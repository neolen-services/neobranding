// The editor's two windows: Export (choose, watch the progress, then play and save the result) and the start of an
// empty project (your own files, or a Studio video).
import { useEffect, useState } from "react";
import { projectLength, showTime, type EditProject } from "@shared/edit";
import { pickedClip, pickedPicture, type Video } from "@shared/studio";
import { api } from "./api";
import { overlayFrames } from "./EditDraw";
import { card, Dialog, Icon, ICONS, primaryButton, quietButton } from "./studioUi";

export function ExportDialog({ project, onDone, onClose }: { project: EditProject; onDone: (p: EditProject) => void; onClose: () => void }) {
  const [burn, setBurn] = useState(project.captions.length > 0 && project.showCaptions);
  const [stage, setStage] = useState<"choose" | "drawing" | "making" | "done">("choose");
  const [share, setShare] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(project.exports[0] ?? null);
  const running = stage === "drawing" || stage === "making";

  async function go() {
    setError("");
    setShare(0);
    try {
      setStage("drawing");
      // Captions are drawn here exactly as the preview draws them, then laid over the video by FFmpeg.
      const frames = await overlayFrames({ ...project, showCaptions: burn && project.showCaptions });
      setStage("making");
      const timer = window.setInterval(async () => {
        const s = await api.editExportProgress(project.id);
        if (s !== null) setShare(s);
      }, 600);
      const made = await api.exportEdit(project.id, frames).finally(() => window.clearInterval(timer));
      if (!made.ok) {
        setError(made.error);
        setStage("choose");
        return;
      }
      onDone(made.project);
      setResult(made.project.exports[0]);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The video could not be exported.");
      setStage("choose");
    }
  }

  return (
    <Dialog
      title={stage === "done" ? "Your video is ready" : "Export video"}
      locked={running}
      onClose={onClose}
      footer={
        stage === "done" ? (
          <>
            <button type="button" className={quietButton} onClick={() => setStage("choose")}>
              Export again
            </button>
            <button type="button" className={primaryButton} onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button type="button" className={quietButton} disabled={running} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={primaryButton} disabled={running} onClick={() => void go()}>
              {running ? "Exporting…" : "Export"}
            </button>
          </>
        )
      }
    >
      {stage === "done" && result ? (
        <div className="flex flex-wrap gap-5">
          <video controls autoPlay src={api.studioFileUrl(result.file)} className="aspect-[9/16] w-44 rounded-xl bg-black object-cover" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm opacity-70">
              {showTime(result.seconds)} · 1080×1920 MP4 · levelled to the loudness the platforms use
            </p>
            <div className="flex flex-col gap-2">
              <a className={`${primaryButton} text-center`} href={api.studioFileUrl(result.file)} download={`${project.title}.mp4`}>
                Save a copy
              </a>
              {result.srt && (
                <a className={`${quietButton} text-center`} href={api.studioFileUrl(result.srt)} download={`${project.title}.srt`}>
                  Captions file (.srt)
                </a>
              )}
              <button type="button" className={quietButton} onClick={() => void api.openAssetsFolder("edits", project.id)}>
                Show in folder
              </button>
            </div>
          </div>
        </div>
      ) : running ? (
        <div className="space-y-3 py-4">
          <p className="text-sm">{stage === "drawing" ? "Drawing the captions and text…" : `Making the video… ${Math.round(share * 100)}%`}</p>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--tint)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
            <div className="h-full rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${stage === "drawing" ? 3 : Math.max(share * 100, 5)}%` }} />
          </div>
          <p className="text-xs opacity-60">This runs on your computer and costs nothing.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between">
              <span className="opacity-65">Length</span>
              {showTime(projectLength(project))}
            </li>
            <li className="flex justify-between">
              <span className="opacity-65">Size</span>1080×1920, 30 frames a second
            </li>
            <li className="flex justify-between">
              <span className="opacity-65">Sound</span>Levelled to −14 LUFS, music ducked under speech
            </li>
          </ul>
          <label className={`flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 ${project.captions.length ? "" : "opacity-50"}`}>
            <input type="checkbox" className="mt-1" checked={burn} disabled={!project.captions.length} onChange={(e) => setBurn(e.target.checked)} />
            <span className="text-sm">
              <span className="block font-medium">Burn the captions into the video</span>
              <span className="block text-xs opacity-60">{project.captions.length ? "Turn this off to post with the platform's own captions; a captions file (.srt) is saved either way." : "This video has no captions."}</span>
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm font-medium text-red-400">
              {error}
            </p>
          )}
          {project.exports.length > 0 && (
            <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={() => setStage("done")}>
              See the last export ({new Date(project.exports[0].createdAt).toLocaleString()})
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** What an empty project shows: start from your own files or from a Studio video. */
export function StartWindow({ project, working, onFiles, onProject, setError }: { project: EditProject; working: string; onFiles: () => void; onProject: (p: EditProject) => void; setError: (e: string) => void }) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [bringing, setBringing] = useState("");
  useEffect(() => {
    api.listVideos().then((all) => setVideos(all.filter((v) => v.scenes.some((s) => pickedClip(s) || pickedPicture(s))))).catch(() => setVideos([]));
  }, []);
  async function bring(video: Video) {
    setBringing(video.id);
    setError("");
    try {
      const made = await api.editFromVideo(video.id);
      if (!made.ok) return setError(made.error);
      // The new project takes the place of this empty one.
      await api.deleteEdit(project.id);
      onProject(made.project);
    } finally {
      setBringing("");
    }
  }
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-3xl space-y-5">
        <div className="text-center">
          <p className="font-display text-2xl font-semibold">What are you editing?</p>
          <p className="mt-1 text-sm opacity-60">Bring the footage in, then tell the AI editor what you want.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <button type="button" onClick={onFiles} disabled={working !== ""} className={`${card} flex flex-col items-center gap-3 border-dashed py-10 text-center hover:border-[var(--ink)]`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)]/15">
              <Icon d="M12 16V4M7 9l5-5 5 5M5 20h14" className="h-6 w-6" />
            </span>
            <span className="font-display text-lg font-semibold">{working || "Your own files"}</span>
            <span className="text-sm opacity-60">Videos, photos, a voiceover or music. Drop them here or click to choose.</span>
          </button>
          <section className={`${card} flex flex-col`}>
            <p className="font-display text-lg font-semibold">A Studio video</p>
            <p className="mt-1 text-sm opacity-60">Its clips, voices, on-screen text and captions, laid out in order.</p>
            <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto">
              {videos === null && <li className="text-sm opacity-60">Loading…</li>}
              {videos?.length === 0 && <li className="text-sm opacity-60">No Studio video has a storyboard or clip yet.</li>}
              {videos?.map((v) => (
                <li key={v.id}>
                  <button type="button" disabled={bringing !== ""} onClick={() => void bring(v)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-left text-sm hover:border-[var(--ink)] disabled:opacity-50">
                    <Icon d={ICONS.film} className="h-4 w-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate font-medium">{v.title}</span>
                    <span className="shrink-0 text-xs opacity-60">{bringing === v.id ? "Bringing it in…" : `${v.scenes.filter((s) => pickedClip(s)).length}/${v.scenes.length} clips`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
