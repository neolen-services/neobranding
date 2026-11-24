// The Storyboard tab of a video: one storyboard for every scene, a sheet of four frames showing
// what happens in it. The work goes in four steps, shown at the top: draw them, have them checked,
// fix what would make the video wrong, approve. One button always does the next step.
import { useEffect, useRef, useState } from "react";
import type { MediaChoice } from "@shared/media";
import { pickedPicture, storyboardApproved, type Scene, type TakeResult, type Video } from "@shared/studio";
import { api } from "./api";
import { inOrder } from "./inOrder";
import { readUpload, ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import { card, Chip, fieldClass, Icon, ICONS, label, primaryButton, quietButton, smallButton } from "./studioUi";

const MAX_PICTURE = 30 * 1024 * 1024;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function StoryboardTab({
  video,
  busy,
  save,
  setError,
  setNotice,
  onChange,
  onNext,
}: {
  video: Video;
  /** What the page is doing right now, or "". */
  busy: string;
  save: (changes: Partial<Video>, keepApproval?: boolean) => Promise<boolean>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  onChange: (video: Video) => void;
  /** Opens the Preview tab. */
  onNext: () => void;
}) {
  const [look, setLook] = useState(video.look);
  /** What a batch is doing ("" when none), and the scenes it is working on right now. */
  const [doing, setDoing] = useState("");
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const keys = useMediaKeys();
  const [choices, setChoice] = useMediaChoices();
  /** How many rounds of fixing the automatic run may take, what it is doing now ("" when it is not running), and whether Stop was pressed. */
  const [rounds, setRounds] = useState(3);
  const [auto, setAuto] = useState("");
  const stop = useRef(false);

  const scenes = video.scenes;
  const isAi = (i: number) => scenes[i].madeBy === "ai";
  const ai = scenes.filter((s) => s.madeBy === "ai");
  const drawn = ai.filter((s) => pickedPicture(s));
  const missing = scenes.map((_, i) => i).filter((i) => isAi(i) && !pickedPicture(scenes[i]));
  const checked = drawn.filter((s) => s.review?.picture === s.picture);
  const approved = drawn.filter(storyboardApproved);
  /** Storyboards the check says would make the video wrong, that have a fix to apply and are not approved. */
  const fixable = scenes.map((_, i) => i).filter((i) => {
    const s = scenes[i];
    return isAi(i) && s.picture !== "" && s.review?.picture === s.picture && !s.review.ok && s.review.fix !== "" && !storyboardApproved(s);
  });
  const filmed = scenes.length - ai.length;

  /** Makes storyboards for the given scenes, several at once where one does not lean on another. */
  async function make(what: string, which: number[], dependsOn: (i: number) => number | undefined, change: (i: number) => string | undefined) {
    if (!choices) return 0;
    setError("");
    setNotice("");
    setDoing(what);
    const done = await inOrder(which, dependsOn, async (i) => {
      const id = scenes[i].id;
      setActive((now) => new Set(now).add(id));
      try {
        const result = await api.makeScenePicture(video.id, id, choices.picture, change(i));
        if (!result.ok) setError(`Scene ${i + 1}: ${result.error}`);
        else onChange(result.video);
        return result.ok;
      } catch (e) {
        setError(e instanceof Error ? e.message : "The storyboard could not be made.");
        return false;
      } finally {
        setActive((now) => {
          const next = new Set(now);
          next.delete(id);
          return next;
        });
      }
    });
    setDoing("");
    return done;
  }

  // A storyboard is drawn from the one before it when the scene carries on, and otherwise from the nearest
  // earlier scene in the same place, so those are made first. Everything else is made side by side.
  const drawnFrom = (i: number) => {
    if (i > 0 && scenes[i].continues) return i - 1;
    const here = scenes[i].place.trim().toLowerCase();
    if (!here) return undefined;
    for (let j = i - 1; j >= 0; j--) if (isAi(j) && scenes[j].place.trim().toLowerCase() === here) return j;
    return undefined;
  };
  const makeMissing = () => make("Drawing", missing, drawnFrom, () => undefined);
  const applyFixes = async () => {
    // A fix edits the scene's own storyboard, so none waits for another.
    const done = await make("Fixing", fixable, () => undefined, (i) => scenes[i].review?.fix);
    if (done > 0) setNotice(`${plural(done, "storyboard")} made again with the suggested ${done === 1 ? "fix" : "fixes"}. Check the new ${done === 1 ? "one" : "ones"}, or look and approve.`);
  };

  /** Has Claude look at the storyboards not checked yet, or at all of them again. */
  async function check(everything: boolean) {
    setDoing("Checking");
    setError("");
    setNotice("");
    try {
      const result = await api.reviewStoryboard(video.id, everything ? undefined : "new");
      if (!result.ok) return setError(result.error);
      const reopened = result.video.scenes.filter((s, i) => storyboardApproved(scenes[i] ?? s) && !storyboardApproved(s)).length;
      onChange(result.video);
      const bad = result.video.scenes.filter((s) => s.review?.picture === s.picture && !s.review.ok && !storyboardApproved(s)).length;
      setNotice(
        bad === 0
          ? "Checked: nothing has to be fixed. Look through them yourself, then approve."
          : `Checked: ${plural(bad, "storyboard")} ${bad === 1 ? "has" : "have"} something that would make the video wrong. The notes are under each one.${reopened > 0 ? ` ${reopened === 1 ? "One of them was approved, so its approval was" : `${reopened} of them were approved, so their approval was`} taken back.` : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The storyboards could not be checked.");
    } finally {
      setDoing("");
    }
  }

  /**
   * Does the whole loop without being asked at each step: draws what is missing, has the storyboards checked,
   * applies every suggested fix, and checks the redrawn ones again, for up to `rounds` rounds of fixing.
   * It stops as soon as nothing has to be fixed, when a round fixes nothing, or when Stop is pressed.
   * It never approves: that stays the creator's call.
   */
  async function autoFix() {
    if (!choices) return;
    setError("");
    setNotice("");
    stop.current = false;
    let now = video;
    let drawn = 0;
    let checks = 0;
    /** How many times each scene has been made again, so one that will not come right is not retried for ever. */
    const tries = new Map<string, number>();
    const isAi = (v: Video, i: number) => v.scenes[i].madeBy === "ai";
    const toFix = (v: Video) =>
      v.scenes.map((_, i) => i).filter((i) => {
        const sc = v.scenes[i];
        return isAi(v, i) && sc.picture !== "" && sc.review?.picture === sc.picture && !sc.review.ok && sc.review.fix !== "" && !storyboardApproved(sc);
      });
    const unchecked = (v: Video) => v.scenes.some((sc) => sc.madeBy === "ai" && sc.picture !== "" && sc.review?.picture !== sc.picture && !storyboardApproved(sc));
    /** Makes storyboards for the given scenes, several at once, and returns whether all of them worked. */
    const draw = async (which: number[], dependsOn: (i: number) => number | undefined, change: (i: number) => string | undefined) => {
      const made = await inOrder(which, dependsOn, async (i) => {
        const id = now.scenes[i].id;
        setActive((a) => new Set(a).add(id));
        try {
          const result = await api.makeScenePicture(now.id, id, choices.picture, change(i));
          if (!result.ok) setError(`Scene ${i + 1}: ${result.error}`);
          else {
            now = result.video;
            onChange(now);
            drawn++;
          }
          return result.ok;
        } catch (e) {
          setError(e instanceof Error ? e.message : "The storyboard could not be made.");
          return false;
        } finally {
          setActive((a) => {
            const next = new Set(a);
            next.delete(id);
            return next;
          });
        }
      });
      return made === which.length;
    };
    const check = async () => {
      const result = await api.reviewStoryboard(now.id, "new");
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      now = result.video;
      onChange(now);
      checks++;
      return true;
    };

    let ended = "";
    try {
      const missingNow = now.scenes.map((_, i) => i).filter((i) => isAi(now, i) && !pickedPicture(now.scenes[i]));
      if (missingNow.length > 0) {
        setAuto(`Drawing ${plural(missingNow.length, "storyboard")}`);
        const from = (i: number) => {
          if (i > 0 && now.scenes[i].continues) return i - 1;
          const here = now.scenes[i].place.trim().toLowerCase();
          if (!here) return undefined;
          for (let j = i - 1; j >= 0; j--) if (isAi(now, j) && now.scenes[j].place.trim().toLowerCase() === here) return j;
          return undefined;
        };
        if (!(await draw(missingNow, from, () => undefined))) ended = "A storyboard could not be drawn, so it stopped.";
      }
      for (let round = 1; !ended && !stop.current; round++) {
        if (unchecked(now)) {
          setAuto(`Checking${round > 1 ? `, round ${round}` : ""}`);
          if (!(await check())) {
            ended = "The check could not be run, so it stopped.";
            break;
          }
        }
        const failing = toFix(now);
        if (failing.length === 0) break;
        if (round > rounds) {
          ended = `Stopped after ${plural(rounds, "round")}.`;
          break;
        }
        // A scene that has been made again twice and still fails is left for the creator: a third try rarely differs.
        const worth = failing.filter((i) => (tries.get(now.scenes[i].id) ?? 0) < 2);
        if (worth.length === 0) {
          ended = "What is left did not come right after two tries each.";
          break;
        }
        if (stop.current) break;
        setAuto(`Fixing ${plural(worth.length, "storyboard")}, round ${round} of ${rounds}`);
        for (const i of worth) tries.set(now.scenes[i].id, (tries.get(now.scenes[i].id) ?? 0) + 1);
        // A fix edits a scene's own storyboard, so none waits for another.
        if (!(await draw(worth, () => undefined, (i) => now.scenes[i].review?.fix))) {
          ended = "A storyboard could not be made again, so it stopped.";
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setAuto("");
    }
    const left = toFix(now).map((i) => i + 1);
    const did = [drawn > 0 && `${plural(drawn, "storyboard")} drawn`, checks > 0 && `${plural(checks, "check")} run`].filter(Boolean).join(", ");
    setNotice(
      [
        stop.current ? "Stopped." : left.length === 0 && !unchecked(now) ? "Nothing has to be fixed any more. Look through them, then approve." : ended,
        left.length > 0 && `Still to fix: ${left.length === 1 ? "scene" : "scenes"} ${left.join(", ")}.`,
        did && `${did.charAt(0).toUpperCase()}${did.slice(1)}.`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  /** Approves every storyboard in use that is not approved yet. */
  async function approveAll() {
    setError("");
    setNotice("");
    setDoing("Approving");
    let done = 0;
    try {
      for (const scene of drawn.filter((s) => !storyboardApproved(s))) {
        const result = await api.approveStoryboard(video.id, scene.id, true);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        done++;
        onChange(result.video);
      }
      if (done > 0) setNotice(`${plural(done, "storyboard")} approved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setDoing("");
    }
  }

  if (!choices) return null;
  const off = busy !== "" || doing !== "" || auto !== "";
  const unchecked = drawn.length - checked.length;
  const unapproved = drawn.length - approved.length;
  const allApproved = ai.length > 0 && missing.length === 0 && unapproved === 0;

  // The one thing to do next, and the four steps it belongs to.
  const stage = missing.length > 0 ? 0 : unchecked > 0 ? 1 : fixable.length > 0 ? 2 : unapproved > 0 ? 3 : 4;
  const steps = [
    { name: "Draw", count: `${drawn.length} of ${ai.length}`, done: missing.length === 0 },
    { name: "Check", count: `${checked.length} of ${drawn.length}`, done: drawn.length > 0 && unchecked === 0 },
    { name: "Fix", count: fixable.length > 0 ? `${fixable.length} to fix` : "nothing to fix", done: drawn.length > 0 && unchecked === 0 && fixable.length === 0 },
    { name: "Approve", count: `${approved.length} of ${drawn.length}`, done: allApproved },
  ];
  const next = [
    { text: `Draw ${plural(missing.length, "storyboard")}`, busy: "Drawing", act: () => void makeMissing(), note: "Scenes that do not lean on each other are drawn at the same time." },
    { text: `Check ${plural(unchecked, "storyboard")}`, busy: "Checking", act: () => void check(false), note: "Claude looks at each sheet. Uses your Claude credits: roughly 2 to 3 cents a scene." },
    { text: `Apply ${plural(fixable.length, "suggested fix", "suggested fixes")}`, busy: "Fixing", act: () => void applyFixes(), note: "Each one is made again from its current storyboard with only the fix changed." },
    { text: `Approve all ${unapproved}`, busy: "Approving", act: () => void approveAll(), note: "Or approve them one at a time below, after looking at each." },
    { text: "Next: preview it", busy: "", act: onNext, note: "Watch the storyboards play in order with the voices before any clip is made." },
  ][stage];
  const working = doing ? `${doing}${active.size > 0 ? ` ${plural(active.size, "scene")}` : ""}…` : "";

  return (
    <div className="space-y-5">
      <section className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold">Storyboard</h3>
            <p className="mt-0.5 max-w-2xl text-sm opacity-60">
              One sheet of four frames for each scene, showing what happens in it. Settle them here, because a storyboard costs little and a clip costs a lot.
              {filmed > 0 && ` ${plural(filmed, "scene")} you film ${filmed === 1 ? "needs" : "need"} none.`}
            </p>
          </div>
          {ai.length > 0 && (
            <div className="text-right">
              <button type="button" className={`${primaryButton} inline-flex items-center gap-2`} disabled={off} onClick={next.act}>
                {working && doing === next.busy ? working : next.text}
                {stage === 4 && <Icon d={ICONS.arrow} />}
              </button>
              <p className="mt-1.5 max-w-xs text-xs opacity-55">{next.note}</p>
            </div>
          )}
        </div>

        {ai.length > 0 && (
          <ol className="grid gap-2 sm:grid-cols-4" aria-label="Steps">
            {steps.map((step, i) => (
              <li
                key={step.name}
                aria-current={i === stage ? "step" : undefined}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${i === stage ? "border-[var(--primary)] bg-[var(--tint)]" : "border-[var(--line)]"} ${i > stage ? "opacity-55" : ""}`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold ${step.done ? "bg-[var(--primary)] text-white" : "border border-[var(--line)]"}`}>
                  {step.done ? <Icon d={ICONS.check} className="h-3 w-3" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{step.name}</span>
                  <span className="block truncate text-xs opacity-60">{step.count}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {ai.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
            {auto ? (
              <span className="flex items-center gap-3 rounded-full border border-[var(--primary)] bg-[var(--tint)] py-1 pl-4 pr-1 text-sm">
                <span role="status">{auto}…</span>
                <button type="button" className={smallButton} disabled={stop.current} onClick={() => ((stop.current = true), setAuto(`${auto}, stopping after this step`))}>
                  Stop
                </button>
              </span>
            ) : (
              stage < 3 && (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className={smallButton}
                    disabled={off}
                    title="Draws what is missing, checks, applies every suggested fix and checks again, until nothing has to be fixed or the rounds run out. It never approves for you."
                    onClick={() => void autoFix()}
                  >
                    Check and fix automatically
                  </button>
                  <label className="flex items-center gap-1.5 text-xs opacity-70">
                    up to
                    <select className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 py-1" aria-label="Rounds of fixing" value={rounds} disabled={off} onChange={(e) => setRounds(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    {rounds === 1 ? "round" : "rounds"}
                  </label>
                </span>
              )
            )}
            {/* The steps that are not next are still within reach, as quiet buttons. */}
            {stage !== 1 && drawn.length > 0 && (
              <button type="button" className={smallButton} disabled={off} title="Claude looks at every storyboard again, including those already checked. Uses your Claude credits." onClick={() => void check(true)}>
                {doing === "Checking" ? "Checking…" : "Check all again"}
              </button>
            )}
            {stage !== 2 && fixable.length > 0 && (
              <button type="button" className={smallButton} disabled={off} onClick={() => void applyFixes()}>
                Apply {plural(fixable.length, "suggested fix", "suggested fixes")}
              </button>
            )}
            {stage !== 3 && unapproved > 0 && (
              <button type="button" className={smallButton} disabled={off} title="Approves every storyboard as it is, including any the check says have something to fix." onClick={() => void approveAll()}>
                Approve all {unapproved}
              </button>
            )}
            <details className="ml-auto text-sm" open={drawn.length === 0}>
              <summary className="cursor-pointer text-xs opacity-60 hover:opacity-100">Picture service and look</summary>
              <div className="mt-3 grid w-[min(44rem,80vw)] gap-4 md:grid-cols-3">
                <ServicePicker task="picture" value={choices.picture} keys={keys} onChange={(c) => setChoice("picture", c)} stacked />
                <label className="block text-sm md:col-span-2">
                  <span className={label}>Look every AI scene shares</span>
                  <input
                    className={`${fieldClass} mt-1.5`}
                    placeholder="For example: realistic film, warm evening light, shallow focus"
                    value={look}
                    onChange={(e) => setLook(e.target.value)}
                    onBlur={() => look.trim() !== video.look && void save({ look: look.trim() }, true)}
                  />
                </label>
              </div>
            </details>
          </div>
        )}
      </section>

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {scenes.map((scene, index) => (
          <Panel key={scene.id} video={video} scene={scene} index={index} choice={choices.picture} disabled={off} drawing={active.has(scene.id)} onVideo={onChange} />
        ))}
      </ol>

      {ai.length === 0 && (
        <section className={`${card} flex flex-wrap items-center gap-3`}>
          <p className="min-w-0 flex-1 text-sm opacity-70">You film every scene of this video, so there is nothing to draw.</p>
          <button type="button" className={`${primaryButton} flex items-center gap-2`} disabled={off} onClick={onNext}>
            Next: preview it
            <Icon d={ICONS.arrow} />
          </button>
        </section>
      )}
    </div>
  );
}

/** One scene of the storyboard: its sheet of frames, what the check said, and the ways to redo or approve it. */
function Panel({
  video,
  scene,
  index,
  choice,
  disabled,
  drawing,
  onVideo,
}: {
  video: Video;
  scene: Scene;
  index: number;
  /** The service that makes pictures on this page. */
  choice: MediaChoice;
  disabled: boolean;
  /** A batch started from the top of the page is making this scene's storyboard right now. */
  drawing: boolean;
  onVideo: (video: Video) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The full-size view closes with Esc.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  async function run(what: string, work: () => Promise<TakeResult>) {
    setBusy(what);
    setError("");
    try {
      const result = await work();
      if (result.ok) onVideo(result.video);
      else setError(result.error);
      return result.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy("");
    }
  }

  const picture = pickedPicture(scene);
  const filmed = scene.madeBy === "me";
  const off = disabled || busy !== "";
  const makePicture = async (change = note) => (await run("Making", () => api.makeScenePicture(video.id, scene.id, choice, change))) && setNote("");
  const beforeHasPicture = index > 0 && Boolean(pickedPicture(video.scenes[index - 1]));
  const isApproved = !filmed && storyboardApproved(scene);
  // What the check said about the storyboard now in use; notes about an earlier one no longer apply.
  const review = picture && scene.review?.picture === picture.id ? scene.review : null;
  const making = drawing || busy === "Making";

  return (
    <li className={`${card} flex flex-col gap-3 !p-3 ${isApproved ? "border-[var(--primary)]/60" : ""}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold tabular-nums">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-60" title={scene.place}>
          {scene.seconds}s{scene.place && ` · ${scene.place}`}
        </span>
        {filmed ? (
          <Chip tone="warn">You film</Chip>
        ) : isApproved ? (
          <Chip tone="good">Approved</Chip>
        ) : review ? (
          <Chip tone={review.ok ? "good" : "warn"}>{review.ok ? "Ready to approve" : "To fix"}</Chip>
        ) : picture ? (
          <Chip>Not checked</Chip>
        ) : null}
      </div>

      {index > 0 && !filmed ? (
        <div role="radiogroup" aria-label={`How scene ${index + 1} starts`} className="flex min-h-[1.875rem] rounded-full border border-[var(--line)] p-0.5 text-xs font-medium">
          {(
            [
              [true, "Carries on", `Scene ${index + 1} carries straight on from scene ${index} with no cut. Its storyboard is drawn from the storyboard before it.`],
              [false, "New shot", `Scene ${index + 1} is a new shot: a cut.`],
            ] as const
          ).map(([value, text, title]) => (
            <button
              key={text}
              type="button"
              role="radio"
              aria-checked={scene.continues === value}
              title={title}
              disabled={off}
              onClick={() => scene.continues !== value && void run("Changing", () => api.setSceneFlow(video.id, scene.id, value))}
              className={`flex-1 rounded-full px-2 py-1 ${scene.continues === value ? "bg-[var(--tint)]" : "opacity-55 hover:opacity-100"}`}
            >
              {text}
            </button>
          ))}
        </div>
      ) : (
        <p className="flex min-h-[1.875rem] items-center px-1 text-xs opacity-55">{index === 0 ? "Opening shot" : scene.continues ? `Carries on from scene ${index}` : "New shot"}</p>
      )}

      <div className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-black text-center text-xs text-white/60">
        {picture ? (
          <button type="button" title="Look at it full size" className="block h-full w-full cursor-zoom-in" onClick={() => setZoomed(true)}>
            <img src={api.studioFileUrl(picture.file)} alt={`Storyboard for scene ${index + 1}: ${scene.action}`} className="h-full w-full object-cover" />
          </button>
        ) : (
          <span className="flex flex-col items-center gap-2 px-4">
            <Icon d={filmed ? ICONS.camera : ICONS.ai} className="h-6 w-6 opacity-60" />
            {filmed ? "You film this scene. Add your clip on the Make tab." : "No storyboard yet"}
          </span>
        )}
        {making && <span className="absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-sm text-white">Drawing the storyboard…</span>}
      </div>

      <div className="space-y-1">
        <p className="line-clamp-3 text-sm leading-relaxed" title={scene.action}>
          {scene.action}
        </p>
        {scene.lines[0] && <p className="line-clamp-2 text-sm italic opacity-60">“{scene.lines[0].text}”</p>}
      </div>

      {review && !isApproved && (review.problems.length > 0 || review.minor.length > 0) && (
        <div className={`rounded-xl border px-3 py-2 text-sm ${review.ok ? "border-[var(--line)]" : "border-[var(--accent)]/50 bg-[var(--accent)]/10"}`}>
          {review.problems.length > 0 && (
            <>
              <p className="text-xs font-medium uppercase tracking-wide opacity-70">Would make the video wrong</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-snug">
                {review.problems.map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            </>
          )}
          {review.problems.some((p) => /^not fixed/i.test(p.trim())) && (
            <p className="mt-2 rounded-lg bg-black/20 px-2.5 py-2 text-xs leading-relaxed">
              This has been tried and came back the same. Applying the fix again draws it afresh, but if it keeps failing, use a stronger picture model (Nano Banana Pro, under “Picture service and look” at the top), or approve it if the video can live with it.
            </p>
          )}
          {review.fix && (
            <>
              <p className="mt-2 text-xs opacity-80">
                <span className="font-medium">Suggested fix:</span> {review.fix}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={`${primaryButton} !px-3 !py-1 !text-xs`} disabled={off} onClick={() => void makePicture(review.fix)}>
                  {busy === "Making" ? "Making…" : "Apply this fix"}
                </button>
                <button type="button" className={smallButton} disabled={off} title="Puts the suggested fix in the box below, so you can change the words first." onClick={() => setNote(review.fix)}>
                  Edit it first
                </button>
              </div>
            </>
          )}
          {review.minor.length > 0 && (
            <details className={`text-xs opacity-70 ${review.problems.length > 0 ? "mt-2" : ""}`}>
              <summary className="cursor-pointer">
                {review.minor.length === 1 ? "1 small thing" : `${review.minor.length} small things`} a viewer would not notice
              </summary>
              <ul className="mt-1 list-disc space-y-1 pl-4 leading-snug">
                {review.minor.map((flaw, i) => (
                  <li key={i}>{flaw}</li>
                ))}
              </ul>
              <p className="mt-1">Making it again over these would only bring new ones.</p>
            </details>
          )}
        </div>
      )}

      {!filmed && (
        <div className="mt-auto space-y-2">
          {picture && (
            <button
              type="button"
              className={isApproved ? `${smallButton} w-full` : review && !review.ok ? `${quietButton} w-full !py-1.5` : `${primaryButton} w-full !py-1.5`}
              disabled={off}
              onClick={() => void run("Approving", () => api.approveStoryboard(video.id, scene.id, !isApproved))}
            >
              {isApproved ? "Approved · take it back" : review && !review.ok ? "Approve anyway" : "Approve"}
            </button>
          )}
          {!picture && (
            <button type="button" className={`${primaryButton} w-full !py-1.5`} disabled={off} onClick={() => void makePicture("")}>
              {making ? "Drawing…" : "Draw this storyboard"}
            </button>
          )}
          {!picture && scene.continues && index > 0 && !beforeHasPicture && <p className="text-xs opacity-60">Scene {index}'s storyboard comes first: this one is drawn from it.</p>}

          {picture && !isApproved && (
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none"
                placeholder="What should change?"
                aria-label={`What should change in the storyboard for scene ${index + 1}`}
                value={note}
                disabled={off}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && note.trim() && !off && void makePicture()}
              />
              <button type="button" className={smallButton} disabled={off || !note.trim()} title="Makes this storyboard again with only that change." onClick={() => void makePicture()}>
                Change
              </button>
            </div>
          )}

          {picture && (
            <details className="text-xs">
              <summary className="cursor-pointer opacity-60 hover:opacity-100">More</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={smallButton} disabled={off} title="Draws a different storyboard from the script, not an edit of this one." onClick={() => void makePicture("")}>
                  Draw a different one
                </button>
                <button type="button" className={smallButton} disabled={off} title="Claude looks at this storyboard and writes what is wrong with it. Uses your Claude credits." onClick={() => void run("Checking", () => api.reviewStoryboard(video.id, scene.id))}>
                  {busy === "Checking" ? "Checking…" : review ? "Check again" : "Check this one"}
                </button>
                <button type="button" className={smallButton} disabled={off} onClick={() => fileInput.current?.click()}>
                  {busy === "Adding" ? "Adding…" : "Add your own"}
                </button>
              </div>
              {scene.pictures.length > 1 && (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Storyboards made for scene ${index + 1}`}>
                  {scene.pictures.map((take, i) => {
                    const using = take.id === scene.picture;
                    const what = `Storyboard ${i + 1}${take.source === "upload" ? " · added by you" : take.madeWith ? ` · ${take.madeWith}` : ""}`;
                    return (
                      <li key={take.id} className="group relative">
                        <button
                          type="button"
                          aria-pressed={using}
                          aria-label={`${what}${using ? " (in use)" : ""}`}
                          title={`${what}${using ? " · in use" : " · click to use"}`}
                          disabled={off}
                          onClick={() => !using && run("Choosing", () => api.changeTake(video.id, scene.id, take.id, "use"))}
                          className={`block aspect-[9/16] w-9 overflow-hidden rounded-md border-2 bg-black ${using ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"}`}
                        >
                          <img src={api.studioFileUrl(take.file)} alt="" className="h-full w-full object-cover" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${what}`}
                          title="Remove"
                          disabled={off}
                          onClick={() => run("Removing", () => api.changeTake(video.id, scene.id, take.id, "remove"))}
                          className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] hover:border-red-400 hover:text-red-400 group-focus-within:flex group-hover:flex"
                        >
                          <Icon d={ICONS.close} className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </details>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > MAX_PICTURE) return setError("That picture is over 30 MB. Use a smaller one.");
              await run("Adding", async () => api.addSceneFile(video.id, scene.id, await readUpload(file)));
            }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}

      {zoomed && picture && (
        <div role="dialog" aria-modal="true" aria-label={`Storyboard for scene ${index + 1}`} className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6" onClick={() => setZoomed(false)}>
          <img src={api.studioFileUrl(picture.file)} alt={`Storyboard for scene ${index + 1}: ${scene.action}`} className="max-h-full max-w-full rounded-xl object-contain" />
          <button type="button" autoFocus className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm font-medium text-white hover:border-white" onClick={() => setZoomed(false)}>
            <Icon d={ICONS.close} className="h-4 w-4" />
            Close
          </button>
        </div>
      )}
    </li>
  );
}
