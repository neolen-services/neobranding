import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import { formatUsd } from "@shared/analysis";
import { MIN_ANALYSED_POSTS, type GenerateOptions, type Idea, type IdeaDraft } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import { AnalyseAll } from "./AnalysisView";
import { api } from "./api";
import { SCRIPT_COST, ScriptBlock } from "./ScriptView";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton =
  "rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:border-[var(--primary)] disabled:opacity-50";

type Suggestion = IdeaDraft & { key: string };
type Sort = "newest" | "score";
type Tab = "idea" | "script";

export function IdeasView({
  brand,
  onOpenSettings,
  onOpenResearch,
  focusId,
}: {
  brand: BrandKit;
  onOpenSettings: () => void;
  onOpenResearch: () => void;
  /** An idea to open on arrival. */
  focusId?: string;
}) {
  const [posts, setPosts] = useState<ResearchItem[]>([]);
  const [round, setRound] = useState<{ considered: number; costUsd: number } | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [options, setOptions] = useState<GenerateOptions>({ count: 5, pillar: "", platform: "", notes: "", series: "" });
  const [formOpen, setFormOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [series, setSeries] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [pendingDelete, setPendingDelete] = useState<Idea | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.hasApiKey("anthropic").then(setHasKey);
    api.listIdeas().then(setIdeas);
    api.listResearch().then(setPosts).catch(() => setPosts([]));
  }, []);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setGenerating(true);
    try {
      const result = await api.generateIdeas(options);
      if (result.ok) {
        setSuggestions(result.ideas.map((idea) => ({ ...idea, key: crypto.randomUUID() })));
        setRound({ considered: result.considered, costUsd: result.costUsd });
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
    const saved = await api.saveIdea({ ...draft, id: key, createdAt: new Date().toISOString() });
    setIdeas((list) => [saved, ...list]);
    setSuggestions((list) => list.filter((s) => s.key !== key));
  }

  async function remove(idea: Idea) {
    await api.deleteIdea(idea.id);
    setIdeas((list) => list.filter((i) => i.id !== idea.id));
    setPendingDelete(null);
  }

  function openForm(forSeries = "") {
    setOptions((o) => ({ ...o, series: forSeries }));
    setFormOpen(true);
    // Wait for the form to be on the page before bringing it into view.
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const replaceIdea = (idea: Idea) => setIdeas((list) => list.map((i) => (i.id === idea.id ? idea : i)));
  const replacePost = (post: ResearchItem) => setPosts((list) => list.map((p) => (p.id === post.id ? post : p)));

  const analysed = posts.filter((p) => p.analysis);
  const ready = analysed.length >= MIN_ANALYSED_POSTS;
  const seriesNames = [...new Set(ideas.map((i) => i.series ?? "").filter(Boolean))].sort();

  const inSeries = series ? ideas.filter((i) => i.series === series) : ideas;
  const visible = sort === "newest" ? inSeries : [...inSeries].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (hasKey === false) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="max-w-2xl rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="font-display text-xl font-semibold">Connect Claude first</h2>
          <p className="mt-2 text-sm leading-relaxed opacity-75">
            The analysis, ideas and scripts are written by Anthropic's Claude, using your own API key. Add your key in
            Settings to start.
          </p>
          <button type="button" className={`${primaryButton} mt-4`} onClick={onOpenSettings}>
            Open settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 text-[var(--ink)]">
      {/* Where things stand, in one strip. */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Count label="Posts saved" value={posts.length} onClick={onOpenResearch} />
            <Count label="Analysed" value={`${analysed.length} of ${posts.length}`} />
            <Count label="Ideas saved" value={ideas.length} />
            <Count label="Scripts" value={ideas.filter((i) => i.script).length} />
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="text-sm underline opacity-60 hover:opacity-100" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>
              How this works
            </button>
            <button type="button" className={primaryButton} onClick={() => (formOpen ? setFormOpen(false) : openForm())}>
              {formOpen ? "Close" : "Write new ideas"}
            </button>
          </div>
        </div>

        {analysed.length < posts.length && (
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <AnalyseAll items={posts} onChange={replacePost} />
          </div>
        )}

        {helpOpen && (
          <ol className="mt-4 list-decimal space-y-1.5 border-t border-[var(--line)] pt-4 pl-5 text-sm leading-relaxed opacity-80">
            <li>Save posts you like to Research. Every saved post counts as one that worked; your rating adds weight.</li>
            <li>
              Claude analyses each post once (frames, transcript, caption) and saves the hook, structure and why it
              works. Later steps only read the saved result.
            </li>
            <li>
              “Write new ideas” writes five times as many ideas as you ask for, each modelled on one analysed post. A
              separate pass scores every one as a sceptical viewer and shows only the best.
            </li>
            <li>Save the ideas you want. Open one to see why it scored as it did and the post it borrows from.</li>
            <li>
              On an idea's Script tab, Claude writes three opening lines, a second-by-second script, the kind of sound
              and a caption ({SCRIPT_COST}, written once and saved).
            </li>
          </ol>
        )}
      </section>

      {formOpen && (
        <section ref={formRef} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="font-display text-lg font-semibold">Write new ideas</h2>
          {!ready ? (
            <p className="mt-2 text-sm opacity-75">
              Analyse at least {MIN_ANALYSED_POSTS} saved posts first. {analysed.length} analysed so far.
            </p>
          ) : (
            <form onSubmit={generate}>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Labeled label="How many to keep">
                  <select className={fieldClass} value={options.count} onChange={(e) => setOptions({ ...options, count: Number(e.target.value) })}>
                    {[3, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        Top {n} of {n * 5}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Content pillar">
                  <select className={fieldClass} value={options.pillar} onChange={(e) => setOptions({ ...options, pillar: e.target.value })}>
                    <option value="">Any pillar</option>
                    {brand.pillars.map((p) => (
                      <option key={p.title}>{p.title}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Platform">
                  <select className={fieldClass} value={options.platform} onChange={(e) => setOptions({ ...options, platform: e.target.value })}>
                    <option value="">Any platform</option>
                    {brand.platforms.map((p) => (
                      <option key={p.platform}>{p.platform}</option>
                    ))}
                  </select>
                </Labeled>
                <Labeled label="Series">
                  <select className={fieldClass} value={options.series ?? ""} onChange={(e) => setOptions({ ...options, series: e.target.value })}>
                    <option value="">Any, including new</option>
                    {seriesNames.map((s) => (
                      <option key={s} value={s}>
                        More of “{s}”
                      </option>
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
                <button type="submit" className={primaryButton} disabled={generating}>
                  {generating ? "Writing and judging…" : "Write and judge ideas (about $0.30)"}
                </button>
                {generating && <span className="text-sm opacity-60">This takes one to two minutes.</span>}
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-400">
              {error}
            </p>
          )}
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--tint)] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">New suggestions</h2>
              {round && (
                <p className="text-sm opacity-60">
                  The best {suggestions.length} of {round.considered} written. This round cost about {formatUsd(round.costUsd)}.
                </p>
              )}
            </div>
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
              <article key={s.key} className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
                <IdeaDetails idea={s} heading />
                <div className="mt-5 flex gap-3 border-t border-[var(--line)] pt-4">
                  <button type="button" className={primaryButton} onClick={() => keep(s)}>
                    Save idea
                  </button>
                  <button type="button" className={quietButton} onClick={() => setSuggestions((list) => list.filter((x) => x.key !== s.key))}>
                    Dismiss
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="font-display text-lg font-semibold">Saved ideas</h2>
            <p className="text-sm opacity-60">
              {plural(inSeries.length, "idea", "ideas")}
              {series && ` in “${series}”`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {series && ready && (
              <button type="button" className={quietButton} onClick={() => openForm(series)}>
                More episodes
              </button>
            )}
            {seriesNames.length > 0 && (
              <select className={`${fieldClass} !w-auto`} aria-label="Series" value={series} onChange={(e) => setSeries(e.target.value)}>
                <option value="">All series</option>
                {seriesNames.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            <select className={`${fieldClass} !w-auto`} aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest first</option>
              <option value="score">Highest score</option>
            </select>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="border-t border-[var(--line)] p-8 text-center text-sm opacity-70">
            Nothing saved yet. Press “Write new ideas” and save the ones you like.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed text-left text-sm">
              <thead className="border-y border-[var(--line)] text-xs opacity-60">
                <tr>
                  <th className="px-5 py-2 font-normal">Idea</th>
                  <th className="w-44 px-3 py-2 font-normal">Series</th>
                  <th className="w-20 px-3 py-2 font-normal">Score</th>
                  <th className="w-14 px-3 py-2" aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {visible.map((idea) => {
                  const open = openId === idea.id;
                  return (
                    <Fragment key={idea.id}>
                      <tr className={`border-b border-[var(--line)] ${open ? "bg-[var(--tint)]" : "hover:bg-[var(--tint)]"}`}>
                        <td className="px-5 py-3">
                          <button type="button" className="block w-full text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : idea.id)}>
                            <span className="block truncate font-medium">{idea.title}</span>
                            <span className="block truncate opacity-60">{idea.hook}</span>
                          </button>
                        </td>
                        <td className="truncate px-3 py-3 opacity-80">{idea.series || "–"}</td>
                        <td className="px-3 py-3 tabular-nums">{idea.score ?? "–"}</td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            aria-label={`Delete ${idea.title}`}
                            title="Delete"
                            className="rounded-md p-1.5 opacity-60 hover:bg-red-500/10 hover:text-red-400 hover:opacity-100"
                            onClick={() => setPendingDelete(idea)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-[var(--line)]">
                          <td colSpan={4} className="bg-[var(--bg)] px-5 py-5">
                            <OpenIdea idea={idea} onChange={replaceIdea} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pendingDelete && (
        <ConfirmDelete idea={pendingDelete} onCancel={() => setPendingDelete(null)} onConfirm={() => remove(pendingDelete)} />
      )}
    </div>
  );
}

/** One saved idea, opened: the idea itself and its script. */
function OpenIdea({ idea, onChange }: { idea: Idea; onChange: (idea: Idea) => void }) {
  const [tab, setTab] = useState<Tab>("idea");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");

  async function writeScript() {
    setError("");
    setWriting(true);
    try {
      const result = await api.writeScript(idea.id);
      if (result.ok) onChange(result.idea);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write the script.");
    } finally {
      setWriting(false);
    }
  }

  const tabs: [Tab, string][] = [
    ["idea", "Idea"],
    ["script", "Script"],
  ];

  return (
    <div className="max-w-3xl">
      <div role="tablist" className="mb-4 flex gap-1 border-b border-[var(--line)]">
        {tabs.map(([name, text]) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === name ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === "idea" && <IdeaDetails idea={idea} />}

      {tab === "script" && (
        <div>
          {idea.script ? (
            <>
              <ScriptBlock title={idea.title} script={idea.script} />
              <button type="button" className="mt-4 text-sm underline opacity-60 hover:opacity-100 disabled:opacity-30" disabled={writing} onClick={writeScript}>
                {writing ? "Writing…" : `Write it again (${SCRIPT_COST})`}
              </button>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={primaryButton} disabled={writing} onClick={writeScript}>
                {writing ? "Writing the script…" : `Write script (${SCRIPT_COST})`}
              </button>
              <span className="text-sm opacity-60">
                {writing ? "About 20 seconds." : "Three opening lines, a timed script, sound and caption."}
              </span>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The idea itself: opening line, where it came from, outline and caption. */
function IdeaDetails({ idea, heading = false }: { idea: IdeaDraft; heading?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copyCaption = async () => {
    await navigator.clipboard.writeText(`${idea.caption}\n\n${idea.hashtags.join(" ")}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4 text-sm">
      {heading && (
        <div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-widest opacity-70">
            {idea.pillar && <span>{idea.pillar}</span>}
            {idea.platform && <span>{idea.platform}</span>}
            {idea.score != null && (
              <span className="ml-auto rounded-full bg-[var(--primary)] px-2.5 py-0.5 font-sans text-xs font-semibold normal-case tracking-normal text-white">
                Score {idea.score}
              </span>
            )}
          </p>
          <h3 className="mt-3 font-display text-xl font-semibold">{idea.title}</h3>
        </div>
      )}
      <p className="border-l-4 border-[var(--accent)] pl-3 text-lg leading-snug">“{idea.hook}”</p>
      <p className="opacity-70">
        {[
          !heading && idea.pillar,
          !heading && idea.platform,
          idea.modelledOnLabel && `Modelled on the post by ${idea.modelledOnLabel}`,
          idea.series && `Series: ${idea.series}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {idea.scoreReason && (
        <Part title="Why this score">
          <p className="leading-relaxed">{idea.scoreReason}</p>
        </Part>
      )}
      {idea.altHooks && idea.altHooks.length > 0 && (
        <Part title="Other opening lines">
          <ul className="list-disc space-y-1 pl-5 leading-relaxed">
            {idea.altHooks.map((h, i) => (
              <li key={i}>“{h}”</li>
            ))}
          </ul>
        </Part>
      )}
      <Part title="Outline">
        <ol className="list-decimal space-y-1 pl-5 leading-relaxed">
          {idea.outline.map((beat, i) => (
            <li key={i}>{beat}</li>
          ))}
        </ol>
      </Part>
      <Part title="Call to action">
        <p className="leading-relaxed">{idea.cta}</p>
      </Part>
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
  );
}

function ConfirmDelete({ idea, onCancel, onConfirm }: { idea: Idea; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);

  // Escape closes the popup, like clicking outside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onCancel} role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-idea"
        className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-delete-idea" className="font-display text-xl font-semibold">
          Delete this idea?
        </h2>
        <p className="mt-2 text-sm leading-relaxed opacity-75">
          “{idea.title}” will be removed
          {idea.script ? ", along with its script" : ""}
          . This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className={quietButton} onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            className="rounded-full bg-red-600 px-5 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            onClick={async () => {
              setDeleting(true);
              await onConfirm();
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One number on the progress strip. */
function Count({ label, value, onClick }: { label: string; value: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular-nums">{value}</dd>
    </>
  );
  return onClick ? (
    <button type="button" className="text-left hover:text-[var(--accent)]" title="Open Research" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div>{body}</div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <Label>{title}</Label>
      <div className="mt-1">{children}</div>
    </div>
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
