// Studio's home: every video and series with where it stands and what to do next, one way to start something new, and the list of scenes to film.
import { createContext, useContext, useEffect, useState, type FormEvent } from "react";
import type { BrandKit } from "@shared/brand";
import { ideaKind, type Idea } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import { pickedClip, pickedPicture, productionLabel, type Character, type NewVideo, type Series, type Video } from "@shared/studio";
import { api } from "./api";
import { SeriesPage } from "./SeriesPage";
import { card, Chip, Dialog, Icon, ICONS, IdeaPicker, label, primaryButton, ProgressBars, quietButton, STAGES, videoProgress } from "./studioUi";
import { VideoPage } from "./VideoPage";

/** Opens a video in Studio from anywhere in the app. Provided by the app shell. */
export const OpenVideoContext = createContext<(videoId: string) => void>(() => undefined);

/** Starts a video from an idea or a saved post and opens it in Studio. */
export function MakeVideoButton({ from, label: text, note, series }: { from: NewVideo; label: string; note?: string; /** Start a series from the idea instead of a single video. */ series?: boolean }) {
  const openVideo = useContext(OpenVideoContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={quietButton}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            // Studio opens whichever it is by its id.
            const result = series ? await api.createSeries({ ideaIds: from.ideaId ? [from.ideaId] : from.ideaIds, production: from.production }) : await api.createVideo(from);
            if (result.ok) openVideo(result.value.id);
            else setError(result.error);
          } catch {
            setError(series ? "The series could not be started." : "The video could not be started.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Starting…" : text}
      </button>
      {error ? (
        <span role="alert" className="text-sm font-medium text-red-400">
          {error}
        </span>
      ) : (
        note && <span className="text-sm opacity-60">{note}</span>
      )}
    </span>
  );
}

type Tab = "videos" | "series" | "filming";
type Open = { kind: "video" | "series"; id: string } | null;

