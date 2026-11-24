// The editor's preview: plays the timeline as it will be exported. Each clip has its own video element, shown
// while it is on screen and kept at the right point of its file; each placed sound has its own audio element.
// Looks and motion are shown with CSS; captions and text are drawn with the same code the export uses.
import { useEffect, useRef } from "react";
import { clipAt, clipLength, clipStarts, projectLength, type EditClip, type EditProject, type Look } from "@shared/edit";
import { api } from "./api";
import { drawOverlay, fontsReady } from "./EditDraw";

/** Close to the colour filters the export uses. */
export const LOOK_CSS: Record<Look, string> = {
  none: "none",
  warm: "sepia(0.18) saturate(1.12) hue-rotate(-8deg)",
  cool: "saturate(1.05) hue-rotate(12deg) brightness(1.02)",
  bw: "grayscale(1) contrast(1.1)",
  vivid: "saturate(1.35) contrast(1.06)",
  contrast: "contrast(1.22) brightness(0.98)",
  faded: "contrast(0.86) saturate(0.78) brightness(1.04)",
};

/** The zoom or pan of a clip `p` of the way through it (0 to 1), as a CSS transform. */
function motionCss(clip: EditClip, p: number) {
  switch (clip.motion) {
    case "zoom-in":
      return `scale(${1 + 0.12 * p})`;
    case "zoom-out":
      return `scale(${1.12 - 0.12 * p})`;
    case "punch-in":
      return "scale(1.18)";
    case "pan-left":
      return `scale(1.15) translateX(${(-6.5 + 13 * p).toFixed(2)}%)`;
    case "pan-right":
      return `scale(1.15) translateX(${(6.5 - 13 * p).toFixed(2)}%)`;
    default:
      return "none";
  }
}

/** How far apart a media element may drift from where it should be before it is moved back. */
const DRIFT = 0.25;

