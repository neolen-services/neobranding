// The Ideas page: write a round of ideas, review what came back, keep the good ones, and send them on to Studio.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { formatUsd } from "@shared/analysis";
import type { BrandKit } from "@shared/brand";
import { MIN_ANALYSED_POSTS, type GenerateOptions, type Idea, type IdeaDraft, type IdeaSuggestion } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import { PRODUCTIONS, productionLabel, type Video } from "@shared/studio";
import { AnalyseAll } from "./AnalysisView";
import { api } from "./api";
import { MakeVideoButton } from "./StudioView";
import { card, Chip, Dialog, fieldClass, Icon, ICONS, label, PostPicker, primaryButton, ProductionPicker, quietButton, smallButton } from "./studioUi";

type Tab = "saved" | "review";
type Sort = "newest" | "score";
const BLANK: GenerateOptions = { count: 5, pillar: "", platform: "", notes: "", series: "", production: "mix", postIds: [] };
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3";
const CHEVRON = "M6 9l6 6 6-6";

export function IdeasView({
  brand,
  onOpenSettings,
  onOpenResearch,
  focusId,
  onOpenItem,
}: {
  brand: BrandKit;
  onOpenSettings: () => void;
  onOpenResearch: () => void;
  /** An idea to open on arrival. */
  focusId?: string;
  /** Told which idea is open (null for none), so the agent can offer it. */
  onOpenItem?: (id: string | null) => void;
}) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [suggestions, setSuggestions] = useState<IdeaSuggestion[]>([]);
  const [posts, setPosts] = useState<ResearchItem[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("saved");
  const [writing, setWriting] = useState(false);
  const [options, setOptions] = useState<GenerateOptions>(BLANK);
  /** When the round now running was started, or 0. */
  const [generating, setGenerating] = useState(0);
  const [round, setRound] = useState<{ considered: number; costUsd: number } | null>(null);
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [pillar, setPillar] = useState("");
  const [series, setSeries] = useState("");
  const [made, setMade] = useState("");
  const [freshOnly, setFreshOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [pendingDelete, setPendingDelete] = useState<Idea | null>(null);

  useEffect(() => {
    onOpenItem?.(openId);
    return () => onOpenItem?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  useEffect(() => {
    api.hasApiKey("anthropic").then(setHasKey);
    api.listIdeas().then(setIdeas);
    api.listResearch().then(setPosts).catch(() => setPosts([]));
    api.listVideos().then(setVideos).catch(() => setVideos([]));
    // Ideas waiting from an earlier round come first, unless a particular idea was asked for.
    api.listSuggestions().then((waiting) => {
      setSuggestions(waiting);
      if (waiting.length > 0 && !focusId) setTab("review");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setError("");
    setGenerating(Date.now());
    try {
      const result = await api.generateIdeas(options);
      if (result.ok) {
        setSuggestions(await api.listSuggestions());
        setRound({ considered: result.considered, costUsd: result.costUsd });
        setWriting(false);
        setTab("review");
        if (result.ideas.length === 0) setError("No ideas came back. Try again.");
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write ideas.");
    } finally {
      setGenerating(0);
    }
  }

  /** Saves suggestions as ideas and takes them off the waiting list. */
  async function keep(list: IdeaSuggestion[]) {
    const saved: Idea[] = [];
    for (const { key, suggestedAt: _suggestedAt, ...draft } of list) saved.push(await api.saveIdea({ ...draft, id: key, createdAt: new Date().toISOString() }));
    const left = await api.dismissSuggestions(list.map((s) => s.key));
    setIdeas((all) => [...saved.reverse(), ...(all ?? [])]);
    setSuggestions(left);
    if (left.length === 0) setTab("saved");
  }
  const dismiss = async (list: IdeaSuggestion[]) => setSuggestions(await api.dismissSuggestions(list.map((s) => s.key)));

  async function remove(idea: Idea) {
    await api.deleteIdea(idea.id);
    setIdeas((list) => (list ?? []).filter((i) => i.id !== idea.id));
    setPendingDelete(null);
  }

  function openWriter(forSeries = "") {
    setOptions((o) => ({ ...o, series: forSeries }));
    setError("");
    setWriting(true);
  }

  if (!ideas) return null;

  const replacePost = (post: ResearchItem) => setPosts((list) => list.map((p) => (p.id === post.id ? post : p)));
  const analysed = posts.filter((p) => p.analysis);
  const used = new Set(videos.flatMap((v) => v.ideaIds));
  const values = (pick: (idea: Idea) => string | undefined) => [...new Set(ideas.map((i) => pick(i) ?? "").filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const filtered = ideas.filter(
    (i) =>
      (!q || [i.title, i.hook, i.pillar, i.series ?? "", i.viewer ?? ""].some((t) => t.toLowerCase().includes(q))) &&
      (!pillar || i.pillar === pillar) &&
      (!series || i.series === series) &&
      (!made || i.production === made) &&
      (!freshOnly || !used.has(i.id)),
  );
  const visible = sort === "newest" ? filtered : [...filtered].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const filtering = Boolean(q || pillar || series || made || freshOnly);
  const select = "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-sm focus:border-[var(--primary)] focus:outline-none";

  if (hasKey === false) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className={`${card} max-w-2xl`}>
          <h2 className="font-display text-xl font-semibold">Connect Claude first</h2>
          <p className="mt-2 text-sm leading-relaxed opacity-75">The analysis and ideas are written by Anthropic's Claude, using your own API key. Add your key in Settings to start.</p>
          <button type="button" className={`${primaryButton} mt-4`} onClick={onOpenSettings}>
            Open settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 text-[var(--ink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Ideas" className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface)] p-1">
          {(
            [
              ["saved", "Saved", ideas.length],
              ["review", "To review", suggestions.length],
            ] as const
          ).map(([name, text, count]) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${tab === name ? "bg-[var(--tint)]" : "opacity-60 hover:opacity-100"}`}
            >
              {text}
              <span className={`text-xs tabular-nums ${name === "review" && count > 0 ? "rounded-full bg-[var(--accent)] px-1.5 font-semibold text-black" : "opacity-60"}`}>{count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="text-sm underline opacity-60 hover:opacity-100" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>
            How this works
          </button>
          {generating > 0 && !writing ? (
            <button type="button" className={`${quietButton} flex items-center gap-2`} onClick={() => setWriting(true)}>
              <Spinner />
              Writing ideas… <Elapsed since={generating} />
            </button>
          ) : (
            <button type="button" className={`${primaryButton} flex items-center gap-2`} onClick={() => openWriter()}>
              <Icon d={ICONS.plus} />
              Write new ideas
            </button>
          )}
        </div>
      </div>

      {helpOpen && (
        <ol className={`${card} grid gap-5 text-sm leading-relaxed sm:grid-cols-2 lg:grid-cols-4`}>
          {[
            ["Save and analyse", "Save posts you like to Research. Claude analyses each one once: its hook, its structure and why it works."],
            ["Write and judge", "Claude writes five times as many ideas as you ask for, each modelled on one analysed post. A separate pass scores every one as a sceptical viewer."],
            ["Review", "Only the best come back, under To review. Save the ones worth making and dismiss the rest."],
            ["Make it", "“Make video” on a saved idea opens it in Studio, where it becomes a script you approve."],
          ].map(([title, text], i) => (
            <li key={title}>
              <p className="flex items-center gap-2 font-semibold">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--tint)] text-xs">{i + 1}</span>
                {title}
              </p>
              <p className="mt-1.5 opacity-70">{text}</p>
            </li>
          ))}
        </ol>
      )}

      {error && !writing && (
        <p role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          {error}
          <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => setError("")}>
            <Icon d={ICONS.close} />
          </button>
        </p>
      )}

      {posts.length === 0 ? (
        <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-sm">
            <span className="font-medium">Save some posts first.</span> <span className="opacity-70">Ideas are modelled on posts that already worked for someone else.</span>
          </p>
          <button type="button" className={quietButton} onClick={onOpenResearch}>
            Open Research
          </button>
        </div>
      ) : (
        analysed.length < posts.length && (
          <div className={`${card} flex flex-wrap items-center justify-between gap-x-6 gap-y-3`}>
            <p className="text-sm">
              <span className="font-medium">
                {posts.length - analysed.length} of {posts.length} saved posts {posts.length - analysed.length === 1 ? "is" : "are"} not analysed yet.
              </span>{" "}
              <span className="opacity-70">Ideas only learn from analysed posts.</span>
            </p>
            <AnalyseAll items={posts} onChange={replacePost} />
          </div>
        )
      )}

      {tab === "review" && (
        <ReviewTab suggestions={suggestions} round={round} onKeep={keep} onDismiss={dismiss} onWrite={() => openWriter()} />
      )}

      {tab === "saved" &&
        (ideas.length === 0 ? (
          <div className={`${card} flex flex-col items-center px-6 py-14 text-center`}>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tint)]">
              <Icon d={ICONS.ai} className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold">No ideas saved yet</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed opacity-65">
              {suggestions.length > 0
                ? `${suggestions.length} ${suggestions.length === 1 ? "idea is" : "ideas are"} waiting for you under To review.`
                : "Claude writes ideas modelled on the posts you saved, a separate pass judges them, and you keep the best."}
            </p>
            <button type="button" className={`${primaryButton} mt-5`} onClick={() => (suggestions.length > 0 ? setTab("review") : openWriter())}>
              {suggestions.length > 0 ? "Review them" : "Write new ideas"}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1">
                <Icon d={ICONS.search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                <input className={`${fieldClass} pl-9`} type="search" placeholder="Search your ideas" aria-label="Search your ideas" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {values((i) => i.pillar).length > 1 && (
                <select className={select} aria-label="Pillar" value={pillar} onChange={(e) => setPillar(e.target.value)}>
                  <option value="">Any pillar</option>
                  {values((i) => i.pillar).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              )}
              {values((i) => i.series).length > 0 && (
                <select className={select} aria-label="Series" value={series} onChange={(e) => setSeries(e.target.value)}>
                  <option value="">Any series</option>
                  {values((i) => i.series).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
              {values((i) => i.production).length > 0 && (
                <select className={select} aria-label="How it is made" value={made} onChange={(e) => setMade(e.target.value)}>
                  <option value="">Made any way</option>
                  {PRODUCTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                aria-pressed={freshOnly}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${freshOnly ? "border-[var(--primary)] bg-[var(--tint)]" : "border-[var(--line)] opacity-80 hover:border-[var(--ink)]"}`}
                onClick={() => setFreshOnly(!freshOnly)}
              >
                Not made yet
              </button>
              <select className={select} aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="newest">Newest first</option>
                <option value="score">Highest score</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm opacity-70">
              <p>
                {visible.length === ideas.length ? `${ideas.length} ${ideas.length === 1 ? "idea" : "ideas"}` : `${visible.length} of ${ideas.length} ideas`}
                {filtering && (
                  <button
                    type="button"
                    className="ml-3 underline"
                    onClick={() => {
                      setQuery("");
                      setPillar("");
                      setSeries("");
                      setMade("");
                      setFreshOnly(false);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </p>
              {series && (
                <button type="button" className="underline" onClick={() => openWriter(series)}>
                  Write more for “{series}”
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <p className={`${card} text-center text-sm opacity-70`}>No saved idea matches that.</p>
            ) : (
              <ul className="space-y-2">
                {visible.map((idea) => (
                  <IdeaRow
                    key={idea.id}
                    idea={idea}
                    open={openId === idea.id}
                    inStudio={used.has(idea.id)}
                    onToggle={() => setOpenId(openId === idea.id ? null : idea.id)}
                    onDelete={() => setPendingDelete(idea)}
                  />
                ))}
              </ul>
            )}
          </>
        ))}

      {writing && (
        <WriteDialog
          brand={brand}
          posts={posts}
          analysed={analysed.length}
          seriesNames={values((i) => i.series)}
          options={options}
          onOptions={setOptions}
          generating={generating}
          error={error}
          onClose={() => setWriting(false)}
          onWrite={() => void generate()}
          onOpenResearch={onOpenResearch}
        />
      )}

      {pendingDelete && <ConfirmDelete idea={pendingDelete} onCancel={() => setPendingDelete(null)} onConfirm={() => remove(pendingDelete)} />}
    </div>
  );
}

const Spinner = () => <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--primary)]" />;

/** Minutes and seconds since a moment, counting up. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>;
}

/** The judge's score out of 100. Filled when it is strong, outlined otherwise. */
function Score({ value }: { value?: number }) {
  return (
    <span
      title={value === undefined ? "Not scored" : "Score out of 100, from a separate judging pass"}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold tabular-nums ${
        value === undefined ? "border border-[var(--line)] opacity-50" : value >= 75 ? "bg-[var(--primary)] text-white" : "border border-[var(--primary)]"
      }`}
    >
      {value ?? "–"}
    </span>
  );
}

const Tags = ({ idea, inStudio }: { idea: IdeaDraft; inStudio?: boolean }) => (
  <span className="flex flex-wrap gap-1.5">
    {inStudio && <Chip tone="good">In Studio</Chip>}
    {idea.pillar && <Chip>{idea.pillar}</Chip>}
    {idea.production && <Chip>{productionLabel(idea.production)}</Chip>}
    {idea.series && <Chip>{idea.series}</Chip>}
    {idea.platform && <Chip>{idea.platform}</Chip>}
  </span>
);

// ---------- To review ----------

function ReviewTab({
  suggestions,
  round,
  onKeep,
  onDismiss,
  onWrite,
}: {
  suggestions: IdeaSuggestion[];
  /** The round just run in this visit, if any. */
  round: { considered: number; costUsd: number } | null;
  onKeep: (list: IdeaSuggestion[]) => Promise<void>;
  onDismiss: (list: IdeaSuggestion[]) => Promise<void>;
  onWrite: () => void;
}) {
  const [busy, setBusy] = useState("");
  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(what);
    try {
      await work();
    } finally {
      setBusy("");
    }
  };

  if (suggestions.length === 0) {
    return (
      <div className={`${card} flex flex-col items-center px-6 py-14 text-center`}>
        <h2 className="font-display text-xl font-semibold">Nothing to review</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed opacity-65">New ideas wait here until you save or dismiss them, even if you leave this page.</p>
        <button type="button" className={`${primaryButton} mt-5`} onClick={onWrite}>
          Write new ideas
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm opacity-70">
          {suggestions.length} {suggestions.length === 1 ? "idea" : "ideas"} waiting, best first. Save the ones worth making.
          {round && ` This round kept the best of ${round.considered} written and cost ${/^\D/.test(formatUsd(round.costUsd).replace("$", "")) ? "" : "about "}${formatUsd(round.costUsd)}.`}
        </p>
        <div className="flex gap-2">
          <button type="button" className={smallButton} disabled={busy !== ""} onClick={() => run("all", () => onKeep(suggestions))}>
            {busy === "all" ? "Saving…" : "Save all"}
          </button>
          <button type="button" className={smallButton} disabled={busy !== ""} onClick={() => run("none", () => onDismiss(suggestions))}>
            Dismiss all
          </button>
        </div>
      </div>
      <ul className="grid gap-4 lg:grid-cols-2">
        {[...suggestions]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .map((s) => (
            <li key={s.key} className={`${card} flex flex-col`}>
              <div className="flex items-start gap-3">
                <Score value={s.score} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-lg font-semibold leading-snug">{s.title}</h3>
                  <div className="mt-1.5">
                    <Tags idea={s} />
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <IdeaSummary idea={s} />
              </div>
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium opacity-70 hover:opacity-100">Outline, caption and why this score</summary>
                <div className="mt-4">
                  <IdeaMore idea={s} />
                </div>
              </details>
              <div className="mt-auto flex gap-2 pt-5">
                <button type="button" className={`${primaryButton} !px-4 !py-1.5`} disabled={busy !== ""} onClick={() => run(s.key, () => onKeep([s]))}>
                  {busy === s.key ? "Saving…" : "Save idea"}
                </button>
                <button type="button" className={smallButton} disabled={busy !== ""} onClick={() => run(s.key, () => onDismiss([s]))}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
      </ul>
    </>
  );
}

// ---------- Saved ----------

/** One saved idea: its score, what it is, where it stands, and the way on to Studio. Opens to show the rest. */
function IdeaRow({ idea, open, inStudio, onToggle, onDelete }: { idea: Idea; open: boolean; inStudio: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    <li className={`rounded-2xl border bg-[var(--surface)] shadow-sm ${open ? "border-[var(--primary)]" : "border-[var(--line)] hover:border-[var(--ink)]"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Score value={idea.score} />
        <button type="button" className="min-w-0 flex-1 basis-64 text-left" aria-expanded={open} onClick={onToggle}>
          <span className="block truncate font-medium">{idea.title}</span>
          <span className="block truncate text-sm opacity-60">“{idea.hook}”</span>
          <span className="mt-1.5 block">
            <Tags idea={idea} inStudio={inStudio} />
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <MakeVideoButton from={{ ideaId: idea.id }} label={inStudio ? "Make another" : "Make video"} />
          <button type="button" aria-label={`Delete ${idea.title}`} title="Delete" className="rounded-full p-2 opacity-55 hover:bg-red-500/10 hover:text-red-400 hover:opacity-100" onClick={onDelete}>
            <Icon d={TRASH} />
          </button>
          <button type="button" aria-label={open ? "Close" : "Show everything"} className="rounded-full p-2 opacity-55 hover:bg-[var(--tint)] hover:opacity-100" onClick={onToggle}>
            <Icon d={CHEVRON} className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {open && (
        <div className="grid gap-x-8 gap-y-5 border-t border-[var(--line)] p-5 lg:grid-cols-2">
          <IdeaSummary idea={idea} />
          <IdeaMore idea={idea} />
        </div>
      )}
    </li>
  );
}

/** What an idea is at a glance: its opening line, who it is for and what they leave with. */
function IdeaSummary({ idea }: { idea: IdeaDraft }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="border-l-4 border-[var(--accent)] pl-3 font-display text-lg font-medium leading-snug">“{idea.hook}”</p>
      {(idea.viewer || idea.takeaway) && (
        <dl className="space-y-3">
          {idea.viewer && (
            <Part title="Who it is for">
              <dd>{idea.viewer}</dd>
            </Part>
          )}
          {idea.takeaway && (
            <Part title="What they leave with">
              <dd>{idea.takeaway}</dd>
            </Part>
          )}
        </dl>
      )}
      {idea.modelledOnLabel && <p className="opacity-60">Modelled on the post by {idea.modelledOnLabel}</p>}
    </div>
  );
}

/** The rest of an idea: why it scored as it did, other openings, the outline, the closing ask and the caption. */
function IdeaMore({ idea }: { idea: IdeaDraft }) {
  const [copied, setCopied] = useState(false);
  const copyCaption = async () => {
    await navigator.clipboard.writeText(`${idea.caption}\n\n${idea.hashtags.join(" ")}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-4 text-sm">
      {idea.scoreReason && (
        <Part title="Why this score">
          <p className="leading-relaxed">{idea.scoreReason}</p>
        </Part>
      )}
      <Part title="Outline">
        <ol className="list-decimal space-y-1 pl-5 leading-relaxed">
          {idea.outline.map((beat, i) => (
            <li key={i}>{beat}</li>
          ))}
        </ol>
      </Part>
      {idea.cta && (
        <Part title="Closing ask">
          <p className="leading-relaxed">{idea.cta}</p>
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
      {idea.caption && (
        <div>
          <div className="flex items-center justify-between">
            <p className={label}>Caption</p>
            <button type="button" className={`${smallButton} flex items-center gap-1.5`} onClick={copyCaption}>
              <Icon d={copied ? ICONS.check : ICONS.copy} className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 whitespace-pre-line rounded-xl bg-[var(--tint)] p-3 leading-relaxed">
            {idea.caption}
            <span className="mt-2 block opacity-70">{idea.hashtags.join(" ")}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className={label}>{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ---------- Writing a round ----------

/** Asks for a round of ideas: how they are made, which posts to learn from, anything specific, and a few optional limits. Shows progress while Claude works. */
function WriteDialog({
  brand,
  posts,
  analysed,
  seriesNames,
  options,
  onOptions,
  generating,
  error,
  onClose,
  onWrite,
  onOpenResearch,
}: {
  brand: BrandKit;
  posts: ResearchItem[];
  /** How many saved posts have been analysed. */
  analysed: number;
  seriesNames: string[];
  options: GenerateOptions;
  onOptions: (options: GenerateOptions) => void;
  /** When the round now running was started, or 0. */
  generating: number;
  error: string;
  onClose: () => void;
  onWrite: () => void;
  onOpenResearch: () => void;
}) {
  const picked = options.postIds ?? [];
  const learning = picked.length || analysed;
  const set = (changes: Partial<GenerateOptions>) => onOptions({ ...options, ...changes });
  const limits = [options.pillar, options.platform, options.series].filter(Boolean).length + (options.count !== 5 ? 1 : 0);
  const step = (n: number, text: string, optional?: boolean) => (
    <p className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--tint)] text-xs">{n}</span>
      {text}
      {optional && <span className="font-normal opacity-50">optional</span>}
    </p>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!generating && analysed > 0) onWrite();
  };

  return (
    <form onSubmit={submit}>
      <Dialog
        title="Write new ideas"
        onClose={onClose}
        footer={
          generating ? (
            <button type="button" className={quietButton} onClick={onClose}>
              Close and keep working
            </button>
          ) : analysed === 0 ? (
            <button type="button" className={primaryButton} onClick={onOpenResearch}>
              Open Research
            </button>
          ) : (
            <>
              <p role={error ? "alert" : undefined} className={`mr-auto min-w-0 flex-1 text-sm ${error ? "font-medium text-red-400" : "opacity-60"}`}>
                {error || `Writes ${options.count * 5}, a separate judge scores them, you get the best ${options.count}. About $0.30, one to two minutes.`}
              </p>
              <button type="button" className={quietButton} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={primaryButton}>
                Write ideas
              </button>
            </>
          )
        }
      >
        {generating ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span aria-hidden className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--line)] border-t-[var(--primary)]" />
            <p className="mt-5 font-display text-lg font-semibold">
              Writing {options.count * 5} ideas from {learning} {learning === 1 ? "post" : "posts"}, then judging them
            </p>
            <p className="mt-1 text-sm opacity-60">
              <Elapsed since={generating} /> so far. It usually takes one to two minutes.
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed opacity-60">You can close this and keep working. The ideas will be waiting under To review, even if you leave this page.</p>
          </div>
        ) : analysed === 0 ? (
          <p className="text-sm leading-relaxed opacity-75">
            {posts.length === 0 ? "Save some posts to Research first, then analyse them." : "Analyse a saved post first."} Ideas are modelled on posts that have been analysed.
          </p>
        ) : (
          <>
            <div>
              {step(1, "How will they be made?")}
              <ProductionPicker value={options.production ?? "mix"} onChange={(production) => set({ production })} />
            </div>
            <div>
              {step(2, "Which saved posts should they learn from?")}
              <PostPicker
                posts={posts}
                picked={picked}
                onChange={(postIds) => set({ postIds })}
                max={30}
                selectAll={
                  analysed >= MIN_ANALYSED_POSTS
                    ? `Nothing ticked: all ${analysed} analysed posts are used.`
                    : `Tick the posts to learn from. (With ${MIN_ANALYSED_POSTS} or more analysed, leaving this empty uses them all.)`
                }
              />
            </div>
            <div>
              {step(3, "Anything specific?", true)}
              <textarea
                className={fieldClass}
                rows={2}
                placeholder="For example: about sleep, or reacting to a new study"
                aria-label="Anything specific"
                value={options.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </div>
            <details open={limits > 0 || undefined}>
              <summary className="cursor-pointer text-sm font-semibold">
                More options
                <span className="ml-2 font-normal opacity-50">{limits > 0 ? `${limits} set` : "how many, pillar, platform, series"}</span>
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field name="How many to keep">
                  <select className={fieldClass} value={options.count} onChange={(e) => set({ count: Number(e.target.value) })}>
                    {[3, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        Top {n} of {n * 5}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field name="Content pillar">
                  <select className={fieldClass} value={options.pillar} onChange={(e) => set({ pillar: e.target.value })}>
                    <option value="">Any pillar</option>
                    {brand.pillars.map((p) => (
                      <option key={p.title}>{p.title}</option>
                    ))}
                  </select>
                </Field>
                <Field name="Platform">
                  <select className={fieldClass} value={options.platform} onChange={(e) => set({ platform: e.target.value })}>
                    <option value="">Any platform</option>
                    {brand.platforms.map((p) => (
                      <option key={p.platform}>{p.platform}</option>
                    ))}
                  </select>
                </Field>
                <Field name="Series">
                  <select className={fieldClass} value={options.series ?? ""} onChange={(e) => set({ series: e.target.value })}>
                    <option value="">Any, including new</option>
                    {seriesNames.map((s) => (
                      <option key={s} value={s}>
                        More of “{s}”
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </details>
          </>
        )}
      </Dialog>
    </form>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block opacity-70">{name}</span>
      {children}
    </label>
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
        <p className="mt-2 text-sm leading-relaxed opacity-75">“{idea.title}” will be removed. This cannot be undone.</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className={quietButton} onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
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
