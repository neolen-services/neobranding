// One series: its episodes down the middle, where the work is, and the plan, cast and story so far beside them.
import { useEffect, useState } from "react";
import type { BrandKit } from "@shared/brand";
import type { Idea } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import { productionLabel, type Character, type Series, type Video } from "@shared/studio";
import { api } from "./api";
import { DeleteButton } from "./CastView";
import { IdeaStage } from "./IdeaStage";
import { card, Chip, fieldClass, Icon, ICONS, label, postName, primaryButton, ProductionPicker, ProgressBars, smallButton, videoProgress } from "./studioUi";

export function SeriesPage({
  series,
  cast,
  brand,
  ideas,
  posts,
  videos,
  onBack,
  onChange,
  onOpenVideo,
  onDelete,
  onOpenCast,
  autoSuggest,
}: {
  /** Ask Claude for ideas on arrival: the series was just started from the New dialog. */
  autoSuggest?: boolean;
  series: Series;
  cast: Character[];
  brand: BrandKit;
  ideas: Idea[];
  posts: ResearchItem[];
  /** The episodes of this series that have been started. */
  videos: Video[];
  onBack: () => void;
  onChange: (series: Series) => void;
  onOpenVideo: (video: Video) => void;
  onDelete: () => Promise<void>;
  onOpenCast: () => void;
}) {
  const [draft, setDraft] = useState(series);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(0);
  const [planning, setPlanning] = useState(false);
  useEffect(() => setDraft(series), [series]);

  async function save(next: Series) {
    setError("");
    const result = await api.saveSeries(next);
    if (result.ok) onChange(result.value);
    else setError(result.error);
  }
  const saveIfChanged = () => JSON.stringify(draft) !== JSON.stringify(series) && void save(draft);

  async function start(number: number) {
    setStarting(number);
    setError("");
    const result = await api.createVideo({ seriesId: series.id, episode: number });
    setStarting(0);
    if (result.ok) onOpenVideo(result.value);
    else setError(result.error);
  }

  async function planSeason() {
    setPlanning(true);
    setError("");
    try {
      const result = await api.planSeason(series.id);
      if (result.ok) onChange(result.value);
      else setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The season could not be planned.");
    } finally {
      setPlanning(false);
    }
  }

  const members = cast.filter((c) => series.characterIds.includes(c.id));
  const others = cast.filter((c) => !series.characterIds.includes(c.id));
  const fromIdeas = series.ideaIds.map((id) => ideas.find((i) => i.id === id)?.title).filter(Boolean);
  const inspired = series.postIds.map((id) => posts.find((p) => p.id === id)).filter((p) => p !== undefined).map(postName);
  const approved = videos.filter((v) => v.approvedAt).length;
  // The first episode not yet started is the obvious one to start next.
  const nextToStart = series.episodes.findIndex((_, i) => !videos.some((v) => v.episode === i + 1)) + 1;
  const plan: [keyof Pick<Series, "premise" | "question" | "ending">, string][] = [
    ["premise", "Premise"],
    ["question", "The running question"],
    ["ending", "How the season ends"],
  ];

  // No season yet: the idea is settled first, then Claude plans the episodes from it.
  if (series.episodes.length === 0) {
    return (
      <div>
        <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
            <button type="button" aria-label="Back to all series" title="All series" className="rounded-full border border-[var(--line)] p-2 hover:border-[var(--ink)]" onClick={onBack}>
              <Icon d={ICONS.back} />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-xl font-semibold">{series.title}</h2>
              <p className="truncate text-sm opacity-60">
                Series · {productionLabel(series.production)} · {series.ideaApprovedAt ? "idea approved, season not planned yet" : "idea not settled yet"}
              </p>
            </div>
            <DeleteButton name="this series" onConfirm={onDelete} />
          </div>
        </div>
        <div className="mx-auto max-w-6xl space-y-5 p-6">
          {error && (
            <p role="alert" className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
              {error}
            </p>
          )}
          <section className={`${card} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-lg font-semibold">What you asked for</h3>
              <ProductionPicker compact value={series.production} onChange={(production) => void save({ ...series, production })} />
            </div>
            <textarea
              className={fieldClass}
              rows={3}
              aria-label="What the series is about"
              placeholder="What the series is, who it is for, and anything it must include."
              value={draft.brief}
              onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
              onBlur={saveIfChanged}
            />
            {fromIdeas.length > 0 && <p className="text-sm opacity-60">From your {fromIdeas.length === 1 ? "idea" : `${fromIdeas.length} ideas`}: {fromIdeas.join(" · ")}</p>}
            {inspired.length > 0 && <p className="text-sm opacity-60">Inspired by {inspired.length === 1 ? "a saved post" : `${inspired.length} saved posts`}: {inspired.join(" · ")}</p>}
          </section>
          <IdeaStage
            kind="series"
            item={series}
            settled={series.ideaApprovedAt !== ""}
            autoStart={autoSuggest}
            onChange={(item) => onChange(item as Series)}
            next={
              <button type="button" className={primaryButton} disabled={planning} onClick={() => void planSeason()}>
                {planning ? "Planning the season… about 30 seconds" : "Plan the season (a few cents)"}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <button type="button" aria-label="Back to all series" title="All series" className="rounded-full border border-[var(--line)] p-2 hover:border-[var(--ink)]" onClick={onBack}>
            <Icon d={ICONS.back} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl font-semibold">{series.title}</h2>
            <p className="truncate text-sm opacity-60">
              Series · {productionLabel(series.production)} · {series.episodes.length} episodes · {videos.length} started · {approved} approved
            </p>
          </div>
          <DeleteButton name="this series" onConfirm={onDelete} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 p-6">
        {error && (
          <p role="alert" className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
            {error}
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className={`${card} h-fit !p-0`}>
            <div className="border-b border-[var(--line)] px-5 py-4">
              <h3 className="font-display text-lg font-semibold">Episodes</h3>
              <p className="mt-0.5 text-sm opacity-60">Make the first three, post them, and only carry on if the saves and follows justify it.</p>
            </div>
            <ol className="divide-y divide-[var(--line)]">
              {series.episodes.map((episode, i) => {
                const number = i + 1;
                const video = videos.find((v) => v.episode === number);
                const progress = video ? videoProgress(video, cast, brand) : null;
                return (
                  <li key={i} className="grid gap-x-5 gap-y-3 px-5 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full font-display text-sm font-semibold ${
                        progress?.done === 5 ? "bg-[var(--primary)] text-white" : video ? "border border-[var(--primary)]" : "border border-[var(--line)] opacity-60"
                      }`}
                    >
                      {progress?.done === 5 ? <Icon d={ICONS.check} /> : number}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{episode.teaches}</p>
                      <p className="mt-0.5 text-sm opacity-60">Ends on: {episode.endsOn}</p>
                      {progress && (
                        <p className="mt-2 flex flex-wrap items-center gap-2.5 text-xs">
                          <ProgressBars done={progress.done} />
                          <span className={progress.waiting ? "text-[var(--accent)]" : "opacity-60"}>{progress.next}</span>
                        </p>
                      )}
                    </div>
                    {video ? (
                      <button type="button" className={`${smallButton} flex items-center gap-1.5`} onClick={() => onOpenVideo(video)}>
                        Open
                        <Icon d={ICONS.arrow} className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button type="button" className={number === nextToStart ? `${primaryButton} !px-4 !py-1.5` : smallButton} disabled={starting !== 0} onClick={() => start(number)}>
                        {starting === number ? "Starting…" : "Start episode"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <aside className="space-y-5">
            <section className={card}>
              <p className={`${label} mb-2`}>How it is made</p>
              <ProductionPicker compact value={series.production} onChange={(production) => void save({ ...series, production })} />
              <p className="mt-2 text-xs opacity-60">Episodes you start from now on follow this. One already started keeps its own setting.</p>
              {series.ideaIds.length > 0 && (
                <p className="mt-3 border-t border-[var(--line)] pt-3 text-sm">
                  <span className="opacity-60">Planned from your ideas: </span>
                  {fromIdeas.join(" · ") || "(since deleted)"}
                </p>
              )}
            </section>

            <section className={`${card} space-y-4`}>
              <p className={label}>The plan</p>
              {plan.map(([key, name]) => (
                <label key={key} className="block text-sm">
                  <span className="font-medium">{name}</span>
                  <textarea className={`${fieldClass} mt-1`} rows={3} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} onBlur={saveIfChanged} />
                </label>
              ))}
            </section>

            <section className={card}>
              <div className="flex items-center justify-between gap-2">
                <p className={label}>Cast</p>
                <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={onOpenCast}>
                  Open the cast
                </button>
              </div>
              <p className="mt-2 text-sm opacity-60">
                {series.production === "ai"
                  ? "You do not appear. These characters carry every episode."
                  : series.production === "me"
                    ? "You film this series alone, so its episodes are written without characters."
                    : "You are always the host. These characters are available to every episode."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {members.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5 rounded-full bg-[var(--tint)] py-1 pl-3 pr-1.5 text-sm font-medium">
                    {c.name}
                    {!c.voice && <Chip tone="warn">no voice</Chip>}
                    <button
                      type="button"
                      aria-label={`Take ${c.name} out of this series`}
                      title="Take out of this series"
                      className="rounded-full p-0.5 opacity-60 hover:opacity-100"
                      onClick={() => void save({ ...series, characterIds: series.characterIds.filter((id) => id !== c.id) })}
                    >
                      <Icon d={ICONS.close} className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {others.length > 0 && (
                  <select
                    aria-label="Add a character to this series"
                    className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                    value=""
                    onChange={(e) => e.target.value && void save({ ...series, characterIds: [...series.characterIds, e.target.value] })}
                  >
                    <option value="">Add a character…</option>
                    {others.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </section>

            <section className={card}>
              <p className={label}>Story so far</p>
              {series.storySoFar.length === 0 ? (
                <p className="mt-2 text-sm opacity-60">Nothing yet. When you approve an episode's script, what happened in it is added here, and the next episode is written knowing it.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {series.storySoFar.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