export function EditPreview({
  project,
  time,
  playing,
  onTime,
  onPlaying,
  safeZones,
  className = "aspect-[9/16] w-full",
}: {
  project: EditProject;
  time: number;
  playing: boolean;
  onTime: (t: number) => void;
  onPlaying: (playing: boolean) => void;
  /** Shows where the platforms put their buttons and captions, so nothing important goes there. */
  safeZones: boolean;
  /** Its size; by default as wide as its column. */
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const sounds = useRef(new Map<string, HTMLAudioElement>());
  const layers = useRef(new Map<string, HTMLDivElement>());
  const fade = useRef<HTMLDivElement>(null);
  const clock = useRef({ startedAt: 0, from: 0 });
  const latest = useRef({ project, time });
  latest.current = { project, time };
  const total = projectLength(project);
  const assetOf = (id: string) => project.assets.find((a) => a.id === id);

  /** Puts every element where it should be at time `t`, playing or not. */
  function sync(t: number, running: boolean) {
    const p = latest.current.project;
    const at = clipAt(p, t);
    const starts = clipStarts(p);
    p.clips.forEach((c, i) => {
      const layer = layers.current.get(c.id);
      const el = videos.current.get(c.id);
      const active = at?.clip.id === c.id;
      if (layer) {
        layer.style.opacity = active ? "1" : "0";
        if (active) {
          const progress = Math.min(Math.max((t - starts[i]) / Math.max(clipLength(c), 0.001), 0), 1);
          layer.style.transform = motionCss(c, progress);
          layer.style.filter = LOOK_CSS[c.look];
        }
      }
      if (!el) return;
      if (active && at) {
        el.playbackRate = c.speed;
        el.volume = Math.min(c.volume, 1);
        el.muted = c.volume === 0;
        if (Math.abs(el.currentTime - at.fileTime) > DRIFT || !running) el.currentTime = at.fileTime;
        if (running && el.paused) void el.play().catch(() => undefined);
        if (!running && !el.paused) el.pause();
      } else if (!el.paused) el.pause();
    });
    if (fade.current) {
      const c = at?.clip;
      const into = at ? t - at.start : 1;
      fade.current.style.opacity = c?.transition === "fade" && into < 0.35 ? String(1 - into / 0.35) : "0";
    }
    for (const item of p.audio) {
      const el = sounds.current.get(item.id);
      if (!el) continue;
      const into = t - item.start;
      const length = item.out - item.in;
      const on = into >= 0 && into < length;
      if (on) {
        let volume = item.volume;
        if (item.fadeIn > 0) volume *= Math.min(into / item.fadeIn, 1);
        if (item.fadeOut > 0) volume *= Math.min((length - into) / item.fadeOut, 1);
        el.volume = Math.min(Math.max(volume, 0), 1);
        const want = item.in + into;
        if (Math.abs(el.currentTime - want) > DRIFT || !running) el.currentTime = want;
        if (running && el.paused) void el.play().catch(() => undefined);
        if (!running && !el.paused) el.pause();
      } else if (!el.paused) el.pause();
    }
    const ctx = canvas.current?.getContext("2d");
    if (ctx) drawOverlay(ctx, p, t);
  }

  // While playing, time runs from the clock and everything follows it.
  useEffect(() => {
    if (!playing) {
      sync(time, false);
      return;
    }
    clock.current = { startedAt: performance.now(), from: time >= total - 0.05 ? 0 : time };
    let frame = 0;
    const tick = () => {
      const t = clock.current.from + (performance.now() - clock.current.startedAt) / 1000;
      if (t >= total) {
        sync(total, false);
        onTime(total);
        onPlaying(false);
        return;
      }
      sync(t, true);
      onTime(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const el of [...videos.current.values(), ...sounds.current.values()]) el.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // When paused, a seek or an edit redraws the frame.
  useEffect(() => {
    if (!playing) sync(time, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, project, playing]);

  // The captions' font may arrive after the first drawing.
  useEffect(() => {
    void fontsReady().then(() => sync(latest.current.time, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black ${className}`} onClick={() => onPlaying(!playing)}>
      {project.clips.map((c) => {
        const a = assetOf(c.assetId);
        if (!a) return null;
        return (
          <div
            key={c.id}
            ref={(el) => void (el ? layers.current.set(c.id, el) : layers.current.delete(c.id))}
            className="absolute inset-0 opacity-0"
            style={{ transformOrigin: "center" }}
          >
            {a.kind === "image" ? (
              <img src={api.studioFileUrl(a.file)} alt="" className="h-full w-full object-cover" />
            ) : (
              <video
                ref={(el) => void (el ? videos.current.set(c.id, el) : videos.current.delete(c.id))}
                src={api.studioFileUrl(a.file)}
                preload="auto"
                playsInline
                className="h-full w-full object-cover"
                onLoadedData={() => !playing && sync(latest.current.time, false)}
              />
            )}
          </div>
        );
      })}
      {project.audio.map((item) => {
        const a = assetOf(item.assetId);
        return a ? <audio key={item.id} ref={(el) => void (el ? sounds.current.set(item.id, el) : sounds.current.delete(item.id))} src={api.studioFileUrl(a.file)} preload="auto" /> : null;
      })}
      <div ref={fade} className="pointer-events-none absolute inset-0 bg-black opacity-0" />
      <canvas ref={canvas} width={project.width} height={project.height} className="pointer-events-none absolute inset-0 h-full w-full" />
      {safeZones && (
        // Roughly where TikTok, Reels and Shorts put their own buttons and the caption of the post.
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute inset-x-0 top-0 h-[8%] bg-red-500/25" />
          <div className="absolute bottom-0 inset-x-0 h-[20%] bg-red-500/25" />
          <div className="absolute bottom-[20%] right-0 top-[45%] w-[15%] bg-red-500/25" />
          <span className="absolute bottom-[21%] left-2 rounded bg-black/60 px-1.5 py-0.5 text-[0.6rem] text-white">Covered by the app's buttons</span>
        </div>
      )}
      {project.clips.length === 0 && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/60">Nothing on the timeline yet.</p>}
    </div>
  );
}
