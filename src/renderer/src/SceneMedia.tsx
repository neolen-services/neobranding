import { useRef, useState } from "react";
import type { MediaSettings } from "@shared/media";
import { boardId, joinState, pickedClip, pickedPicture, storyboardApproved, type Scene, type TakeResult, type Video } from "@shared/studio";
import { MotionPlayer } from "./MotionBoard";
import { api } from "./api";
import { readUpload } from "./ServicePicker";
import { card, Chip, Icon, ICONS, primaryButton, smallButton } from "./studioUi";

const MAX_UPLOAD = 300 * 1024 * 1024;
const TAKE_SOURCE: Record<string, string> = { lipsync: "Lip-synced", filmed: "Filmed by you" };

/**
 * One scene on the Make tab: its clip, made to follow the storyboard settled on the Storyboard tab.
 * A scene that carries on from the one before opens on the last frame of that scene's clip, so the
 * two play as one take. Every attempt is kept as a take to switch between.
 */
export function SceneMedia({
  video,
  scene,
  index,
  choices,
  disabled,
  onVideo,
  onStoryboard,
}: {
  video: Video;
  scene: Scene;
  index: number;
  /** The service chosen for each job on this page. */
  choices: MediaSettings;
  disabled: boolean;
  onVideo: (video: Video) => void;
  /** Opens the Storyboard tab, where a scene's storyboard is made. */
  onStoryboard: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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
  const clip = pickedClip(scene);
  const hasVoice = scene.lines.some((l) => l.audioFile);
  // A motion graphics scene has an animation where others have a storyboard, and its clip is rendered here, not sent to a service.
  const { animation } = scene;
  const outOfDate = Boolean(animation && clip && clip.source !== "filmed" && clip.from !== animation.id);
  const off = disabled || busy !== "";
  const filmed = scene.madeBy === "me";
  const carriesOn = !filmed && index > 0 && scene.continues;
  const join = joinState(video.scenes, index);
  const beforeHasClip = index > 0 && Boolean(pickedClip(video.scenes[index - 1]));

  const makeClip = () => run("Making the clip", () => api.makeSceneClip(video.id, scene.id, choices.clip));
  const lipSync = () => run("Lip-syncing", () => api.makeSceneLipSync(video.id, scene.id, choices.lipsync));
  const addFile = () => fileInput.current?.click();

  // How this scene meets the ones around it, in a sentence.
  const flow = filmed
    ? ""
    : animation
      ? outOfDate
        ? "The animation changed after this clip was rendered. Render it again."
        : ""
      : [
        index === 0
          ? "Opening shot."
          : !carriesOn
            ? "New shot."
            : join === "joined"
              ? `Opens where scene ${index} ends.`
              : join === "stale"
                ? `Does not open where scene ${index} now ends. Remake it to join them.`
                : beforeHasClip
                  ? `Carries on from scene ${index}: opens on its last frame.`
                  : `Carries on from scene ${index}. Make scene ${index}'s clip first, so this one opens on its last frame.`,
      ]
        .filter(Boolean)
        .join(" ");

  return (
    <article className={`${card} flex gap-4 !p-4`}>
      <div className="flex aspect-[9/16] w-32 shrink-0 items-center justify-center self-start overflow-hidden rounded-xl border border-[var(--line)] bg-black text-center text-xs text-white/60">
        {clip ? (
          <video controls preload="metadata" src={api.studioFileUrl(clip.file)} poster={picture ? api.studioFileUrl(picture.file) : undefined} className="h-full w-full object-cover" />
        ) : animation ? (
          <MotionPlayer key={animation.id} video={video} scene={scene} className="h-full w-full" />
        ) : picture ? (
          <img src={api.studioFileUrl(picture.file)} alt={`Storyboard: ${scene.action}`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 px-3">
            <Icon d={filmed ? ICONS.camera : ICONS.ai} className="h-6 w-6 opacity-60" />
            {filmed ? "Your clip goes here" : "No storyboard"}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-display text-base font-semibold">Scene {index + 1}</h4>
          <span className="text-xs opacity-55">
            {scene.seconds}s{scene.place && ` · ${scene.place}`}
          </span>
          <span className="ml-auto flex gap-1.5">
            {filmed ? (
              <Chip tone={clip ? "good" : "warn"}>{clip ? "Clip added" : "You film this"}</Chip>
            ) : join === "stale" ? (
              <Chip tone="warn">Not joined</Chip>
            ) : (
              <Chip tone={clip ? "good" : "plain"}>{clip ? (join === "joined" ? "Joined clip" : "Clip") : "No clip"}</Chip>
            )}
          </span>
        </div>

        {flow && <p className={`text-xs ${join === "stale" ? "text-[var(--accent)]" : "opacity-60"}`}>{flow}</p>}
        <p className="line-clamp-2 text-sm leading-relaxed">{scene.action}</p>
        {scene.lines[0] && <p className="line-clamp-2 text-sm italic opacity-60">“{scene.lines[0].text}”</p>}

        {!filmed && (!boardId(scene) || (animation && !storyboardApproved(scene))) ? (
          <button type="button" className={smallButton} disabled={off} onClick={onStoryboard}>
            {animation ? "Approve its animation first" : "Make its storyboard first"}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {filmed ? (
              <button type="button" className={clip ? smallButton : `${primaryButton} !px-4 !py-1.5`} disabled={off} onClick={addFile}>
                {busy === "Adding your file" ? "Adding…" : clip ? "Replace your clip" : "Add your filmed clip"}
              </button>
            ) : (
              <>
                <button type="button" className={!clip || join === "stale" || outOfDate ? `${primaryButton} !px-4 !py-1.5` : smallButton} disabled={off} onClick={() => void makeClip()}>
                  {animation
                    ? busy === "Making the clip"
                      ? "Rendering…"
                      : clip
                        ? "Render again"
                        : "Render clip"
                    : busy === "Making the clip"
                      ? "Making the clip… this can take minutes"
                      : join === "stale"
                        ? "Remake clip to join"
                        : clip
                          ? "Make another clip"
                          : "Make clip"}
                </button>
                {!animation && (
                  <button
                    type="button"
                    className={smallButton}
                    disabled={off || !hasVoice}
                    title={hasVoice ? "Makes the speaking character's reference picture say the scene's first recorded line." : "Make the voices first (Preview tab): lip-sync needs a recorded line."}
                    onClick={() => void lipSync()}
                  >
                    {busy === "Lip-syncing" ? "Lip-syncing… this can take minutes" : "Lip-sync"}
                  </button>
                )}
                <button type="button" className={smallButton} disabled={off} onClick={addFile}>
                  {busy === "Adding your file" ? "Adding…" : "Add your own clip"}
                </button>
              </>
            )}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          accept="video/mp4,video/quicktime,video/webm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > MAX_UPLOAD) return setError("That file is over 300 MB. Trim or compress it first.");
            await run("Adding your file", async () => api.addSceneFile(video.id, scene.id, await readUpload(file)));
          }}
        />

        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}

        {scene.clips.length > 0 && (
          <div className="border-t border-[var(--line)] pt-3">
            <p className="mb-1.5 text-xs opacity-55">Clips · click one to use it</p>
            <ul className="flex flex-wrap gap-2">
              {scene.clips.map((take, i) => {
                const using = take.id === scene.clip;
                const what = `Clip ${i + 1}${TAKE_SOURCE[take.source] ? ` · ${TAKE_SOURCE[take.source]}` : ""}${take.madeWith ? ` · ${take.madeWith}` : ""}`;
                return (
                  <li key={take.id} className="group relative">
                    <button
                      type="button"
                      aria-pressed={using}
                      aria-label={`${what}${using ? " (in use)" : ""}`}
                      title={`${what}${using ? " · in use" : ""}`}
                      disabled={off}
                      onClick={() => !using && run("Choosing", () => api.changeTake(video.id, scene.id, take.id, "use"))}
                      className={`flex aspect-[9/16] w-11 items-center justify-center overflow-hidden rounded-md border-2 bg-black text-white/70 ${using ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"}`}
                    >
                      <Icon d={ICONS.play} className="h-3.5 w-3.5" />
                    </button>
                    <span className="absolute -right-1.5 -top-1.5 hidden gap-0.5 group-focus-within:flex group-hover:flex">
                      <a
                        href={api.studioFileUrl(take.file)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${what}`}
                        title="Open full size"
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink)]"
                      >
                        <Icon d={ICONS.open} className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        aria-label={`Remove ${what}`}
                        title="Remove"
                        disabled={off}
                        onClick={() => run("Removing", () => api.changeTake(video.id, scene.id, take.id, "remove"))}
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] hover:border-red-400 hover:text-red-400"
                      >
                        <Icon d={ICONS.close} className="h-3 w-3" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}
