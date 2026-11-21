import { useEffect, useState, type ReactNode } from "react";
import type { BrandKit } from "@shared/brand";
import type { Idea } from "@shared/ideas";
import { api } from "./api";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function Dashboard({
  brand,
  onOpenIdeas,
  onOpenBrand,
}: {
  brand: BrandKit;
  onOpenIdeas: () => void;
  onOpenBrand: () => void;
}) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);

  useEffect(() => {
    api.listIdeas().then(setIdeas);
  }, []);

  if (!ideas) return null;

  const thisWeek = ideas.filter((i) => Date.now() - new Date(i.createdAt).getTime() < WEEK_MS).length;
  const withScript = ideas.filter((i) => i.script).length;
  const progress: [string, number][] = [
    ["Saved ideas", ideas.length],
    ["With a script", withScript],
  ];
  const coveredPillars = brand.pillars.filter((p) => ideas.some((i) => i.pillar === p.title));
  const uncovered = brand.pillars.filter((p) => !coveredPillars.includes(p));
  const withBio = brand.platforms.filter((p) => p.bio).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Saved ideas"
          value={ideas.length}
          badge={`+${thisWeek} this week`}
          headline={ideas.length === 0 ? "No ideas saved yet" : `${ideas.length - withScript} without a script`}
          detail="Every idea you have kept"
        />
        <StatCard
          label="Scripts"
          value={withScript}
          badge={ideas.length ? `${Math.round((withScript / ideas.length) * 100)}% of ideas` : "0% of ideas"}
          headline={withScript === 0 ? "No scripts written yet" : "Ready to film"}
          detail="Ideas with a written script"
        />
        <StatCard
          label="Pillars covered"
          value={`${coveredPillars.length}/${brand.pillars.length}`}
          badge={uncovered.length ? `${uncovered.length} without ideas` : "All covered"}
          headline={uncovered.length ? `Missing: ${uncovered[0].title}` : "Every pillar has an idea"}
          detail="Content pillars with at least one idea"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Content pipeline" className="lg:col-span-2">
          {ideas.length === 0 ? (
            <Empty action="Suggest video ideas" onAction={onOpenIdeas}>
              Your pipeline is empty. Get your first batch of video ideas.
            </Empty>
          ) : (
            <div className="space-y-4">
              {progress.map(([name, n]) => {
                return (
                  <div key={name}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="font-medium">{name}</span>
                      <span className="font-mono opacity-60">{n}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--tint)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{ width: `${(n / ideas.length) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Brand" action="Open brand" onAction={onOpenBrand}>
          <dl className="space-y-3 text-sm">
            <Row label="Topics">{brand.topics.join(", ") || "None"}</Row>
            <Row label="Content pillars">{brand.pillars.length}</Row>
            <Row label="Voice traits">{brand.voice.length}</Row>
            <Row label="Platforms">
              {brand.platforms.length} ({withBio} with a bio)
            </Row>
          </dl>
        </Panel>
      </div>

      <Panel title="Latest ideas" action="All video ideas" onAction={onOpenIdeas}>
        {ideas.length === 0 ? (
          <p className="text-sm opacity-60">Ideas you save will appear here.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {ideas.slice(0, 5).map((idea) => (
              <li key={idea.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{idea.title}</p>
                  <p className="truncate text-sm opacity-60">
                    {[idea.pillar, idea.platform].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {idea.score != null && (
                  <span className="shrink-0 rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs font-medium">
                    Score {idea.score}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function StatCard({
  label,
  value,
  badge,
  headline,
  detail,
}: {
  label: string;
  value: ReactNode;
  badge: string;
  headline: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm opacity-60">{label}</p>
        <span className="shrink-0 rounded-full border border-[var(--line)] px-2 py-0.5 text-xs font-medium">
          {badge}
        </span>
      </div>
      <p className="mt-2 font-display text-4xl font-bold tabular-nums">{value}</p>
      <p className="mt-5 truncate text-sm font-semibold">{headline}</p>
      <p className="mt-1 text-sm opacity-60">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  action,
  onAction,
  className = "",
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {action && (
          <button type="button" onClick={onAction} className="text-sm font-medium text-[var(--accent)] hover:underline">
            {action} →
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="opacity-60">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Empty({ action, onAction, children }: { action: string; onAction: () => void; children: ReactNode }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm opacity-70">{children}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        {action}
      </button>
    </div>
  );
}
