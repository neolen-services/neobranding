// The editor's tool rail and the panel it opens beside the preview: Media, Captions, Text, Music and sound, Looks.
// Each choice is shown as a picture (caption styles drawn, looks on a frame of your own clip) so it is picked by eye.
import { useEffect, useRef, useState } from "react";
import { CAPTION_STYLES, clipAt, LOOK_LABELS, LOOKS, MOTION_LABELS, MOTIONS, projectLength, TRANSITION_LABELS, TRANSITIONS, type CaptionStyle, type EditAsset, type EditProject, type Look } from "@shared/edit";
import { api } from "./api";
import { drawCaptionSample, fontsReady } from "./EditDraw";
import { LOOK_CSS } from "./EditPreview";
import { ASSET_DRAG, type Change, type Selection } from "./EditTimeline";
import { fieldClass, Icon, ICONS, label, primaryButton, smallButton } from "./studioUi";

export type PanelName = "media" | "captions" | "text" | "sound" | "looks";

const RAIL: { id: PanelName; name: string; icon: string }[] = [
  { id: "media", name: "Media", icon: "M4 6h16v12H4zM4 14l4-4 4 4 3-3 5 5" },
  { id: "captions", name: "Captions", icon: "M4 6h16v12H4zM8 11h3M13 11h3M8 14h8" },
  { id: "text", name: "Text", icon: "M5 6h14M12 6v12M9 18h6" },
  { id: "sound", name: "Music and sound", icon: "M9 18V6l10-2v12M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" },
  { id: "looks", name: "Looks and motion", icon: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.400-4-8.500-9-8.500zM7.500 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 7.500a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" },
];

export function ToolRail({ open, onOpen }: { open: PanelName | null; onOpen: (p: PanelName | null) => void }) {
  return (
    <nav aria-label="Tools" className="flex flex-col items-center gap-1 border-r border-[var(--line)] py-2">
      {RAIL.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-label={r.name}
          aria-pressed={open === r.id}
          title={r.name}
          onClick={() => onOpen(open === r.id ? null : r.id)}
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${open === r.id ? "bg-[var(--primary)]/20 text-[var(--ink)]" : "opacity-60 hover:bg-[var(--tint)] hover:opacity-100"}`}
        >
          <Icon d={r.icon} className="h-5 w-5" />
        </button>
      ))}
    </nav>
  );
}

type PanelProps = {
  project: EditProject;
  time: number;
  selected: Selection;
  locked: boolean;
  /** What a panel action is doing ("" when none). */
  working: string;
  onChange: Change;
  onSelect: (s: Selection) => void;
  onAddFiles: () => void;
  onTranscribe: (asset: EditAsset) => void;
  onCaptions: (wordsPerCaption: number) => void;
  onMusic: (description: string) => void;
  onPlace: (asset: EditAsset, role?: "voice" | "music" | "sfx") => void;
};

export function ToolPanel(props: PanelProps & { open: PanelName }) {
  const name = RAIL.find((r) => r.id === props.open)!.name;
  return (
    <section aria-label={name} className="flex min-h-0 flex-col border-r border-[var(--line)]">
      <p className="border-b border-[var(--line)] px-4 py-2.5 text-sm font-semibold">{name}</p>
      <fieldset disabled={props.locked} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {props.open === "media" && <MediaPanel {...props} />}
        {props.open === "captions" && <CaptionsPanel {...props} />}
        {props.open === "text" && <TextPanel {...props} />}
        {props.open === "sound" && <SoundPanel {...props} />}
        {props.open === "looks" && <LooksPanel {...props} />}
      </fieldset>
    </section>
  );
}

/** A still for a file: the picture itself, or the first frame of a video's strip. */
function Still({ asset, at = 0, className = "", style }: { asset: EditAsset; at?: number; className?: string; style?: React.CSSProperties }) {
  if (asset.kind === "image") return <img src={api.studioFileUrl(asset.file)} alt="" className={`object-cover ${className}`} style={style} />;
  if (asset.kind === "video" && asset.thumbs) {
    const index = Math.min(Math.floor(at / asset.thumbs.every), asset.thumbs.count - 1);
    return <span className={`block bg-no-repeat ${className}`} style={{ backgroundImage: `url("${api.studioFileUrl(asset.thumbs.file)}")`, backgroundSize: `${asset.thumbs.count * 100}% 100%`, backgroundPosition: `${asset.thumbs.count > 1 ? (index / (asset.thumbs.count - 1)) * 100 : 0}% 0`, ...style }} />;
  }
  return (
    <span className={`flex items-center justify-center bg-black/60 text-white/60 ${className}`} style={style}>
      <Icon d={asset.kind === "audio" ? ICONS.speaker : ICONS.film} />
    </span>
  );
}

function MediaPanel({ project, working, onAddFiles, onTranscribe, onPlace }: PanelProps) {
  return (
    <>
      <button type="button" onClick={onAddFiles} className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-[var(--line)] px-3 py-4 text-sm hover:border-[var(--ink)]">
        <Icon d={ICONS.plus} className="h-5 w-5 opacity-70" />
        {working.startsWith("Adding") ? working : "Add files"}
        <span className="text-xs opacity-55">or drop them anywhere on the editor</span>
      </button>
      <p className="text-xs opacity-55">Drag a file onto the timeline, or use + to add it.</p>
      <ul className="grid grid-cols-2 gap-2">
        {project.assets.map((a, i) => {
          const hasSound = a.kind === "audio" || a.hasAudio;
          const used = project.clips.some((c) => c.assetId === a.id) || project.audio.some((s) => s.assetId === a.id);
          return (
            <li key={a.id} draggable onDragStart={(e) => (e.dataTransfer.setData(ASSET_DRAG, a.id), (e.dataTransfer.effectAllowed = "copy"))} className="group cursor-grab active:cursor-grabbing">
              <div className="relative overflow-hidden rounded-lg border border-[var(--line)] bg-black">
                {a.kind === "audio" ? (
                  <span className="flex aspect-[9/12] items-center justify-center bg-violet-900/50 bg-contain bg-center bg-no-repeat" style={a.wave ? { backgroundImage: `url("${api.studioFileUrl(a.wave)}")` } : undefined}>
                    {!a.wave && <Icon d={ICONS.speaker} className="h-5 w-5 text-white/60" />}
                  </span>
                ) : (
                  <Still asset={a} at={a.seconds / 2} className="aspect-[9/12] w-full" />
                )}
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[0.65rem] text-white">{a.kind === "image" ? "Photo" : `${a.seconds.toFixed(1)}s`}</span>
                {!used && <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[0.65rem] text-white/80">Not used</span>}
                <button type="button" aria-label={`Add ${a.name}`} title={a.kind === "audio" ? "Add as music, or as a voice at the playhead" : "Add to the end"} onClick={() => onPlace(a)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <Icon d={ICONS.plus} className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1 truncate text-xs" title={a.name}>
                <span className="opacity-50">A{i + 1}</span> {a.name}
              </p>
              {hasSound && (
                <p className="text-[0.65rem] opacity-55">
                  {a.words && !a.wordsEstimated ? (
                    "Transcribed"
                  ) : (
                    <button type="button" className="underline hover:opacity-100" onClick={() => onTranscribe(a)} title="Hears the words and their times with Deepgram, for cutting and captions">
                      {working === `Transcribing ${a.id}` ? "Transcribing…" : a.wordsEstimated ? "Words from the script · transcribe" : "Transcribe"}
                    </button>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

const SWATCHES = ["#FFFFFF", "#FFD400", "#3DDC84", "#39D5FF", "#FF4D8D", "#FF8A00", "#111111"];

export function Swatches({ value, onChange, name }: { value: string; onChange: (v: string) => void; name: string }) {
  return (
    <div>
      <p className={`${label} mb-1.5`}>{name}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={c} aria-pressed={value.toUpperCase() === c} onClick={() => onChange(c)} className={`h-7 w-7 rounded-full border ${value.toUpperCase() === c ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--bg)]" : "border-[var(--line)]"}`} style={{ background: c }} />
        ))}
        <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-[var(--line)]" title="Another colour">
          <span className="absolute inset-0 flex items-center justify-center text-xs">+</span>
          <input type="color" className="absolute inset-0 opacity-0" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
      </div>
    </div>
  );
}

