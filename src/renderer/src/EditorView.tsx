// The Editor section: every editing project, and starting a new one from files or from a Studio video.
import { createContext, useEffect, useState } from "react";
import { showTime, type EditSummary } from "@shared/edit";
import { api } from "./api";
import { EditorPage } from "./EditorPage";
import { card, Icon, ICONS, primaryButton } from "./studioUi";

/** Opens a project in the editor from anywhere in the app. Provided by the app shell. */
export const OpenEditorContext = createContext<(projectId: string) => void>(() => undefined);

export function EditorView({ focusId, onOpenSettings }: { /** A project to open on arrival. */ focusId?: string; onOpenSettings: () => void }) {
  const [projects, setProjects] = useState<EditSummary[] | null>(null);
  const [open, setOpen] = useState(focusId ?? "");
  const [error, setError] = useState("");
  const load = () => api.listEdits().then(setProjects).catch((e) => setError(String(e?.message ?? e)));
  useEffect(() => {
    if (!open) void load();
  }, [open]);

  if (open) return <EditorPage key={open} projectId={open} onBack={() => setOpen("")} onOpenSettings={onOpenSettings} />;

  async function start() {
    const made = await api.createEdit("Untitled edit");
    if (made.ok) setOpen(made.project.id);
    else setError(made.error);
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">Video editor</h2>
          <p className="text-sm opacity-60">Bring in your own footage or a Studio video, and have the AI editor cut it, caption it and add music. You can change anything by hand.</p>
        </div>
        <button type="button" className={`${primaryButton} flex items-center gap-2`} onClick={() => void start()}>
          <Icon d={ICONS.plus} />
          New project
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {projects?.length === 0 && (
        <section className={`${card} text-center`}>
          <p className="font-display text-lg font-semibold">No projects yet</p>
          <p className="mt-1 text-sm opacity-65">Start one from your own files, or from a Studio video once it has storyboards or clips.</p>
        </section>
      )}
      <ul className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))" }}>
        {projects?.map((p) => (
          <li key={p.id} className="group relative">
            <button type="button" onClick={() => setOpen(p.id)} className={`${card} flex w-full flex-col gap-2 !p-2.5 text-left hover:border-[var(--ink)]`}>
              <span className="flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl bg-black text-white/50">
                {p.cover ? /\.(png|jpe?g|webp)$/i.test(p.cover) ? <img src={api.studioFileUrl(p.cover)} alt="" className="h-full w-full object-cover" /> : <video src={api.studioFileUrl(p.cover)} preload="metadata" muted className="h-full w-full object-cover" /> : <Icon d={ICONS.film} className="h-6 w-6" />}
              </span>
              <span className="truncate px-1 text-sm font-medium">{p.title}</span>
              <span className="px-1 text-xs opacity-60">
                {p.clips ? `${showTime(p.seconds)} · ${p.clips} clip${p.clips === 1 ? "" : "s"}` : "Empty"}
                {p.exported ? " · exported" : ""}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Delete ${p.title}`}
              title="Delete this project and its files"
              className="absolute right-4 top-4 hidden h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:text-red-400 group-focus-within:flex group-hover:flex"
              onClick={async () => {
                if (!window.confirm(`Delete "${p.title}" and every file in it? This cannot be undone.`)) return;
                await api.deleteEdit(p.id);
                void load();
              }}
            >
              <Icon d={ICONS.close} className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}
