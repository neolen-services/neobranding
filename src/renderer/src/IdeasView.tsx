import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import { formatUsd } from "@shared/analysis";
import {
  IDEA_STATUSES,
  MIN_ANALYSED_POSTS,
  STATUS_LABELS,
  type GenerateOptions,
  type Idea,
  type IdeaDraft,
  type IdeaStatus,
} from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import { AnalyseAll } from "./AnalysisView";
import { api } from "./api";
import { latestCheck, ResultsSection } from "./ResultsView";
import { SCRIPT_COST, ScriptBlock } from "./ScriptView";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton =
  "rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:border-[var(--primary)] disabled:opacity-50";

type Suggestion = IdeaDraft & { key: string };

export function IdeasView({
  brand,
  onOpenSettings,
  onOpenResearch,
}: {
  brand: BrandKit;
  onOpenSettings: () => void;
  onOpenResearch: () => void;
}) {
  const [posts, setPosts] = useState<ResearchItem[]>([]);
  const [round, setRound] = useState<{ considered: number; costUsd: number } | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [options, setOptions] = useState<GenerateOptions>({ count: 5, pillar: "", platform: "", notes: "" });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [filter, setFilter] = useState<IdeaStatus | "all">("all");
  const [bySeries, setBySeries] = useState(false);
  /** The idea a script is being written for, and the last failure. */
  const [scripting, setScripting] = useState("");
  const [scriptError, setScriptError] = useState<{ id: string; message: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

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

  async function writeScript(idea: Idea) {
    setScriptError(null);
    setScripting(idea.id);
    try {
      const result = await api.writeScript(idea.id);
      if (result.ok) setIdeas((list) => list.map((i) => (i.id === result.idea.id ? result.idea : i)));
      else setScriptError({ id: idea.id, message: result.error });
    } catch (err) {
      setScriptError({ id: idea.id, message: err instanceof Error ? err.message : "Could not write the script." });
    } finally {
      setScripting("");
    }
  }

  /** Sets up step 3 to write more episodes of one series and brings it into view. */
  function moreOfSeries(series: string) {
    setOptions((o) => ({ ...o, series }));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const replaceIdea = (idea: Idea) => setIdeas((list) => list.map((i) => (i.id === idea.id ? idea : i)));
  const measured = ideas.filter((i) => latestCheck(i)).length;
  /** Average likes of the measured videos in a list, as text, or "" if none are measured. */
  const averageLikes = (list: Idea[]) => {
    const likes = list.map((i) => latestCheck(i)?.likes).filter((n): n is number => typeof n === "number");
    if (likes.length === 0) return "";
    const average = likes.reduce((a, b) => a + b, 0) / likes.length;
    return ` · average ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(average)} likes over ${likes.length} posted`;
  };

  const seriesNames = [...new Set(ideas.map((i) => i.series ?? "").filter(Boolean))].sort();
  const scripted = ideas.filter((i) => i.script).length;

  const counts = Object.fromEntries(
    IDEA_STATUSES.map((s) => [s, ideas.filter((i) => i.status === s).length]),
  ) as Record<IdeaStatus, number>;
  const visible = filter === "all" ? ideas : ideas.filter((i) => i.status === filter);
  /** One group holding everything, or one group per series (null series = no heading). */
  const groups: { series: string | null; ideas: Idea[] }[] = bySeries
    ? [...seriesNames, ""]
        .map((series) => ({ series, ideas: visible.filter((i) => (i.series ?? "") === series) }))
        .filter((g) => g.ideas.length > 0)
    : [{ series: null, ideas: visible }];

  const analysed = posts.filter((p) => p.analysis);
  const ready = analysed.length >= MIN_ANALYSED_POSTS;
  const replacePost = (post: ResearchItem) => setPosts((list) => list.map((p) => (p.id === post.id ? post : p)));
  /** The most common values of one analysis field, e.g. the formats your saved posts use. */
  const common = (pick: (p: ResearchItem) => string) => {
    const counts = new Map<string, number>();
    for (const p of analysed) counts.set(pick(p), (counts.get(pick(p)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  };

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
            Ideas built from posts that already worked. Each idea borrows the structure of one post you saved and fills
            it with your own topic, then a separate pass judges which ones would stop the scroll.
          </p>

          {hasKey === false ? (
            <div className="mt-8 max-w-2xl rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold">Connect Claude first</h2>
              <p className="mt-2 text-sm leading-relaxed opacity-75">
                The analysis and the ideas are written by Anthropic's Claude, using your own API key. Add your key in
                Settings to start.
              </p>
              <button type="button" className={`${primaryButton} mt-4`} onClick={onOpenSettings}>
                Open settings
              </button>
            </div>
          ) : (
            <ol className="mt-8 space-y-4">
              <Step number={1} title="Collect posts that worked" done={posts.length > 0}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm opacity-75">
                    {posts.length === 0
                      ? "Save posts you like to Research, by pasting a link or sending it to your Telegram bot."
                      : `${posts.length} ${posts.length === 1 ? "post" : "posts"} saved in Research. Every saved post counts as one that worked; your rating adds weight.`}
                  </p>
                  <button type="button" className={quietButton} onClick={onOpenResearch}>
                    Open Research
                  </button>
                </div>
              </Step>

              <Step number={2} title="Analyse each post" done={posts.length > 0 && analysed.length === posts.length}>
                <p className="text-sm opacity-75">
                  Claude looks at frames from each video with its transcript and caption, and records the hook, the
                  structure and why it works. Each post is analysed once and saved; later steps only read the saved
                  result. {analysed.length} of {posts.length} analysed.
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--tint)]">
                  <div
                    className="h-full rounded-full bg-[var(--primary)]"
                    style={{ width: `${posts.length ? (analysed.length / posts.length) * 100 : 0}%` }}
                  />
                </div>
                <div className="mt-3">
                  <AnalyseAll items={posts} onChange={replacePost} />
                </div>
                {analysed.length > 0 && (
                  <div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4 text-sm sm:grid-cols-2">
                    <Tally title="Formats in your saved posts" rows={common((p) => p.analysis!.format)} total={analysed.length} />
                    <Tally title="How they hook the viewer" rows={common((p) => p.analysis!.hookType)} total={analysed.length} />
                  </div>
                )}
              </Step>

              <Step number={3} title="Write many ideas, keep the best" done={suggestions.length > 0}>
                {!ready ? (
                  <p className="text-sm opacity-75">
                    Analyse at least {MIN_ANALYSED_POSTS} posts to unlock this step. {analysed.length} analysed so far.
                  </p>
                ) : (
                  <form onSubmit={generate} ref={formRef}>
                    <p className="text-sm opacity-75">
                      Claude writes five times as many ideas as you ask for, each modelled on one analysed post. A
                      second, separate pass scores every one as a sceptical viewer and only the top ones are shown.
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <Labeled label="How many to keep">
                        <select
                          className={fieldClass}
                          value={options.count}
                          onChange={(e) => setOptions({ ...options, count: Number(e.target.value) })}
                        >
                          {[3, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              Top {n} of {n * 5}
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
                    {seriesNames.length > 0 && (
                      <div className="mt-4">
                        <Labeled label="Series">
                          <select
                            className={fieldClass}
                            value={options.series ?? ""}
                            onChange={(e) => setOptions({ ...options, series: e.target.value })}
                          >
                            <option value="">Any, including new series</option>
                            {seriesNames.map((s) => (
                              <option key={s} value={s}>
                                More episodes of “{s}”
                              </option>
                            ))}
                          </select>
                        </Labeled>
                      </div>
                    )}
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
              </Step>

              <Step number={4} title="Review and save" done={ideas.length > 0}>
                <p className="text-sm opacity-75">
                  {suggestions.length > 0
                    ? `${suggestions.length} ideas are waiting below${round ? `, the best of ${round.considered} written. This round cost about ${formatUsd(round.costUsd)}` : ""}.`
                    : "The top ideas appear below with their score, the reason for it, and the post each one is modelled on. Save the ones you want."}
                </p>
              </Step>

              <Step number={5} title="Script the ones you will film" done={scripted > 0}>
                <p className="text-sm opacity-75">
                  On a saved idea, press “Write script”. Claude writes three opening lines, a second-by-second script
                  (what to say, what to show, the text on screen), the kind of sound to use and a caption, paced like
                  the post the idea is modelled on. Each script is written once ({SCRIPT_COST}) and saved with the
                  idea. {ideas.length > 0 && `${scripted} of ${ideas.length} saved ideas have a script.`}
                </p>
                <p className="mt-2 text-sm opacity-75">
                  Ideas that share a structure belong to one series. View saved ideas by series to see which formats
                  you can repeat, and ask for more episodes of any of them.
                </p>
              </Step>

              <Step number={6} title="Post it and measure" done={measured > 0}>
                <p className="text-sm opacity-75">
                  After you post a video, paste its link under “Results” on the idea. The app reads its likes, comments
                  and views, then reads them again by itself: once a day for two weeks, then once a week, whenever the
                  app is open. Reading numbers is free.{" "}
                  {measured > 0
                    ? `${measured} of your videos ${measured === 1 ? "is" : "are"} being measured.`
                    : "None of your videos are being measured yet."}
                </p>
                <p className="mt-2 text-sm opacity-75">
                  The next time you write ideas in step 3, Claude sees how each posted video did and leans towards the
                  series, structures and openings that worked for you.
                </p>
              </Step>
            </ol>
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
              {seriesNames.length > 0 && (
                <>
                  <span className="mx-1 w-px self-stretch bg-[var(--line)]" />
                  <FilterChip selected={bySeries} onClick={() => setBySeries(!bySeries)}>
                    By series
                  </FilterChip>
                </>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-8 text-center opacity-70">
              {ideas.length === 0
                ? "Nothing saved yet. Suggest some ideas above and save the ones you like."
                : "No ideas with this status."}
            </p>
          ) : (
            <div className="space-y-10">
              {groups.map((group) => (
                <div key={group.series ?? "all"}>
                  {group.series !== null && (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display text-xl font-semibold">{group.series || "Not in a series"}</h3>
                        <p className="text-sm opacity-60">
                          {group.ideas.length} {group.ideas.length === 1 ? "idea" : "ideas"} ·{" "}
                          {group.ideas.filter((i) => i.script).length} scripted ·{" "}
                          {group.ideas.filter((i) => i.status === "posted").length} posted
                          {averageLikes(group.ideas)}
                        </p>
                      </div>
                      {group.series && ready && (
                        <button type="button" className={quietButton} onClick={() => moreOfSeries(group.series!)}>
                          More episodes
                        </button>
                      )}
                    </div>
                  )}
                  <div className="grid gap-4 lg:grid-cols-2">
                    {group.ideas.map((idea) => (
                      <IdeaCard
                        key={idea.id}
                        idea={idea}
                        script={
                          <>
                            <ScriptSection
                              idea={idea}
                              busy={scripting === idea.id}
                              disabled={scripting !== ""}
                              error={scriptError?.id === idea.id ? scriptError.message : ""}
                              onWrite={() => writeScript(idea)}
                            />
                            <ResultsSection idea={idea} onChange={replaceIdea} />
                          </>
                        }
                      >
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
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** The script of a saved idea, or the button that writes it. */
function ScriptSection({
  idea,
  busy,
  disabled,
  error,
  onWrite,
}: {
  idea: Idea;
  busy: boolean;
  disabled: boolean;
  error: string;
  onWrite: () => void;
}) {
  const [shown, setShown] = useState(false);
  // Open the script as soon as it has been written.
  const hadScript = useRef(Boolean(idea.script));
  useEffect(() => {
    if (idea.script && !hadScript.current) setShown(true);
    hadScript.current = Boolean(idea.script);
  }, [idea.script]);

  return (
    <div className="mt-4 border-t border-[var(--line)] pt-4">
      <div className="flex flex-wrap items-center gap-3">
        {idea.script ? (
          <>
            <button type="button" className={quietButton} aria-expanded={shown} onClick={() => setShown(!shown)}>
              {shown ? "Hide script" : "Show script"}
            </button>
            <button
              type="button"
              className="text-sm underline opacity-60 hover:opacity-100 disabled:opacity-30"
              disabled={disabled}
              onClick={onWrite}
            >
              {busy ? "Writing…" : `Write it again (${SCRIPT_COST})`}
            </button>
          </>
        ) : (
          <button type="button" className={primaryButton} disabled={disabled} onClick={onWrite}>
            {busy ? "Writing the script…" : `Write script (${SCRIPT_COST})`}
          </button>
        )}
        {busy && <span className="text-sm opacity-60">About 20 seconds.</span>}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-400">
          {error}
        </p>
      )}
      {idea.script && shown && (
        <div className="mt-4">
          <ScriptBlock title={idea.title} script={idea.script} />
        </div>
      )}
    </div>
  );
}

/** One idea. Saved ideas start collapsed to the title and hook. */
function IdeaCard({
  idea,
  open = false,
  script,
  children,
}: {
  idea: IdeaDraft;
  open?: boolean;
  /** The script area, for saved ideas. */
  script?: ReactNode;
  children: ReactNode;
}) {
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
        {idea.score != null && (
          <span className="ml-auto rounded-full bg-[var(--primary)] px-2.5 py-0.5 font-sans text-xs font-semibold normal-case tracking-normal text-white opacity-100">
            Score {idea.score}
          </span>
        )}
      </p>
      <h3 className="mt-3 font-display text-xl font-semibold">{idea.title}</h3>
      <p className="mt-2 border-l-4 border-[var(--accent)] pl-3 text-lg leading-snug">“{idea.hook}”</p>
      {(idea.modelledOnLabel || idea.series) && (
        <p className="mt-3 text-sm opacity-70">
          {idea.modelledOnLabel && <>Modelled on the post by {idea.modelledOnLabel}</>}
          {idea.modelledOnLabel && idea.series && " · "}
          {idea.series && <>Series: {idea.series}</>}
        </p>
      )}

      {expanded ? (
        <div className="mt-4 space-y-4 text-sm">
          {idea.scoreReason && (
            <div>
              <Label>Why this score</Label>
              <p className="mt-1 leading-relaxed">{idea.scoreReason}</p>
            </div>
          )}
          {idea.altHooks && idea.altHooks.length > 0 && (
            <div>
              <Label>Other opening lines</Label>
              <ul className="mt-1 list-disc space-y-1 pl-5 leading-relaxed">
                {idea.altHooks.map((h, i) => (
                  <li key={i}>“{h}”</li>
                ))}
              </ul>
            </div>
          )}
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

      {script}

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

/** One numbered step of the process. */
function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            done ? "bg-[var(--primary)] text-white" : "border border-[var(--line)]"
          }`}
        >
          {done ? "✓" : number}
        </span>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </li>
  );
}

/** A short count of how often each value appears. */
function Tally({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-widest opacity-60">{title}</p>
      <ul className="space-y-1">
        {rows.map(([name, count]) => (
          <li key={name} className="flex justify-between gap-3">
            <span>{name}</span>
            <span className="tabular-nums opacity-60">
              {count} of {total}
            </span>
          </li>
        ))}
      </ul>
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
