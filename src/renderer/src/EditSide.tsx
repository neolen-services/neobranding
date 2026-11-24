// The editor's right-hand panel. "AI" is the conversation with the AI editor, one card per turn with what it
// changed and a way to undo that turn. "Selected" holds the controls for whatever is picked on the timeline.
import { useEffect, useRef, type ReactNode } from "react";
import { clipLength, clipStarts, LOOK_LABELS, LOOKS, MOTION_LABELS, MOTIONS, showTime, TRANSITION_LABELS, TRANSITIONS, type EditChatView, type EditClip, type EditProject, type EditText } from "@shared/edit";
import type { Change, Selection } from "./EditTimeline";
import { fieldClass, Icon, ICONS, label, smallButton } from "./studioUi";

export function SidePanel({
  tab,
  onTab,
  chat,
  busy,
  error,
  onUndoTurn,
  onNewChat,
  onOpenSettings,
  children,
}: {
  tab: "ai" | "selected";
  onTab: (t: "ai" | "selected") => void;
  chat: EditChatView;
  /** What the AI editor is doing, or "". */
  busy: string;
  error: string;
  onUndoTurn: (checkpoint: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  /** The controls for the selection. */
  children: ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Newer browsers return a promise from scrollIntoView, which an effect must not return.
    void end.current?.scrollIntoView({ block: "end" });
  }, [chat.entries.length, busy, tab]);
  const lastTurn = [...chat.entries].reverse().find((e) => e.role === "assistant" && e.checkpoint)?.checkpoint;

  return (
    <aside className="flex min-h-0 flex-col border-l border-[var(--line)]">
      <div role="tablist" className="flex items-center gap-4 border-b border-[var(--line)] px-4 text-sm font-medium">
        {(
          [
            ["ai", "AI editor"],
            ["selected", "Selected"],
          ] as const
        ).map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)} className={`-mb-px border-b-2 py-2.5 ${tab === id ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"}`}>
            {name}
            {id === "ai" && busy && <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)] align-middle" />}
          </button>
        ))}
        {tab === "ai" && chat.entries.length > 0 && (
          <button type="button" className="ml-auto text-xs font-normal opacity-55 hover:opacity-100" disabled={busy !== ""} onClick={onNewChat} title="Starts the conversation again. The timeline stays as it is.">
            New chat
          </button>
        )}
      </div>

      {tab === "selected" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {chat.entries.length === 0 && !busy && (
            <div className="space-y-3 text-sm">
              <p className="opacity-75">Ask for what you want in the box under the preview. The AI editor sees your media and hears what is said, then edits the timeline here in front of you.</p>
              <p className="opacity-75">Every request is a step you can undo, here or with Ctrl+Z.</p>
              <p className="text-xs opacity-55">Uses your Claude credit. Transcripts use Deepgram; music and sound effects use ElevenLabs.</p>
            </div>
          )}
          {chat.entries.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="ml-6 rounded-2xl rounded-br-md bg-[var(--primary)]/15 px-3.5 py-2 text-sm">
                {m.text}
              </p>
            ) : (
              <div key={i} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
                {m.actions.length > 0 && (
                  <ul className="mb-2 space-y-1 border-b border-[var(--line)] pb-2">
                    {m.actions.map((a, k) => (
                      <li key={k} className="flex items-start gap-2 text-xs opacity-75">
                        <Icon d={ICONS.check} className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
                {m.text && <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>}
                {m.checkpoint && m.actions.length > 0 && (
                  <button
                    type="button"
                    className={`${smallButton} mt-2.5 flex items-center gap-1.5`}
                    disabled={busy !== ""}
                    title={m.checkpoint === lastTurn ? "Puts the timeline back as it was before this request" : "Puts the timeline back as it was before this request, which also undoes everything after it"}
                    onClick={() => onUndoTurn(m.checkpoint!)}
                  >
                    <Icon d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" className="h-3.5 w-3.5" />
                    {m.checkpoint === lastTurn ? "Undo this" : "Go back to before this"}
                  </button>
                )}
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm opacity-70">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
              {busy}…
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-red-400">
              {error}{" "}
              {/key/i.test(error) && (
                <button type="button" className="underline" onClick={onOpenSettings}>
                  Open Settings
                </button>
              )}
            </p>
          )}
          <div ref={end} />
        </div>
      )}
      {tab === "ai" && chat.costUsd > 0 && <p className="border-t border-[var(--line)] px-4 py-2 text-xs tabular-nums opacity-55">${chat.costUsd.toFixed(2)} spent in this conversation</p>}
    </aside>
  );
}

// ---------- Controls for the selection ----------

function Slider({ name, value, min, max, step, show, onChange }: { name: string; value: number; min: number; max: number; step: number; show?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 flex justify-between font-medium">
        <span className="opacity-70">{name}</span>
        <span className="tabular-nums opacity-60">{show ? show(value) : value.toFixed(2)}</span>
      </span>
      <input type="range" className="w-full accent-[var(--primary)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Chips<T extends string>({ value, options, labels, onChange }: { value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={`rounded-full border px-2.5 py-1 text-xs ${value === o ? "border-[var(--primary)] bg-[var(--primary)]/15 font-medium" : "border-[var(--line)] opacity-75 hover:opacity-100"}`}>
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

const secs = (v: number) => `${v.toFixed(1)}s`;

export function SelectedControls({ project, selected, time, onChange, onSelect, onSplit, onRemove }: { project: EditProject; selected: Selection; time: number; onChange: Change; onSelect: (s: Selection) => void; onSplit: () => void; onRemove: () => void }) {
  const clipIndex = selected?.kind === "clip" ? project.clips.findIndex((c) => c.id === selected.id) : -1;
  const sound = selected?.kind === "sound" ? project.audio.find((a) => a.id === selected.id) : undefined;
  const caption = selected?.kind === "caption" ? project.captions.find((c) => c.id === selected.id) : undefined;
  const text = selected?.kind === "text" ? project.texts.find((t) => t.id === selected.id) : undefined;
  const key = `panel:${selected?.id}`;

  const header = (title: string, sub: string) => (
    <div className="mb-4 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display font-semibold">{title}</p>
        <p className="text-xs opacity-60">{sub}</p>
      </div>
      <button type="button" aria-label="Remove (Delete)" title="Remove (Delete)" className="rounded-full p-1.5 opacity-60 hover:text-red-400 hover:opacity-100" onClick={onRemove}>
        <Icon d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      </button>
      <button type="button" aria-label="Deselect (Esc)" title="Deselect (Esc)" className="rounded-full p-1.5 opacity-60 hover:opacity-100" onClick={() => onSelect(null)}>
        <Icon d={ICONS.close} />
      </button>
    </div>
  );

  if (clipIndex >= 0) {
    const c = project.clips[clipIndex];
    const a = project.assets.find((x) => x.id === c.assetId);
    const start = clipStarts(project)[clipIndex];
    const set = (changes: Partial<EditClip>) => onChange({ ...project, clips: project.clips.map((x, i) => (i === clipIndex ? { ...x, ...changes } : x)) }, `${key}:${Object.keys(changes).join()}`);
    const inside = time > start + 0.05 && time < start + clipLength(c) - 0.05;
    return (
      <div className="space-y-4">
        {header(`Clip ${clipIndex + 1}`, `${a?.name ?? ""} · ${showTime(start)} · ${clipLength(c).toFixed(1)}s`)}
        <p className="text-xs opacity-60">Drag its edges on the timeline to trim it, or drag it to move it.</p>
        <Slider name="Speed" value={c.speed} min={0.25} max={3} step={0.05} show={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ speed: v })} />
        {a?.kind === "video" && a.hasAudio && <Slider name="Its own sound" value={c.volume} min={0} max={2} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ volume: v })} />}
        <div>
          <p className={`${label} mb-1.5`}>Motion</p>
          <Chips value={c.motion} options={MOTIONS} labels={MOTION_LABELS} onChange={(v) => set({ motion: v })} />
        </div>
        <div>
          <p className={`${label} mb-1.5`}>Look</p>
          <Chips value={c.look} options={LOOKS} labels={LOOK_LABELS} onChange={(v) => set({ look: v })} />
        </div>
        <div>
          <p className={`${label} mb-1.5`}>Comes in with</p>
          <Chips value={c.transition} options={TRANSITIONS} labels={TRANSITION_LABELS} onChange={(v) => set({ transition: v })} />
        </div>
        <button type="button" className={smallButton} disabled={!inside} onClick={onSplit} title="S">
          Split at the playhead (S)
        </button>
      </div>
    );
  }

  if (sound) {
    const a = project.assets.find((x) => x.id === sound.assetId);
    const set = (changes: Partial<typeof sound>) => onChange({ ...project, audio: project.audio.map((x) => (x.id === sound.id ? { ...x, ...changes } : x)) }, `${key}:${Object.keys(changes).join()}`);
    return (
      <div className="space-y-4">
        {header(sound.role === "music" ? "Music" : sound.role === "sfx" ? "Sound effect" : "Voice", `${a?.name ?? ""} · from ${showTime(sound.start)}`)}
        <Slider name="Volume" value={sound.volume} min={0} max={sound.role === "music" ? 1 : 2} step={0.01} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ volume: v })} />
        <Slider name="Fade in" value={sound.fadeIn} min={0} max={5} step={0.1} show={secs} onChange={(v) => set({ fadeIn: v })} />
        <Slider name="Fade out" value={sound.fadeOut} min={0} max={5} step={0.1} show={secs} onChange={(v) => set({ fadeOut: v })} />
        <div>
          <p className={`${label} mb-1.5`}>Plays as</p>
          <Chips value={sound.role} options={["voice", "music", "sfx"] as const} labels={{ voice: "Voice", music: "Music", sfx: "Sound effect" }} onChange={(v) => set({ role: v })} />
        </div>
        {sound.role === "music" && <p className="text-xs opacity-60">In the export, music turns down by itself whenever someone speaks.</p>}
      </div>
    );
  }

  if (text) {
    const set = (changes: Partial<EditText>) => onChange({ ...project, texts: project.texts.map((x) => (x.id === text.id ? { ...x, ...changes } : x)) }, `${key}:${Object.keys(changes).join()}`);
    return (
      <div className="space-y-4">
        {header("Text", `${showTime(text.start)} to ${showTime(text.end)}`)}
        <textarea className={`${fieldClass} !py-2`} rows={2} value={text.text} onChange={(e) => set({ text: e.target.value })} aria-label="Words" />
        <div>
          <p className={`${label} mb-1.5`}>Where</p>
          <Chips value={text.position} options={["top", "middle", "bottom"] as const} labels={{ top: "Top", middle: "Middle", bottom: "Bottom" }} onChange={(v) => set({ position: v })} />
        </div>
        <div>
          <p className={`${label} mb-1.5`}>Style</p>
          <Chips value={text.style} options={["title", "label", "plain"] as const} labels={{ title: "Title", label: "Label", plain: "Plain" }} onChange={(v) => set({ style: v })} />
        </div>
        <label className="flex items-center justify-between text-sm">
          Pops in
          <input type="checkbox" checked={text.pop === true} onChange={(e) => set({ pop: e.target.checked || undefined })} />
        </label>
      </div>
    );
  }

  if (caption) {
    return (
      <div className="space-y-4">
        {header("Caption", `${showTime(caption.start)} to ${showTime(caption.end)}`)}
        <input
          className={`${fieldClass} !py-2`}
          aria-label="Words"
          value={caption.words.map((w) => w.text).join(" ")}
          onChange={(e) => {
            const parts = e.target.value.split(/\s+/).filter(Boolean);
            const span = caption.end - caption.start;
            const words = parts.map((w, k) => ({ text: w, start: caption.start + (span * k) / parts.length, end: caption.start + (span * (k + 1)) / parts.length }));
            onChange({ ...project, captions: project.captions.map((c) => (c.id === caption.id ? { ...c, words } : c)) }, `${key}:words`);
          }}
        />
        <p className="text-xs opacity-60">The look of every caption is in the Captions panel on the left.</p>
      </div>
    );
  }

  return <p className="text-sm opacity-60">Click a clip, text, caption or sound on the timeline to change it here.</p>;
}
