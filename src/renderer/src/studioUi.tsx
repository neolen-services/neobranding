// Small pieces every Studio screen shares: buttons, chips, the "how it is made" choice, the idea picker, a dialog.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import { ideaKind, type Idea } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import { MAX_IDEAS, joinState, pickedClip, pickedPicture, productionLabel, storyboardApproved, PRODUCTIONS, SPEAKER_ME, SPEAKER_NARRATOR, type Character, type Production, type Video } from "@shared/studio";
import { api } from "./api";

export const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
export const primaryButton = "rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
export const quietButton = "rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium hover:border-[var(--ink)] disabled:opacity-50";
export const smallButton = "rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:border-[var(--ink)] disabled:opacity-40";
export const card = "rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm";
export const label = "text-xs font-medium uppercase tracking-wide opacity-55";

export const SCRIPT_COST = "about $0.10";
export const WORDS_PER_SECOND = 2.5;

/** A line icon drawn from one path, sized by the text around it. */
export function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      <path d={d} />
    </svg>
  );
}
export const ICONS = {
  back: "M15 5l-7 7 7 7",
  check: "M5 12.5l4.5 4.5L19 7.500",
  plus: "M12 5v14M5 12h14",
  play: "M8 5.500v13l11-6.500z",
  pause: "M8 5v14M16 5v14",
  ai: "M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM19 16l.700 2.300L22 19l-2.300.700L19 22l-.700-2.300L16 19l2.300-.700z",
  camera: "M4 8h3l1.500-2h7L17 8h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  mix: "M4 7h10M4 17h10M17 4v6M17 14v6M14 7h6M14 17h6",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9.500h4M4 14.500h4M16 9.500h4M16 14.500h4",
  series: "M5 6h14M5 12h14M5 18h9",
  open: "M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5",
  close: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  speaker: "M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6",
  copy: "M9 9h10v11H9zM5 15V4h10",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  filter: "M4 6h16M7 12h10M10 18h4",
} as const;

export const Chip = ({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "strong" | "warn" | "good" }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
      tone === "strong" ? "bg-[var(--primary)] text-white" : tone === "warn" ? "border border-[var(--accent)] text-[var(--accent)]" : tone === "good" ? "bg-emerald-500/15 text-emerald-400" : "bg-[var(--tint)]"
    }`}
  >
    {children}
  </span>
);

const PRODUCTION_ICON: Record<Production, string> = { mix: ICONS.mix, ai: ICONS.ai, me: ICONS.camera };

/** The three ways a video or series can be made. `compact` is one row of buttons; otherwise three cards that explain themselves. */
export function ProductionPicker({ value, onChange, disabled, compact }: { value: Production; onChange: (value: Production) => void; disabled?: boolean; compact?: boolean }) {
  if (compact) {
    return (
      <div role="radiogroup" aria-label="How it is made" className="inline-flex rounded-full border border-[var(--line)] p-0.5">
        {PRODUCTIONS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={value === p.id}
            disabled={disabled}
            title={p.note}
            onClick={() => value !== p.id && onChange(p.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${value === p.id ? "bg-[var(--primary)] text-white" : "opacity-70 hover:opacity-100"}`}
          >
            <Icon d={PRODUCTION_ICON[p.id]} className="h-3.5 w-3.5" />
            {p.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="How it is made" className="grid gap-2 sm:grid-cols-3">
      {PRODUCTIONS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          disabled={disabled}
          onClick={() => value !== p.id && onChange(p.id)}
          className={`rounded-xl border p-3 text-left disabled:opacity-50 ${value === p.id ? "border-[var(--primary)] bg-[var(--tint)] ring-1 ring-[var(--primary)]" : "border-[var(--line)] hover:border-[var(--ink)]"}`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Icon d={PRODUCTION_ICON[p.id]} />
            {p.label}
          </span>
          <span className="mt-1 block text-xs leading-snug opacity-65">{p.note}</span>
        </button>
      ))}
    </div>
  );
}

