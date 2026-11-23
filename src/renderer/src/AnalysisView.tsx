import { useRef, useState, type ReactNode } from "react";
import { formatUsd, type PostAnalysis } from "@shared/analysis";
import type { ResearchItem } from "@shared/research";
import { api } from "./api";

const quietButton =
  "rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium hover:border-[var(--ink)] disabled:opacity-50";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";

/** What one analysis costs when nothing has been analysed yet to average from. */
const DEFAULT_COST = 0.07;

/** The typical cost of analysing one post, from the posts analysed so far. */
export function costPerPost(items: ResearchItem[]): number {
  const costs = items.flatMap((i) => (i.analysis ? [i.analysis.costUsd] : []));
  return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : DEFAULT_COST;
}

/** Claude's breakdown of one post, or a button to get it. */
export function PostAnalysisBlock({ item, onChange }: { item: ResearchItem; onChange: (item: ResearchItem) => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function analyse() {
    setWorking(true);
    setError("");
    const result = await api.analyzeResearch(item.id);
    setWorking(false);
    if (result.ok) onChange(result.item);
    else setError(result.error);
  }

  const { analysis } = item;
  // A transcript added after the analysis means there is now more to analyse.
  const stale = analysis && !analysis.usedTranscript && item.transcript !== "";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-widest opacity-60">Analysis</p>
        {analysis && (
          <button type="button" className="text-xs underline opacity-60 hover:opacity-100" disabled={working} onClick={analyse}>
            {working ? "Analysing…" : "Analyse again"}
          </button>
        )}
      </div>

      {!analysis ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm">
          <span className="opacity-60">Not analysed yet.</span>
          <button type="button" className={quietButton} disabled={working} onClick={analyse}>
            {working ? "Analysing… about 15 seconds" : `Analyse this post (about ${formatUsd(DEFAULT_COST)})`}
          </button>
        </div>
      ) : (
        <AnalysisDetails analysis={analysis} />
      )}

      {stale && (
        <p className="mt-2 text-sm text-[var(--accent)]">
          This was analysed before the video had a transcript. Analyse again for a fuller result.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function AnalysisDetails({ analysis }: { analysis: PostAnalysis }) {
  const stats = [
    analysis.durationSeconds != null && `${Math.round(analysis.durationSeconds)} seconds`,
    analysis.cuts != null && `${analysis.cuts} cuts`,
    analysis.wordsPerMinute != null && `${analysis.wordsPerMinute} words a minute`,
  ].filter(Boolean);

  return (
    <div className="mt-1.5 space-y-4 rounded-xl bg-[var(--bg)] p-4 text-sm leading-relaxed">
      <p>{analysis.summary}</p>

      <div className="flex flex-wrap gap-2">
        <Tag>{analysis.format}</Tag>
        {analysis.style && <Tag>{analysis.style}</Tag>}
        <Tag>{analysis.hookType} hook</Tag>
        <Tag>{analysis.emotion}</Tag>
        {stats.map((s) => (
          <Tag key={String(s)} quiet>
            {s}
          </Tag>
        ))}
      </div>

      {analysis.style && (
        <Part title="Visual style">
          <p>
            <span className="font-medium">{analysis.style}.</span> {analysis.styleNotes}
          </p>
        </Part>
      )}

      <Part title="The hook">
        <dl className="space-y-1.5">
          <Line label="Says">{analysis.spokenHook ? `“${analysis.spokenHook}”` : "Nothing is spoken."}</Line>
          <Line label="Shows">{analysis.visualHook || "Not described."}</Line>
          <Line label="On-screen text">{analysis.openingText ? `“${analysis.openingText}”` : "None."}</Line>
        </dl>
      </Part>

      <Part title="What happens">
        <ol className="list-decimal space-y-1 pl-5">
          {analysis.beats.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ol>
        {analysis.cta && (
          <p className="mt-2">
            <span className="opacity-60">Closing ask: </span>
            {analysis.cta}
          </p>
        )}
      </Part>

      <Part title="Why it works">
        <ul className="list-disc space-y-1 pl-5">
          {analysis.whyItWorks.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </Part>

      <Part title="Reusable structure">
        <ol className="list-decimal space-y-1 pl-5">
          {analysis.skeleton.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </Part>

      <p className="text-xs opacity-50">
        Based on {analysis.framesUsed} {analysis.framesUsed === 1 ? "frame" : "frames"}
        {analysis.usedTranscript ? ", the transcript" : ""} and the caption · cost about {formatUsd(analysis.costUsd)} ·{" "}
        {new Date(analysis.analyzedAt).toLocaleDateString()}
      </p>
    </div>
  );
}

/**
 * Analyses every post that has not been analysed yet, two at a time, showing
 * progress. Each finished post is saved straight away, so stopping part-way
 * loses nothing.
 */
export function AnalyseAll({ items, onChange }: { items: ResearchItem[]; onChange: (item: ResearchItem) => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [lastError, setLastError] = useState("");
  const stop = useRef(false);

  const pending = items.filter((i) => !i.analysis);
  if (pending.length === 0 && !progress) return null;

  async function run() {
    const queue = [...pending];
    const total = queue.length;
    let done = 0;
    let failed = 0;
    stop.current = false;
    setLastError("");
    setProgress({ done, total, failed });

    const worker = async () => {
      while (!stop.current) {
        const next = queue.shift();
        if (!next) return;
        const result = await api.analyzeResearch(next.id).catch(() => ({ ok: false as const, error: "The request failed." }));
        if (result.ok) onChange(result.item);
        else {
          failed++;
          setLastError(result.error);
          // A rejected key or missing key will fail for every post, so stop early.
          if (/API key/i.test(result.error)) stop.current = true;
        }
        done++;
        setProgress({ done, total, failed });
      }
    };
    await Promise.all([worker(), worker()]);
    setProgress(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {progress ? (
        <>
          <span className="text-sm tabular-nums opacity-80">
            Analysing {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </span>
          <button type="button" className={quietButton} onClick={() => (stop.current = true)}>
            Stop
          </button>
        </>
      ) : (
        <button type="button" className={primaryButton} onClick={run}>
          Analyse {pending.length} {pending.length === 1 ? "post" : "posts"} (about{" "}
          {formatUsd(pending.length * costPerPost(items))})
        </button>
      )}
      {lastError && (
        <span role="alert" className="text-sm font-medium text-red-400">
          {lastError}
        </span>
      )}
    </div>
  );
}

function Tag({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span className={`rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs ${quiet ? "opacity-60" : "font-medium"}`}>
      {children}
    </span>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-xs uppercase tracking-widest opacity-60">{title}</p>
      {children}
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 opacity-60">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