export function StyleCard({ style, active, onPick }: { style: CaptionStyle; active: boolean; onPick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void fontsReady().then(() => canvas.current && drawCaptionSample(canvas.current, { ...style, size: 1.7 }, "This is it"));
  }, [style]);
  return (
    <button type="button" aria-pressed={active} onClick={onPick} className={`overflow-hidden rounded-xl border ${active ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/40" : "border-[var(--line)] hover:border-[var(--ink)]"}`}>
      <canvas ref={canvas} width={540} height={300} className="block w-full bg-neutral-700" />
      <span className="block px-2 py-1 text-left text-xs capitalize">{style.name === "karaoke" ? "Highlight" : style.name}</span>
    </button>
  );
}

function CaptionsPanel({ project, working, onChange, onCaptions }: PanelProps) {
  const [per, setPer] = useState(3);
  const style = project.captionStyle;
  const set = (changes: Partial<CaptionStyle>) => onChange({ ...project, captionStyle: { ...style, ...changes } }, `captions:${Object.keys(changes).join()}`);
  return (
    <>
      <div className="space-y-2 rounded-xl border border-[var(--line)] p-3">
        <p className="text-sm font-medium">{project.captions.length ? `${project.captions.length} captions` : "No captions yet"}</p>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="opacity-60">Words at a time</span>
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={per === n} onClick={() => setPer(n)} className={`h-6 w-6 rounded-full border ${per === n ? "border-[var(--primary)] bg-[var(--primary)]/15" : "border-[var(--line)]"}`}>
              {n}
            </button>
          ))}
        </div>
        <button type="button" className={`${primaryButton} w-full !py-1.5`} disabled={working !== ""} onClick={() => onCaptions(per)}>
          {working === "Captions" ? "Making captions…" : project.captions.length ? "Make them again" : "Make captions"}
        </button>
        <p className="text-[0.7rem] opacity-55">From the words heard in your voice and video files, as the timeline now stands.</p>
      </div>
      <label className="flex items-center justify-between text-sm">
        Show captions
        <input type="checkbox" checked={project.showCaptions} onChange={(e) => onChange({ ...project, showCaptions: e.target.checked })} />
      </label>
      <div>
        <p className={`${label} mb-1.5`}>Style</p>
        <div className="grid grid-cols-2 gap-2">
          {CAPTION_STYLES.map((n) => (
            <StyleCard key={n} style={{ ...style, name: n }} active={style.name === n} onPick={() => set({ name: n })} />
          ))}
        </div>
      </div>
      <Swatches name="Text colour" value={style.color} onChange={(v) => set({ color: v })} />
      <Swatches name={style.name === "boxed" ? "Band colour" : "Highlight colour"} value={style.accent} onChange={(v) => set({ accent: v })} />
      <label className="block text-xs">
        <span className="mb-1 flex justify-between font-medium">
          <span className="opacity-70">Size</span>
          <span className="opacity-60">{Math.round(style.size * 100)}%</span>
        </span>
        <input type="range" className="w-full accent-[var(--primary)]" min={0.6} max={1.6} step={0.05} value={style.size} onChange={(e) => set({ size: Number(e.target.value) })} />
      </label>
      <label className="block text-xs">
        <span className="mb-1 flex justify-between font-medium">
          <span className="opacity-70">Height on screen</span>
          <span className="opacity-60">{style.y > 0.78 ? "Under the buttons" : style.y > 0.6 ? "Lower third" : style.y > 0.4 ? "Middle" : "Upper"}</span>
        </span>
        <input type="range" className="w-full accent-[var(--primary)]" min={0.2} max={0.85} step={0.01} value={style.y} onChange={(e) => set({ y: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between text-sm">
        Capital letters
        <input type="checkbox" checked={style.upper} onChange={(e) => set({ upper: e.target.checked })} />
      </label>
    </>
  );
}

function TextPanel({ project, time, onChange, onSelect }: PanelProps) {
  const total = Math.max(projectLength(project), 1);
  const add = (text: string, start: number, length: number, position: "top" | "middle" | "bottom", style: "title" | "label" | "plain") => {
    const id = crypto.randomUUID();
    const from = Math.min(Math.max(start, 0), Math.max(total - 0.5, 0));
    onChange({ ...project, texts: [...project.texts, { id, text, start: from, end: Math.min(from + length, Math.max(total, from + 0.5)), position, style }] });
    onSelect({ kind: "text", id });
  };
  const presets = [
    { name: "Hook title", note: "Big, at the top, for the first 2.5 seconds", act: () => add("Your hook", 0, 2.5, "top", "title") },
    { name: "Label", note: "On a band, at the playhead", act: () => add("Label", time, 2.5, "middle", "label") },
    { name: "Call to action", note: "Over the last 3 seconds", act: () => add("Follow for more", total - 3, 3, "bottom", "label") },
    { name: "Plain text", note: "At the playhead", act: () => add("Text", time, 2.5, "middle", "plain") },
  ];
  return (
    <>
      <div className="space-y-2">
        {presets.map((p) => (
          <button key={p.name} type="button" onClick={p.act} className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2.5 text-left hover:border-[var(--ink)]">
            <Icon d={ICONS.plus} className="h-4 w-4 opacity-60" />
            <span>
              <span className="block text-sm font-medium">{p.name}</span>
              <span className="block text-xs opacity-55">{p.note}</span>
            </span>
          </button>
        ))}
      </div>
      {project.texts.length > 0 && (
        <div>
          <p className={`${label} mb-1.5`}>On the video</p>
          <ul className="space-y-1">
            {project.texts.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onSelect({ kind: "text", id: t.id })} className="w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--tint)]">
                  {t.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function SoundPanel({ project, working, onMusic, onPlace, onSelect }: PanelProps) {
  const [describe, setDescribe] = useState("");
  const sounds = project.assets.filter((a) => a.kind === "audio");
  return (
    <>
      <div className="space-y-2 rounded-xl border border-[var(--line)] p-3">
        <p className="text-sm font-medium">Make music with AI</p>
        <textarea className={`${fieldClass} !py-2 text-sm`} rows={2} placeholder="Warm lo-fi beat, relaxed, soft piano" value={describe} onChange={(e) => setDescribe(e.target.value)} />
        <button type="button" className={`${primaryButton} w-full !py-1.5`} disabled={working !== "" || !describe.trim()} onClick={() => onMusic(describe)}>
          {working === "Music" ? "Making music…" : "Make it"}
        </button>
        <p className="text-[0.7rem] opacity-55">Made by ElevenLabs as long as the video, using your ElevenLabs credits. It replaces any music already on the timeline.</p>
      </div>
      {sounds.length > 0 && (
        <div>
          <p className={`${label} mb-1.5`}>Your sound files</p>
          <ul className="space-y-1.5">
            {sounds.map((a) => (
              <li key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG, a.id)} className="rounded-lg border border-[var(--line)] p-2 text-xs">
                <p className="truncate text-sm" title={a.name}>
                  {a.name}
                </p>
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" className={smallButton} onClick={() => onPlace(a, "music")}>
                    As music
                  </button>
                  <button type="button" className={smallButton} onClick={() => onPlace(a, "voice")} title="Placed at the playhead">
                    As voice
                  </button>
                  <button type="button" className={smallButton} onClick={() => onPlace(a, "sfx")} title="Placed at the playhead">
                    As effect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {project.audio.length > 0 && (
        <div>
          <p className={`${label} mb-1.5`}>On the timeline</p>
          <ul className="space-y-1">
            {project.audio.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onSelect({ kind: "sound", id: s.id })} className="flex w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--tint)]">
                  <span className="truncate">{project.assets.find((a) => a.id === s.assetId)?.name}</span>
                  <span className="shrink-0 text-xs opacity-55">{s.role === "sfx" ? "effect" : s.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function LooksPanel({ project, time, selected, onChange }: PanelProps) {
  // The look is set on the selected clip, or else on the clip under the playhead.
  const picked = selected?.kind === "clip" ? project.clips.find((c) => c.id === selected.id) : undefined;
  const at = clipAt(project, time);
  const clip = picked ?? at?.clip;
  if (!clip) return <p className="text-sm opacity-60">Put a clip on the timeline first.</p>;
  const index = project.clips.indexOf(clip);
  const asset = project.assets.find((a) => a.id === clip.assetId);
  const fileTime = picked ? clip.in : (at?.fileTime ?? clip.in);
  const setClip = (changes: Partial<typeof clip>) => onChange({ ...project, clips: project.clips.map((c) => (c.id === clip.id ? { ...c, ...changes } : c)) });
  return (
    <>
      <p className="text-xs opacity-60">For clip {index + 1}. Select another clip on the timeline to change it instead.</p>
      <div className="grid grid-cols-3 gap-2">
        {LOOKS.map((l: Look) => (
          <button key={l} type="button" aria-pressed={clip.look === l} onClick={() => setClip({ look: l })} className={`overflow-hidden rounded-lg border text-left ${clip.look === l ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/40" : "border-[var(--line)] hover:border-[var(--ink)]"}`}>
            {asset ? <Still asset={asset} at={fileTime} className="aspect-square w-full" style={{ filter: LOOK_CSS[l] }} /> : <span className="block aspect-square bg-black" />}
            <span className="block truncate px-1.5 py-1 text-[0.7rem]">{LOOK_LABELS[l]}</span>
          </button>
        ))}
      </div>
      <button type="button" className={smallButton} onClick={() => onChange({ ...project, clips: project.clips.map((c) => ({ ...c, look: clip.look })) })}>
        Use “{LOOK_LABELS[clip.look]}” on every clip
      </button>
      <div>
        <p className={`${label} mb-1.5`}>Motion</p>
        <div className="grid grid-cols-2 gap-1.5">
          {MOTIONS.map((m) => (
            <button key={m} type="button" aria-pressed={clip.motion === m} onClick={() => setClip({ motion: m })} className={`rounded-lg border px-2 py-1.5 text-xs ${clip.motion === m ? "border-[var(--primary)] bg-[var(--primary)]/15 font-medium" : "border-[var(--line)] hover:border-[var(--ink)]"}`}>
              {MOTION_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className={`${label} mb-1.5`}>Comes in with</p>
        <div className="grid grid-cols-2 gap-1.5">
          {TRANSITIONS.map((t) => (
            <button key={t} type="button" aria-pressed={clip.transition === t} onClick={() => setClip({ transition: t })} className={`rounded-lg border px-2 py-1.5 text-xs ${clip.transition === t ? "border-[var(--primary)] bg-[var(--primary)]/15 font-medium" : "border-[var(--line)] hover:border-[var(--ink)]"}`}>
              {TRANSITION_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
