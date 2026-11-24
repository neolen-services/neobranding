// The Storyboard and Clips steps of a video. Each shows every scene at once, side by side in the order they play,
// so a problem between scenes (a prop that changes, a place that does not match, a clip that does not join) is
// easy to see. One bar at the top of each step always says the one thing to do next and does it.
import { useRef, useState } from "react";
import type { BrandKit } from "@shared/brand";
import { joinState, pickedClip, pickedPicture, storyboardApproved, type Character, type Video } from "@shared/studio";
import { api } from "./api";
import { inOrder } from "./inOrder";
import { SceneMedia } from "./SceneMedia";
import { useMediaChoices } from "./ServicePicker";
import { Panel } from "./Storyboard";
import { NextBar, smallButton, type VideoProgress } from "./studioUi";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** How many rounds of fixing drawing and checking may take before it stops and leaves the rest to the creator. */
const ROUNDS = 3;
/** Every scene as one card in a grid, in the order they play. */
const GRID = { gridTemplateColumns: "repeat(auto-fill, minmax(12.5rem, 1fr))" };

type Props = {
  video: Video;
  cast: Character[];
  brand: BrandKit;
  busy: string;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onChange: (video: Video) => void;
};

const isAi = (v: Video, i: number) => v.scenes[i].madeBy === "ai";

/** Which scenes a batch is working on right now, to show on their cards. */
function useActive() {
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const add = (id: string) => setActive((a) => new Set(a).add(id));
  const remove = (id: string) =>
    setActive((a) => {
      const next = new Set(a);
      next.delete(id);
      return next;
    });
  return { active, add, remove };
}

