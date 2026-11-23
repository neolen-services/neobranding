import { createContext, Fragment, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  detectPlatform,
  PLATFORM_LABELS,
  SUPPORTED_LINKS_HINT,
  type ResearchAudio,
  type ResearchItem,
  type ResearchPlatform,
} from "@shared/research";
import { AnalyseAll, PostAnalysisBlock } from "./AnalysisView";
import { Icon, ICONS } from "./studioUi";
import { api } from "./api";
import { MakeVideoButton } from "./StudioView";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton =
  "rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium hover:border-[var(--ink)] disabled:opacity-50";

/** How many posts the plain list shows at first, and how many more each time. */
const FIRST_SCREEN = 20;
const LINK_ICON = "M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1";
/** The ids of posts being analysed in the background, or waiting their turn. */
const AnalysingContext = createContext<string[]>([]);
/** The heading for posts that are the only one of their concept so far. */
const ONE_OF_A_KIND = "\u0000alone";
/** The "Concept" filter's value for posts that are in no group. */
const NO_GROUP = "\u0000none";
/** Posts analysed before grouping existed are sorted into groups once, the first time Research is opened. */
let autoGrouped = false;

export function ResearchView({
  onOpenSettings,
  focusId,
  onOpenItem,
}: {
  onOpenSettings: () => void;
  /** A post to open on arrival. */
  focusId?: string;
  /** Told which post is open (null for none), so the agent can offer it. */
  onOpenItem?: (id: string | null) => void;
}) {
  const [items, setItems] = useState<ResearchItem[] | null>(null);
  const [hasDeepgram, setHasDeepgram] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>("saved");
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  useEffect(() => {
    onOpenItem?.(openId);
    return () => onOpenItem?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  const focused = useRef(false);
  const [platform, setPlatform] = useState<ResearchPlatform | "all">("all");
  const [limit, setLimit] = useState(FIRST_SCREEN);
  const [query, setQuery] = useState("");
  const [rated, setRated] = useState<"" | "top" | "none">("");
  /** The groups closed in the grouped view, by their heading. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<ResearchItem | null>(null);
  const [byGroup, setByGroup] = useState(false);
  const viewChosen = useRef(false);
  const [concept, setConcept] = useState("");
  /** Only posts made in this visual style, or "" for all. */
  const [style, setStyle] = useState("");
  /** What the grouping is doing right now, or "". */
  const [grouping, setGrouping] = useState("");
  const [groupNote, setGroupNote] = useState("");
  /** Whether new posts are analysed on their own, and which are being analysed now. */
  const [auto, setAuto] = useState<{ on: boolean; analysing: string[] }>({ on: true, analysing: [] });
  const analysingBefore = useRef(0);

  // Watches the background analysis: when a post finishes, the list is read again so its analysis and group show.
  useEffect(() => {
    const check = () =>
      api
        .researchAuto()
        .then((now) => {
          if (now.analysing.length < analysingBefore.current) void api.listResearch().then(setItems);
          analysingBefore.current = now.analysing.length;
          setAuto(now);
        })
        .catch(() => undefined);
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);

  /** Has Claude sort posts into groups of similar videos: those without a group, or every one afresh. */
  async function runGrouping(all: boolean, count: number) {
    setGroupNote("");
    setGrouping(`Sorting ${count} ${count === 1 ? "post" : "posts"} into groups of similar videos…`);
    try {
      const result = await api.groupResearch(all);
      if (result.ok) {
        setItems(result.items);
        setGroupNote(result.grouped === 0 ? "" : `${result.grouped} ${result.grouped === 1 ? "post" : "posts"} sorted into groups of similar videos.`);
        viewChosen.current = true;
        setByGroup(true);
      } else setGroupNote(`The posts could not be grouped: ${result.error}`);
    } catch (e) {
      setGroupNote(e instanceof Error ? e.message : "The posts could not be grouped.");
    } finally {
      setGrouping("");
    }
  }

  // Analysed posts that have no group yet are grouped without being asked, once per run of the app.
  useEffect(() => {
    if (!items) return;
    if (!viewChosen.current && items.some((i) => i.group)) {
      viewChosen.current = true;
      setByGroup(true);
    }
    const waiting = items.filter((i) => i.analysis && !i.group).length;
    if (waiting === 0 || autoGrouped) return;
    autoGrouped = true;
    void api.hasApiKey("anthropic").then((has) => {
      if (has) void runGrouping(false, waiting);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    const load =() => api.listResearch().then(setItems).catch(() => setItems((list) => list ?? []));
    load();
    api.hasApiKey("deepgram").then(setHasDeepgram);
    // Posts sent through Telegram arrive on their own, so the list is re-read every few seconds.
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!detectPlatform(url)) {
      setError(SUPPORTED_LINKS_HINT);
      return;
    }
    setSaving(true);
    try {
      const result = await api.addResearch(url.trim());
      if (result.ok) {
        setItems((list) => [result.item, ...(list ?? [])]);
        setUrl("");
        void api.researchAuto().then((now) => {
          analysingBefore.current = now.analysing.length;
          setAuto(now);
        });
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The post could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  // Posts analysed before visual styles were recorded can have just the style added, which costs far less than analysing again.
  const unstyled = (items ?? []).filter((i) => i.analysis && !i.analysis.style);
  const [styling, setStyling] = useState("");
  async function addStyles() {
    let done = 0;
    for (const [n, item] of unstyled.entries()) {
      setStyling(`Looking at post ${n + 1} of ${unstyled.length}`);
      try {
        const result = await api.styleResearch(item.id);
        if (!result.ok) break;
        done++;
        setItems((list) => (list ?? []).map((i) => (i.id === result.item.id ? result.item : i)));
      } catch {
        break;
      }
    }
    setStyling(done < unstyled.length ? "Stopped early. Try again for the rest." : "");
  }

  const replace = (item: ResearchItem) => setItems((list) => (list ?? []).map((i) => (i.id === item.id ? item : i)));

  async function remove(item: ResearchItem) {
    await api.deleteResearch(item.id);
    setItems((list) => (list ?? []).filter((i) => i.id !== item.id));
  }

  // Search and filters, then the chosen order.
  const groupSizes = new Map<string, number>();
  for (const i of items ?? []) if (i.group) groupSizes.set(i.group, (groupSizes.get(i.group) ?? 0) + 1);
  const groupNames = [...groupSizes.keys()].sort((a, b) => groupSizes.get(b)! - groupSizes.get(a)! || a.localeCompare(b));
  const q = query.trim().toLowerCase();
  const filtered = sorted(
    (items ?? []).filter(
      (i) =>
        (platform === "all" || i.platform === platform) &&
        (!style || i.analysis?.style === style) &&
        (!concept || (concept === NO_GROUP ? !i.group : i.group === concept)) &&
        (rated === "" || (rated === "none" ? i.rating === null : (i.rating ?? 0) >= 4)) &&
        (!q || [postTitle(i), i.author, i.authorHandle, i.caption, i.note, i.group ?? "", i.analysis?.topic ?? "", i.analysis?.format ?? "", i.analysis?.style ?? ""].some((t) => t.toLowerCase().includes(q))),
    ),
    sort,
  );
  // Grouped: the biggest group first and posts without a group last. The chosen order holds inside each group.
  const rank = (i: ResearchItem) => (i.group ? groupNames.indexOf(i.group) : groupNames.length);
  const matching = byGroup ? [...filtered].sort((a, b) => rank(a) - rank(b)) : filtered;
  /** The heading a post sits under in the grouped view: its group, one shared heading for posts that are alone in theirs, or none. */
  const section = (i: ResearchItem) => (!i.group ? "" : (groupSizes.get(i.group) ?? 0) > 1 ? i.group : ONE_OF_A_KIND);
  const alone = [...groupSizes.values()].filter((n) => n === 1).length;
  // Groups are always shown whole; the plain list is shown a screenful at a time.
  const shown = byGroup ? matching : matching.slice(0, limit);
  const sections = [...new Set(matching.map(section))];
  const filtering = Boolean(q || concept || style || rated || platform !== "all");
  // The visual styles among the saved posts, most common first, for the filter.
  const stylesSaved = [...(items ?? []).reduce((n, i) => (i.analysis?.style ? n.set(i.analysis.style, (n.get(i.analysis.style) ?? 0) + 1) : n), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  // Once the posts have loaded, make sure the post we were sent to is on screen.
  useEffect(() => {
    if (!focusId || focused.current || !items) return;
    focused.current = true;
    const index = items.findIndex((i) => i.id === focusId);
    if (index >= limit) setLimit(index + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, items]);

  const analysed = (items ?? []).filter((i) => i.analysis).length;
  const select = "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-sm focus:border-[var(--primary)] focus:outline-none";
  const working = grouping || (auto.analysing.length > 0 ? `Analysing ${auto.analysing.length} new ${auto.analysing.length === 1 ? "post" : "posts"} and putting ${auto.analysing.length === 1 ? "it in its group" : "them in their groups"}…` : "");

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      {/* Saving a post is one line: paste, press, done. */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
        <form onSubmit={save} className="flex flex-wrap gap-3">
          <div className="relative min-w-0 flex-1">
            <Icon d={LINK_ICON} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
            <input
              type="url"
              aria-label="Post link"
              className={`${fieldClass} pl-9`}
              placeholder="Paste an Instagram or YouTube Shorts link to save it"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <button type="submit" className={primaryButton} disabled={saving || !url.trim()}>
            {saving ? "Saving…" : "Save post"}
          </button>
        </form>
        <p className="mt-2 text-xs leading-relaxed opacity-60">
          {saving
            ? "Downloading. This can take a minute. The very first save also sets up the download tools, which can take a few minutes."
            : auto.on
              ? "The app downloads the post, writes down what is said, analyses it and puts it with similar videos. You can also send links to your Telegram bot."
              : "The app downloads the post and writes down what is said. You can also send links to your Telegram bot."}
          {hasDeepgram === false && !saving && (
            <>
              {" "}
              No transcript until you add a Deepgram key.{" "}
              <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={onOpenSettings}>
                Open settings
              </button>
            </>
          )}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-red-400">
            {error}
          </p>
        )}
      </section>

      {items && items.length === 0 && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-[var(--line)] px-6 py-14 text-center">
          <h2 className="font-display text-xl font-semibold">Nothing saved yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed opacity-65">
            Save posts that worked for other creators. Each one is analysed for why it works and grouped with similar videos, and your ideas are modelled on them.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <>
          {/* Where the library stands, and the few things that act on all of it. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <dl className="flex flex-wrap gap-x-7 gap-y-2">
              {(
                [
                  ["Posts", items.length],
                  ["Analysed", analysed === items.length ? "All" : `${analysed} of ${items.length}`],
                  ["Groups", groupNames.length - alone],
                  ["One of a kind", alone],
                ] as const
              ).map(([name, value]) => (
                <div key={name}>
                  <dt className="text-xs opacity-55">{name}</dt>
                  <dd className="font-display text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <AnalyseAll items={items} onChange={replace} />
              <details className="relative">
                <summary className={`${quietButton} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>Options</summary>
                <div className="absolute right-0 top-11 z-30 w-80 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm shadow-2xl">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="checkbox" className="mt-0.5" checked={auto.on} onChange={async (e) => setAuto({ ...auto, on: await api.setResearchAuto(e.target.checked) })} />
                    <span>
                      <span className="font-medium">Analyse new posts automatically</span>
                      <span className="mt-0.5 block text-xs opacity-60">Each new post is analysed and grouped as soon as it is saved. About $0.06 a post on your Claude account.</span>
                    </span>
                  </label>
                  {(unstyled.length > 0 || styling) && (
                    <div className="border-t border-[var(--line)] pt-3">
                      <button type="button" className="font-medium underline disabled:opacity-40" disabled={styling.startsWith("Looking") || unstyled.length === 0} onClick={() => void addStyles()}>
                        {styling.startsWith("Looking") ? `${styling}…` : `Add the visual style to ${unstyled.length} ${unstyled.length === 1 ? "post" : "posts"}`}
                      </button>
                      <span className="mt-0.5 block text-xs opacity-60">{styling && !styling.startsWith("Looking") ? styling : "These were analysed before styles were recorded. Only their look is checked: about a cent a post."}</span>
                    </div>
                  )}
                  {groupNames.length > 0 && (
                    <div className="border-t border-[var(--line)] pt-3">
                      <button type="button" className="font-medium underline disabled:opacity-40" disabled={grouping !== ""} onClick={() => void runGrouping(true, analysed)}>
                        Regroup everything
                      </button>
                      <span className="mt-0.5 block text-xs opacity-60">Sorts every analysed post into groups afresh. A few cents. Groups you set by hand are replaced.</span>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </div>

          {/* Finding posts. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Icon d={ICONS.search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
              <input className={`${fieldClass} pl-9`} type="search" placeholder="Search creators, captions, notes and concepts" aria-label="Search saved posts" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {groupNames.length > 0 && (
              <select className={`${select} max-w-56`} aria-label="Concept" value={concept} onChange={(e) => setConcept(e.target.value)}>
                <option value="">All concepts</option>
                {groupNames.map((g) => (
                  <option key={g} value={g}>
                    {g} ({groupSizes.get(g)})
                  </option>
                ))}
                <option value={NO_GROUP}>No group yet</option>
              </select>
            )}
            {stylesSaved.length > 1 && (
              <select className={select} aria-label="Visual style" value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="">All styles</option>
                {stylesSaved.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name} ({count})
                  </option>
                ))}
              </select>
            )}
            <select className={select} aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value as ResearchPlatform | "all")}>
              <option value="all">All platforms</option>
              {(Object.keys(PLATFORM_LABELS) as ResearchPlatform[]).map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
            <select className={select} aria-label="Your rating" value={rated} onChange={(e) => setRated(e.target.value as typeof rated)}>
              <option value="">Any rating</option>
              <option value="top">4 stars or more</option>
              <option value="none">Not rated yet</option>
            </select>
            <select className={select} aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="saved">Newest saved</option>
              <option value="rating">Highest rated</option>
              <option value="likes">Most liked</option>
            </select>
            {groupNames.length > 0 && (
              <div role="radiogroup" aria-label="How the posts are laid out" className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-sm font-medium">
                {(
                  [
                    [true, "Groups"],
                    [false, "List"],
                  ] as const
                ).map(([grouped, text]) => (
                  <button
                    key={text}
                    type="button"
                    role="radio"
                    aria-checked={byGroup === grouped}
                    title={grouped ? "Similar videos together" : "One list, in the order chosen"}
                    className={`rounded-md px-3 py-1.5 ${byGroup === grouped ? "bg-[var(--tint)]" : "opacity-60 hover:opacity-100"}`}
                    onClick={() => {
                      viewChosen.current = true;
                      setByGroup(grouped);
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(working || groupNote) && (
            <p role="status" className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm ${working ? "border-[var(--line)] bg-[var(--tint)]" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"}`}>
              {working && <span aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--primary)]" />}
              {working || groupNote}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm opacity-70">
            <p>
              {matching.length === items.length ? `${items.length} ${items.length === 1 ? "post" : "posts"}` : `${matching.length} of ${items.length} posts`}
              {filtering && (
                <button
                  type="button"
                  className="ml-3 underline"
                  onClick={() => {
                    setQuery("");
                    setConcept("");
                    setStyle("");
                    setRated("");
                    setPlatform("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </p>
            {byGroup && sections.length > 1 && (
              <button type="button" className="underline" onClick={() => setCollapsed(collapsed.size > 0 ? new Set() : new Set(sections))}>
                {collapsed.size > 0 ? "Open every group" : "Close every group"}
              </button>
            )}
          </div>

          <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
            {/* The groups there are, for the field that moves a post to another. */}
            <datalist id="concept-groups">
              {groupNames.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <AnalysingContext.Provider value={auto.analysing}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-xs font-medium uppercase tracking-wide opacity-55">
                      <th className="w-[36%] px-5 py-3 font-medium">Post</th>
                      <th className="w-[9%] px-3 py-3 font-medium">Likes</th>
                      <th className="w-[11%] px-3 py-3 font-medium">Comments</th>
                      <th className="w-[136px] px-3 py-3 font-medium">Your rating</th>
                      <th className="px-3 py-3 font-medium">Your note</th>
                      <th className="w-[64px] px-5 py-3 font-medium" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-10 text-center opacity-60">
                          No saved post matches that.
                        </td>
                      </tr>
                    )}
                    {shown.map((item, index) => {
                      const key = section(item);
                      const closed = byGroup && collapsed.has(key);
                      const count = key === ONE_OF_A_KIND ? matching.filter((i) => section(i) === key).length : matching.filter((i) => section(i) === key).length;
                      return (
                        <Fragment key={item.id}>
                          {/* A heading wherever a new group starts. Press it to close or open the group. */}
                          {byGroup && (index === 0 || section(shown[index - 1]) !== key) && (
                            <tr className="border-b border-[var(--line)] bg-[var(--tint)]">
                              <td colSpan={6} className="p-0">
                                <button
                                  type="button"
                                  aria-expanded={!closed}
                                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left hover:bg-white/5"
                                  onClick={() => {
                                    const next = new Set(collapsed);
                                    if (closed) next.delete(key);
                                    else next.add(key);
                                    setCollapsed(next);
                                  }}
                                >
                                  <Icon d="M6 9l6 6 6-6" className={`h-4 w-4 opacity-60 transition-transform ${closed ? "-rotate-90" : ""}`} />
                                  <span className="font-display font-semibold">{key === ONE_OF_A_KIND ? "One of a kind" : item.group || "No group yet"}</span>
                                  <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs font-medium tabular-nums">{count}</span>
                                  <span className="text-xs opacity-60">
                                    {key === ONE_OF_A_KIND
                                      ? "No similar video saved yet. Each has its own concept, and a later post like it will join it."
                                      : item.group
                                        ? "Similar videos, built on the same concept."
                                        : "Posts get a group when they are analysed."}
                                  </span>
                                </button>
                              </td>
                            </tr>
                          )}
                          {!closed && (
                            <ResearchRow
                              item={item}
                              open={openId === item.id}
                              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
                              canTranscribe={hasDeepgram === true}
                              onChange={replace}
                              onDelete={() => setPendingDelete(item)}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </AnalysingContext.Provider>
            {!byGroup && matching.length > shown.length && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3 text-sm">
                <p className="opacity-60">
                  Showing {shown.length} of {matching.length}
                </p>
                <button type="button" className={quietButton} onClick={() => setLimit(limit + FIRST_SCREEN)}>
                  Show {Math.min(FIRST_SCREEN, matching.length - shown.length)} more
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {pendingDelete && (
        <ConfirmDelete
          item={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            await remove(pendingDelete);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

/** Asks before a saved post and its files are removed for good. */
function ConfirmDelete({
  item,
  onCancel,
  onConfirm,
}: {
  item: ResearchItem;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  // Escape closes the popup, like clicking outside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-delete-title" className="font-display text-xl font-semibold">
          Delete this post?
        </h2>
        <p className="mt-2 text-sm leading-relaxed opacity-75">
          “{postTitle(item)}” will be removed from Research, along with its downloaded files, transcript, rating and
          note. This cannot be undone.
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

type Sort = "saved" | "rating" | "likes";

function sorted(items: ResearchItem[], sort: Sort): ResearchItem[] {
  if (sort === "saved") return items; // Already newest first.
  const value = (i: ResearchItem) => (sort === "rating" ? i.rating : i.likeCount) ?? -1;
  return [...items].sort((a, b) => value(b) - value(a));
}

const postTitle = (item: ResearchItem) =>
  // YouTube videos have a real title; Instagram's is only "Video by <name>".
  (item.platform === "youtube" && item.title) || item.author || item.authorHandle || "Saved post";

/** One table row, plus the full post underneath when it is opened. */
function ResearchRow({
  item,
  open,
  onToggle,
  canTranscribe,
  onChange,
  onDelete,
}: {
  item: ResearchItem;
  open: boolean;
  onToggle: () => void;
  canTranscribe: boolean;
  onChange: (item: ResearchItem) => void;
  onDelete: () => void;
}) {
  const first = item.media[0];
  const thumbnail = first ? (first.kind === "image" ? first.file : first.posterFile) : "";
  const imageCount = item.media.filter((m) => m.kind === "image").length;

  const analysing = useContext(AnalysingContext);

  async function edit(change: { rating?: number | null; note?: string }) {
    const result = await api.updateResearch(item.id, change);
    if (result.ok) onChange(result.item);
  }

  return (
    <>
      <tr className={`align-top ${open ? "bg-[var(--bg)]" : "border-b border-[var(--line)] hover:bg-[var(--bg)]"}`}>
        <td className="px-5 py-3">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-3 text-left">
            {thumbnail ? (
              <img
                src={api.researchFileUrl(item.id, thumbnail)}
                alt=""
                loading="lazy"
                className="h-14 w-10 shrink-0 rounded-md bg-black object-cover"
              />
            ) : (
              <span className="h-14 w-10 shrink-0 rounded-md bg-black" />
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium">{postTitle(item)}</span>
              <span className="block truncate text-xs opacity-60">
                {PLATFORM_LABELS[item.platform]} · {describeMedia(item.media.length - imageCount, imageCount)}
                {item.durationSeconds != null && ` · ${formatDuration(item.durationSeconds)}`}
                {item.analysis ? " · analysed" : analysing.includes(item.id) && " · analysing…"}
              </span>
              {item.audio && (
                <span className="block truncate text-xs opacity-60" title={describeAudio(item.audio)}>
                  ♪ {describeAudio(item.audio)}
                </span>
              )}
            </span>
          </button>
        </td>
        <td className="px-3 py-3 tabular-nums opacity-80">
          {item.likeCount != null ? formatCount(item.likeCount) : "–"}
        </td>
        <td className="px-3 py-3 tabular-nums opacity-80">
          {item.commentCount != null ? formatCount(item.commentCount) : "–"}
        </td>
        <td className="px-3 py-3">
          <RatingPicker value={item.rating} onChange={(rating) => edit({ rating })} />
        </td>
        <td className="px-3 py-3">
          <NoteField value={item.note} onSave={(note) => edit({ note })} />
        </td>
        <td className="whitespace-nowrap px-5 py-3 text-right">
          <button
            type="button"
            aria-label="Delete post"
            title="Delete post"
            onClick={onDelete}
            className="rounded-md p-1.5 opacity-60 hover:bg-red-500/15 hover:text-red-400 hover:opacity-100"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
            </svg>
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--line)] bg-[var(--bg)]">
          <td colSpan={6} className="px-5 pb-5">
            <ResearchCard item={item} canTranscribe={canTranscribe} onChange={onChange} onDelete={onDelete} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Five stars. Hovering previews a rating; pressing the current one again clears it. */
function RatingPicker({ value, onChange }: { value: number | null; onChange: (rating: number | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div
      className="flex items-center"
      role="group"
      aria-label={value ? `Rated ${value} out of 5` : "Not rated"}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          aria-label={value === n ? "Clear rating" : `Rate ${n} out of 5`}
          title={value === n ? "Clear rating" : `Rate ${n} out of 5`}
          onMouseEnter={() => setHover(n)}
          onClick={() => {
            setHover(null);
            onChange(value === n ? null : n);
          }}
          className={`p-0.5 ${n <= shown ? "text-[var(--accent)]" : "text-[var(--ink)] opacity-25 hover:opacity-60"}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={n <= shown ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l2.6 5.600 6 .800-4.400 4.200 1.100 6-5.300-3-5.300 3 1.100-6L3.400 9.400l6-.800z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

/**
 * The note shown as a line of text. Clicking it opens a roomy editor on top of
 * the table; it saves when you click away or press Ctrl+Enter, and Escape cancels.
 */
function NoteField({ value, onSave }: { value: string; onSave: (note: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const cancelled = useRef(false);
  const width = 340;

  const close = (save: boolean) => {
    setPlace(null);
    if (save && draft.trim() !== value) onSave(draft.trim());
  };

  return (
    <>
      <button
        type="button"
        title={value || "Add a note"}
        className={`block w-full rounded-md px-2 py-1 text-left hover:bg-[var(--tint)] ${value ? "" : "opacity-45 hover:opacity-80"}`}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setDraft(value);
          cancelled.current = false;
          // Fixed to the window so the table's scrolling cannot clip it. It opens just
          // under the row (or above it near the bottom) so the row itself stays visible.
          const height = 180;
          const below = box.bottom + 6;
          setPlace({
            left: Math.max(8, Math.min(box.left, window.innerWidth - width - 24)),
            top: below + height < window.innerHeight ? below : Math.max(8, box.top - height - 6),
          });
        }}
      >
        <span className="line-clamp-2 break-words">{value || "Add note"}</span>
      </button>
      {place && (
        <div className="fixed z-40 rounded-xl border border-[var(--primary)] bg-[var(--surface)] p-2 shadow-2xl" style={{ ...place, width }}>
          <textarea
            autoFocus
            rows={5}
            aria-label="Note"
            placeholder="Why you saved it, what to copy, what to try…"
            className="block w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed placeholder:opacity-50 focus:outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                cancelled.current = true;
                close(false);
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                close(true);
              }
            }}
            onBlur={() => !cancelled.current && close(true)}
          />
          <p className="px-1.5 pt-1 text-xs opacity-45">Saves when you click away · Esc cancels</p>
        </div>
      )}
    </>
  );
}

function ResearchCard({
  item,
  canTranscribe,
  onChange,
  onDelete,
}: {
  item: ResearchItem;
  canTranscribe: boolean;
  onChange: (item: ResearchItem) => void;
  onDelete: () => void;
}) {
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");

  async function transcribe() {
    setTranscribing(true);
    setError("");
    const result = await api.transcribeResearch(item.id);
    setTranscribing(false);
    if (result.ok) onChange(result.item);
    else setError(result.error);
  }

  const hasVideo = item.media.some((m) => m.kind === "video");
  const imageCount = item.media.filter((m) => m.kind === "image").length;

  const details = [
    describeMedia(item.media.length - imageCount, imageCount),
    item.publishedAt && new Date(item.publishedAt).toLocaleDateString(undefined, { dateStyle: "medium" }),
    item.durationSeconds != null && formatDuration(item.durationSeconds),
    item.viewCount != null && `${formatCount(item.viewCount)} views`,
    item.likeCount != null && `${formatCount(item.likeCount)} likes`,
    item.commentCount != null && `${formatCount(item.commentCount)} comments`,
  ].filter(Boolean);

  return (
    <article className="grid gap-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 md:grid-cols-[240px_1fr]">
      <MediaViewer item={item} />

      <div className="min-w-0 space-y-5">
        <div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-widest opacity-70">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              {PLATFORM_LABELS[item.platform]}
            </span>
            {details.map((d) => (
              <span key={String(d)}>{d}</span>
            ))}
          </p>
          {/* YouTube videos have a real title; Instagram's is only "Video by <name>". */}
          <h3 className="mt-2 font-display text-xl font-semibold">
            {(item.platform === "youtube" && item.title) || item.author || item.authorHandle || "Saved post"}
          </h3>
          <p className="text-sm opacity-60">
            {[item.platform === "youtube" && item.author, item.authorHandle && `@${item.authorHandle}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <GroupField item={item} onChange={onChange} />

        <TextBlock label="Caption" text={item.caption} empty="This post has no caption." />

        {hasVideo && <AudioUsed item={item} onChange={onChange} />}

        <PostAnalysisBlock item={item} onChange={onChange} />

        {hasVideo && (
        <div>
          <TextBlock
            label="What is said"
            text={item.transcript}
            empty={
              item.transcriptError ||
              (canTranscribe ? "Not transcribed yet." : "Add a Deepgram API key in Settings to transcribe this video.")
            }
          />
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-red-400">
              {error}
            </p>
          )}
          {canTranscribe && (
            <button type="button" className={`${quietButton} mt-3`} disabled={transcribing} onClick={transcribe}>
              {transcribing ? "Transcribing…" : item.transcript ? "Transcribe again" : "Transcribe"}
            </button>
          )}
        </div>
        )}

        <div className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] pt-4 text-sm">
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Open original
          </a>
          <span className="opacity-50">Saved {new Date(item.savedAt).toLocaleDateString()}</span>
          {item.analysis && <MakeVideoButton from={{ postId: item.id }} label="Make my version" />}
          <button type="button" className="ml-auto opacity-60 hover:text-red-400 hover:opacity-100" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

const describeAudio = (audio: ResearchAudio) => [audio.title, audio.artist].filter(Boolean).join(" · ");

/** Which sound the video uses: a song, or the creator's own recording. */
/** The concept group a post is in: pick another, type a new one, or clear it. Saved on leaving the box or pressing Enter. */
function GroupField({ item, onChange }: { item: ResearchItem; onChange: (item: ResearchItem) => void }) {
  const [draft, setDraft] = useState(item.group ?? "");
  const [error, setError] = useState("");
  useEffect(() => setDraft(item.group ?? ""), [item.group]);

  async function save() {
    if (draft.trim() === (item.group ?? "")) return;
    setError("");
    const result = await api.updateResearch(item.id, { group: draft });
    if (result.ok) onChange(result.item);
    else setError(result.error);
  }

  return (
    <label className="block text-sm">
      <span className="font-mono text-xs uppercase tracking-widest opacity-60">Concept group</span>
      <input
        className={`${fieldClass} mt-1.5 max-w-md`}
        list="concept-groups"
        placeholder={item.analysis ? "No group. Type a name, or pick one." : "Set when the post is analysed. You can also type one."}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="mt-1 block text-xs opacity-55">Posts built on the same concept share a group, so similar videos sit together.</span>
      {error && (
        <span role="alert" className="mt-1 block text-xs font-medium text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}

function AudioUsed({ item, onChange }: { item: ResearchItem; onChange: (item: ResearchItem) => void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setChecking(true);
    setError("");
    const result = await api.refreshResearchAudio(item.id);
    setChecking(false);
    if (result.ok) onChange(result.item);
    else setError(result.error);
  }

  const { audio } = item;
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest opacity-60">Audio used</p>
      {audio ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[var(--bg)] p-3 text-sm">
          <span className="font-medium">♪ {audio.title}</span>
          {audio.artist && <span className="opacity-70">{audio.kind === "original" ? `@${audio.artist}` : audio.artist}</span>}
          <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs">
            {audio.kind === "music" ? "Song" : "Original sound"}
          </span>
          {audio.trending && (
            <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs font-semibold text-white">Trending</span>
          )}
          {audio.url && (
            <a
              href={audio.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto font-medium text-[var(--accent)] hover:underline"
            >
              Videos using this sound
            </a>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm">
          {/* undefined means the post was saved before the app looked for the sound. */}
          <span className="opacity-60">{audio === null ? "No sound details were found." : "Not checked yet."}</span>
          <button type="button" className={quietButton} disabled={checking} onClick={check}>
            {checking ? "Checking…" : audio === null ? "Check again" : "Check audio"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Shows a post's videos and pictures one at a time, with arrows when there are several. */
function MediaViewer({ item }: { item: ResearchItem }) {
  const [index, setIndex] = useState(0);
  const current = item.media[Math.min(index, item.media.length - 1)];
  if (!current) return <div className="aspect-[4/5] w-full rounded-xl bg-black" />;

  const url = (file: string) => api.researchFileUrl(item.id, file);
  const step = (by: number) => setIndex((i) => (i + by + item.media.length) % item.media.length);
  const arrowClass =
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2.5 py-1 text-lg text-white hover:bg-black/80";

  return (
    <div className="self-start">
      <div className="relative">
        {current.kind === "video" ? (
          <video
            key={current.file}
            controls
            preload="none"
            className="aspect-[9/16] w-full rounded-xl bg-black object-contain"
            poster={current.posterFile ? url(current.posterFile) : undefined}
            src={url(current.file)}
          />
        ) : (
          <a href={url(current.file)} target="_blank" rel="noreferrer" title="Open full size">
            <img
              src={url(current.file)}
              alt={`Picture ${index + 1} of ${item.media.length} from this post`}
              loading="lazy"
              className="w-full rounded-xl bg-black object-contain"
            />
          </a>
        )}
        {item.media.length > 1 && (
          <>
            <button type="button" aria-label="Previous" className={`${arrowClass} left-2`} onClick={() => step(-1)}>
              ‹
            </button>
            <button type="button" aria-label="Next" className={`${arrowClass} right-2`} onClick={() => step(1)}>
              ›
            </button>
          </>
        )}
      </div>
      {item.media.length > 1 && (
        <p className="mt-2 text-center font-mono text-xs opacity-60">
          {index + 1} / {item.media.length}
        </p>
      )}
    </div>
  );
}

function describeMedia(videos: number, images: number): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [videos > 0 && plural(videos, "video"), images > 0 && plural(images, "picture")].filter(Boolean).join(", ");
}

/** A labelled block of saved text with a copy button. */
function TextBlock({ label, text, empty }: { label: string; text: string; empty: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-widest opacity-60">{label}</p>
        {text && (
          <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {text ? (
        <p className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-line rounded-xl bg-[var(--bg)] p-3 text-sm leading-relaxed">
          {text}
        </p>
      ) : (
        <p className="mt-1.5 text-sm opacity-60">{empty}</p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
