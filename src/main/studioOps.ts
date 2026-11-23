// Everything that can be done to the cast, series and videos, in one place,
// so the app's screens and the agent do exactly the same thing.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
import { randomUUID } from "node:crypto";
import {
  approvalProblem,
  ideaList,
  parseCharacter,
  parseProduction,
  parseResults,
  parseSeries,
  parseVideo,
  type Character,
  type NewSeries,
  type NewVideo,
  type Series,
  type SeriesStart,
  type StudioResult,
  type Video,
  type VideoVoicesResult,
} from "../shared/studio";
import type { ApiProvider } from "../shared/settings";
import { ensureFfmpeg, listResearch } from "./research";
import type { ResearchItem } from "../shared/research";
import type { Store } from "./store";
import { planSeries, reviewStoryboards, voiceVideo, writeVideo } from "./studio";
import { animateScene, designMotion } from "./motion";
import { animationPage } from "../shared/motion";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { choiceLabel, MEDIA_MODELS, parseChoice, parseMediaSettings, type MediaSettings, type MediaTask, type UploadedFile } from "../shared/media";
import { boardId, characterReference, DEFAULT_STYLE, isMotion, stylePrompt, pickedClip, pickedPicture, speakerName, storyboardApproved, type Scene, type TakeResult } from "../shared/studio";
import { audioFilePath } from "./audio";
import { deleteTake, forLooking, fromUpload, lastFrame, loadTake, makeClip, makeLipSync, makePicture, saveTake, type ClipReference, type Media } from "./media";

const MEDIA_SETTING = "media_settings";

export type StudioContext = {
  /** Renders an animation page to an MP4 on this computer. Only the desktop app can; undefined elsewhere. */
  render?: (page: string, seconds: number, ffmpeg: string) => Promise<Buffer>;
  dataDir: () => string;
  store: () => Store;
  key: (provider: ApiProvider) => string;
};

const words = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const fail = (e: unknown, fallback: string) => ({ ok: false as const, error: e instanceof Error ? e.message : fallback });
const rate = (v: Video) => {
  const r = v.results;
  return r ? ((r.saves ?? 0) + (r.shares ?? 0) + (r.follows ?? 0)) / Math.max(r.views ?? 0, 1) : 0;
};

