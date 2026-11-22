// The Storyboard tab of a video: one picture for every scene, the frame it starts on, looked
// through in order before any clip is made. A picture costs little and a clip costs a lot, so
// this is where the look of the video is settled.
import { useRef, useState } from "react";
import type { MediaChoice } from "@shared/media";
import { pickedPicture, type Scene, type TakeResult, type Video } from "@shared/studio";
import { api } from "./api";
import { readUpload, ServicePicker, useMediaChoices, useMediaKeys } from "./ServicePicker";
import { card, Chip, fieldClass, Icon, ICONS, label, primaryButton, smallButton } from "./studioUi";

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
  /** Opens the Make tab. */
  onNext: () => void;
}) {
  const [look, setLook] = useState(video.look);
  const [making, setMaking] = useState("");
  const keys = useMediaKeys();
  const [choices, setChoice] = useMediaChoices();
  const ai = video.scenes.filter((s) => s.madeBy === "ai");
  const missing = ai.filter((s) => !pickedPicture(s));
  const filmed = video.scenes.length - ai.length;
  const carryOn = video.scenes.filter((s, i) => i > 0 && s.continues && s.madeBy === "ai").length;

  /** Makes a picture for every AI scene that has none, from the first scene down, stopping at the first that fails. */
  async function makeMissing() {
    if (!choices) return;
    setError("");
    setNotice("");
    for (const [i, scene] of missing.entries()) {
      setMaking(`Making picture ${i + 1} of ${missing.length}`);
      try {
        const result = await api.makeScenePicture(video.id, scene.id, choices.picture);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        onChange(result.video);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The picture could not be made.");
        break;
      }
    }
    setMaking("");
  }

  if (!choices) return null;
  const off = busy !== "" || making !== "";
  const counts = [
    ai.length > 0 && `${ai.length - missing.length} of ${plural(ai.length, "picture")} made`,
    carryOn > 0 && `${plural(carryOn, "scene")} ${carryOn === 1 ? "carries" : "carry"} on from the one before`,
    filmed > 0 && `${plural(filmed, "scene")} you film`,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <section className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold">Storyboard</h3>
            <p className="mt-0.5 text-sm opacity-60">{counts.join(" · ")}</p>
            <p className="mt-1.5 max-w-3xl text-sm opacity-60">
              One picture for each scene: the frame it starts on. Look through them in order and redo any that is off before a clip is made. A scene that carries on is drawn from the picture
              before it, so work from the first scene down.
            </p>
          </div>
          {missing.length > 0 && (
            <button type="button" className={primaryButton} disabled={off} onClick={makeMissing}>
              {making ? `${making}…` : `Make ${plural(missing.length, "missing picture")}`}
            </button>
          )}
        </div>
        {ai.length > 0 && (
          <div className="grid gap-4 border-t border-[var(--line)] pt-4 md:grid-cols-3">
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
        )}
      </section>

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {video.scenes.map((scene, index) => (
          <Panel key={scene.id} video={video} scene={scene} index={index} choice={choices.picture} disabled={off} onVideo={onChange} />
        ))}
      </ol>

      <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-sm opacity-70">
          {missing.length > 0
            ? `${plural(missing.length, "scene")} still ${missing.length === 1 ? "needs" : "need"} a picture. A clip can only be made for a scene that has one.`
            : ai.length > 0
              ? "Every scene has its picture. When they read as one video from first to last, make the clips."
              : "You film every scene of this video, so there is nothing to draw. Add your clips on the Make tab."}
        </p>
        <button type="button" className={`${primaryButton} flex items-center gap-2`} disabled={off || (ai.length > 0 && missing.length === ai.length)} onClick={onNext}>
          Next: make the clips
          <Icon d={ICONS.arrow} />
        </button>
      </section>
    </div>
  );
}

/** One scene of the storyboard: its picture, what happens in it, and the ways to redo the picture. */
function Panel({
  video,
  scene,
  index,
  choice,
  disabled,
  onVideo,
}: {
  video: Video;
  scene: Scene;
  index: number;
  /** The service that makes pictures on this page. */
  choice: MediaChoice;
  disabled: boolean;
  onVideo: (video: Video) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
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
  const filmed = scene.madeBy === "me";
  const off = disabled || busy !== "";
  const makePicture = async () => (await run("Making", () => api.makeScenePicture(video.id, scene.id, choice, note))) && setNote("");
  const beforeHasPicture = index > 0 && Boolean(pickedPicture(video.scenes[index - 1]));

  return (
    <li className={`${card} flex flex-col gap-3 !p-3`}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold tabular-nums">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-xs opacity-60" title={scene.place}>
          {scene.seconds}s{scene.place && ` · ${scene.place}`}
        </span>
        {filmed && <Chip tone="warn">You film</Chip>}
      </div>

      {index > 0 && !filmed ? (
        <div role="radiogroup" aria-label={`How scene ${index + 1} starts`} className="flex min-h-[1.875rem] rounded-full border border-[var(--line)] p-0.5 text-xs font-medium">
          {(
            [
              [true, "Carries on", `Scene ${index + 1} carries straight on from scene ${index} with no cut. Its picture is drawn from the picture before it.`],
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
          <a href={api.studioFileUrl(picture.file)} target="_blank" rel="noreferrer" title="Open full size" className="block h-full w-full">
            <img src={api.studioFileUrl(picture.file)} alt={`Storyboard picture for scene ${index + 1}: ${scene.action}`} className="h-full w-full object-cover" />
          </a>
        ) : (
          <span className="flex flex-col items-center gap-2 px-4">
            <Icon d={filmed ? ICONS.camera : ICONS.ai} className="h-6 w-6 opacity-60" />
            {filmed ? "You film this scene. Add your clip on the Make tab." : "No picture yet"}
          </span>
        )}
        {busy === "Making" && <span className="absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-sm text-white">Making the picture…</span>}
      </div>

      <div className="space-y-1">
        <p className="line-clamp-4 text-sm leading-relaxed" title={scene.action}>
          {scene.action}
        </p>
        {scene.lines[0] && <p className="line-clamp-2 text-sm italic opacity-60">“{scene.lines[0].text}”</p>}
      </div>

      {!filmed && (
        <div className="mt-auto space-y-2">
          {picture && (
            <input
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none"
              placeholder="What should change?"
              aria-label={`What should change in the picture for scene ${index + 1}`}
              value={note}
              disabled={off}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !off && void makePicture()}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={picture ? smallButton : `${primaryButton} !px-4 !py-1.5`} disabled={off} onClick={() => void makePicture()}>
              {busy === "Making" ? "Making…" : picture ? "Another picture" : "Make picture"}
            </button>
            <button type="button" className={smallButton} disabled={off} onClick={() => fileInput.current?.click()}>
              {busy === "Adding" ? "Adding…" : "Add your own"}
            </button>
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
          {!picture && scene.continues && index > 0 && !beforeHasPicture && (
            <p className="text-xs opacity-60">Make scene {index}'s picture first: this one is drawn from it.</p>
          )}

          {scene.pictures.length > 1 && (
            <ul className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-2" aria-label={`Pictures made for scene ${index + 1}`}>
              {scene.pictures.map((take, i) => {
                const using = take.id === scene.picture;
                const what = `Picture ${i + 1}${take.source === "upload" ? " · added by you" : take.madeWith ? ` · ${take.madeWith}` : ""}`;
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
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