/** The Storyboard step: every scene's storyboard at once, drawn, checked, fixed and approved before any clip is made. */
export function StoryboardTab({ video, busy, setError, setNotice, onChange, onNext }: Props & { /** Opens the Clips step. */ onNext: () => void }) {
  const [choices] = useMediaChoices();
  /** What a batch is doing ("" when none). */
  const [doing, setDoing] = useState("");
  const { active, add, remove } = useActive();
  const stop = useRef(false);
  const scenes = video.scenes;

  const ai = scenes.filter((s) => s.madeBy === "ai");
  const missing = scenes.map((_, i) => i).filter((i) => isAi(video, i) && !pickedPicture(scenes[i]));
  const drawn = ai.filter((s) => pickedPicture(s));
  const unchecked = drawn.filter((s) => s.review?.picture !== s.picture && !storyboardApproved(s));
  const toFix = (v: Video) =>
    v.scenes.map((_, i) => i).filter((i) => {
      const s = v.scenes[i];
      return isAi(v, i) && s.picture !== "" && s.review?.picture === s.picture && !s.review.ok && s.review.fix !== "" && !storyboardApproved(s);
    });
  const fixable = toFix(video);
  const unapproved = drawn.filter((s) => !storyboardApproved(s));

  /** Makes storyboards for the given scenes, several at once where one does not lean on another, and returns the video as it then is. */
  async function draw(now: Video, which: number[], dependsOn: (i: number) => number | undefined, change: (v: Video, i: number) => string | undefined) {
    let latest = now;
    let failed = false;
    await inOrder(which, dependsOn, async (i) => {
      const id = now.scenes[i].id;
      add(id);
      try {
        const result = await api.makeScenePicture(now.id, id, choices!.picture, change(latest, i));
        if (!result.ok) {
          failed = true;
          setError(`Scene ${i + 1}: ${result.error}`);
        } else {
          latest = result.video;
          onChange(latest);
        }
        return result.ok;
      } catch (e) {
        failed = true;
        setError(e instanceof Error ? e.message : "The storyboard could not be made.");
        return false;
      } finally {
        remove(id);
      }
    });
    return { video: latest, failed };
  }

  /**
   * Draws what is missing, has the storyboards checked, applies every suggested fix and checks the redrawn ones again,
   * for up to ROUNDS rounds. Stops as soon as nothing has to be fixed, when a scene will not come right after two
   * tries, or when Stop is pressed. It never approves: that stays the creator's call.
   */
  async function settle() {
    if (!choices) return;
    setError("");
    setNotice("");
    stop.current = false;
    let now = video;
    let ended = "";
    const tries = new Map<string, number>();
    // A storyboard is drawn from the one before it when the scene carries on, and otherwise from the nearest earlier
    // scene in the same place, so those are made first. Everything else is made side by side.
    const from = (i: number) => {
      if (i > 0 && now.scenes[i].continues) return i - 1;
      const here = now.scenes[i].place.trim().toLowerCase();
      if (!here) return undefined;
      for (let j = i - 1; j >= 0; j--) if (isAi(now, j) && now.scenes[j].place.trim().toLowerCase() === here) return j;
      return undefined;
    };
    const anyUnchecked = (v: Video) => v.scenes.some((s) => s.madeBy === "ai" && s.picture !== "" && s.review?.picture !== s.picture && !storyboardApproved(s));
    try {
      const gap = now.scenes.map((_, i) => i).filter((i) => isAi(now, i) && !pickedPicture(now.scenes[i]));
      if (gap.length > 0) {
        setDoing(`Drawing ${plural(gap.length, "storyboard")}`);
        const r = await draw(now, gap, from, () => undefined);
        now = r.video;
        if (r.failed) ended = "A storyboard could not be drawn, so it stopped.";
      }
      for (let round = 1; !ended && !stop.current; round++) {
        if (anyUnchecked(now)) {
          setDoing(round > 1 ? `Checking again, round ${round}` : "Checking the storyboards");
          const result = await api.reviewStoryboard(now.id, "new");
          if (!result.ok) {
            setError(result.error);
            ended = "The check could not run, so it stopped.";
            break;
          }
          now = result.video;
          onChange(now);
        }
        const failing = toFix(now);
        if (failing.length === 0 || stop.current) break;
        if (round > ROUNDS) {
          ended = `Stopped after ${plural(ROUNDS, "round")} of fixes.`;
          break;
        }
        // A scene made again twice that still fails is left for the creator: a third try rarely differs.
        const worth = failing.filter((i) => (tries.get(now.scenes[i].id) ?? 0) < 2);
        if (worth.length === 0) {
          ended = "What is left did not come right after two tries each.";
          break;
        }
        for (const i of worth) tries.set(now.scenes[i].id, (tries.get(now.scenes[i].id) ?? 0) + 1);
        setDoing(`Fixing ${plural(worth.length, "storyboard")}`);
        // A fix edits the scene's own storyboard, so none waits for another.
        const r = await draw(now, worth, () => undefined, (v, i) => v.scenes[i].review?.fix);
        now = r.video;
        if (r.failed) ended = "A storyboard could not be made again, so it stopped.";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setDoing("");
    }
    const left = toFix(now).map((i) => i + 1);
    setNotice(
      stop.current
        ? "Stopped."
        : left.length === 0 && !ended
          ? "Every storyboard is drawn and checked. Look through them side by side, then approve."
          : [ended, left.length > 0 && `Still to fix: ${left.length === 1 ? "scene" : "scenes"} ${left.join(", ")}. Change it by hand on its card, or approve it anyway.`].filter(Boolean).join(" "),
    );
  }

  /** Approves every storyboard in use that is not approved yet. */
  async function approveAll() {
    setError("");
    setNotice("");
    setDoing("Approving");
    try {
      for (const s of unapproved) {
        const result = await api.approveStoryboard(video.id, s.id, true);
        if (!result.ok) return setError(result.error);
        onChange(result.video);
      }
      setNotice(`${plural(unapproved.length, "storyboard")} approved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setDoing("");
    }
  }

  if (!choices) return null;
  const off = busy !== "" || doing !== "";

  // The one thing to do next.
  const next =
    ai.length === 0
      ? { title: "Nothing to draw: you film every scene", note: "Add your clips on the next step.", action: "Go to clips", act: async () => onNext() }
      : missing.length > 0
        ? { title: `Draw ${plural(missing.length, "storyboard")}`, note: `Each sheet of four frames is checked and fixed for you, up to ${ROUNDS} rounds. A storyboard costs little; a clip costs a lot.`, action: `Draw ${missing.length === 1 ? "it" : `all ${missing.length}`}`, act: settle }
        : unchecked.length > 0 || fixable.length > 0
          ? {
              title: unchecked.length > 0 ? `Check ${plural(unchecked.length, "storyboard")}` : `Fix ${plural(fixable.length, "storyboard")}`,
              note: "Claude looks at each sheet, and anything that would make the video wrong is redrawn. A few cents a scene, plus the redraws.",
              action: unchecked.length > 0 ? "Check and fix" : "Fix them",
              act: settle,
            }
          : unapproved.length > 0
            ? { title: `Approve ${plural(unapproved.length, "storyboard")}`, note: "Look along the row first: the same place, people and things should match from scene to scene. Each clip follows its storyboard, so this is the cheap moment to change one.", action: `Approve all ${unapproved.length}`, act: approveAll }
            : { title: "Every storyboard is approved", note: "Next, each one is turned into a clip.", action: "Go to clips", act: async () => onNext() };

  return (
    <div className="space-y-5">
      <NextBar title={doing ? `${doing}…` : next.title} note={doing ? "You can keep looking around while this runs." : next.note} action={doing ? undefined : next.action} busy={off} onAction={() => void next.act()}>
        {doing && /Drawing|Checking|Fixing/.test(doing) && (
          <button type="button" className={smallButton} disabled={stop.current} onClick={() => ((stop.current = true), setDoing(`${doing}, stopping after this step`))}>
            Stop
          </button>
        )}
      </NextBar>

      <ol className="grid gap-4" style={GRID} aria-label="Storyboards">
        {scenes.map((s, i) => (
          <li key={s.id} className="flex">
            <div className="flex w-full [&>*]:w-full">
              <Panel video={video} scene={s} index={i} choice={choices.picture} disabled={off} drawing={active.has(s.id)} onVideo={onChange} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The Clips step: every scene's clip at once, made from its approved storyboard, with the voices. */
export function ClipsTab({
  video,
  busy,
  setError,
  setNotice,
  onChange,
  progress,
  onOpenCast,
  onStoryboards,
  onNext,
}: Props & {
  progress: VideoProgress;
  onOpenCast: () => void;
  /** Opens the Storyboard step. */
  onStoryboards: () => void;
  /** Opens the Preview step. */
  onNext: () => void;
}) {
  const [choices] = useMediaChoices();
  const [doing, setDoing] = useState("");
  const { active, add, remove } = useActive();
  const scenes = video.scenes;

  /** A scene whose clip is still to make: its storyboard is approved, and it has no clip or one that no longer joins the clip before it. */
  const clipDue = (v: Video, i: number) => isAi(v, i) && storyboardApproved(v.scenes[i]) && (!pickedClip(v.scenes[i]) || joinState(v.scenes, i) === "stale");
  const clipsDue = scenes.map((_, i) => i).filter((i) => clipDue(video, i));
  const toFilm = scenes.map((_, i) => i).filter((i) => scenes[i].madeBy === "me" && !pickedClip(scenes[i]));
  const waiting = scenes.filter((s) => s.madeBy === "ai" && !storyboardApproved(s));
  const canVoice = progress.unvoiced > 0 && progress.voiceless.length === 0;

  /** Speaks every AI line that has no recording yet. Returns false if it failed. */
  async function voices() {
    setDoing(`Making ${plural(progress.unvoiced, "voice line")}`);
    const result = await api.voiceVideo(video.id);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    onChange(result.video);
    if (result.skipped.length) setNotice(`Voices not made: ${result.skipped.join(", ")}.`);
    return true;
  }

  /**
   * Makes the voices that can be made, then every clip that is due. A scene that carries on opens on the last frame of
   * the clip before it, so it waits for that clip; new shots are made side by side. A clip remade leaves the one carrying
   * on from it out of date, so that one is made again too.
   */
  async function makeAll() {
    if (!choices) return;
    setError("");
    setNotice("");
    try {
      if (canVoice && !(await voices())) return;
      const which: number[] = [];
      for (let i = 0; i < scenes.length; i++) {
        const follows = i > 0 && scenes[i].continues && isAi(video, i) && storyboardApproved(scenes[i]) && which.includes(i - 1);
        if (clipDue(video, i) || follows) which.push(i);
      }
      if (which.length === 0) return;
      let running = 0;
      const show = () => setDoing(running > 0 ? `Making ${plural(running, "clip")}` : "Making clips");
      show();
      const made = await inOrder(
        which,
        (i) => (scenes[i].continues ? i - 1 : undefined),
        async (i) => {
          running++;
          show();
          add(scenes[i].id);
          try {
            const result = await api.makeSceneClip(video.id, scenes[i].id, choices.clip);
            if (!result.ok) setError(`Scene ${i + 1}: ${result.error}`);
            else onChange(result.video);
            return result.ok;
          } catch (e) {
            setError(e instanceof Error ? e.message : "The clip could not be made.");
            return false;
          } finally {
            running--;
            show();
            remove(scenes[i].id);
          }
        },
      );
      if (made > 0) setNotice(`${plural(made, "clip")} made. Play the whole video from the top bar to see them run together.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setDoing("");
    }
  }

  async function oneVoiceRun() {
    setError("");
    setNotice("");
    try {
      if (await voices()) setNotice("Every line is recorded.");
    } finally {
      setDoing("");
    }
  }

  if (!choices) return null;
  const off = busy !== "" || doing !== "";

  const next =
    clipsDue.length > 0
      ? {
          title: `Make ${plural(clipsDue.length, "clip")}${canVoice ? ` and ${plural(progress.unvoiced, "voice line")}` : ""}`,
          note: `The costly step: each clip is charged by your clip service${canVoice ? ", and voices by ElevenLabs" : ""}. New shots are made side by side.`,
          action: `Make ${clipsDue.length === 1 ? "it" : `all ${clipsDue.length}`}`,
          act: makeAll,
        }
      : toFilm.length > 0
        ? { title: `Film ${toFilm.length === 1 ? `scene ${toFilm[0] + 1}` : `scenes ${toFilm.map((i) => i + 1).join(", ")}`} and add your clip`, note: "Each card says what happens in the scene; add your clip there." }
        : canVoice
          ? { title: `Make ${plural(progress.unvoiced, "voice line")}`, note: "Charged by ElevenLabs.", action: "Make them", act: oneVoiceRun }
          : waiting.length > 0
            ? { title: `${plural(waiting.length, "scene")} ${waiting.length === 1 ? "waits" : "wait"} for an approved storyboard`, note: "A clip is made only from an approved storyboard.", action: "Go to storyboards", act: async () => onStoryboards() }
            : { title: "Every clip is ready", note: "Watch the whole video through on the last step.", action: "Go to preview", act: async () => onNext() };

  return (
    <div className="space-y-5">
      <NextBar title={doing ? `${doing}…` : next.title} note={doing ? "This can take minutes. You can keep looking around while it runs." : next.note} action={doing ? undefined : next.action} busy={off} onAction={() => void next.act?.()}>
        {!doing && progress.voiceless.length > 0 && (
          <button type="button" className={smallButton} onClick={onOpenCast} title="Their lines cannot be spoken until they have a voice.">
            No voice yet: {progress.voiceless.join(", ")}
          </button>
        )}
      </NextBar>

      <ol className="grid gap-4" style={GRID} aria-label="Clips">
        {scenes.map((s, i) => (
          <li key={s.id} className="flex [&>*]:w-full">
            <SceneMedia video={video} scene={s} index={i} choices={choices} disabled={off} making={active.has(s.id)} onVideo={onChange} onStoryboard={onStoryboards} tile />
          </li>
        ))}
      </ol>
    </div>
  );
}