export function studioOps(ctx: StudioContext) {
  const db = ctx.store;
  const cast = (): Character[] => db().listDocs<unknown>("characters").map(parseCharacter);
  const series = (): Series[] => db().listDocs<unknown>("series").map(parseSeries);
  const videos = (): Video[] => db().listDocs<unknown>("videos").map(parseVideo);
  const findVideo = (id: unknown) => videos().find((v) => v.id === String(id));
  const findIdea = (id: string) => db().listIdeas().find((i) => i.id === id);

  /** The saved posts with these ids that are still there and analysed, in the order given. */
  async function postsOf(ids: string[]) {
    if (ids.length === 0) return [];
    const all = await listResearch(ctx.dataDir());
    return ids.map((id) => all.find((p) => p.id === id)).filter((p): p is ResearchItem => p !== undefined && p.analysis !== undefined);
  }
  /** Checks posts picked for a new video or series. Returns them, or a message saying which cannot be used. */
  async function pickPosts(input: unknown): Promise<{ posts: Awaited<ReturnType<typeof postsOf>>; error?: string }> {
    const ids = ideaList(input);
    if (ids.length === 0) return { posts: [] };
    const all = await listResearch(ctx.dataDir());
    if (ids.some((id) => !all.some((p) => p.id === id))) return { posts: [], error: "One of those posts is no longer saved." };
    const raw = all.find((p) => ids.includes(p.id) && !p.analysis);
    if (raw) return { posts: [], error: `Analyse the post by ${raw.author || raw.authorHandle || "that creator"} in Research first. Its structure is what gets borrowed.` };
    return { posts: await postsOf(ids) };
  }

  /** Which service does which job, unless a request says otherwise. */
  const mediaSettings = (): MediaSettings => {
    try {
      return parseMediaSettings(JSON.parse(db().getSetting(MEDIA_SETTING) || "{}"));
    } catch {
      return parseMediaSettings({});
    }
  };
  const choose = (task: MediaTask, override: unknown) => {
    const asked = (override ?? {}) as { provider?: unknown; model?: unknown };
    // A service named without a model means that service's first known model for the job.
    const model = asked.model ?? MEDIA_MODELS[task].find((m) => m.provider === asked.provider)?.model;
    return parseChoice({ provider: asked.provider, model }) ?? mediaSettings()[task];
  };

  /** The video and scene an action is about. Throws a readable message if either is gone. */
  function find(videoId: unknown, sceneId: unknown) {
    const video = findVideo(videoId);
    const scene = video?.scenes.find((s) => s.id === String(sceneId));
    if (!video || !scene) throw new Error("That scene no longer exists.");
    return { video, scene };
  }

  /** Applies a change to one scene of the video as it is now (it may have changed while a picture was being made) and saves it. */
  function change(videoId: string, sceneId: string, update: (scene: Scene) => Scene): TakeResult {
    const video = findVideo(videoId);
    if (!video) return { ok: false, error: "That video no longer exists." };
    const saved = { ...video, scenes: video.scenes.map((s) => (s.id === sceneId ? update(s) : s)), updatedAt: new Date().toISOString() };
    db().saveDoc("videos", saved);
    return { ok: true, video: saved };
  }

  /**
   * The shared design of a motion graphics video, made once. Scenes animated at the same time all wait
   * for the one request instead of each asking for a design of its own.
   */
  const designing = new Map<string, Promise<{ ok: true; css: string } | { ok: false; error: string }>>();
  function designFor(videoId: string) {
    const video = findVideo(videoId);
    if (!video) return Promise.resolve({ ok: false as const, error: "That video no longer exists." });
    if (video.design) return Promise.resolve({ ok: true as const, css: video.design });
    let running = designing.get(videoId);
    if (!running) {
      running = (async () => {
        const brand = db().getBrand();
        if (!brand) return { ok: false as const, error: "Create your brand first." };
        const result = await designMotion(ctx.key("anthropic"), { video, brand, look: video.look });
        if (!result.ok) return result;
        const now = findVideo(videoId);
        if (now) db().saveDoc("videos", { ...now, design: result.value.css, costUsd: now.costUsd + result.value.costUsd });
        return { ok: true as const, css: result.value.css };
      })().finally(() => designing.delete(videoId));
      designing.set(videoId, running);
    }
    return running;
  }

  /** How a video's AI scenes look: its style (its series' when it has none of its own), then the finer look within it. */
  const lookOf = (video: Video) => {
    const parent = series().find((s) => s.id === video.seriesId);
    return [stylePrompt(video.style || parent?.style || ""), video.look || parent?.look || ""].filter(Boolean).join(" ");
  };

  /** Swaps one name for another in a piece of script, as a whole word only ("Sam" does not touch "Samuel"). */
  const renamer = (from: string, to: string) => {
    if (!from.trim() || from === to) return (text: string) => text;
    const word = new RegExp(`(?<![\\p{L}\\p{N}])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu");
    return (text: string) => text.replace(word, () => to);
  };

  /** The characters seen or heard in a scene. */
  // A script sometimes names someone in what happens without listing them among those seen, so the name counts too.
  const named = (text: string, name: string) => name.trim().length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
  const castOf = (scene: Scene) => cast().filter((c) => scene.characters.includes(c.id) || scene.lines.some((l) => l.speaker === c.id) || named(scene.action, c.name));

  /**
   * What a scene's clip is made from: its storyboard, and, for a scene that carries on from the one
   * before, the very last frame of that scene's clip, which this clip opens on. `from` is the id of
   * the clip it opens on, or of the storyboard when it opens on nothing.
   */
  async function clipSource(
    videoId: unknown,
    sceneId: unknown,
  ): Promise<{ ok: true; video: Video; scene: Scene; index: number; storyboard: Media; opening?: Media; from: string } | { ok: false; error: string }> {
    const { video, scene } = find(videoId, sceneId);
    if (!video.approvedAt) return { ok: false, error: "Approve the script first. Clips are made for an approved script, so none are wasted on words that change." };
    const index = video.scenes.indexOf(scene);
    const picture = pickedPicture(scene);
    if (!picture) return { ok: false, error: `Scene ${index + 1} has no storyboard yet. Make it on the Storyboard tab first: the clip follows it.` };
    if (!storyboardApproved(scene)) return { ok: false, error: `Scene ${index + 1}'s storyboard is not approved yet. Approve it on the Storyboard tab first.` };
    const before = scene.continues && scene.madeBy === "ai" ? video.scenes[index - 1] : undefined;
    const beforeClip = before && pickedClip(before);
    // Without FFmpeg, or if the frame cannot be read, the clip is made from the storyboard alone.
    const toolsDir = beforeClip ? await ensureFfmpeg(ctx.dataDir()) : null;
    const opening = beforeClip && toolsDir ? await lastFrame(ctx.dataDir(), beforeClip, toolsDir).catch(() => undefined) : undefined;
    return { ok: true, video, scene, index, storyboard: await loadTake(ctx.dataDir(), picture), ...(opening && { opening }), from: opening && beforeClip ? beforeClip.id : picture.id };
  }

  /** What the creator's posted videos show about which openings find their audience, for the script writer. */
  function learned(): string {
    const posted = videos().filter((v) => v.results && v.hooks[0] && (v.results.views ?? 0) > 0);
    if (posted.length === 0) return "";
    return posted
      .sort((a, b) => rate(b) - rate(a))
      .slice(0, 5)
      .map((v) => {
        const r = v.results!;
        return `- "${v.hooks[0]}": ${r.views} views, ${r.saves ?? 0} saves, ${r.shares ?? 0} shares, ${r.follows ?? 0} follows${r.note ? `. Note: ${r.note}` : ""}`;
      })
      .join("\n");
  }

  return {
    cast,
    series,
    videos,
    findVideo,

    saveCharacter(input: unknown): StudioResult<Character> {
      try {
        const i = (input ?? {}) as Record<string, unknown>;
        const character = parseCharacter({ ...i, id: i.id || randomUUID() });
        const before = cast().find((c) => c.id === character.id);
        db().saveDoc("characters", character);
        // A new name is written into every script that uses the character, so the words, the storyboards and the cast agree.
        if (before && before.name !== character.name) {
          const rename = renamer(before.name, character.name);
          for (const video of videos()) {
            if (!video.scenes.some((s) => s.characters.includes(character.id) || s.lines.some((l) => l.speaker === character.id))) continue;
            const scenes = video.scenes.map((scene) => ({
              ...scene,
              action: rename(scene.action),
              camera: rename(scene.camera),
              text: rename(scene.text),
              // A recorded line that said the old name is recorded again.
              lines: scene.lines.map((line) => (rename(line.text) === line.text ? line : { speaker: line.speaker, text: rename(line.text), delivery: line.delivery })),
            }));
            if (JSON.stringify(scenes) !== JSON.stringify(video.scenes)) db().saveDoc("videos", { ...video, scenes, updatedAt: new Date().toISOString() });
          }
        }
        return { ok: true, value: character };
      } catch (e) {
        return fail(e, "Could not save the character.");
      }
    },
    deleteCharacter: (id: unknown) => db().deleteDoc("characters", String(id)),

    saveSeries(input: unknown): StudioResult<Series> {
      try {
        const saved = parseSeries(input);
        db().saveDoc("series", saved);
        return { ok: true, value: saved };
      } catch (e) {
        return fail(e, "Could not save the series.");
      }
    },
    deleteSeries: (id: unknown) => db().deleteDoc("series", String(id)),

    /** Plans a season with Claude and saves it, along with any characters the plan added to the cast. */
    async plan(title: unknown, about: unknown, options?: NewSeries): Promise<StudioResult<Series>> {
      const brand = db().getBrand();
      if (!brand) return { ok: false, error: "Create your brand first." };
      const ideas = ideaList(options?.ideaIds).map(findIdea);
      if (ideas.some((i) => !i)) return { ok: false, error: "One of those ideas no longer exists." };
      const result = await planSeries(ctx.key("anthropic"), {
        title: String(title ?? ""),
        about: String(about ?? ""),
        brand,
        characters: cast(),
        production: parseProduction(options?.production),
        ideas: ideas.filter((i) => i !== undefined),
      });
      if (!result.ok) return result;
      for (const character of result.value.newCharacters) db().saveDoc("characters", character);
      const planned = parseSeries({ ...result.value.series, brief: String(about ?? "") });
      db().saveDoc("series", planned);
      return { ok: true, value: planned };
    },

    /** Starts a series from an idea, with no season yet: planSeason plans it. */
    async createSeries(input: SeriesStart): Promise<StudioResult<Series>> {
      try {
        const from = input ?? {};
        const picked = ideaList(from.ideaIds);
        const ideas = picked.map(findIdea).filter((i) => i !== undefined);
        if (ideas.length < picked.length) return { ok: false, error: "One of those ideas no longer exists." };
        const inspired = await pickPosts(from.postIds);
        if (inspired.error) return { ok: false, error: inspired.error };
        const brief = words(from.brief);
        const title = words(from.title) || ideas[0]?.title || brief.slice(0, 60) || (inspired.posts[0] ? `Inspired by ${inspired.posts[0].analysis?.topic || inspired.posts[0].author || "a saved post"}` : "");
        if (!title) return { ok: false, error: "Give the series a title, pick an idea or a post, or say what it is about." };
        const made = parseSeries({ id: randomUUID(), title, brief, production: from.production === undefined ? (ideas[0]?.production ?? "mix") : parseProduction(from.production), style: words(from.style) || DEFAULT_STYLE, videoFormat: words(from.videoFormat), targetSeconds: Number(from.targetSeconds) || 0, platform: words(from.platform), language: words(from.language), ideaIds: picked, postIds: inspired.posts.map((p) => p.id) });
        db().saveDoc("series", made);
        return { ok: true, value: made };
      } catch (e) {
        return fail(e, "Could not start the series.");
      }
    },

    /** Plans the season of a series started from an idea, and saves the plan into it along with any characters it added. */
    async planSeason(id: unknown): Promise<StudioResult<Series>> {
      const brand = db().getBrand();
      if (!brand) return { ok: false, error: "Create your brand first." };
      const existing = series().find((s) => s.id === String(id));
      if (!existing) return { ok: false, error: "That series no longer exists." };
      const result = await planSeries(ctx.key("anthropic"), {
        title: existing.title,
        about: existing.brief,
        brand,
        characters: cast(),
        production: existing.production,
        ideas: existing.ideaIds.map(findIdea).filter((i) => i !== undefined),
        posts: await postsOf(existing.postIds),
      });
      if (!result.ok) return result;
      // The characters a season plan makes are drawn in the style of the series.
      for (const character of result.value.newCharacters) db().saveDoc("characters", { ...character, style: existing.style === "motion" ? "" : existing.style });
      const planned = result.value.series;
      const saved = parseSeries({
        ...existing,
        premise: planned.premise,
        question: planned.question,
        ending: planned.ending,
        episodes: planned.episodes,
        characterIds: [...new Set([...existing.characterIds, ...planned.characterIds])],
        costUsd: existing.costUsd + planned.costUsd,
      });
      db().saveDoc("series", saved);
      return { ok: true, value: saved };
    },

    /** Starts a video from a saved post (a remake), a series episode, or saved ideas and/or a title and the creator's own words. */
    async createVideo(input: NewVideo): Promise<StudioResult<Video>> {
      try {
        const from = input ?? {};
        const now = new Date().toISOString();
        const base = { id: randomUUID(), createdAt: now, updatedAt: now, production: parseProduction(from.production), style: words(from.style) || DEFAULT_STYLE, videoFormat: words(from.videoFormat), targetSeconds: Number(from.targetSeconds) || 0, platform: words(from.platform), language: words(from.language) };
        const picked = ideaList([from.ideaId, ...(Array.isArray(from.ideaIds) ? from.ideaIds : [])]);
        let video: Video;
        if (!from.postId && !from.seriesId) {
          const ideas = picked.map(findIdea).filter((i) => i !== undefined);
          if (ideas.length < picked.length) return { ok: false, error: picked.length === 1 ? "That idea no longer exists." : "One of those ideas no longer exists." };
          const inspired = await pickPosts(from.postIds);
          if (inspired.error) return { ok: false, error: inspired.error };
          const [first] = ideas;
          const topic = inspired.posts[0] ? inspired.posts[0].analysis?.topic || inspired.posts[0].author || "a saved post" : "";
          // The ideas and posts themselves are given to the writer in full; this is what the creator added, or a summary when they added nothing.
          const summary =
            ideas.length === 1
              ? [first.viewer && `For: ${first.viewer}.`, first.hook, ...first.outline, first.takeaway && `The viewer leaves with: ${first.takeaway}`].filter(Boolean).join(" ")
              : ideas.length > 1
                ? `One video that brings together these saved ideas: ${ideas.map((i) => i.title).join("; ")}.`
                : inspired.posts.length
                  ? `A video of my own that borrows what works in ${inspired.posts.length === 1 ? "a saved post" : `${inspired.posts.length} saved posts`}, on a subject that fits my brand.`
                  : "";
          const title = words(from.title) || first?.title || words(from.brief).slice(0, 60) || (topic ? `Inspired by ${topic}` : "");
          const production = from.production === undefined ? (first?.production ?? base.production) : base.production;
          video = parseVideo({ ...base, production, title, brief: words(from.brief) || (ideas.length === 1 ? "" : summary), ideaIds: picked, postIds: inspired.posts.map((p) => p.id) });
        } else if (from.postId) {
          const post = (await listResearch(ctx.dataDir())).find((p) => p.id === from.postId);
          if (!post) return { ok: false, error: "That post is no longer saved." };
          if (!post.analysis) return { ok: false, error: "Analyse this post first. Its structure is what your version is built on." };
          video = parseVideo({
            ...base,
            title: `My version: ${post.analysis.topic || post.author || "saved post"}`,
            brief: from.brief || `My own version of a post about ${post.analysis.topic}, on a subject that fits my brand.`,
            source: "remake",
            postId: post.id,
          });
        } else if (from.seriesId) {
          const parent = series().find((s) => s.id === from.seriesId);
          const number = Math.round(Number(from.episode));
          const episode = parent?.episodes[number - 1];
          if (!parent || !episode) return { ok: false, error: "That episode is not in the series plan." };
          const existing = videos().find((v) => v.seriesId === parent.id && v.episode === number);
          if (existing) return { ok: true, value: existing };
          video = parseVideo({
            ...base,
            title: `${parent.title} · Episode ${number}`,
            brief: `${episode.teaches} Ends on: ${episode.endsOn}`,
            format: "episode",
            style: parent.style || base.style,
            videoFormat: parent.videoFormat || base.videoFormat,
            targetSeconds: parent.targetSeconds || base.targetSeconds,
            platform: parent.platform || base.platform,
            language: parent.language || base.language,
            seriesId: parent.id,
            episode: number,
            // An episode is made the way its series is.
            production: parent.production,
          });
        } else {
          return { ok: false, error: "That episode is not in the series plan." };
        }
        db().saveDoc("videos", video);
        return { ok: true, value: video };
      } catch (e) {
        return fail(e, "Could not start the video.");
      }
    },

    /**
     * Gives a role in one video to another character: an existing one, or ("new") a fresh one
     * made for the role. Every scene and line of the old character becomes the new one's, the
     * old name is swapped for the new one in the script's words, and lines already recorded in
     * the old voice are cleared. A character the script made that was never set up and is used
     * nowhere else is removed, so recasting leaves no clutter behind.
     */
    recast(videoId: unknown, fromId: unknown, toId: unknown): StudioResult<{ video: Video; removed: boolean }> {
      const video = findVideo(videoId);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const everyone = cast();
      const from = everyone.find((c) => c.id === String(fromId));
      if (!from) return { ok: false, error: "That character is no longer there." };
      let to = everyone.find((c) => c.id === String(toId));
      if (toId === "new") {
        // Two characters with one name could not be told apart, so the new one is numbered.
        const taken = new Set(everyone.map((c) => c.name.toLowerCase()));
        // "Sam 2" gives "Sam 3", not "Sam 2 2".
        const base = from.name.replace(/(\s+\d+)+$/, "") || from.name;
        let name = base;
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
        to = parseCharacter({ id: randomUUID(), name, role: from.role, personality: from.personality, speech: from.speech, look: from.look, style: from.style, voice: null, pictures: [] });
        db().saveDoc("characters", to);
      }
      if (!to) return { ok: false, error: "The character to use is no longer there." };
      if (to.id === from.id) return { ok: true, value: { video, removed: false } };
      const target = to;

      const rename = renamer(from.name, target.name);
      const recast = parseVideo({
        ...video,
        scenes: video.scenes.map((scene) => ({
          ...scene,
          action: rename(scene.action),
          camera: rename(scene.camera),
          text: rename(scene.text),
          characters: [...new Set(scene.characters.map((id) => (id === from.id ? target.id : id)))],
          lines: scene.lines.map((line) =>
            // A line the old character spoke needs recording again in the new voice.
            line.speaker === from.id ? { speaker: target.id, text: rename(line.text), delivery: line.delivery } : { ...line, text: line.audioId ? line.text : rename(line.text) },
          ),
        })),
        updatedAt: new Date().toISOString(),
      });
      db().saveDoc("videos", recast);

      const parent = recast.seriesId ? series().find((x) => x.id === recast.seriesId) : undefined;
      if (parent && !parent.characterIds.includes(target.id)) db().saveDoc("series", { ...parent, characterIds: [...parent.characterIds, target.id] });

      const stillUsed =
        videos().some((v) => v.scenes.some((x) => x.characters.includes(from.id) || x.lines.some((l) => l.speaker === from.id))) || series().some((x) => x.characterIds.includes(from.id));
      const untouched = !from.voice && from.pictures.length === 0;
      if (!stillUsed && untouched) db().deleteDoc("characters", from.id);
      return { ok: true, value: { video: recast, removed: !stillUsed && untouched } };
    },

    /** Saves edits to a video as given. */
    saveVideo(input: unknown): StudioResult<Video> {
      try {
        const video = parseVideo({ ...(input as object), updatedAt: new Date().toISOString() });
        db().saveDoc("videos", video);
        return { ok: true, value: video };
      } catch (e) {
        return fail(e, "Could not save the video.");
      }
    },
    deleteVideo: (id: unknown) => db().deleteDoc("videos", String(id)),

    /** Has Claude write the script; with a note, rewrites the current one as the note asks. */
    async writeScript(id: unknown, note: unknown): Promise<StudioResult<Video>> {
      const brand = db().getBrand();
      if (!brand) return { ok: false, error: "Create your brand first." };
      const video = findVideo(id);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const parent = video.seriesId ? series().find((s) => s.id === video.seriesId) : undefined;
      const result = await writeVideo(ctx.key("anthropic"), {
        video,
        brand,
        characters: cast(),
        // An idea deleted since the video was started is simply left out.
        ideas: video.ideaIds.map(findIdea).filter((i) => i !== undefined),
        inspiration: await postsOf(video.postIds),
        post: video.postId ? (await listResearch(ctx.dataDir())).find((p) => p.id === video.postId) : undefined,
        series: parent,
        note: typeof note === "string" ? note.trim() : "",
        learned: learned(),
      });
      if (!result.ok) return result;
      // A character the script made is drawn in the style of the video it was made for.
      for (const character of result.value.newCharacters) db().saveDoc("characters", { ...character, style: isMotion(video) ? "" : video.style || parent?.style || "" });
      // Every character an episode uses joins that series' cast, whether the script made them or they already existed.
      if (parent) {
        const known = new Set(cast().map((c) => c.id));
        const used = result.value.video.scenes.flatMap((s) => [...s.characters, ...s.lines.map((l) => l.speaker)]).filter((x) => known.has(x));
        const added = [...new Set(used)].filter((x) => !parent.characterIds.includes(x));
        if (added.length) db().saveDoc("series", { ...parent, characterIds: [...parent.characterIds, ...added] });
      }
      db().saveDoc("videos", result.value.video);
      return { ok: true, value: result.value.video };
    },

    /** Marks the script as approved, and for an episode adds what happened to the series' story so far. */
    approve(id: unknown): StudioResult<Video> {
      const video = findVideo(id);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const problem = approvalProblem(video);
      if (problem) return { ok: false, error: problem };
      const approved = { ...video, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db().saveDoc("videos", approved);
      const parent = video.seriesId ? series().find((s) => s.id === video.seriesId) : undefined;
      if (parent && video.storyUpdate.length) {
        const added = video.storyUpdate.map((line) => `Episode ${video.episode}: ${line}`).filter((line) => !parent.storySoFar.includes(line));
        db().saveDoc("series", { ...parent, storySoFar: [...parent.storySoFar, ...added] });
      }
      return { ok: true, value: approved };
    },

    /** Speaks every AI line that has no audio yet. Uses ElevenLabs credits. */
    async voices(id: unknown): Promise<VideoVoicesResult> {
      const brand = db().getBrand();
      const video = findVideo(id);
      if (!brand || !video) return { ok: false, error: "That video no longer exists." };
      const result = await voiceVideo(ctx.dataDir(), ctx.key("elevenlabs"), video, cast(), brand);
      if (result.ok) db().saveDoc("videos", result.video);
      return result;
    },

    // ---------- Pictures, clips and lip-sync ----------

    mediaSettings,
    /** Changes which service does which job by default. */
    setMediaSettings(input: unknown): MediaSettings {
      const merged = parseMediaSettings({ ...mediaSettings(), ...(input && typeof input === "object" ? input : {}) });
      db().setSetting(MEDIA_SETTING, JSON.stringify(merged));
      return merged;
    },

    /** Makes a reference picture of a character from their look. An existing one is passed along so the new one matches. */
    async characterPicture(id: unknown, override: unknown): Promise<StudioResult<Character>> {
      try {
        const character = cast().find((c) => c.id === String(id));
        if (!character) return { ok: false, error: "That character no longer exists." };
        if (!character.look && !character.personality) return { ok: false, error: "Describe the character's look first." };
        const choice = choose("picture", override);
        const media = await makePicture(ctx.key, choice, {
          prompt: [
            "A reference picture of one character for a short video series, so they can be drawn the same way every time.",
            stylePrompt(character.style) && `Style: ${stylePrompt(character.style)}`,
            "Full body, facing the camera, plain neutral background, even light. No text, captions or logos.",
            `Character: ${character.name}${character.role ? `, ${character.role}` : ""}.`,
            `Look: ${character.look || character.personality}`,
          ].join("\n"),
          references: character.pictures[0] ? [await loadTake(ctx.dataDir(), character.pictures[0])] : [],
          detail: character.name,
        });
        const take = await saveTake(ctx.dataDir(), "cast", character.id, media, "ai", choiceLabel("picture", choice));
        const fresh = cast().find((c) => c.id === character.id) ?? character;
        const saved = { ...fresh, pictures: [...fresh.pictures, take] };
        db().saveDoc("characters", saved);
        return { ok: true, value: saved };
      } catch (e) {
        return fail(e, "The picture could not be made.");
      }
    },

    /**
     * Makes a character's sheet: one wide picture showing them from the front, from the back and their face
     * close up, drawn from their portrait so it is the same person. With `remove` the sheet is taken away instead.
     */
    async characterSheet(id: unknown, override: unknown, remove?: unknown): Promise<StudioResult<Character>> {
      try {
        const character = cast().find((c) => c.id === String(id));
        if (!character) return { ok: false, error: "That character no longer exists." };
        if (remove === true) {
          if (character.sheet) await deleteTake(ctx.dataDir(), character.sheet);
          const cleared = { ...character, sheet: null };
          db().saveDoc("characters", cleared);
          return { ok: true, value: cleared };
        }
        const portrait = character.pictures[0];
        if (!portrait && !character.look) return { ok: false, error: "Add a picture of the character or describe their look first." };
        const choice = choose("picture", override);
        const media = await makePicture(ctx.key, choice, {
          prompt: [
            "A character sheet of ONE character, so they can be drawn the same way in every shot of a video.",
            "One wide picture with three views side by side on a plain light background, in even light: on the left the whole body from the FRONT, standing; in the middle the whole body from the BACK, standing the same way; on the right a close-up of the FACE and shoulders, facing the camera.",
            "It is the same person in all three views: the same face, hair, build, skin, and exactly the same clothes, shoes and accessories. The back view shows the back of the same hair and clothes.",
            portrait ? "The reference picture shows this character. Keep them exactly as they are in it: do not change their face, age, hair, build or outfit." : "",
            `Character: ${character.name}${character.role ? `, ${character.role}` : ""}.`,
            character.look && `Look: ${character.look}`,
            stylePrompt(character.style) && `Style: ${stylePrompt(character.style)}${portrait ? " If the reference picture is in another style, keep the picture's." : ""}`,
            "No text, labels, captions, arrows or logos.",
          ]
            .filter(Boolean)
            .join("\n"),
          references: portrait ? [await loadTake(ctx.dataDir(), portrait)] : [],
          detail: `${character.name} · character sheet`,
          wide: true,
        });
        // The sheet remembers the portrait it was drawn from, so a change of main portrait shows it as out of date.
        const take = { ...(await saveTake(ctx.dataDir(), "cast", character.id, media, "ai", choiceLabel("picture", choice))), ...(portrait && { from: portrait.id }) };
        const fresh = cast().find((c) => c.id === character.id) ?? character;
        if (fresh.sheet) await deleteTake(ctx.dataDir(), fresh.sheet);
        const saved = { ...fresh, sheet: take };
        db().saveDoc("characters", saved);
        return { ok: true, value: saved };
      } catch (e) {
        return fail(e, "The character sheet could not be made.");
      }
    },

    /** Adds a picture the creator chose themselves as a character's reference. */
    async addCharacterPicture(id: unknown, upload: UploadedFile): Promise<StudioResult<Character>> {
      try {
        const character = cast().find((c) => c.id === String(id));
        if (!character) return { ok: false, error: "That character no longer exists." };
        const media = fromUpload(upload);
        if (!media.mime.startsWith("image/")) return { ok: false, error: "Choose a picture: PNG, JPEG or WebP." };
        const take = await saveTake(ctx.dataDir(), "cast", character.id, media, "upload", "");
        const saved = { ...character, pictures: [...character.pictures, take] };
        db().saveDoc("characters", saved);
        return { ok: true, value: saved };
      } catch (e) {
        return fail(e, "The picture could not be added.");
      }
    },

    /** Removes one reference picture, or with `first` makes it the main one. */
    async changeCharacterPicture(id: unknown, takeId: unknown, action: unknown): Promise<StudioResult<Character>> {
      const character = cast().find((c) => c.id === String(id));
      const take = character?.pictures.find((t) => t.id === String(takeId));
      if (!character || !take) return { ok: false, error: "That picture no longer exists." };
      const others = character.pictures.filter((t) => t.id !== take.id);
      if (action !== "first") await deleteTake(ctx.dataDir(), take);
      const saved = { ...character, pictures: action === "first" ? [take, ...others] : others };
      db().saveDoc("characters", saved);
      return { ok: true, value: saved };
    },

    /** Makes a still for one scene, using the reference pictures of the characters in it. `note` says what to change from the last attempt. */
    async scenePicture(videoId: unknown, sceneId: unknown, override: unknown, note: unknown): Promise<TakeResult> {
      try {
        const { video, scene } = find(videoId, sceneId);
        if (!video.approvedAt) return { ok: false, error: "Approve the script first. A storyboard is made for an approved script, so none is wasted on words that change." };
        const choice = choose("picture", override);
        const inScene = castOf(scene);
        // What the picture model is shown so the scenes belong together: for a scene that carries on, the storyboard
        // of the scene before; otherwise the storyboard of the nearest earlier scene in the same place.
        const here = scene.place.trim().toLowerCase();
        const index = video.scenes.findIndex((x) => x.id === scene.id);
        const before = video.scenes[index - 1];
        const carriesOn = scene.continues && before !== undefined && pickedPicture(before) !== undefined;
        const sameSet = carriesOn ? before : here ? [...video.scenes.slice(0, index)].reverse().find((x) => x.place.trim().toLowerCase() === here && pickedPicture(x)) : undefined;
        const setPicture = sameSet ? pickedPicture(sameSet) : undefined;
        // A change asked of the storyboard in use is an edit of that sheet, not a new drawing: the sheet is sent
        // as the first picture and everything not named in the change stays as it is.
        const asked = typeof note === "string" ? note.trim() : "";
        // A change that is about who someone is (the wrong face or clothes) is not an edit: the faulty storyboard would be
        // the model's strongest guide and it would keep the wrong person. It is drawn afresh from the character pictures.
        const aboutLooks = /reference picture/i.test(asked);
        const current = asked && !aboutLooks ? pickedPicture(scene) : undefined;
        const first = current ?? setPicture;
        const withPictures = inScene.filter((c) => characterReference(c)).slice(0, first ? 3 : 4);
        const look = lookOf(video);
        const said = scene.lines.map((l) => `${speakerName(l.speaker, cast())}: ${l.text}`).join(" / ");
        const media = await makePicture(ctx.key, choice, {
          prompt: [
            `A storyboard sheet for ONE shot of a vertical short video, ${scene.seconds} seconds long. Draw exactly four frames in a 2 by 2 grid, read left to right and top to bottom, with a thin dark border between them. Each frame is a tall 9:16 picture. Together they show this one continuous shot from its first moment to its last: frame 1 is how it opens, frames 2 and 3 are the action in between, frame 4 is how it ends.`,
            "It is one take, not four shots: the same place, people, clothes, props and light in every frame. Only the action moves on, and the camera only as the camera note says.",
            look ? `Draw every frame in the style and look of the finished video: ${look}` : "Draw every frame as the finished video will look.",
            scene.place && `Place: ${scene.place}.`,
            `What happens across the four frames: ${scene.action}`,
            scene.camera && `Camera: ${scene.camera}.`,
            said && `What is said during the shot (show who is speaking; do not write the words): ${said}`,
            inScene.length
              ? `Characters in the shot: ${inScene.map((c) => `${c.name} (${c.look || c.role})`).join("; ")}.`
              : "",
            withPictures.length
              ? `The first ${withPictures.length === 1 ? "reference picture shows" : `${withPictures.length} reference pictures show, in order,`} ${withPictures.map((c) => `${c.name}${c.sheet ? " (a character sheet: front, back and face)" : ""}`).join(", ")}. These decide who each character is: keep the same face, age, hair, build, clothes and colours in every frame, from whatever side the frame shows them. Match what they wear exactly: the kind of garment (a hoodie stays a hoodie, a collarless shirt stays collarless), its collar, sleeves and colour, from the front and from behind. Draw them in the style of this video even where their picture is in another style. Do not copy the layout or the plain background of a character sheet.`
              : "",
            current
              ? `The LAST reference picture is this shot's current storyboard. Make the SAME sheet again with one change: ${asked} Keep everything else as it is in that picture: the same four frames in the same order, the same composition, place, props, light and colours. Change only what the instruction names, in every frame it applies to. Who the characters are still comes from their own reference pictures: where the storyboard shows one of them differently, their picture wins.`
              : setPicture && carriesOn
              ? `The LAST reference picture is the storyboard of the shot just before this one (scene ${index}). Take the place, the positions and the light from it, and the characters' faces and clothes from their own pictures. This shot carries straight on from it with no cut: frame 1 here is the same moment as its last frame, with the same place, people, clothes, props, light and camera position.`
              : setPicture
                ? `The LAST reference picture is the storyboard of an earlier shot in this same place (scene ${video.scenes.indexOf(sameSet!) + 1}). Take the place from it, and the characters' faces and clothes from their own pictures. Keep the same walls, furniture, props, light, time of day and what everyone wears.`
                : "",
            "Keep the background simple and the same in every frame: no people, objects or clutter that the action above does not need. Anyone or anything in the background of frame 1 stays the same, in the same spot, in all four frames.",
            "No captions, subtitles, speech bubbles, arrows, notes, logos or any other writing. A small frame number in a corner of each frame is the only text allowed.",
            asked && !current ? `${aboutLooks ? "The last attempt got this wrong, so take particular care with it" : "Change from the last attempt"}: ${asked}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          references: await Promise.all([...withPictures.map((c) => characterReference(c)!), ...(first ? [first] : [])].map((take) => loadTake(ctx.dataDir(), take))),
          detail: `${video.title} · scene ${video.scenes.indexOf(scene) + 1}`,
        });
        const take = await saveTake(ctx.dataDir(), "videos", video.id, media, "ai", choiceLabel("picture", choice));
        return change(video.id, scene.id, (s) => ({ ...s, pictures: [...s.pictures, take], picture: take.id }));
      } catch (e) {
        return fail(e, "The picture could not be made.");
      }
    },

    /**
     * Has Claude look at the storyboards and say, scene by scene, whether each is good to make the video from.
     * With a scene id only that scene is checked, with "new" only those not checked yet, otherwise every AI scene
     * that has a storyboard. The storyboard before a checked one is shown too, for continuity. What it says is kept on each scene.
     */
    async storyboardReview(videoId: unknown, sceneId?: unknown): Promise<TakeResult> {
      try {
        const video = findVideo(videoId);
        if (!video) return { ok: false, error: "That video no longer exists." };
        // "new" checks only the storyboards not looked at yet, so one already checked is not paid for twice.
        const fresh = sceneId === "new";
        const all = fresh || sceneId === undefined || sceneId === null;
        const only = all ? -1 : video.scenes.findIndex((s) => s.id === String(sceneId));
        if (!all && only < 0) return { ok: false, error: "That scene no longer exists." };
        const has = (i: number) => video.scenes[i]?.madeBy === "ai" && pickedPicture(video.scenes[i]) !== undefined;
        const check = video.scenes.map((_, i) => i).filter((i) => has(i) && (fresh ? video.scenes[i].review?.picture !== video.scenes[i].picture : all || i === only));
        if (check.length === 0) return { ok: false, error: fresh && video.scenes.some((_, i) => has(i)) ? "Every storyboard has been checked already." : "There is no storyboard to check yet. Make one first." };
        // The storyboard before each checked one is shown too, so continuity can be judged.
        const shown = video.scenes.map((_, i) => i).filter((i) => has(i) && (check.includes(i) || check.includes(i + 1)));
        const toolsDir = await ensureFfmpeg(ctx.dataDir());
        const sheets = await Promise.all(shown.map(async (i) => ({ scene: i + 1, ...(await forLooking(ctx.dataDir(), pickedPicture(video.scenes[i])!, toolsDir)) })));
        const looked = new Map(shown.map((i) => [i + 1, video.scenes[i].picture]));
        const result = await reviewStoryboards(ctx.key("anthropic"), {
          video,
          characters: cast().filter((c) => video.scenes.some((s) => s.characters.includes(c.id) || s.lines.some((l) => l.speaker === c.id))),
          look: lookOf(video),
          sheets,
          faces: await Promise.all(
            cast()
              .filter((c) => characterReference(c) && check.some((i) => castOf(video.scenes[i]).some((x) => x.id === c.id)))
              .slice(0, 6)
              .map(async (c) => ({ name: c.name, ...(await forLooking(ctx.dataDir(), characterReference(c)!, toolsDir)) })),
          ),
          check: check.map((i) => i + 1),
          // A storyboard made again since its last check is checked against what that check asked for, not from scratch.
          before: check
            .map((i) => ({ i, review: video.scenes[i].review }))
            .filter(({ i, review }) => review && review.picture !== video.scenes[i].picture && review.problems.length > 0)
            .map(({ i, review }) => ({ scene: i + 1, problems: review!.problems, fix: review!.fix })),
        });
        if (!result.ok) return result;
        // The video may have changed while Claude was looking: each answer is kept with the storyboard it was about.
        const now = findVideo(video.id);
        if (!now) return { ok: false, error: "That video no longer exists." };
        const checkedAt = new Date().toISOString();
        const saved = {
          ...now,
          costUsd: now.costUsd + result.value.costUsd,
          scenes: now.scenes.map((s, i) => {
            const r = result.value.reviews.find((x) => x.scene === i + 1);
            const picture = looked.get(i + 1);
            return r && picture ? { ...s, review: { picture, ok: r.ok, problems: r.problems, minor: r.minor, fix: r.fix, checkedAt } } : s;
          }),
          updatedAt: checkedAt,
        };
        db().saveDoc("videos", saved);
        return { ok: true, video: saved };
      } catch (e) {
        return fail(e, "The storyboards could not be checked.");
      }
    },

    /**
     * Has Claude animate one scene of a motion graphics video. The video's shared design is made first if it
     * has none. With a note, the scene's current animation is changed as the note says.
     */
    async sceneAnimation(videoId: unknown, sceneId: unknown, note: unknown): Promise<TakeResult> {
      try {
        const { video, scene } = find(videoId, sceneId);
        if (!video.approvedAt) return { ok: false, error: "Approve the script first, so nothing is animated for words that will change." };
        if (!isMotion(video) || scene.madeBy !== "ai") return { ok: false, error: "Only the AI scenes of a motion graphics video are animated." };
        const brand = db().getBrand();
        if (!brand) return { ok: false, error: "Create your brand first." };
        const designed = await designFor(video.id);
        if (!designed.ok) return designed;
        const asked = typeof note === "string" ? note.trim() : "";
        const result = await animateScene(ctx.key("anthropic"), {
          video,
          brand,
          look: video.look,
          design: designed.css,
          index: video.scenes.indexOf(scene),
          ...(asked && { note: asked }),
          ...(asked && scene.animation && { current: scene.animation }),
        });
        if (!result.ok) return result;
        const animation = { id: randomUUID(), html: result.value.html, css: result.value.css, madeAt: new Date().toISOString() };
        const now = findVideo(video.id);
        if (!now) return { ok: false, error: "That video no longer exists." };
        const saved = { ...now, costUsd: now.costUsd + result.value.costUsd, scenes: now.scenes.map((s) => (s.id === scene.id ? { ...s, animation } : s)), updatedAt: animation.madeAt };
        db().saveDoc("videos", saved);
        return { ok: true, video: saved };
      } catch (e) {
        return fail(e, "The scene could not be animated.");
      }
    },

    /** The creator approves the storyboard a scene has in use, or takes the approval back. */
    sceneApprove(videoId: unknown, sceneId: unknown, approved: unknown): TakeResult {
      try {
        const { video, scene } = find(videoId, sceneId);
        if (approved === true && !boardId(scene)) return { ok: false, error: "This scene has nothing to approve yet." };
        return change(video.id, scene.id, (s) => ({ ...s, approved: approved === true ? boardId(s) : "" }));
      } catch (e) {
        return fail(e, "That did not work.");
      }
    },

    /** Says whether a scene carries straight on from the one before it, or is a new shot. */
    sceneFlow(videoId: unknown, sceneId: unknown, continues: unknown): TakeResult {
      try {
        const { video, scene } = find(videoId, sceneId);
        if (continues === true && video.scenes.indexOf(scene) === 0) return { ok: false, error: "The first scene has nothing before it to carry on from." };
        return change(video.id, scene.id, (s) => ({ ...s, continues: continues === true }));
      } catch (e) {
        return fail(e, "That did not work.");
      }
    },

    /** Makes the scene's clip, following its storyboard. */
    /** Turns the scene's chosen picture into a moving clip. */
    async sceneClip(videoId: unknown, sceneId: unknown, override: unknown): Promise<TakeResult> {
      try {
        const asked = find(videoId, sceneId);
        // A motion graphics scene is not sent anywhere: its animation is rendered on this computer.
        if (asked.scene.animation) {
          const { video, scene } = asked;
          const animation = scene.animation!;
          if (!storyboardApproved(scene)) return { ok: false, error: `Scene ${video.scenes.indexOf(scene) + 1}'s animation is not approved yet. Approve it first.` };
          if (!ctx.render) return { ok: false, error: "Animations are rendered by the desktop app. Open this video there to make its clips." };
          const toolsDir = await ensureFfmpeg(ctx.dataDir());
          if (!toolsDir) return { ok: false, error: "FFmpeg is needed to render an animation, and it could not be set up on this computer." };
          const bytes = await ctx.render(animationPage(video.design, animation, scene.seconds, "render"), scene.seconds, join(toolsDir, `ffmpeg${process.platform === "win32" ? ".exe" : ""}`));
          const take = { ...(await saveTake(ctx.dataDir(), "videos", video.id, { bytes, mime: "video/mp4" }, "ai", "Rendered on this computer")), from: animation.id };
          return change(video.id, scene.id, (s) => ({ ...s, clips: [...s.clips, take], clip: take.id }));
        }
        if (isMotion(asked.video) && asked.scene.madeBy === "ai") return { ok: false, error: `Scene ${asked.video.scenes.indexOf(asked.scene) + 1} is not animated yet. Animate it on the Storyboard tab first.` };
        const source = await clipSource(videoId, sceneId);
        if (!source.ok) return source;
        const { video, scene, index } = source;
        const choice = choose("clip", override);
        const inScene = castOf(scene).filter((c) => characterReference(c));
        const references: ClipReference[] = [
          {
            media: source.storyboard,
            role: "the storyboard of this shot: a sheet of numbered frames in reading order, showing what happens from its first moment to its last. Follow those frames in order as ONE continuous shot. It is a plan, not a picture to show: never show the sheet, the grid, the borders or the numbers",
          },
          ...(await Promise.all(inScene.map(async (c) => ({ media: await loadTake(ctx.dataDir(), characterReference(c)!), role: `${c.name}${c.sheet ? ", on a character sheet (front, back and face)" : ""}: this decides who they are. Keep the same face, hair, build, clothes and colours, in the style of this video; never show the sheet itself` })))),
        ];
        const look = lookOf(video);
        const media = await makeClip(ctx.key, choice, {
          references,
          opening: source.opening,
          prompt: [
            `One continuous ${scene.seconds}-second vertical shot, full frame, with no cuts.`,
            source.opening && `It carries straight on from the shot before (scene ${index}): open on that shot's last frame and continue the same movement.`,
            `What happens: ${scene.action}`,
            scene.camera && `Camera: ${scene.camera}.`,
            scene.place && `Place: ${scene.place}.`,
            look && `Style and look: ${look}`,
            "No captions, subtitles or any text on screen. No split screen.",
          ]
            .filter(Boolean)
            .join("\n"),
          seconds: scene.seconds,
          detail: `${video.title} · scene ${index + 1}`,
        });
        const take = { ...(await saveTake(ctx.dataDir(), "videos", video.id, media, "ai", choiceLabel("clip", choice))), from: source.from };
        return change(video.id, scene.id, (s) => ({ ...s, clips: [...s.clips, take], clip: take.id }));
      } catch (e) {
        return fail(e, "The clip could not be made.");
      }
    },

    /** Makes the speaking character's picture say the scene's first recorded AI line. */
    async sceneLipSync(videoId: unknown, sceneId: unknown, override: unknown): Promise<TakeResult> {
      try {
        const { scene: asked } = find(videoId, sceneId);
        if (!asked.lines.some((l) => l.audioFile)) return { ok: false, error: "This scene has no recorded line yet. Make the voices first." };
        const { video, scene } = find(videoId, sceneId);
        const line = scene.lines.find((l) => l.audioFile);
        const audioPath = line?.audioFile ? audioFilePath(ctx.dataDir(), line.audioFile) : null;
        if (!line || !audioPath) return { ok: false, error: "This scene has no recorded line yet. Make the voices first." };
        // A storyboard is a sheet of frames, not a face, so the speaker's own reference picture is what speaks.
        const speaker = cast().find((c) => c.id === line.speaker);
        const face = speaker?.pictures[0];
        if (!face) return { ok: false, error: speaker ? `${speaker.name} has no reference picture yet. Add one on the Cast tab: lip-sync makes that picture speak.` : "Lip-sync makes a character's picture speak, and this line is not spoken by a character." };
        const choice = choose("lipsync", override);
        const media = await makeLipSync(ctx.key, choice, {
          image: await loadTake(ctx.dataDir(), face),
          audio: { bytes: await readFile(audioPath), mime: "audio/mpeg" },
          detail: `${video.title} · scene ${video.scenes.indexOf(scene) + 1}`,
        });
        const take = await saveTake(ctx.dataDir(), "videos", video.id, media, "lipsync", choiceLabel("lipsync", choice));
        return change(video.id, scene.id, (s) => ({ ...s, clips: [...s.clips, take], clip: take.id }));
      } catch (e) {
        return fail(e, "The lip-sync could not be made.");
      }
    },

    /** Adds a clip the creator filmed, or a picture they chose, to a scene. */
    async addSceneFile(videoId: unknown, sceneId: unknown, upload: UploadedFile): Promise<TakeResult> {
      try {
        const { video, scene } = find(videoId, sceneId);
        const media = fromUpload(upload);
        const isVideo = media.mime.startsWith("video/");
        if (!isVideo && !media.mime.startsWith("image/")) return { ok: false, error: "Choose a video (MP4, MOV, WebM) or a picture (PNG, JPEG, WebP)." };
        const take = await saveTake(ctx.dataDir(), "videos", video.id, media, isVideo ? "filmed" : "upload", "");
        return change(video.id, scene.id, (s) => (isVideo ? { ...s, clips: [...s.clips, take], clip: take.id } : { ...s, pictures: [...s.pictures, take], picture: take.id }));
      } catch (e) {
        return fail(e, "The file could not be added.");
      }
    },

    /** Chooses which picture or clip a scene uses, or with `remove` deletes one. */
    async changeTake(videoId: unknown, sceneId: unknown, takeId: unknown, action: unknown): Promise<TakeResult> {
      try {
        const { video, scene } = find(videoId, sceneId);
        const id = String(takeId);
        const isClip = scene.clips.some((t) => t.id === id);
        const take = [...scene.pictures, ...scene.clips].find((t) => t.id === id);
        if (!take) return { ok: false, error: "That file no longer exists." };
        if (action !== "remove") return change(video.id, scene.id, (s) => (isClip ? { ...s, clip: id } : { ...s, picture: id }));
        await deleteTake(ctx.dataDir(), take);
        return change(video.id, scene.id, (s) =>
          isClip
            ? { ...s, clips: s.clips.filter((t) => t.id !== id), clip: s.clip === id ? (s.clips.filter((t) => t.id !== id).at(-1)?.id ?? "") : s.clip }
            : { ...s, pictures: s.pictures.filter((t) => t.id !== id), picture: s.picture === id ? (s.pictures.filter((t) => t.id !== id).at(-1)?.id ?? "") : s.picture },
        );
      } catch (e) {
        return fail(e, "That did not work.");
      }
    },

    /** Records how a posted video did. These numbers shape the hooks of later scripts. */
    recordResults(id: unknown, input: unknown): StudioResult<Video> {
      const video = findVideo(id);
      if (!video) return { ok: false, error: "That video no longer exists." };
      const saved = { ...video, results: parseResults(input), updatedAt: new Date().toISOString() };
      db().saveDoc("videos", saved);
      return { ok: true, value: saved };
    },
  };
}
