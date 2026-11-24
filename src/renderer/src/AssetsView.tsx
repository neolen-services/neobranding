// Everything the app has made: storyboards, clips, voice lines and character pictures.
// One page lists it all, grouped by the video it belongs to; a video's own page shows just
// its own, scene by scene. Each group can be opened as a folder on this computer.
import { useContext, useEffect, useState } from "react";
import type { Take } from "@shared/media";
import type { Character, Scene, Video } from "@shared/studio";
import { api } from "./api";
import { OpenVideoContext } from "./StudioView";
import { card, Chip, Icon, ICONS, primaryButton, quietButton, smallButton } from "./studioUi";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One thing that was made: a picture, a clip or a spoken line. */
type Asset = {
  key: string;
  kind: "picture" | "clip" | "voice";
  /** Where it plays or shows from. */
  url: string;
  /** What it is, in a few words. */
  label: string;
  /** Whether it is the one the scene or character uses now. */
  inUse: boolean;
  madeWith: string;
};

/** Everything made for one scene, in the order it was made. */
function sceneAssets(scene: Scene, index: number): Asset[] {
  const take = (t: Take, kind: "picture" | "clip", n: number, inUse: boolean): Asset => ({
    key: t.id,
    kind,
    url: api.studioFileUrl(t.file),
    label: `Scene ${index + 1} · ${kind === "picture" ? "storyboard" : t.source === "filmed" ? "your clip" : t.source === "lipsync" ? "lip-sync" : "clip"} ${n}`,
    inUse,
    madeWith: t.madeWith,
  });
  return [
    ...scene.pictures.map((t, n) => take(t, "picture", n + 1, t.id === scene.picture)),
    // The full-size first and last frames the clip starts and ends on.
    ...(["first", "last"] as const).flatMap((which): Asset[] => {
      const t = scene.keyframes?.[which];
      return t ? [{ key: t.id, kind: "picture", url: api.studioFileUrl(t.file), label: `Scene ${index + 1} · ${which} frame`, inUse: scene.keyframes?.board === scene.picture, madeWith: t.madeWith }] : [];
    }),
    ...scene.clips.map((t, n) => take(t, "clip", n + 1, t.id === scene.clip)),
    ...scene.lines.flatMap((line, n): Asset[] =>
      line.audioFile ? [{ key: `${scene.id}-line-${n}`, kind: "voice", url: api.audioFileUrl(line.audioFile), label: `Scene ${index + 1} · line ${n + 1}: “${line.text}”`, inUse: true, madeWith: "" }] : [],
    ),
  ];
}
const videoAssets = (video: Video) => video.scenes.flatMap(sceneAssets);
const count = (assets: Asset[]) =>
  [
    [assets.filter((a) => a.kind === "picture").length, "picture"],
    [assets.filter((a) => a.kind === "clip").length, "clip"],
    [assets.filter((a) => a.kind === "voice").length, "voice line"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, name]) => plural(n as number, name as string))
    .join(" · ");

