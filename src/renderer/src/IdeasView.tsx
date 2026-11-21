import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import {
  IDEA_STATUSES,
  STATUS_LABELS,
  type GenerateOptions,
  type Idea,
  type IdeaDraft,
  type IdeaStatus,
} from "@shared/ideas";
import { api } from "./api";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton =
  "rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:border-[var(--primary)] disabled:opacity-50";

type Suggestion = IdeaDraft & { key: string };

export function IdeasView({ brand, onOpenSettings }: { brand: BrandKit; onOpenSettings: () => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [options, setOptions] = useState<GenerateOptions>({ count: 5, pillar: "", platform: "", notes: "" });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [filter, setFilter] = useState<IdeaStatus | "all">("all");

  useEffect(() => {
    api.hasApiKey().then(setHasKey);
    api.listIdeas().then(setIdeas);
  }, []);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setGenerating(true);
    try {
      const result = await api.generateIdeas(options);
      if (result.ok) {
        setSuggestions(result.ideas.map((idea) => ({ ...idea, key: crypto.randomUUID() })));
        if (result.ideas.length === 0) setError("No ideas came back. Try again.");
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate ideas.");
    } finally {
      setGenerating(false);
    }
  }

  async function keep(suggestion: Suggestion) {
    const { key, ...draft } = suggestion;
    const saved = await api.saveIdea({
      ...draft,
      id: key,
      status: "idea",
      createdAt: new Date().toISOString(),
    });
    setIdeas((list) => [saved, ...list]);
    setSuggestions((list) => list.filter((s) => s.key !== key));
  }

  async function setStatus(idea: Idea, status: IdeaStatus) {
    const saved = await api.saveIdea({ ...idea, status });
    setIdeas((list) => list.map((i) => (i.id === saved.id ? saved : i)));
  }

  async function remove(idea: Idea) {
    await api.deleteIdea(idea.id);
    setIdeas((list) => list.filter((i) => i.id !== idea.id));
  }

  const counts = Object.fromEntries(
    IDEA_STATUSES.map((s) => [s, ideas.filter((i) => i.status === s).length]),
  ) as Record<IdeaStatus, number>;
  const visible = filter === "all" ? ideas : ideas.filter((i) => i.status === filter);

  return (
    <div className="bg-[var(--surface)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest opacity-70">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
            Short videos
          </p>
          <h1 className="mt-4 font-display text-5xl font-bold tracking-tight">Video ideas</h1>
          <p className="mt-3 max-w-2xl text-lg opacity-75">
            Ideas for 30 to 60 second videos, written for your brand: your pillars, audience, voice and goals.
          </p>

          {hasKey === false ? (
            <div className="mt-8 max-w-2xl rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold">Connect Claude first</h2>
              <p className="mt-2 text-sm leading-relaxed opacity-75">
                Ideas are written by Anthropic's Claude, using your own API key. Add your key in Settings to start.
              </p>
              <button type="button" className={`${primaryButton} mt-4`} onClick={onOpenSettings}>
                Open settings
              </button>
            </div>
          ) : (
            <form onSubmit={generate} className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="grid gap-4 sm:grid-cols-3">
                <Labeled label="How many">
                  <select
                    className={fieldClass}
                    value={options.count}
                    onChange={(e) => setOptions({ ...options, count: Number(e.target.value) })}
                  >
                    {[3, 5, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} ideas
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Content pillar">
                  <select
                    className={fieldClass}
                    value={options.pillar}
                    onChange={(e) => setOptions({ ...options, pillar: e.target.value })}
                  >
                    <option value="">Any pillar</option>
                    {brand.pillars.map((p) => (
                      <option key={p.title}>{p.title}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Platform">
                  <select
                    className={fieldClass}
                    value={options.platform}
                    onChange={(e) => setOptions({ ...options, platform: e.target.value })}
                  >
                    <option value="">Any platform</option>
                    {brand.platforms.map((p) => (
                      <option key={p.platform}>{p.platform}</option>
                    ))}
                  </select>
                </Labeled>
              </div>
              <div className="mt-4">
                <Labeled label="Anything specific? (optional)">
                  <input
                    className={fieldClass}
                    placeholder="For example: about sleep, or reacting to a new study"
                    value={options.notes}
                    onChange={(e) => setOptions({ ...options, notes: e.target.value })}
                  />
                </Labeled>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <button type="submit" className={primaryButton} disabled={generating || hasKey === null}>
                  {generating ? "Thinking of ideas…" : "Suggest ideas"}
                </button>
                {generating && <span className="text-sm opacity-60">This usually takes under a minute.</span>}
              </div>
              {error && (
                <p role="alert" className="mt-4 text-sm font-medium text-red-400">
                  {error}
                </p>
              )}
            </form>
          )}
        </div>
      </header>

      {suggestions.length > 0 && (
        <section className="border-b border-[var(--line)] bg-[var(--tint)]">
          <div className="mx-auto max-w-5xl px-6 py-12">
            <div className="mb-6 flex items-center justify-between gap-4">
              <SectionLabel>New suggestions</SectionLabel>
              <div className="flex gap-2">
                <button type="button" className={quietButton} onClick={() => suggestions.forEach(keep)}>
                  Save all
                </button>
                <button type="button" className={quietButton} onClick={() => setSuggestions([])}>
                  Dismiss all
                </button>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {suggestions.map((s) => (
                <IdeaCard key={s.key} idea={s} open>
                  <button type="button" className={primaryButton} onClick={() => keep(s)}>
                    Save idea
                  </button>
                  <button
                    type="button"
                    className={quietButton}
                    onClick={() => setSuggestions((list) => list.filter((x) => x.key !== s.key))}
                  >
                    Dismiss
                  </button>
                </IdeaCard>
              ))}
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <SectionLabel>Saved ideas</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <FilterChip selected={filter === "all"} onClick={() => setFilter("all")}>
                All · {ideas.length}
              </FilterChip>
              {IDEA_STATUSES.map((s) => (
                <FilterChip key={s} selected={filter === s} onClick={() => setFilter(s)}>
                  {STATUS_LABELS[s]} · {counts[s]}
                </FilterChip>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-8 text-center opacity-70">
              {ideas.length === 0
                ? "Nothing saved yet. Suggest some ideas above and save the ones you like."
                : "No ideas with this status."}
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {visible.map((idea) => (
                <IdeaCard key={idea.id} idea={idea}>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="opacity-60">Status</span>
                    <select
                      className={`${fieldClass} !w-auto`}
                      value={idea.status}
                      onChange={(e) => setStatus(idea, e.target.value as IdeaStatus)}
                    >
                      {IDEA_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="ml-auto text-sm opacity-60 hover:text-red-400 hover:opacity-100"
                    onClick={() => remove(idea)}
                  >
                    Delete
                  </button>
                </IdeaCard>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** One idea. Saved ideas start collapsed to the title and hook. */
function IdeaCard({ idea, open = false, children }: { idea: IdeaDraft; open?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  const [copied, setCopied] = useState(false);

  const copyCaption = async () => {
    await navigator.clipboard.writeText(`${idea.caption}\n\n${idea.hashtags.join(" ")}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-widest opacity-70">
        {idea.pillar && (
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--secondary)]" />
            {idea.pillar}
          </span>
        )}
        {idea.platform && <span>{idea.platform}</span>}
      </p>
      <h3 className="mt-3 font-display text-xl font-semibold">{idea.title}</h3>
      <p className="mt-2 border-l-4 border-[var(--accent)] pl-3 text-lg leading-snug">“{idea.hook}”</p>

      {expanded ? (
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <Label>Outline</Label>
            <ol className="mt-1 list-decimal space-y-1 pl-5 leading-relaxed">
              {idea.outline.map((beat, i) => (
                <li key={i}>{beat}</li>
              ))}
            </ol>
          </div>
          <div>
            <Label>Call to action</Label>
            <p className="mt-1 leading-relaxed">{idea.cta}</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label>Caption</Label>
              <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={copyCaption}>
                {copied ? "Copied" : "Copy caption"}
              </button>
            </div>
            <p className="mt-1 whitespace-pre-line rounded-xl bg-[var(--tint)] p-3 leading-relaxed">
              {idea.caption}
              <span className="mt-2 block text-[var(--secondary-text)]">{idea.hashtags.join(" ")}</span>
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        {children}
        {!open && (
          <button
            type="button"
            className="text-sm underline opacity-60 hover:opacity-100"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
        )}
      </div>
    </article>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-widest opacity-60">{children}</p>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 font-mono text-xs uppercase tracking-widest">
      <span className="h-px w-8 bg-[var(--primary)]" />
      <span className="opacity-70">{children}</span>
    </h2>
  );
}

function FilterChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm font-medium ${
        selected
          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--frame)]"
          : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink)]"
      }`}
    >
      {children}
    </button>
  );
}
