import { useRef, useState } from "react";
import type { MediaSettings, Take } from "@shared/media";
import { pickedClip, pickedPicture, type Scene, type TakeResult, type Video } from "@shared/studio";
import { api } from "./api";
import { readUpload } from "./ServicePicker";
import { card, Chip, Icon, ICONS, primaryButton, smallButton } from "./studioUi";

const MAX_UPLOAD = 300 * 1024 * 1024;
const TAKE_SOURCE: Record<string, string> = { lipsync: "Lip-synced", filmed: "Filmed by you", upload: "Added by you" };

/**
 * One scene on the Make tab: what it looks like now, the one sensible next
 * action as the main button, and every attempt kept as a small take to switch
 * between. Pictures come first because they are cheap to redo.
 */
export function SceneMedia({
  video,
  scene,
  index,
  choices,
  disabled,
  onVideo,
}: {
  video: Video;
  scene: Scene;
  index: number;
  /** The service chosen for each job on this page. */
  choices: MediaSettings;
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
  const clip = pickedClip(scene);
  const hasVoice = scene.lines.some((l) => l.audioFile);
  const off = disabled || busy !== "";
  const filmed = scene.madeBy === "me";

  const makePicture = async () => (await run("Making the picture", () => api.makeScenePicture(video.id, scene.id, choices.picture, note))) && setNote("");
  const makeClip = () => run("Making the clip", () => api.makeSceneClip(video.id, scene.id, choices.clip));
  const lipSync = () => run("Lip-syncing", () => api.makeSceneLipSync(video.id, scene.id, choices.lipsync));
  const addFile = () => fileInput.current?.click();

  // The one thing that moves this scene forward is the main button; the rest stay available beside it.
  const main = filmed
    ? { text: clip ? "Replace your clip" : "Add your filmed clip", busyText: "Adding…", when: "Adding your file", act: addFile, primary: !clip }
    : !picture
      ? { text: "Make picture", busyText: "Making the picture…", when: "Making the picture", act: makePicture, primary: true }
      : { text: clip ? "Make another clip" : "Make clip", busyText: "Making the clip… this can take minutes", when: "Making the clip", act: makeClip, primary: !clip };

  const takes = (list: Take[], kind: "Picture" | "Clip", inUse: string) =>
    list.length > 0 && (
      <div>
        <p className="mb-1.5 text-xs opacity-55">
          {kind === "Picture" ? "Pictures" : "Clips"} · click one to use it
        </p>
        <ul className="flex flex-wrap gap-2">
          {list.map((take, i) => {
            const using = take.id === inUse;
            const what = `${kind} ${i + 1}${TAKE_SOURCE[take.source] ? ` · ${TAKE_SOURCE[take.source]}` : ""}${take.madeWith ? ` · ${take.madeWith}` : ""}`;
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
                  {kind === "Picture" ? <img src={api.studioFileUrl(take.file)} alt="" className="h-full w-full object-cover" /> : <Icon d={ICONS.play} className="h-3.5 w-3.5" />}
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
    );

  return (
    <article className={`${card} flex gap-4 !p-4`}>
      <div className="flex aspect-[9/16] w-32 shrink-0 items-center justify-center self-start overflow-hidden rounded-xl border border-[var(--line)] bg-black text-center text-xs text-white/60">
        {clip ? (
          <video controls preload="metadata" src={api.studioFileUrl(clip.file)} poster={picture ? api.studioFileUrl(picture.file) : undefined} className="h-full w-full object-cover" />
        ) : picture ? (
          <img src={api.studioFileUrl(picture.file)} alt={`Scene picture: ${scene.action}`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 px-3">
            <Icon d={filmed ? ICONS.camera : ICONS.ai} className="h-6 w-6 opacity-60" />
            {filmed ? "Your clip goes here" : "No picture yet"}
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
            ) : (
              <>
                <Chip tone={picture ? "good" : "plain"}>{picture ? "Picture" : "No picture"}</Chip>
                <Chip tone={clip ? "good" : "plain"}>{clip ? "Clip" : "No clip"}</Chip>
              </>
            )}
          </span>
        </div>

        <p className="line-clamp-2 text-sm leading-relaxed">{scene.action}</p>
        {scene.lines[0] && <p className="line-clamp-2 text-sm italic opacity-60">“{scene.lines[0].text}”</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={main.primary ? `${primaryButton} !px-4 !py-1.5` : smallButton} disabled={off} onClick={() => void main.act()}>
            {busy === main.when ? main.busyText : main.text}
          </button>
          {!filmed && picture && (
            <>
              <button
                type="button"
                className={smallButton}
                disabled={off || !hasVoice}
                title={hasVoice ? "Makes the character in the picture speak the scene's first recorded line." : "Make the voices first (Preview tab): lip-sync needs a recorded line."}
                onClick={() => void lipSync()}
              >
                {busy === "Lip-syncing" ? "Lip-syncing… this can take minutes" : "Lip-sync"}
              </button>
              <button type="button" className={smallButton} disabled={off} onClick={() => void makePicture()}>
                {busy === "Making the picture" ? "Making the picture…" : "Another picture"}
              </button>
            </>
          )}
          {!filmed && (
            <button type="button" className={smallButton} disabled={off} onClick={addFile}>
              {busy === "Adding your file" ? "Adding…" : "Add your own file"}
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > MAX_UPLOAD) return setError("That file is over 300 MB. Trim or compress it first.");
              await run("Adding your file", async () => api.addSceneFile(video.id, scene.id, await readUpload(file)));
            }}
          />
        </div>

        {!filmed && picture && (
          <input
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none"
            placeholder="What should change in the next picture?"
            aria-label="What should change in the next picture"
            value={note}
            disabled={off}
            onChange={(e) => setNote(e.target.value)}
          />
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}

        {(scene.pictures.length > 0 || scene.clips.length > 0) && (
          <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-[var(--line)] pt-3">
            {takes(scene.pictures, "Picture", scene.picture)}
            {takes(scene.clips, "Clip", scene.clip)}
          </div>
        )}
      </div>
    </article>
  );
}