/** One row of a picker: a saved idea or a saved post. */
type PickItem = {
  id: string;
  title: string;
  sub: string;
  /** Shown at the right: a score or a rating. */
  badge?: string;
  /** Why it cannot be ticked, or "". */
  blocked?: string;
  /** What it is searched by. */
  text: string;
  /** Its value for each filter, by the filter's name. */
  facets: Record<string, string>;
  /** Whether each "Show" choice includes it, by the choice's id. */
  shows: Record<string, boolean>;
  /** The group it belongs to, when the picker shows its rows in groups. "" for none. */
  group?: string;
};

/** Headings for rows that are alone in their group, and for rows in none. */
const ALONE = "\u0000alone";
const UNGROUPED = "\u0000none";

/** A list to tick from, with a search box and a Filter button. Used for saved ideas and saved posts. */
function Picker({
  items,
  picked,
  onChange,
  max,
  search,
  filters,
  shows,
  none,
  selectAll,
  grouped,
  single,
}: {
  items: PickItem[];
  picked: string[];
  onChange: (ids: string[]) => void;
  max: number;
  /** The search box's placeholder. */
  search: string;
  /** The drop-downs under Filter: each a name and the word for "any". */
  filters: { name: string; any: string }[];
  /** The "Show" choices besides "all" and "only the ones I picked". */
  shows: { id: string; label: string }[];
  /** What to say when there is nothing to pick from at all. */
  none: string;
  /** Offers "Select all", and says this when nothing is ticked. */
  selectAll?: string;
  /** Shows the rows under their groups, each group with a tick box that selects all of it. */
  grouped?: boolean;
  /** Only one row can be picked: choosing another replaces it. */
  single?: boolean;
}) {
  const [query, setQuery] = useState("");
  /** The groups opened to show their rows. Groups start closed, so the list reads as a list of groups. */
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [filtering, setFiltering] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [show, setShow] = useState("all");
  if (items.length === 0) return <p className="text-sm opacity-60">{none}</p>;

  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) => (!q || i.text.toLowerCase().includes(q)) && filters.every((f) => !chosen[f.name] || i.facets[f.name] === chosen[f.name]) && (show === "all" || (show === "picked" ? picked.includes(i.id) : i.shows[show])),
  );
  const active = filters.filter((f) => chosen[f.name]).length + (show !== "all" ? 1 : 0);
  const full = picked.length >= max;
  const select = "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--primary)] focus:outline-none";
  const clear = () => {
    setQuery("");
    setChosen({});
    setShow("all");
  };

  const row = (item: PickItem) => {
    const on = picked.includes(item.id);
    const blocked = !on && Boolean(item.blocked);
    return (
      <li key={item.id}>
        <label
          title={blocked ? item.blocked : undefined}
          className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[var(--tint)]"} ${on ? "bg-[var(--tint)]" : ""}`}
        >
          <input
            type={single ? "radio" : "checkbox"}
            checked={on}
            disabled={blocked || (!single && !on && full)}
            onChange={() => onChange(single ? [item.id] : on ? picked.filter((id) => id !== item.id) : [...picked, item.id])}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{item.title}</span>
            <span className="block truncate text-xs opacity-60">{blocked ? item.blocked : item.sub}</span>
          </span>
          {item.badge && <span className="shrink-0 text-xs tabular-nums opacity-60">{item.badge}</span>}
        </label>
      </li>
    );
  };

  // Groups of two or more first, biggest first; then everything that is alone in its group; then what has none.
  const sizes = new Map<string, number>();
  for (const i of items) if (i.group) sizes.set(i.group, (sizes.get(i.group) ?? 0) + 1);
  const sectionOf = (i: PickItem) => (!i.group ? UNGROUPED : (sizes.get(i.group) ?? 0) > 1 ? i.group : ALONE);
  const order = (key: string) => (key === UNGROUPED ? 2 : key === ALONE ? 1 : 0);
  const sections = grouped
    ? [...new Set(shown.map(sectionOf))]
        .sort((a, b) => order(a) - order(b) || (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0) || a.localeCompare(b))
        .map((key) => ({ key, name: key === ALONE ? "One of a kind" : key === UNGROUPED ? "No group yet" : key, rows: shown.filter((i) => sectionOf(i) === key) }))
    : [];

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon d={ICONS.search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
          <input className={`${fieldClass} pl-9`} type="search" placeholder={search} aria-label={search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button
          type="button"
          aria-expanded={filtering}
          className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${filtering || active ? "border-[var(--primary)]" : "border-[var(--line)] hover:border-[var(--ink)]"}`}
          onClick={() => setFiltering(!filtering)}
        >
          <Icon d={ICONS.filter} />
          Filter
          {active > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[0.65rem] text-white">{active}</span>}
        </button>
      </div>

      {filtering && (
        <div className={`mt-2 grid gap-2 rounded-xl border border-[var(--line)] p-3 ${filters.length > 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
          {filters.map((f) => (
            <label key={f.name} className="block text-xs">
              <span className="mb-1 block opacity-60">{f.name}</span>
              <select className={select} value={chosen[f.name] ?? ""} onChange={(e) => setChosen({ ...chosen, [f.name]: e.target.value })}>
                <option value="">{f.any}</option>
                {[...new Set(items.map((i) => i.facets[f.name]).filter(Boolean))].sort().map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="block text-xs">
            <span className="mb-1 block opacity-60">Show</span>
            <select className={select} value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="all">All</option>
              {shows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              <option value="picked">Only the ones I picked</option>
            </select>
          </label>
        </div>
      )}

      {grouped && sections.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs opacity-70">
          <span>Tick a group to take every post in it, or open it to pick one by one.</span>
          <button type="button" className="underline" onClick={() => setOpened(opened.size > 0 ? new Set() : new Set(sections.map((x) => x.key)))}>
            {opened.size > 0 ? "Close all groups" : "Open all groups"}
          </button>
        </p>
      )}
      <ul className={`mt-2 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--line)] p-1.5 ${grouped ? "max-h-72" : "max-h-48"}`}>
        {shown.length === 0 && (
          <li className="px-2 py-2 text-sm opacity-60">
            Nothing matches that.{" "}
            {(q || active > 0) && (
              <button type="button" className="underline" onClick={clear}>
                Clear search and filter
              </button>
            )}
          </li>
        )}
        {!grouped && shown.map(row)}
        {grouped &&
          sections.map(({ key, name, rows }) => {
            const can = rows.filter((i) => !i.blocked);
            const ticked = can.filter((i) => picked.includes(i.id)).length;
            const all = can.length > 0 && ticked === can.length;
            // A search or a filter opens every group, so what was found is in view.
            const open = opened.has(key) || q !== "" || active > 0;
            return (
              <li key={key}>
                <div className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${ticked > 0 ? "bg-[var(--tint)]" : "hover:bg-[var(--tint)]"}`}>
                  <input
                    type="checkbox"
                    aria-label={`Every post in ${name}`}
                    title={can.length === 0 ? "Nothing here can be ticked yet." : all ? "Untick the whole group" : "Tick the whole group"}
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = ticked > 0 && !all;
                    }}
                    disabled={can.length === 0 || (!all && full)}
                    onChange={() =>
                      onChange(all ? picked.filter((id) => !can.some((i) => i.id === id)) : [...new Set([...picked, ...can.map((i) => i.id)])].slice(0, max))
                    }
                  />
                  <button
                    type="button"
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      const next = new Set(opened);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      setOpened(next);
                    }}
                  >
                    <span className="truncate font-semibold">{name}</span>
                    <span className="shrink-0 rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs tabular-nums opacity-80">{ticked > 0 ? `${ticked} of ${rows.length}` : rows.length}</span>
                    <Icon d="M6 9l6 6 6-6" className={`ml-auto h-4 w-4 opacity-50 transition-transform ${open ? "" : "-rotate-90"}`} />
                  </button>
                </div>
                {open && <ul className="mb-1 ml-4 space-y-0.5 border-l border-[var(--line)] pl-2">{rows.map(row)}</ul>}
              </li>
            );
          })}
      </ul>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-70">
        <span>{single ? (picked.length === 0 ? "Pick one." : "") : picked.length === 0 ? (selectAll ?? `Tick as many as you like, up to ${max}.`) : `${picked.length} picked${full ? " (that is the most)" : ""}.`}</span>
        {selectAll !== undefined && (
          <button
            type="button"
            className="underline"
            // Everything in view that can be ticked, on top of what is ticked already.
            onClick={() => onChange([...new Set([...picked, ...shown.filter((i) => !i.blocked).map((i) => i.id)])].slice(0, max))}
          >
            Select all{q || active > 0 ? " shown" : ""}
          </button>
        )}
        {picked.length > 0 && !single && (
          <button type="button" className="underline" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </p>
    </div>
  );
}

/** Saved ideas to choose from: search, and filter by kind, how it is made, pillar and what is already in Studio. With `single`, one idea only. */
export function IdeaPicker({
  ideas,
  picked,
  onChange,
  used,
  single,
}: {
  ideas: Idea[];
  picked: string[];
  onChange: (ids: string[]) => void;
  /** Ideas already made into a video or series. */
  used?: Set<string>;
  single?: boolean;
}) {
  const kind = (i: Idea) => (ideaKind(i) === "series" ? "Series" : "Single video");
  return (
    <Picker
      items={ideas.map((i) => ({
        id: i.id,
        title: i.title,
        sub: [kind(i), i.production && productionLabel(i.production), i.pillar, used?.has(i.id) && "already in Studio"].filter(Boolean).join(" · "),
        badge: i.score !== undefined ? String(i.score) : undefined,
        text: [i.title, i.hook, i.pillar, i.series ?? ""].join(" "),
        facets: { Kind: kind(i), "Made with": i.production ? productionLabel(i.production) : "", Pillar: i.pillar },
        shows: { fresh: !used?.has(i.id) },
      }))}
      picked={picked}
      onChange={onChange}
      max={single ? 1 : MAX_IDEAS}
      single={single}
      search="Search your ideas"
      filters={[
        { name: "Kind", any: "Videos and series" },
        { name: "Made with", any: "Made any way" },
        { name: "Pillar", any: "Any pillar" },
      ]}
      shows={[{ id: "fresh", label: "Not in Studio yet" }]}
      none="No saved ideas yet. Ideas you keep on the Ideas page appear here."
    />
  );
}

/** The name a saved post goes by in a list. */
export const postName = (post: ResearchItem) => (post.platform === "youtube" && post.title) || post.author || post.authorHandle || "Saved post";

/** Saved posts to tick as inspiration: search, filter by platform, format and rating. Only analysed posts can be used, because their structure is what is borrowed. */
export function PostPicker({
  posts,
  picked,
  onChange,
  max = MAX_IDEAS,
  selectAll,
}: {
  posts: ResearchItem[];
  picked: string[];
  onChange: (ids: string[]) => void;
  /** The most that can be ticked. */
  max?: number;
  /** Offers "Select all", and says this when nothing is ticked. */
  selectAll?: string;
}) {
  return (
    <Picker
      items={posts.map((p) => ({
        id: p.id,
        title: postName(p),
        sub: [p.group, p.analysis?.topic, p.analysis?.format, p.platform === "youtube" ? "YouTube" : "Instagram"].filter(Boolean).join(" · "),
        badge: p.rating ? `${p.rating}★` : undefined,
        blocked: p.analysis ? "" : "Not analysed yet. Analyse it in Research to use it.",
        text: [postName(p), p.authorHandle, p.caption, p.note, p.group ?? "", p.analysis?.topic ?? "", p.analysis?.format ?? ""].join(" "),
        group: p.group ?? "",
        facets: { Concept: p.group ?? "", Platform: p.platform === "youtube" ? "YouTube" : "Instagram", Format: p.analysis?.format ?? "" },
        shows: { top: (p.rating ?? 0) >= 4, analysed: Boolean(p.analysis) },
      }))}
      picked={picked}
      onChange={onChange}
      max={max}
      selectAll={selectAll}
      grouped={posts.some((p) => p.group)}
      search="Search your saved posts"
      filters={[
        { name: "Concept", any: "Any concept" },
        { name: "Platform", any: "Any platform" },
        { name: "Format", any: "Any format" },
      ]}
      shows={[
        { id: "top", label: "Rated 4 stars or more" },
        { id: "analysed", label: "Analysed" },
      ]}
      none="No saved posts yet. Posts you save in Research appear here."
    />
  );
}

/** A dialog over the page. Closes on Escape or a click outside, unless `locked` (work is in progress). */
export function Dialog({ title, onClose, locked, footer, children }: { title: string; onClose: () => void; locked?: boolean; footer: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !locked && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={() => !locked && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex max-h-[min(860px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Close" className="rounded-full p-1.5 opacity-60 hover:bg-[var(--tint)] hover:opacity-100 disabled:opacity-30" disabled={locked} onClick={onClose}>
            <Icon d={ICONS.close} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--line)] bg-[var(--surface)] px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

/** A round button that plays one recorded line, and stops it when pressed again. */
export function PlayLine({ file, label: name }: { file: string; label: string }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  return (
    <button
      type="button"
      aria-label={playing ? `Stop ${name}` : `Play ${name}`}
      title={playing ? "Stop" : "Play this line"}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--line)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
      onClick={() => {
        if (playing) {
          audio.current?.pause();
          return setPlaying(false);
        }
        const a = new Audio(api.audioFileUrl(file));
        audio.current = a;
        const stop = () => setPlaying(false);
        a.addEventListener("ended", stop);
        a.addEventListener("error", stop);
        a.play().then(() => setPlaying(true), stop);
      }}
    >
      <Icon d={playing ? ICONS.pause : ICONS.play} className="h-3 w-3" />
    </button>
  );
}

/** The tabs of a video's page, in the order the work is done. */
export const STAGES = ["Idea", "Script", "Cast", "Storyboard", "Preview", "Make", "Finish"] as const;

/** One character in a video's script, and what the video still needs from them. */
export type CastMember = { character: Character; /** How many lines they speak. */ lines: number; /** How many scenes they are seen or heard in. */ scenes: number; needs: string[] };

/** Everyone a video's script uses: its characters, the narrator and the creator, and how many of them are not set up yet. */
export function videoCast(video: Video, cast: Character[], brand: BrandKit | null) {
  const members = cast
    .map((character): CastMember => {
      const inScene = (s: Video["scenes"][number]) => s.characters.includes(character.id) || s.lines.some((l) => l.speaker === character.id);
      const lines = video.scenes.reduce((n, s) => n + s.lines.filter((l) => l.speaker === character.id).length, 0);
      const needs = [
        lines > 0 && !character.voice && "a voice",
        // Only a generated scene needs their pictures; a filmed one has the real thing.
        video.scenes.some((s) => s.madeBy === "ai" && inScene(s)) && (character.pictures.length === 0 ? "a portrait" : !character.sheet && "a character sheet"),
      ].filter((x): x is string => Boolean(x));
      return { character, lines, scenes: video.scenes.filter(inScene).length, needs };
    })
    .filter((m) => m.scenes > 0);
  const spoken = video.scenes.flatMap((s) => s.lines);
  const narratorLines = spoken.filter((l) => l.speaker === SPEAKER_NARRATOR).length;
  const narratorReady = narratorLines === 0 || Boolean(brand?.speakingVoice);
  return { members, narratorLines, narratorReady, myLines: spoken.filter((l) => l.speaker === SPEAKER_ME).length, unready: members.filter((m) => m.needs.length > 0).length + (narratorReady ? 0 : 1) };
}

export type VideoProgress = {
  /** How many of the stages are behind it (0 to all of them). */
  done: number;
  /** The tab where the next thing to do is. */
  tab: number;
  /** The next thing to do, as a short instruction. */
  next: string;
  /** Whether that next thing is the creator's to do now (as opposed to finished). */
  waiting: boolean;
  aiLines: number;
  unvoiced: number;
  /** Speakers whose lines cannot be voiced until a voice is chosen. */
  voiceless: string[];
  /** AI scenes with no storyboard yet. */
  needPicture: number;
  /** AI scenes with no clip, or with a clip that no longer joins the one before it. */
  needClip: number;
  needFilming: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** Where a video stands and the one thing to do next. The same answer drives the list, the page header and the tabs. */
export function videoProgress(video: Video, cast: Character[], brand: BrandKit | null): VideoProgress {
  const lines = video.scenes.flatMap((s) => s.lines).filter((l) => l.speaker !== SPEAKER_ME);
  const unvoiced = lines.filter((l) => !l.audioId).length;
  const voiceless = [
    ...new Set(
      lines
        .filter((l) => (l.speaker === SPEAKER_NARRATOR ? !brand?.speakingVoice : !cast.find((c) => c.id === l.speaker)?.voice))
        .map((l) => (l.speaker === SPEAKER_NARRATOR ? "Narrator" : (cast.find((c) => c.id === l.speaker)?.name ?? "Unknown character"))),
    ),
  ];
  const ai = video.scenes.filter((s) => s.madeBy === "ai");
  const needPicture = ai.filter((s) => !pickedPicture(s)).length;
  const needClip = video.scenes.filter((s, i) => s.madeBy === "ai" && (!pickedClip(s) || joinState(video.scenes, i) === "stale")).length;
  const needFilming = video.scenes.filter((s) => s.madeBy === "me" && !pickedClip(s)).length;
  const base = { aiLines: lines.length, unvoiced, voiceless, needPicture, needClip, needFilming };

  if (video.scenes.length === 0) return { ...base, done: 1, tab: 1, next: "Write the script", waiting: true };
  if (!video.approvedAt) return { ...base, done: 1, tab: 1, next: "Review and approve the script", waiting: true };
  if (video.results) {
    const views = video.results.views;
    return { ...base, done: 7, tab: 6, next: views !== null ? `Posted · ${compact(views)} views` : "Posted", waiting: false };
  }
  const unready = videoCast(video, cast, brand).unready;
  if (unready > 0) return { ...base, done: 2, tab: 2, next: `Set up ${plural(unready, "cast member")}`, waiting: true };
  if (needPicture > 0) return { ...base, done: 3, tab: 3, next: `Make ${plural(needPicture, "storyboard")}`, waiting: true };
  const unapproved = ai.filter((s) => !storyboardApproved(s)).length;
  if (unapproved > 0) return { ...base, done: 3, tab: 3, next: `Approve ${plural(unapproved, "storyboard")}`, waiting: true };
  if (unvoiced > 0 && voiceless.length === 0) return { ...base, done: 4, tab: 4, next: `Make ${plural(unvoiced, "voice line")}`, waiting: true };
  if (needClip > 0) return { ...base, done: 5, tab: 5, next: `Make ${plural(needClip, "clip")} from the storyboard`, waiting: true };
  if (needFilming > 0) return { ...base, done: 5, tab: 5, next: `Film ${plural(needFilming, "scene")} and add ${needFilming === 1 ? "it" : "them"}`, waiting: true };
  return { ...base, done: 6, tab: 6, next: "Post it, then record how it did", waiting: true };
}

/** One short bar for each stage, filled for those already behind a video. */
export function ProgressBars({ done }: { done: number }) {
  return (
    <span className="flex gap-1" role="img" aria-label={`${Math.min(done, STAGES.length)} of ${STAGES.length} stages done`}>
      {STAGES.map((name, i) => (
        <span key={name} title={name} className={`h-1 w-5 rounded-full ${i < done ? "bg-[var(--primary)]" : "bg-[var(--tint)]"}`} />
      ))}
    </span>
  );
}
