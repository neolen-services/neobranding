// One project in the video editor, as a single fixed workspace: tools on the left, the preview with the AI prompt
// in the middle, the AI conversation or the selection's controls on the right, and the timeline along the bottom.
// Every change, the creator's or the AI's, can be undone; each AI request is one step.
import { useEffect, useRef, useState, type DragEvent } from "react";
import { clipAt, clipLength, clipStarts, projectLength, showTime, timelineOf, type EditAsset, type EditChatView, type EditProject, type EditResult } from "@shared/edit";
import { api } from "./api";
import { ExportDialog, StartWindow } from "./EditDialogs";
import { ToolPanel, ToolRail, type PanelName } from "./EditPanels";
import { EditPreview } from "./EditPreview";
import { SelectedControls, SidePanel } from "./EditSide";
import { EditTimeline, type Selection } from "./EditTimeline";
import { readUpload } from "./ServicePicker";
import { Icon, ICONS, primaryButton, smallButton } from "./studioUi";

const SAVE_AFTER_MS = 400;
const POLL_MS = 1000;
/** Changes with the same key this close together are one step of undo (a drag, a slider, typing). */
const MERGE_MS = 1500;
const HISTORY = 100;

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function EditorPage({ projectId, onBack, onOpenSettings }: { projectId: string; onBack: () => void; onOpenSettings: () => void }) {
  const [project, setProject] = useState<EditProject | null>(null);
  const [error, setError] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  const [zoom, setZoom] = useState(60);
  const [safeZones, setSafeZones] = useState(false);
  const [panel, setPanel] = useState<PanelName | null>("media");
  const [side, setSide] = useState<"ai" | "selected">("ai");
  const [working, setWorking] = useState("");
  const [agentBusy, setAgentBusy] = useState("");
  const [chat, setChat] = useState<EditChatView>({ entries: [], costUsd: 0 });
  const [chatError, setChatError] = useState("");
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<"saved" | "saving" | "failed">("saved");
  const [exporting, setExporting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const latest = useRef<EditProject | null>(null);
  latest.current = project;
  const past = useRef<EditProject[]>([]);
  const future = useRef<EditProject[]>([]);
  const lastKey = useRef({ key: "", at: 0 });
  const saveTimer = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const timelineBox = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const p = await api.getEdit(projectId);
      if (!live) return;
      if (!p) return setError("That project is gone.");
      setProject(p);
      setChat(await api.editChat(projectId));
      // Projects made before the timeline showed frames and waveforms get them now.
      const prepared = await api.prepareEdit(projectId).catch(() => null);
      if (live && prepared) setProject((now) => (now ? { ...now, assets: prepared.assets } : prepared));
    })().catch((e) => setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [projectId]);

  // While the AI editor works, its changes appear as it makes them.
  useEffect(() => {
    if (!agentBusy) return;
    const timer = window.setInterval(async () => {
      const [p, status] = await Promise.all([api.getEdit(projectId), api.editorProgress(projectId)]);
      if (p) setProject(p);
      if (status) setAgentBusy(status);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [agentBusy !== "", projectId]);

  const locked = agentBusy !== "" || exporting;

  function persist(next: EditProject) {
    setSaved("saving");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const result = await api.updateEdit(next).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
      setSaved(result.ok ? "saved" : "failed");
      if (!result.ok) setError(result.error);
    }, SAVE_AFTER_MS);
  }

  function remember(before: EditProject) {
    past.current = [...past.current.slice(-HISTORY + 1), before];
    future.current = [];
  }

  /** The creator's own change: shown at once, saved a moment later, and one step of undo. */
  function change(next: EditProject, key?: string) {
    const now = latest.current;
    if (locked || !now) return;
    const t = Date.now();
    if (!(key && key === lastKey.current.key && t - lastKey.current.at < MERGE_MS)) remember(now);
    lastKey.current = { key: key ?? "", at: t };
    setProject(next);
    persist(next);
  }

  /** A project the app sent back after an action (captions made, music added, a turn undone): already saved, and undoable. */
  function adopt(result: EditResult) {
    if (!result.ok) return setError(result.error);
    if (latest.current) remember(latest.current);
    lastKey.current = { key: "", at: 0 };
    setProject(result.project);
  }

  /** Undo and redo change the timeline only; media added since stays. */
  function step(from: React.MutableRefObject<EditProject[]>, to: React.MutableRefObject<EditProject[]>) {
    const now = latest.current;
    const target = from.current.at(-1);
    if (!now || !target || locked) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, now];
    const next = { ...now, ...timelineOf(target) };
    lastKey.current = { key: "", at: 0 };
    setProject(next);
    persist(next);
    redraw((n) => n + 1);
  }
  const undo = () => step(past, future);
  const redo = () => step(future, past);

  async function addFiles(files: FileList | File[] | null) {
    const list = [...(files ?? [])];
    if (!list.length || !project) return;
    setWorking(`Adding ${list.length === 1 ? list[0].name : `${list.length} files`}`);
    setError("");
    try {
      const uploads = await Promise.all(list.map(async (f) => ({ name: f.name, file: await readUpload(f) })));
      adopt(await api.importToEdit(project.id, uploads));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The files could not be added.");
    } finally {
      setWorking("");
    }
  }

  async function run(what: string, work: () => Promise<EditResult>) {
    setWorking(what);
    setError("");
    try {
      adopt(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setWorking("");
    }
  }

  /** Puts a file on the timeline: pictures and video at the end (or where dropped), sound as music or at a time. */
  function place(asset: EditAsset, role?: "voice" | "music" | "sfx", at?: number, row?: string) {
    const p = latest.current;
    if (!p) return;
    if (asset.kind !== "audio" && row !== "voice" && row !== "music") {
      const clip = { id: crypto.randomUUID(), assetId: asset.id, in: 0, out: asset.kind === "image" ? 3 : asset.seconds, speed: 1, look: "none" as const, motion: asset.kind === "image" ? ("zoom-in" as const) : ("none" as const), transition: "cut" as const, volume: 1 };
      let index = p.clips.length;
      if (at !== undefined) {
        const starts = clipStarts(p);
        index = p.clips.findIndex((c, i) => starts[i] + clipLength(c) / 2 > at);
        if (index < 0) index = p.clips.length;
      }
      change({ ...p, clips: [...p.clips.slice(0, index), clip, ...p.clips.slice(index)] });
      setSelected({ kind: "clip", id: clip.id });
      return;
    }
    if (asset.kind === "image") return;
    const as = role ?? (row === "music" || (row === undefined && !p.audio.some((a) => a.role === "music")) ? "music" : "voice");
    const music = as === "music";
    const item = { id: crypto.randomUUID(), assetId: asset.id, role: as, start: music && at === undefined ? 0 : (at ?? time), in: 0, out: asset.seconds, volume: music ? 0.35 : 1, fadeIn: music ? 0.5 : 0, fadeOut: music ? 1.5 : 0 };
    change({ ...p, audio: [...p.audio, item] });
    setSelected({ kind: "sound", id: item.id });
  }

  function split() {
    const p = latest.current;
    if (!p) return;
    const at = clipAt(p, time);
    if (!at) return;
    const into = time - at.start;
    if (into < 0.05 || into > clipLength(at.clip) - 0.05) return;
    const cut = at.clip.in + into * at.clip.speed;
    const second = { ...at.clip, id: crypto.randomUUID(), in: cut, transition: "cut" as const };
    change({ ...p, clips: [...p.clips.slice(0, at.index), { ...at.clip, out: cut }, second, ...p.clips.slice(at.index + 1)] });
    setSelected({ kind: "clip", id: second.id });
  }

  function remove() {
    const p = latest.current;
    if (!p || !selected) return;
    const id = selected.id;
    setSelected(null);
    change({ ...p, clips: p.clips.filter((c) => c.id !== id), audio: p.audio.filter((a) => a.id !== id), captions: p.captions.filter((c) => c.id !== id), texts: p.texts.filter((t) => t.id !== id) });
  }

  async function send(text: string) {
    const said = text.trim();
    const before = latest.current;
    if (!said || agentBusy || !before) return;
    setDraft("");
    setChatError("");
    setSide("ai");
    setPlaying(false);
    setChat((c) => ({ ...c, entries: [...c.entries, { role: "user", text: said, actions: [] }] }));
    setAgentBusy("Thinking");
    try {
      const reply = await api.sendToEditor(before.id, said);
      if (reply.chat) setChat(reply.chat);
      if (!reply.ok) setChatError(reply.error);
      const after = await api.getEdit(before.id);
      if (after) {
        // The whole request is one step of undo.
        if (JSON.stringify(timelineOf(after)) !== JSON.stringify(timelineOf(before))) remember(before);
        lastKey.current = { key: "", at: 0 };
        setProject(after);
      }
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "The AI editor could not be reached.");
    } finally {
      setAgentBusy("");
    }
  }

  // Keyboard shortcuts, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = latest.current;
      if (!p || typing(e.target) || exporting) return;
      const mod = e.ctrlKey || e.metaKey;
      const total = projectLength(p);
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if (e.key.toLowerCase() === "s" && !mod) {
        split();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        const by = (e.shiftKey ? 1 : 1 / p.fps) * (e.key === "ArrowLeft" ? -1 : 1);
        setTime((t) => Math.min(Math.max(t + by, 0), total));
      } else if (e.key === "Home") setTime(0);
      else if (e.key === "End") setTime(total);
      else if (e.key === "Escape") setSelected(null);
      else if (e.key === "=" || e.key === "+") setZoom((z) => Math.min(z * 1.25, 400));
      else if (e.key === "-") setZoom((z) => Math.max(z / 1.25, 6));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Choosing a piece shows its controls.
  useEffect(() => {
    if (selected) setSide("selected");
  }, [selected?.id]);

  if (error && !project) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!project) return <p className="p-6 text-sm opacity-60">Opening the project…</p>;
  const total = projectLength(project);
  const empty = project.assets.length === 0;
  const fit = () => {
    const width = (timelineBox.current?.clientWidth ?? 900) - 112 - 40;
    setZoom(Math.min(Math.max(width / Math.max(total, 1), 6), 400));
  };

  const suggestions = [
    project.clips.length > 1 && "Make a tight first cut: open on the strongest moment and cut the pauses",
    project.captions.length === 0 && "Add bold captions",
    project.texts.length === 0 && "Add a hook title for the first two seconds",
    !project.audio.some((a) => a.role === "music") && "Add calm instrumental music under it",
    "Make it punchier with punch-ins and quicker cuts",
  ].filter((s): s is string => Boolean(s));

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes("Files") && !locked) {
      e.preventDefault();
      setDropping(true);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col" onDragOver={onDragOver} onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)} onDrop={(e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDropping(false);
      void addFiles(e.dataTransfer.files);
    }}>
      {/* Top bar */}
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <button type="button" aria-label="Back to all projects" title="All projects" className="rounded-full p-2 hover:bg-[var(--tint)]" onClick={onBack}>
          <Icon d={ICONS.back} />
        </button>
        <input
          aria-label="Project title"
          className="min-w-0 max-w-md flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-lg font-semibold hover:border-[var(--line)] focus:border-[var(--primary)] focus:outline-none"
          value={project.title}
          onChange={(e) => change({ ...project, title: e.target.value }, "title")}
        />
        <span className="text-xs opacity-55">{saved === "saving" ? "Saving…" : saved === "failed" ? "Not saved" : "Saved"}</span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={!past.current.length || locked} className="rounded-full p-2 hover:bg-[var(--tint)] disabled:opacity-30" onClick={undo}>
            <Icon d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </button>
          <button type="button" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" disabled={!future.current.length || locked} className="rounded-full p-2 hover:bg-[var(--tint)] disabled:opacity-30" onClick={redo}>
            <Icon d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
          </button>
          <span className="mx-1 h-5 w-px bg-[var(--line)]" />
          <button type="button" className={`${primaryButton} flex items-center gap-2 !py-1.5`} disabled={locked || project.clips.length === 0} onClick={() => setExporting(true)} title="Make the finished MP4">
            <Icon d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            Export
          </button>
        </span>
      </header>

      {error && (
        <p role="alert" className="flex items-start justify-between gap-3 border-b border-red-400/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300">
          {error}
          <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => setError("")}>
            <Icon d={ICONS.close} />
          </button>
        </p>
      )}

      {empty ? (
        <div className="min-h-0 flex-1">
          <StartWindow project={project} working={working} onFiles={() => fileInput.current?.click()} onProject={(p) => setProject(p)} setError={setError} />
        </div>
      ) : (
        <>
          {/* Tools, preview and the right-hand panel */}
          <div className={`grid min-h-0 flex-1 ${panel ? "grid-cols-[3.5rem_17rem_minmax(0,1fr)_21rem] 2xl:grid-cols-[3.5rem_19rem_minmax(0,1fr)_24rem]" : "grid-cols-[3.5rem_minmax(0,1fr)_21rem] 2xl:grid-cols-[3.5rem_minmax(0,1fr)_24rem]"}`}>
            <ToolRail open={panel} onOpen={setPanel} />
            {panel && (
              <ToolPanel
                open={panel}
                project={project}
                time={time}
                selected={selected}
                locked={locked}
                working={working}
                onChange={change}
                onSelect={setSelected}
                onAddFiles={() => fileInput.current?.click()}
                onTranscribe={(a) => void run(`Transcribing ${a.id}`, () => api.transcribeEditAsset(project.id, a.id))}
                onCaptions={(n) => void run("Captions", () => api.remakeEditCaptions(project.id, n))}
                onMusic={(d) => void run("Music", () => api.makeEditMusic(project.id, d))}
                onPlace={(a, role) => place(a, role)}
              />
            )}
            <div className="flex min-h-0 min-w-0 flex-col items-center gap-3 bg-[var(--tint)]/40 px-4 pb-3 pt-4">
              <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                <div className="aspect-[9/16] h-full max-h-full max-w-full">
                  <EditPreview project={project} time={time} playing={playing} onTime={setTime} onPlaying={setPlaying} safeZones={safeZones} className="h-full w-full" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Back one frame (←)" title="Back one frame (←), a second with Shift" className="rounded-full p-1.5 opacity-70 hover:opacity-100" onClick={() => setTime((t) => Math.max(t - 1 / project.fps, 0))}>
                  <Icon d="M15 18l-6-6 6-6" />
                </button>
                <button type="button" aria-label={playing ? "Pause (Space)" : "Play (Space)"} title="Play or pause (Space)" className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--bg)]" onClick={() => setPlaying(!playing)}>
                  <Icon d={playing ? ICONS.pause : ICONS.play} />
                </button>
                <button type="button" aria-label="Forward one frame (→)" title="Forward one frame (→), a second with Shift" className="rounded-full p-1.5 opacity-70 hover:opacity-100" onClick={() => setTime((t) => Math.min(t + 1 / project.fps, total))}>
                  <Icon d="M9 18l6-6-6-6" />
                </button>
                <span className="w-28 text-center text-sm tabular-nums opacity-70">
                  {showTime(time)} / {showTime(total)}
                </span>
                <button type="button" aria-pressed={safeZones} title="Shows where the platforms' buttons cover the video" className={`rounded-full border px-2.5 py-1 text-xs ${safeZones ? "border-[var(--primary)] bg-[var(--primary)]/15" : "border-[var(--line)] opacity-70"}`} onClick={() => setSafeZones(!safeZones)}>
                  Safe zones
                </button>
              </div>
              {/* The AI prompt, always one sentence away. */}
              <div className="w-full max-w-2xl space-y-2">
                {!agentBusy && (
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {suggestions.map((s) => (
                      <button key={s} type="button" className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--bg)] px-3 py-1 text-xs hover:border-[var(--ink)]" onClick={() => void send(s)}>
                        {s.split(":")[0]}
                      </button>
                    ))}
                  </div>
                )}
                <form
                  className="flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--bg)] py-1.5 pl-3.5 pr-1.5 focus-within:border-[var(--primary)]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(draft);
                  }}
                >
                  <Icon d={ICONS.ai} className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  <input
                    aria-label="Ask the AI editor"
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm placeholder:opacity-50 focus:outline-none"
                    placeholder={agentBusy ? `${agentBusy}…` : "Ask AI: cut the pauses, add captions, make it punchier…"}
                    value={draft}
                    disabled={agentBusy !== ""}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button type="submit" className={`${primaryButton} !px-4 !py-1.5`} disabled={agentBusy !== "" || !draft.trim()}>
                    {agentBusy ? "Working…" : "Ask"}
                  </button>
                </form>
              </div>
            </div>
            <SidePanel
              tab={side}
              onTab={setSide}
              chat={chat}
              busy={agentBusy}
              error={chatError}
              onUndoTurn={(checkpoint) => void run("Undoing", () => api.undoEditorTurn(project.id, checkpoint))}
              onNewChat={() => void api.clearEditChat(project.id).then(() => setChat({ entries: [], costUsd: 0 }))}
              onOpenSettings={onOpenSettings}
            >
              <fieldset disabled={locked}>
                <SelectedControls project={project} selected={selected} time={time} onChange={change} onSelect={setSelected} onSplit={split} onRemove={remove} />
              </fieldset>
            </SidePanel>
          </div>

          {/* Timeline */}
          <div ref={timelineBox} className="flex shrink-0 flex-col border-t border-[var(--line)]">
            <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 text-xs">
              <button type="button" className={smallButton} onClick={split} disabled={locked} title="Split the clip at the playhead (S)">
                Split
              </button>
              <button type="button" className={smallButton} onClick={remove} disabled={locked || !selected} title="Remove the selected piece (Delete)">
                Delete
              </button>
              <span className="ml-2 hidden opacity-50 lg:inline">Drag pieces to move them and their edges to trim. Space plays, S splits, ←/→ step, Ctrl+Z undoes.</span>
              <span className="ml-auto flex items-center gap-2">
                <button type="button" aria-label="Zoom out (-)" className="rounded p-1 opacity-70 hover:opacity-100" onClick={() => setZoom((z) => Math.max(z / 1.25, 6))}>
                  −
                </button>
                <input type="range" aria-label="Zoom" min={6} max={400} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-28 accent-[var(--primary)]" />
                <button type="button" aria-label="Zoom in (+)" className="rounded p-1 opacity-70 hover:opacity-100" onClick={() => setZoom((z) => Math.min(z * 1.25, 400))}>
                  +
                </button>
                <button type="button" className={smallButton} onClick={fit}>
                  Fit
                </button>
              </span>
            </div>
            <div>
              <EditTimeline
                project={project}
                time={time}
                zoom={zoom}
                selected={selected}
                locked={locked}
                onSeek={(t) => (setPlaying(false), setTime(t))}
                onSelect={setSelected}
                onChange={change}
                onDropAsset={(id, row, t) => {
                  const a = project.assets.find((x) => x.id === id);
                  if (a) place(a, row === "music" ? "music" : row === "voice" ? "voice" : undefined, t, row);
                }}
              />
            </div>
          </div>
        </>
      )}

      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/60">
          <p className="rounded-2xl border-2 border-dashed border-white/70 px-10 py-8 text-lg font-semibold text-white">Drop to add to the project</p>
        </div>
      )}
      {exporting && (
        <ExportDialog
          project={project}
          onDone={(p) => setProject((now) => (now ? { ...now, exports: p.exports } : p))}
          onClose={() => setExporting(false)}
        />
      )}
      <input ref={fileInput} type="file" hidden multiple accept="video/*,audio/*,image/png,image/jpeg,image/webp" onChange={(e) => void addFiles(e.target.files ? [...e.target.files] : null).finally(() => (e.target.value = ""))} />
    </div>
  );
}
