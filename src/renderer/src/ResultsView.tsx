import { useState, type FormEvent } from "react";
import type { Idea, PostCheck } from "@shared/ideas";
import { api } from "./api";

const label = "font-mono text-xs uppercase tracking-widest opacity-60";
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number | null) => (n === null ? "–" : compact.format(n));

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / (60 * 24));
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The latest numbers of an idea's published video, or null if it has none. */
export const latestCheck = (idea: Idea): PostCheck | null => idea.posted?.checks.at(-1) ?? null;

/** How a saved idea did once posted: link your video, then its numbers over time. */
export function ResultsSection({ idea, onChange }: { idea: Idea; onChange: (idea: Idea) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  async function act(request: Promise<{ ok: true; idea: Idea } | { ok: false; error: string }>) {
    setError("");
    setBusy(true);
    try {
      const result = await request;
      if (result.ok) onChange(result.idea);
      else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const posted = idea.posted;
  const first = posted?.checks[0];
  const last = posted?.checks.at(-1);
  const gained = (pick: (c: PostCheck) => number | null) => {
    if (!first || !last || first === last) return "";
    const a = pick(first);
    const b = pick(last);
    if (a === null || b === null || b === a) return "";
    return ` (${b > a ? "+" : "−"}${compact.format(Math.abs(b - a))})`;
  };

  return (
    <div className="mt-4 border-t border-[var(--line)] pt-4 text-sm">
      <p className={label}>Results</p>
      {!posted ? (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (url.trim()) void act(api.trackIdea(idea.id, url));
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            placeholder="Posted it? Paste the link to your video"
            aria-label="Link to your posted video"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:border-[var(--primary)] disabled:opacity-50"
          >
            {busy ? "Reading numbers…" : "Track"}
          </button>
        </form>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-2">
            {(
              [
                ["Likes", (c: PostCheck) => c.likes],
                ["Comments", (c: PostCheck) => c.comments],
                ["Views", (c: PostCheck) => c.views],
              ] as const
            ).map(([name, pick]) => (
              <div key={name} className="rounded-xl bg-[var(--tint)] p-3">
                <dt className="text-xs opacity-60">{name}</dt>
                <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums">
                  {last ? fmt(pick(last)) : "–"}
                  <span className="block h-4 font-sans text-xs font-normal opacity-60">{gained(pick).trim()}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 opacity-70">
            <span>
              {posted.platform}
              {last && ` · checked ${ago(last.at)}`}
              {posted.checks.length > 1 && ` · change since ${new Date(first!.at).toLocaleDateString()}`}
            </span>
            <button
              type="button"
              className="underline hover:opacity-100 disabled:opacity-40"
              disabled={busy}
              onClick={() => act(api.checkIdea(idea.id))}
            >
              {busy ? "Checking…" : "Check now"}
            </button>
            {posted.checks.length > 1 && (
              <button type="button" className="underline" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? "Hide history" : `History (${posted.checks.length})`}
              </button>
            )}
            <button
              type="button"
              className="underline hover:text-red-400 disabled:opacity-40"
              disabled={busy}
              onClick={() => act(api.trackIdea(idea.id, ""))}
            >
              Remove link
            </button>
          </p>
          {showHistory && (
            <table className="mt-3 w-full text-left tabular-nums">
              <thead className="text-xs opacity-60">
                <tr>
                  <th className="py-1 font-normal">Checked</th>
                  <th className="py-1 font-normal">Likes</th>
                  <th className="py-1 font-normal">Comments</th>
                  <th className="py-1 font-normal">Views</th>
                </tr>
              </thead>
              <tbody>
                {[...posted.checks].reverse().map((c) => (
                  <tr key={c.at} className="border-t border-[var(--line)]">
                    <td className="py-1">{new Date(c.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="py-1">{fmt(c.likes)}</td>
                    <td className="py-1">{fmt(c.comments)}</td>
                    <td className="py-1">{fmt(c.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
