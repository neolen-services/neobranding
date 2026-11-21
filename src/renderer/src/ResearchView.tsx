import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  detectPlatform,
  PLATFORM_LABELS,
  SUPPORTED_LINKS_HINT,
  type ResearchAudio,
  type ResearchItem,
  type ResearchPlatform,
} from "@shared/research";
import { AnalyseAll, PostAnalysisBlock } from "./AnalysisView";
import { api } from "./api";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton =
  "rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium hover:border-[var(--ink)] disabled:opacity-50";

export function ResearchView({ onOpenSettings, focusId }: { onOpenSettings: () => void; /** A post to open on arrival. */ focusId?: string }) {
  const [items, setItems] = useState<ResearchItem[] | null>(null);
  const [hasDeepgram, setHasDeepgram] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>("saved");
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const focused = useRef(false);
  const [platform, setPlatform] = useState<ResearchPlatform | "all">("all");
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<ResearchItem | null>(null);

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
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The post could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const replace = (item: ResearchItem) => setItems((list) => (list ?? []).map((i) => (i.id === item.id ? item : i)));

  async function remove(item: ResearchItem) {
    await api.deleteResearch(item.id);
    setItems((list) => (list ?? []).filter((i) => i.id !== item.id));
  }

  // Filter, then sort, then cut into pages of ten.
  const matching = sorted(
    (items ?? []).filter((i) => platform === "all" || i.platform === platform),
    sort,
  );
  // Once the posts have loaded, turn to the page that holds the post we were sent to.
  useEffect(() => {
    if (!focusId || focused.current || !items) return;
    focused.current = true;
    const index = items.findIndex((i) => i.id === focusId);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
  }, [focusId, items]);

  const pageCount = Math.max(Math.ceil(matching.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, pageCount); // Deleting the last post on a page steps back one.
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = matching.slice(firstIndex, firstIndex + PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold">Save a post</h2>
        <p className="mt-2 text-sm leading-relaxed opacity-70">
          Paste a link to a public Instagram post (reel, video, photo or carousel) or a YouTube Short. The app downloads
          the videos and pictures, keeps the caption and details, and writes down what is said in any video.
        </p>
        <form onSubmit={save} className="mt-4 flex flex-wrap gap-3">
          <input
            type="url"
            aria-label="Post link"
            className={`${fieldClass} min-w-0 flex-1`}
            placeholder="Instagram or YouTube Shorts link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className={primaryButton} disabled={saving || !url.trim()}>
            {saving ? "Saving…" : "Save post"}
          </button>
        </form>
        {saving && (
          <p className="mt-3 text-sm opacity-60">
            Downloading. This can take a minute. The very first save also sets up the download tools, which can take a few minutes.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {hasDeepgram === false && (
          <p className="mt-4 rounded-xl bg-[var(--tint)] p-3 text-sm">
            <span className="opacity-80">
              Videos are saved without a transcript until you add a Deepgram API key.{" "}
            </span>
            <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={onOpenSettings}>
              Open settings
            </button>
          </p>
        )}
      </section>

      {items && items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[var(--line)] p-8 text-center opacity-70">
          Nothing saved yet.
        </p>
      )}

      {items && items.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
            <h2 className="font-display text-lg font-semibold">
              Saved posts{" "}
              <span className="font-sans text-sm font-normal opacity-60">
                · {platform === "all" ? items.length : `${matching.length} of ${items.length}`}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-4">
              <AnalyseAll items={items} onChange={replace} />
              <label className="flex items-center gap-2 text-sm">
                <span className="opacity-60">Platform</span>
                <select
                  className={`${fieldClass} !w-auto !py-1.5`}
                  value={platform}
                  onChange={(e) => {
                    setPlatform(e.target.value as ResearchPlatform | "all");
                    setPage(1);
                  }}
                >
                  <option value="all">All platforms</option>
                  {(Object.keys(PLATFORM_LABELS) as ResearchPlatform[]).map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="opacity-60">Sort by</span>
                <select
                  className={`${fieldClass} !w-auto !py-1.5`}
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as Sort);
                    setPage(1);
                  }}
                >
                  <option value="saved">Newest saved</option>
                  <option value="rating">Highest rated</option>
                  <option value="likes">Most liked</option>
                </select>
              </label>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] font-mono text-xs uppercase tracking-widest opacity-60">
                  <th className="w-[36%] px-5 py-3 font-normal">Post</th>
                  <th className="w-[9%] px-3 py-3 font-normal">Likes</th>
                  <th className="w-[11%] px-3 py-3 font-normal">Comments</th>
                  <th className="w-[136px] px-3 py-3 font-normal">Rating</th>
                  <th className="px-3 py-3 font-normal">Note</th>
                  <th className="w-[64px] px-5 py-3 font-normal" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center opacity-60">
                      No saved posts from this platform.
                    </td>
                  </tr>
                )}
                {pageItems.map((item) => (
                  <ResearchRow
                    key={item.id}
                    item={item}
                    open={openId === item.id}
                    onToggle={() => setOpenId(openId === item.id ? null : item.id)}
                    canTranscribe={hasDeepgram === true}
                    onChange={replace}
                    onDelete={() => setPendingDelete(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {matching.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3 text-sm">
              <p className="opacity-60">
                Showing {firstIndex + 1}–{firstIndex + pageItems.length} of {matching.length}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={quietButton}
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span className="tabular-nums opacity-80">
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  className={quietButton}
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
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
const PAGE_SIZE = 10;

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
                {item.analysis && " · analysed"}
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
