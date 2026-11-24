// The editor's timeline: every track under one ruler. Clips show frames from their video and sounds show their
// waveform. Drag a piece to move it (clips reorder), drag its edges to trim, drag on the ruler to scrub, and drop
// media from the Media panel onto a track. Pieces snap to each other's edges and to the playhead.
import { useRef, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { clipLength, clipStarts, projectLength, showTime, type EditAsset, type EditAudio, type EditCaption, type EditClip, type EditProject, type EditText } from "@shared/edit";
import { api } from "./api";

export type Selection = { kind: "clip" | "sound" | "caption" | "text"; id: string } | null;
/** A change from the timeline. `key` groups a run of changes (one drag) into one step of undo. */
export type Change = (next: EditProject, key?: string) => void;
type Kind = NonNullable<Selection>["kind"];
type Row = "picture" | "text" | "captions" | "voice" | "music";

/** The media dragged from the Media panel carries its id under this type. */
export const ASSET_DRAG = "application/x-edit-asset";

const ROWS: { id: Row; name: string; height: number }[] = [
  { id: "picture", name: "Clips", height: 60 },
  { id: "text", name: "Text", height: 30 },
  { id: "captions", name: "Captions", height: 30 },
  { id: "voice", name: "Voice and sound", height: 40 },
  { id: "music", name: "Music", height: 40 },
];
const RULER = 24;
const EDGE = 7;
const SNAP_PX = 8;

type Drag = { mode: "move" | "start" | "end"; kind: Kind; id: string; x: number; moved: boolean; before: EditProject };

export function EditTimeline({
  project,
  time,
  zoom,
  selected,
  locked,
  onSeek,
  onSelect,
  onChange,
  onDropAsset,
}: {
  project: EditProject;
  time: number;
  /** Pixels per second. */
  zoom: number;
  selected: Selection;
  /** While the AI editor works or a video is exported, nothing can be dragged. */
  locked: boolean;
  onSeek: (t: number) => void;
  onSelect: (s: Selection) => void;
  onChange: Change;
  onDropAsset: (assetId: string, row: Row, t: number) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const scrubbing = useRef(false);
  const total = Math.max(projectLength(project), 1);
  const width = Math.max(total * zoom + 160, 600);
  const starts = clipStarts(project);
  const asset = (id: string) => project.assets.find((a) => a.id === id);
  const isSel = (kind: Kind, id: string) => selected?.kind === kind && selected.id === id;
  const timeAt = (clientX: number) => {
    const box = area.current?.getBoundingClientRect();
    return box ? Math.max((clientX - box.left) / zoom, 0) : 0;
  };
  const step = zoom >= 80 ? 1 : zoom >= 30 ? 2 : zoom >= 14 ? 5 : 10;

  /** The nearest edge or the playhead within a few pixels of `t`, or `t` itself. */
  function snap(t: number, except: string, p: EditProject) {
    const points = [0, time];
    let at = 0;
    for (const c of p.clips) {
      points.push(at);
      at += clipLength(c);
      points.push(at);
    }
    for (const x of [...p.texts, ...p.captions]) if (x.id !== except) points.push(x.start, x.end);
    for (const a of p.audio) if (a.id !== except) points.push(a.start, a.start + a.out - a.in);
    let best = t;
    let gap = SNAP_PX / zoom;
    for (const q of points) if (Math.abs(q - t) < gap) (gap = Math.abs(q - t)), (best = q);
    return best;
  }

  // ---------- Dragging pieces ----------

  function begin(e: PointerEvent, kind: Kind, id: string) {
    if (locked || e.button !== 0) return;
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - box.left;
    const mode = x < EDGE ? "start" : x > box.width - EDGE ? "end" : "move";
    drag.current = { mode, kind, id, x: e.clientX, moved: false, before: project };
    try {
      // Keeps the drag going when the pointer leaves the piece.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Without capture the drag still works while the pointer stays over the piece.
    }
  }

  function follow(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / zoom;
    if (!d.moved && Math.abs(e.clientX - d.x) < 3) return;
    d.moved = true;
    const p = d.before;
    const key = `drag:${d.id}:${d.mode}`;
    if (d.kind === "clip") {
      const i = p.clips.findIndex((c) => c.id === d.id);
      const c = p.clips[i];
      const a = asset(c.assetId);
      const longest = a?.kind === "image" ? 600 : (a?.seconds ?? c.out);
      if (d.mode === "move") {
        // Clips play one after another, so moving one changes its place in the order.
        const at = timeAt(e.clientX);
        const others = p.clips.filter((x) => x.id !== c.id);
        let t = 0;
        let index = 0;
        for (const o of others) {
          if (t + clipLength(o) / 2 < at) index++;
          t += clipLength(o);
        }
        const clips = [...others.slice(0, index), c, ...others.slice(index)];
        if (clips.some((x, k) => x.id !== project.clips[k]?.id)) onChange({ ...project, clips }, key);
        return;
      }
      const start = clipStarts(p)[i];
      let next: EditClip;
      if (d.mode === "start") {
        next = { ...c, in: Math.min(Math.max(c.in + dx * c.speed, 0), c.out - 0.1) };
      } else {
        const end = snap(start + clipLength(c) + dx, c.id, p);
        next = { ...c, out: Math.min(Math.max(c.in + (end - start) * c.speed, c.in + 0.1), longest) };
      }
      onChange({ ...project, clips: project.clips.map((x) => (x.id === c.id ? next : x)) }, key);
      return;
    }
    if (d.kind === "sound") {
      const a = p.audio.find((x) => x.id === d.id)!;
      const longest = asset(a.assetId)?.seconds ?? a.out;
      let next: EditAudio = a;
      if (d.mode === "move") next = { ...a, start: Math.max(snap(a.start + dx, a.id, p), 0) };
      else if (d.mode === "start") {
        const shift = Math.min(Math.max(dx, -a.in, -a.start), a.out - a.in - 0.1);
        next = { ...a, start: a.start + shift, in: a.in + shift };
      } else next = { ...a, out: Math.min(Math.max(snap(a.start + a.out - a.in + dx, a.id, p) - a.start + a.in, a.in + 0.1), longest) };
      onChange({ ...project, audio: project.audio.map((x) => (x.id === a.id ? next : x)) }, key);
      return;
    }
    // Text and captions sit at times of their own.
    const list = d.kind === "text" ? p.texts : p.captions;
    const item = list.find((x) => x.id === d.id)!;
    let start = item.start;
    let end = item.end;
    if (d.mode === "move") {
      const length = end - start;
      start = Math.max(snap(item.start + dx, item.id, p), 0);
      end = start + length;
    } else if (d.mode === "start") start = Math.min(Math.max(snap(item.start + dx, item.id, p), 0), end - 0.1);
    else end = Math.max(snap(item.end + dx, item.id, p), start + 0.1);
    if (d.kind === "text") {
      const next: EditText = { ...(item as EditText), start, end };
      onChange({ ...project, texts: project.texts.map((x) => (x.id === item.id ? next : x)) }, key);
    } else {
      const c = item as EditCaption;
      // Moving a caption moves its words with it; trimming keeps them inside it.
      const shift = d.mode === "move" ? start - c.start : 0;
      const words = c.words.map((w) => ({ ...w, start: Math.min(Math.max(w.start + shift, start), end), end: Math.min(Math.max(w.end + shift, start), end) }));
      onChange({ ...project, captions: project.captions.map((x) => (x.id === c.id ? { ...c, start, end, words } : x)) }, key);
    }
  }

  function end(kind: Kind, id: string) {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect({ kind, id });
  }

  // ---------- Pieces ----------

  const piece = (kind: Kind, id: string, start: number, length: number, className: string, style: CSSProperties, children: ReactNode, title: string) => (
    <div
      key={id}
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-pressed={isSel(kind, id)}
      title={title}
      draggable={false}
      // The browser's own drag-and-drop would take over the pointer and cancel the drag.
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => begin(e, kind, id)}
      onPointerMove={follow}
      onPointerCancel={() => (drag.current = null)}
      onPointerUp={() => end(kind, id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect({ kind, id })}
      className={`group absolute bottom-1 top-1 overflow-hidden rounded-md border text-[0.7rem] leading-tight ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${isSel(kind, id) ? "z-10 border-white ring-2 ring-[var(--primary)]" : ""} ${className}`}
      style={{ left: start * zoom, width: Math.max(length * zoom - 1, 6), touchAction: "none", ...style }}
    >
      {children}
      {!locked && (
        <>
          <span className="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize bg-white/0 group-hover:bg-white/40" />
          <span className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize bg-white/0 group-hover:bg-white/40" />
        </>
      )}
    </div>
  );

  /** Frames from the clip's own video across the piece, each from the moment of the file it stands for. */
  function frames(c: EditClip, a: EditAsset | undefined, blockWidth: number) {
    if (!a) return null;
    const h = 52;
    if (a.kind === "image") return <span className="absolute inset-0 bg-cover bg-center opacity-90" style={{ backgroundImage: `url("${api.studioFileUrl(a.file)}")`, backgroundRepeat: "repeat-x", backgroundSize: `${h * 0.5625}px 100%` }} />;
    if (!a.thumbs) return null;
    const tile = Math.max(h * ((a.width || 9) / (a.height || 16)), 18);
    const count = Math.min(Math.ceil(blockWidth / tile), 80);
    const strip = `url("${api.studioFileUrl(a.thumbs.file)}")`;
    return (
      <span className="absolute inset-0 flex overflow-hidden opacity-90">
        {Array.from({ length: count }, (_, k) => {
          const t = c.in + ((k * tile) / zoom) * c.speed;
          const index = Math.min(Math.floor(t / a.thumbs!.every), a.thumbs!.count - 1);
          return <span key={k} className="h-full shrink-0" style={{ width: tile, backgroundImage: strip, backgroundSize: `${a.thumbs!.count * tile}px 100%`, backgroundPosition: `-${index * tile}px 0` }} />;
        })}
      </span>
    );
  }

  const wave = (a: EditAudio, file?: string, seconds = 0): CSSProperties =>
    file ? { backgroundImage: `url("${api.studioFileUrl(file)}")`, backgroundSize: `${seconds * zoom}px 70%`, backgroundPosition: `-${a.in * zoom}px center`, backgroundRepeat: "no-repeat" } : {};

  const content: Record<Row, ReactNode> = {
    picture: project.clips.map((c, i) => {
      const a = asset(c.assetId);
      const len = clipLength(c);
      return piece(
        "clip",
        c.id,
        starts[i],
        len,
        "border-sky-300/50 bg-sky-900",
        {},
        <>
          {frames(c, a, len * zoom)}
          <span className="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/70 px-1 py-0.5 text-white">
            {i + 1} · {a?.name ?? "Missing"}
            {c.speed !== 1 ? ` · ${c.speed}×` : ""}
          </span>
        </>,
        `Clip ${i + 1}: ${a?.name ?? ""}, ${len.toFixed(1)}s`,
      );
    }),
    text: project.texts.map((t) => piece("text", t.id, t.start, t.end - t.start, "border-fuchsia-300/50 bg-fuchsia-500/35 px-1.5 py-1", {}, <span className="block truncate">{t.text}</span>, `Text: ${t.text}`)),
    captions: project.captions.map((c) => {
      const words = c.words.map((w) => w.text).join(" ");
      return piece("caption", c.id, c.start, c.end - c.start, `border-amber-300/50 bg-amber-500/35 px-1.5 py-1 ${project.showCaptions ? "" : "opacity-40"}`, {}, <span className="block truncate">{words}</span>, `Caption: ${words}`);
    }),
    voice: project.audio
      .filter((a) => a.role !== "music")
      .map((s) => {
        const a = asset(s.assetId);
        return piece("sound", s.id, s.start, s.out - s.in, `${s.role === "sfx" ? "border-rose-300/50 bg-rose-500/40" : "border-emerald-300/50 bg-emerald-600/40"} px-1.5 py-0.5`, wave(s, a?.wave, a?.seconds), <span className="relative block truncate">{a?.name}</span>, a?.name ?? "Sound");
      }),
    music: project.audio
      .filter((a) => a.role === "music")
      .map((s) => {
        const a = asset(s.assetId);
        return piece("sound", s.id, s.start, s.out - s.in, "border-violet-300/50 bg-violet-600/40 px-1.5 py-0.5", wave(s, a?.wave, a?.seconds), <span className="relative block truncate">{a?.name} · {Math.round(s.volume * 100)}%</span>, a?.name ?? "Music");
      }),
  };

  const allowDrop = (e: DragEvent) => {
    if (!locked && e.dataTransfer.types.includes(ASSET_DRAG)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  return (
    <div className="flex select-none">
      <div className="w-28 shrink-0 border-r border-[var(--line)] text-xs font-medium">
        <div style={{ height: RULER }} className="border-b border-[var(--line)]" />
        {ROWS.map((r) => (
          <div key={r.id} style={{ height: r.height }} className="flex items-center border-b border-[var(--line)] px-3 opacity-65">
            {r.name}
            {r.id === "captions" && !project.showCaptions && <span className="ml-1 opacity-60">(off)</span>}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1">
        <div ref={area} className="relative" style={{ width }}>
          <div
            className="relative cursor-text border-b border-[var(--line)]"
            style={{ height: RULER }}
            onPointerDown={(e) => {
              scrubbing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              onSeek(Math.min(timeAt(e.clientX), total));
            }}
            onPointerMove={(e) => scrubbing.current && onSeek(Math.min(timeAt(e.clientX), total))}
            onPointerUp={() => (scrubbing.current = false)}
          >
            {Array.from({ length: Math.floor(total / step) + 2 }, (_, i) => (
              <span key={i} className="absolute top-0 h-full border-l border-[var(--line)] pl-1 text-[0.65rem] tabular-nums opacity-55" style={{ left: i * step * zoom }}>
                {showTime(i * step).replace(/\.0$/, "")}
              </span>
            ))}
          </div>
          {ROWS.map((r) => (
            <div
              key={r.id}
              style={{ height: r.height }}
              className="relative border-b border-[var(--line)]"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  onSelect(null);
                  onSeek(Math.min(timeAt(e.clientX), total));
                }
              }}
              onDragOver={allowDrop}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(ASSET_DRAG);
                if (!id) return;
                e.preventDefault();
                onDropAsset(id, r.id, timeAt(e.clientX));
              }}
            >
              {content[r.id]}
            </div>
          ))}
          {project.clips.length > 0 && <div className="pointer-events-none absolute bottom-0 border-l border-dashed border-[var(--line)]" style={{ left: total * zoom, top: RULER }} />}
          <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 bg-[var(--accent)]" style={{ left: time * zoom }}>
            <span className="absolute -left-[5px] top-0 h-3 w-3 rotate-45 bg-[var(--accent)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