export function StudioView({
  brand,
  focusId,
  onOpenSettings,
  onOpenCast,
  onOpenBrand,
}: {
  brand: BrandKit;
  /** A video to open on arrival. */
  focusId?: string;
  onOpenSettings: () => void;
  onOpenCast: () => void;
  onOpenBrand: () => void;
}) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [cast, setCast] = useState<Character[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [posts, setPosts] = useState<ResearchItem[]>([]);
  const [tab, setTab] = useState<Tab>("videos");
  const [open, setOpen] = useState<Open>(focusId ? { kind: "video", id: focusId } : null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    const [v, s, c, i, p] = await Promise.all([api.listVideos(), api.listSeries(), api.listCast(), api.listIdeas(), api.listResearch()]);
    setVideos(v);
    setSeries(s);
    setCast(c);
    setIdeas(i);
    setPosts(p);
  };
  useEffect(() => {
    void reload();
  }, []);

  if (!videos) return null;

  const putVideo = (video: Video) => setVideos((list) => [video, ...(list ?? []).filter((v) => v.id !== video.id)]);
  const openVideo = videos.find((v) => v.id === open?.id);
  const openSeries = series.find((s) => s.id === open?.id);

  if (openVideo) {
    return (
      <VideoPage
        key={openVideo.id}
        video={openVideo}
        cast={cast}
        brand={brand}
        ideas={ideas}
        posts={posts}
        series={series.find((s) => s.id === openVideo.seriesId)}
        onBack={() => setOpen(openVideo.seriesId ? { kind: "series", id: openVideo.seriesId } : null)}
        // A script can add characters and extend a series' story, so everything is read again.
        onChange={(video) => {
          putVideo(video);
          void reload();
        }}
        onDelete={async () => {
          await api.deleteVideo(openVideo.id);
          setOpen(null);
          void reload();
        }}
        onOpenSettings={onOpenSettings}
        onOpenBrand={onOpenBrand}
        onCast={(changed) => setCast((list) => list.map((c) => (c.id === changed.id ? changed : c)))}
      />
    );
  }

  if (openSeries) {
    return (
      <SeriesPage
        key={openSeries.id}
        series={openSeries}
        cast={cast}
        brand={brand}
        ideas={ideas}
        posts={posts}
        videos={videos.filter((v) => v.seriesId === openSeries.id)}
        onBack={() => {
          setTab("series");
          setOpen(null);
        }}
        // Planning a season can add characters, so everything is read again.
        onChange={(saved) => {
          setSeries((list) => list.map((s) => (s.id === saved.id ? saved : s)));
          void reload();
        }}
        onOpenVideo={(video) => {
          putVideo(video);
          setOpen({ kind: "video", id: video.id });
        }}
        onDelete={async () => {
          await api.deleteSeries(openSeries.id);
          setOpen(null);
          void reload();
        }}
        onOpenCast={onOpenCast}
      />
    );
  }

  const toFilm = videos.filter((v) => v.approvedAt).reduce((n, v) => n + v.scenes.filter((s) => s.madeBy === "me" && !pickedClip(s)).length, 0);
  const tabs: [Tab, string, number][] = [
    ["videos", "Videos", videos.length],
    ["series", "Series", series.length],
    ["filming", "To film", toFilm],
  ];
  const withProgress = videos.map((video) => ({ video, progress: videoProgress(video, cast, brand) }));
  const active = withProgress.filter((v) => v.progress.done < STAGES.length);
  const posted = withProgress.filter((v) => v.progress.done === STAGES.length);
  const empty = videos.length === 0 && series.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Studio" className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface)] p-1">
          {tabs.map(([name, text, count]) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${tab === name ? "bg-[var(--tint)]" : "opacity-60 hover:opacity-100"}`}
            >
              {text}
              <span className="text-xs tabular-nums opacity-60">{count}</span>
            </button>
          ))}
        </div>
        <button type="button" className={`${primaryButton} flex items-center gap-2`} onClick={() => setCreating(true)}>
          <Icon d={ICONS.plus} />
          New video or series
        </button>
      </div>

      {empty && tab !== "filming" ? (
        <div className={`${card} flex flex-col items-center px-6 py-14 text-center`}>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tint)]">
            <Icon d={ICONS.film} className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold">Make your first video</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed opacity-65">
            Pick one of your saved ideas and Studio takes it from script to scenes. The idea already says whether it is a single video or a series, and how it is made.
          </p>
          <button type="button" className={`${primaryButton} mt-5`} onClick={() => setCreating(true)}>
            New video or series
          </button>
        </div>
      ) : (
        <>
          {tab === "videos" && (
            <>
              {videos.length === 0 && <p className="text-sm opacity-60">No videos yet. A series' episodes appear here once you start them.</p>}
              {active.length > 0 && (
                <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {active.map(({ video, progress }) => (
                    <VideoCard key={video.id} video={video} progress={progress} series={series.find((s) => s.id === video.seriesId)} onOpen={() => setOpen({ kind: "video", id: video.id })} />
                  ))}
                </ul>
              )}
              {posted.length > 0 && (
                <section>
                  <h2 className={`${label} mb-3`}>Posted</h2>
                  <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {posted.map(({ video, progress }) => (
                      <VideoCard key={video.id} video={video} progress={progress} series={series.find((s) => s.id === video.seriesId)} onOpen={() => setOpen({ kind: "video", id: video.id })} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {tab === "series" && (
            <>
              {series.length === 0 && <p className="text-sm opacity-60">No series yet. A series is a season of episodes with one running question.</p>}
              <ul className="grid gap-4 md:grid-cols-2">
                {series.map((s) => (
                  <SeriesCard key={s.id} series={s} videos={videos.filter((v) => v.seriesId === s.id)} onOpen={() => setOpen({ kind: "series", id: s.id })} />
                ))}
              </ul>
            </>
          )}

          {tab === "filming" && <FilmingList videos={videos} onOpen={(id) => setOpen({ kind: "video", id })} />}
        </>
      )}

      {creating && (
        <NewDialog
          ideas={ideas}
          used={new Set([...videos, ...series].flatMap((x) => x.ideaIds))}
          onClose={() => setCreating(false)}
          onVideo={(video) => {
            putVideo(video);
            setCreating(false);
            setOpen({ kind: "video", id: video.id });
          }}
          onSeries={async (planned) => {
            await reload();
            setCreating(false);
            setOpen({ kind: "series", id: planned.id });
          }}
        />
      )}
    </div>
  );
}

/** One video in the list: what it looks like so far, how far it has got, and the next thing to do. */
function VideoCard({ video, progress, series, onOpen }: { video: Video; progress: ReturnType<typeof videoProgress>; series?: Series; onOpen: () => void }) {
  const picture = video.scenes.map(pickedPicture).find(Boolean);
  const seconds = video.scenes.reduce((n, s) => n + s.seconds, 0);
  const meta = [video.format === "episode" ? `Episode ${video.episode ?? ""}` : "", video.source === "remake" ? "Remake" : "", productionLabel(video.production), seconds ? `${seconds}s` : ""].filter(Boolean);
  return (
    <li>
      <button type="button" onClick={onOpen} className="group flex h-full w-full gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 text-left shadow-sm hover:border-[var(--primary)]">
        <span className={`flex aspect-[9/16] w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl ${picture ? "bg-black" : "bg-[var(--tint)] opacity-80"}`}>
          {picture ? <img src={api.studioFileUrl(picture.file)} alt="" className="h-full w-full object-cover" /> : <Icon d={video.production === "me" ? ICONS.camera : video.production === "ai" ? ICONS.ai : ICONS.film} className="h-6 w-6" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col py-1">
          {series && <span className="mb-0.5 truncate text-xs font-medium uppercase tracking-wide opacity-55">{series.title}</span>}
          <span className="line-clamp-2 font-medium leading-snug">{series ? `Episode ${video.episode ?? ""}` : video.title}</span>
          <span className="mt-1 truncate text-xs opacity-60">{(series ? meta.slice(1) : meta).join(" · ")}</span>
          <span className="mt-auto block pt-3">
            <ProgressBars done={progress.done} />
            <span className={`mt-2 flex items-center gap-1.5 text-sm ${progress.waiting ? "font-medium text-[var(--accent)]" : "opacity-60"}`}>
              <span className="truncate">{progress.next}</span>
              {progress.waiting && <Icon d={ICONS.arrow} className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** One series in the list, with a dot for each episode: empty, started, or script approved. */
function SeriesCard({ series, videos, onOpen }: { series: Series; videos: Video[]; onOpen: () => void }) {
  const state = (number: number) => {
    const video = videos.find((v) => v.episode === number);
    return !video ? "none" : video.approvedAt ? "approved" : "started";
  };
  const nextToStart = series.episodes.findIndex((_, i) => state(i + 1) === "none") + 1;
  const waiting = videos.find((v) => !v.approvedAt);
  const next =
    series.episodes.length === 0
      ? "Plan the season"
      : waiting
        ? `Episode ${waiting.episode ?? ""} is waiting for you`
        : nextToStart
          ? `Start episode ${nextToStart}`
          : "Every episode is started";
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex h-full w-full flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 text-left shadow-sm hover:border-[var(--primary)]">
        <span className="flex items-start justify-between gap-3">
          <span className="font-display text-lg font-semibold leading-snug">{series.title}</span>
          <Chip>{productionLabel(series.production)}</Chip>
        </span>
        <span className="mt-1.5 line-clamp-2 text-sm leading-relaxed opacity-65">{series.premise || series.brief}</span>
        <span className="mt-auto flex flex-wrap items-center gap-3 pt-4">
          <span className="flex gap-1.5" role="img" aria-label={`${videos.length} of ${series.episodes.length} episodes started`}>
            {series.episodes.map((_, i) => {
              const s = state(i + 1);
              return <span key={i} title={`Episode ${i + 1}`} className={`h-2.5 w-2.5 rounded-full ${s === "approved" ? "bg-[var(--primary)]" : s === "started" ? "border-2 border-[var(--primary)]" : "bg-[var(--tint)]"}`} />;
            })}
          </span>
          <span className="text-sm font-medium text-[var(--accent)]">{next}</span>
        </span>
      </button>
    </li>
  );
}

/** Everything the creator films themselves, across approved videos, grouped by place so one trip covers several scenes. */
function FilmingList({ videos, onOpen }: { videos: Video[]; onOpen: (videoId: string) => void }) {
  const shots = videos
    .filter((v) => v.approvedAt)
    .flatMap((video) => video.scenes.map((scene, index) => ({ video, scene, index })).filter((s) => s.scene.madeBy === "me"));
  const places = [...new Set(shots.map((s) => s.scene.place || "No place given"))];
  const left = shots.filter((s) => !pickedClip(s.scene)).length;

  if (shots.length === 0) {
    return <p className="text-sm opacity-60">Nothing to film yet. Scenes marked “You film it” appear here once their script is approved.</p>;
  }
  return (
    <div className="space-y-5">
      <p className="text-sm opacity-70">
        {left} of {shots.length} {shots.length === 1 ? "scene" : "scenes"} still to film, grouped by place.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        {places.map((place) => (
          <section key={place} className={`${card} h-fit !p-0`}>
            <h3 className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-3 font-display text-base font-semibold">
              <Icon d={ICONS.camera} />
              {place}
            </h3>
            <ul className="divide-y divide-[var(--line)]">
              {shots
                .filter((s) => (s.scene.place || "No place given") === place)
                .map(({ video, scene, index }) => {
                  const done = Boolean(pickedClip(scene));
                  return (
                    <li key={scene.id} className={`px-5 py-4 text-sm ${done ? "opacity-55" : ""}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button type="button" className="text-xs underline opacity-70 hover:opacity-100" onClick={() => onOpen(video.id)}>
                          {video.title} · scene {index + 1} · {scene.seconds}s
                        </button>
                        {done && <Chip tone="good">Clip added</Chip>}
                      </div>
                      {scene.lines.map((line, i) => (
                        <p key={i} className="mt-2 text-base leading-relaxed">
                          “{line.text}”{line.delivery && <span className="ml-2 text-sm opacity-55">{line.delivery}</span>}
                        </p>
                      ))}
                      <p className="mt-2 opacity-70">
                        {scene.action}
                        {scene.camera && ` Camera: ${scene.camera}.`}
                        {scene.text && ` On screen: “${scene.text}”.`}
                      </p>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Starting something new in Studio: pick one saved idea. The idea already says whether it is a single video or a series, and how it is made. */
function NewDialog({
  ideas,
  used,
  onClose,
  onVideo,
  onSeries,
}: {
  ideas: Idea[];
  /** Ideas already made into a video or series. */
  used: Set<string>;
  onClose: () => void;
  onVideo: (video: Video) => void;
  onSeries: (series: Series) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idea = ideas.find((i) => i.id === picked[0]);
  const isSeries = idea !== undefined && ideaKind(idea) === "series";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!idea) return setError("Pick an idea first.");
    setBusy(true);
    setError("");
    try {
      if (isSeries) {
        const result = await api.createSeries({ ideaIds: [idea.id] });
        if (result.ok) await onSeries(result.value);
        else setError(result.error);
      } else {
        const result = await api.createVideo({ ideaId: idea.id });
        if (result.ok) onVideo(result.value);
        else setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title="New in Studio"
        onClose={onClose}
        locked={busy}
        footer={
          <>
            <p role={error ? "alert" : undefined} className={`mr-auto min-w-0 flex-1 text-sm ${error ? "font-medium text-red-400" : "opacity-60"}`}>
              {error ||
                (idea
                  ? `${isSeries ? "A series" : "A single video"}, ${productionLabel(idea.production ?? "mix").toLowerCase()}. Next: ${isSeries ? "the season plan" : "the script"}.`
                  : "Pick one saved idea. It already says whether it is a single video or a series, and how it is made.")}
            </p>
            <button type="button" className={quietButton} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButton} disabled={busy || !idea}>
              {busy ? "Starting…" : isSeries ? "Start series" : "Start video"}
            </button>
          </>
        }
      >
        {ideas.length === 0 ? (
          <p className="text-sm leading-relaxed opacity-75">No saved ideas yet. Every video and series in Studio starts from one, so write and save ideas on the Ideas page first.</p>
        ) : (
          <IdeaPicker ideas={ideas} picked={picked} onChange={setPicked} used={used} single />
        )}
      </Dialog>
    </form>
  );
}