/** A wall of assets. Pictures open larger; clips and voice lines play in place. */
function Wall({ assets }: { assets: Asset[] }) {
  const [zoomed, setZoomed] = useState<Asset | null>(null);
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);
  const seen = assets.filter((a) => a.kind !== "voice");
  const heard = assets.filter((a) => a.kind === "voice");
  return (
    <>
      {seen.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
          {seen.map((a) => (
            <li key={a.key}>
              <div className={`relative aspect-[9/16] overflow-hidden rounded-lg border-2 bg-black ${a.inUse ? "border-[var(--primary)]" : "border-transparent"}`} title={`${a.label}${a.madeWith ? ` · ${a.madeWith}` : ""}${a.inUse ? " · in use" : ""}`}>
                {a.kind === "picture" ? (
                  <button type="button" className="block h-full w-full cursor-zoom-in" aria-label={`Look at ${a.label} larger`} onClick={() => setZoomed(a)}>
                    <img src={a.url} alt={a.label} loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <video controls preload="metadata" src={a.url} className="h-full w-full object-cover" />
                )}
              </div>
              <p className="mt-1 truncate text-xs opacity-60">{a.label.replace(/^Scene (\d+) · /, "$1 · ")}</p>
            </li>
          ))}
        </ul>
      )}
      {heard.length > 0 && (
        <ul className={`space-y-2 ${seen.length > 0 ? "mt-4" : ""}`}>
          {heard.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center gap-3 text-sm">
              <audio controls preload="none" src={a.url} className="h-8 w-56 shrink-0" />
              <span className="min-w-0 flex-1 truncate opacity-75" title={a.label}>
                {a.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {zoomed && (
        <div role="dialog" aria-modal="true" aria-label={zoomed.label} className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6" onClick={() => setZoomed(null)}>
          <img src={zoomed.url} alt={zoomed.label} className="max-h-full max-w-full rounded-xl object-contain" />
          <button type="button" autoFocus className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm font-medium text-white hover:border-white" onClick={() => setZoomed(null)}>
            <Icon d={ICONS.close} className="h-4 w-4" />
            Close
          </button>
        </div>
      )}
    </>
  );
}

const openFolder = (folder: "videos" | "cast" | "audio", id?: string) => void api.openAssetsFolder(folder, id ?? "");

/** One video's assets, scene by scene. Shown from the video's own page. */
export function VideoAssets({ video, onBack }: { video: Video; onBack: () => void }) {
  const all = videoAssets(video);
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-label="Back to the video" title="Back to the video" className="rounded-full border border-[var(--line)] p-2 hover:border-[var(--ink)]" onClick={onBack}>
          <Icon d={ICONS.back} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-semibold">Assets of {video.title}</h2>
          <p className="text-sm opacity-60">{count(all) || "Nothing has been made for this video yet."}</p>
        </div>
        <button type="button" className={`${primaryButton} flex items-center gap-2`} title="Storyboards and clips are kept here. Voice lines are in the audio folder." onClick={() => openFolder("videos", video.id)}>
          <Icon d={ICONS.open} />
          Open the folder
        </button>
        {all.some((a) => a.kind === "voice") && (
          <button type="button" className={quietButton} onClick={() => openFolder("audio")}>
            Open the voice lines folder
          </button>
        )}
      </div>

      {all.length === 0 ? (
        <p className={`${card} text-center text-sm opacity-70`}>Storyboards, clips and voice lines appear here as they are made.</p>
      ) : (
        video.scenes.map((scene, index) => {
          const assets = sceneAssets(scene, index);
          if (assets.length === 0) return null;
          return (
            <section key={scene.id} className={`${card} space-y-3`}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="font-display text-lg font-semibold">Scene {index + 1}</h3>
                <p className="min-w-0 flex-1 truncate text-sm opacity-60">{scene.action}</p>
                <p className="text-xs opacity-55">{count(assets)}</p>
              </div>
              <Wall assets={assets} />
            </section>
          );
        })
      )}
      <p className="text-xs opacity-55">The one each scene uses now has a coloured edge. Earlier attempts are kept until you remove them on the Storyboard or Make tab.</p>
    </div>
  );
}

/** Everything made in the app, grouped by video, with the characters' pictures as a group of their own. */
export function AssetsView() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [cast, setCast] = useState<Character[]>([]);
  /** Groups shown in full; the rest show their first row. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const openVideo = useContext(OpenVideoContext);

  useEffect(() => {
    api.listVideos().then(setVideos).catch(() => setVideos([]));
    api.listCast().then(setCast).catch(() => setCast([]));
  }, []);
  if (!videos) return null;

  const groups = videos.map((video) => ({ video, assets: videoAssets(video) })).filter((g) => g.assets.length > 0);
  const people = cast.filter((c) => c.pictures.length > 0 || c.sheet);
  const total = groups.reduce((n, g) => n + g.assets.length, 0) + people.reduce((n, c) => n + c.pictures.length + (c.sheet ? 1 : 0), 0);
  const FIRST = 8;
  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm opacity-70">
          {total === 0 ? "Nothing has been made yet." : `${plural(total, "asset")} in ${plural(groups.length, "video")}${people.length > 0 ? ` and ${plural(people.length, "character")}` : ""}.`}
        </p>
        <button type="button" className={`${quietButton} flex items-center gap-2`} onClick={() => void api.openDataFolder()}>
          <Icon d={ICONS.open} />
          Open the data folder
        </button>
      </div>

      {total === 0 && <p className={`${card} text-center text-sm opacity-70`}>Storyboards, clips, voice lines and character pictures appear here as they are made, grouped by video.</p>}

      {groups.map(({ video, assets }) => {
        const all = open.has(video.id);
        // The pictures and clips in use come first, so a closed group shows the video as it stands.
        const ordered = [...assets].sort((a, b) => Number(a.kind === "voice") - Number(b.kind === "voice") || Number(b.inUse) - Number(a.inUse));
        const seen = ordered.filter((a) => a.kind !== "voice");
        const shown = all ? ordered : seen.slice(0, FIRST);
        return (
          <section key={video.id} className={`${card} space-y-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-lg font-semibold">{video.title}</h3>
                <p className="text-xs opacity-60">{count(assets)}</p>
              </div>
              <button type="button" className={smallButton} onClick={() => openVideo(video.id)}>
                Open the video
              </button>
              <button type="button" className={`${smallButton} flex items-center gap-1.5`} onClick={() => openFolder("videos", video.id)}>
                <Icon d={ICONS.open} className="h-3.5 w-3.5" />
                Open the folder
              </button>
            </div>
            <Wall assets={shown} />
            {assets.length > shown.length || all ? (
              <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={() => toggle(video.id)}>
                {all ? "Show less" : `Show all ${assets.length}`}
              </button>
            ) : null}
          </section>
        );
      })}

      {people.length > 0 && (
        <section className={`${card} space-y-4`}>
          <h3 className="font-display text-lg font-semibold">Characters</h3>
          {people.map((c) => (
            <div key={c.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {c.name} <span className="font-normal opacity-60">· {plural(c.pictures.length, "portrait")}{c.sheet ? " · character sheet" : ""}</span>
                </p>
                <button type="button" className={`${smallButton} flex items-center gap-1.5`} onClick={() => openFolder("cast", c.id)}>
                  <Icon d={ICONS.open} className="h-3.5 w-3.5" />
                  Open the folder
                </button>
              </div>
              <Wall
                assets={[
                  ...c.pictures.map((t, n): Asset => ({ key: t.id, kind: "picture", url: api.studioFileUrl(t.file), label: `${c.name} · portrait ${n + 1}`, inUse: n === 0, madeWith: t.madeWith })),
                  ...(c.sheet ? [{ key: c.sheet.id, kind: "picture" as const, url: api.studioFileUrl(c.sheet.file), label: `${c.name} · character sheet`, inUse: true, madeWith: c.sheet.madeWith }] : []),
                ]}
              />
            </div>
          ))}
        </section>
      )}
      {total > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs opacity-55">
          <Chip>In use</Chip> has a coloured edge. Everything here is a file in your data folder, so copying that folder takes it all with it.
        </p>
      )}
    </div>
  );
}
