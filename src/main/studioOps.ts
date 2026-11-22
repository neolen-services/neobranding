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
import { planSeries, voiceVideo, writeVideo } from "./studio";
import { readFile } from "node:fs/promises";
import { choiceLabel, MEDIA_MODELS, parseChoice, parseMediaSettings, type MediaSettings, type MediaTask, type UploadedFile } from "../shared/media";
import { pickedClip, pickedPicture, type Scene, type TakeResult } from "../shared/studio";
import { audioFilePath } from "./audio";
import { deleteTake, fromUpload, lastFrame, loadTake, makeClip, makeLipSync, makePicture, saveTake, type Media } from "./media";

const MEDIA_SETTING = "media_settings";

export type StudioContext = {
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
   * What a scene's clip starts on and, when the next scene carries on from it, ends on.
   * It starts on the scene's storyboard picture; a scene that carries on starts instead on the very last
   * frame of the clip before it when there is one, so the join is exact. It ends on the next scene's
   * storyboard picture when that scene carries on, so the two meet on a frame the creator has reviewed.
   */
  async function clipFrames(
    videoId: unknown,
    sceneId: unknown,
  ): Promise<{ ok: true; video: Video; scene: Scene; index: number; start: Media; from: string; exact: boolean; end?: Media; to?: string } | { ok: false; error: string }> {
    const { video, scene } = find(videoId, sceneId);
    if (!video.approvedAt) return { ok: false, error: "Approve the script first. Clips are made for an approved script, so none are wasted on words that change." };
    const index = video.scenes.indexOf(scene);
    const picture = pickedPicture(scene);
    if (!picture) return { ok: false, error: `Scene ${index + 1} has no storyboard picture yet. Make it on the Storyboard tab first: the clip starts from it.` };
    let start: Media | undefined;
    let from = picture.id;
    const before = scene.continues && scene.madeBy === "ai" ? video.scenes[index - 1] : undefined;
    const beforeClip = before && pickedClip(before);
    if (beforeClip) {
      // Without FFmpeg, or if the frame cannot be read, the scene starts on its storyboard picture instead.
      const toolsDir = await ensureFfmpeg(ctx.dataDir());
      const frame = toolsDir ? await lastFrame(ctx.dataDir(), beforeClip, toolsDir).catch(() => null) : null;
      if (frame) {
        start = frame;
        from = beforeClip.id;
      }
    }
    start ??= await loadTake(ctx.dataDir(), picture);
    const next = video.scenes[index + 1];
    const nextPicture = next && next.continues && next.madeBy === "ai" ? pickedPicture(next) : undefined;
    return {
      ok: true,
      video,
      scene,
      index,
      start,
      from,
      exact: from !== picture.id,
      ...(nextPicture && { end: await loadTake(ctx.dataDir(), nextPicture), to: nextPicture.id }),
    };
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
        db().saveDoc("characters", character);
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
        const made = parseSeries({ id: randomUUID(), title, brief, production: from.production === undefined ? (ideas[0]?.production ?? "mix") : parseProduction(from.production), ideaIds: picked, postIds: inspired.posts.map((p) => p.id) });
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
      for (const character of result.value.newCharacters) db().saveDoc("characters", character);
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
        const base = { id: randomUUID(), createdAt: now, updatedAt: now, production: parseProduction(from.production) };
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
        let name = from.name;
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${from.name} ${n}`;
        to = parseCharacter({ id: randomUUID(), name, role: from.role, personality: from.personality, speech: from.speech, look: from.look, voice: null, pictures: [] });
        db().saveDoc("characters", to);
      }
      if (!to) return { ok: false, error: "The character to use is no longer there." };
      if (to.id === from.id) return { ok: true, value: { video, removed: false } };
      const target = to;

      // The old name, as a whole word, becomes the new one wherever the script says it.
      const named = new RegExp(`(?<![\\p{L}\\p{N}])${from.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu");
      const rename = (text: string) => (from.name && from.name !== target.name ? text.replace(named, target.name) : text);
      const recast = parseVideo({
        ...video,
        scenes: video.scenes.map((scene) => ({
          ...scene,
          action: rename(scene.action),
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
      for (const character of result.value.newCharacters) db().saveDoc("characters", character);
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
        if (!video.approvedAt) return { ok: false, error: "Approve the script first. Pictures are made for an approved script, so none are wasted on words that change." };
        const choice = choose("picture", override);
        const everyone = cast();
        const inScene = everyone.filter((c) => scene.characters.includes(c.id) || scene.lines.some((l) => l.speaker === c.id));
        // What the picture model is shown so the scenes belong together: for a scene that carries on, the storyboard
        // picture of the scene before; otherwise the nearest earlier scene in the same place.
        const here = scene.place.trim().toLowerCase();
        const index = video.scenes.findIndex((x) => x.id === scene.id);
        const before = video.scenes[index - 1];
        const carriesOn = scene.continues && before !== undefined && pickedPicture(before) !== undefined;
        const sameSet = carriesOn ? before : here ? [...video.scenes.slice(0, index)].reverse().find((x) => x.place.trim().toLowerCase() === here && pickedPicture(x)) : undefined;
        const setPicture = sameSet ? pickedPicture(sameSet) : undefined;
        const withPictures = inScene.filter((c) => c.pictures[0]).slice(0, setPicture ? 3 : 4);
        const look = video.look || series().find((s) => s.id === video.seriesId)?.look || "";
        const media = await makePicture(ctx.key, choice, {
          prompt: [
            "One storyboard frame of a vertical 9:16 short video: the first moment of this shot, as the finished video will show it.",
            look && `Style: ${look}`,
            scene.place && `Place: ${scene.place}.`,
            `What happens: ${scene.action}`,
            scene.camera && `Camera: ${scene.camera}.`,
            inScene.length
              ? `Characters in the shot: ${inScene.map((c) => `${c.name} (${c.look || c.role})`).join("; ")}.`
              : "",
            withPictures.length
              ? `The ${setPicture ? "other " : ""}reference pictures show, in order: ${withPictures.map((c) => c.name).join(", ")}. Keep each exactly as in their picture: same face, hair, clothes and colours.`
              : "",
            setPicture && carriesOn
              ? `The FIRST reference picture is the frame the previous shot started on (scene ${index}). This shot carries straight on from it with no cut, so this is the same take a few seconds later: the same place, people, clothes, props, light and camera position. Change only what the action above has changed by the moment this shot begins.`
              : setPicture
                ? `The FIRST reference picture is this same place in an earlier shot of the same video (scene ${video.scenes.indexOf(sameSet!) + 1}). This is the same room at the same moment: keep the same walls, furniture, props, light, time of day and what everyone wears. Only the framing and the instant change.`
                : "",
            "No captions, subtitles, logos or any text in the picture.",
            typeof note === "string" && note.trim() ? `Change from the last attempt: ${note.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          references: await Promise.all([...(setPicture ? [setPicture] : []), ...withPictures.map((c) => c.pictures[0])].map((take) => loadTake(ctx.dataDir(), take))),
          detail: `${video.title} · scene ${video.scenes.indexOf(scene) + 1}`,
        });
        const take = await saveTake(ctx.dataDir(), "videos", video.id, media, "ai", choiceLabel("picture", choice));
        return change(video.id, scene.id, (s) => ({ ...s, pictures: [...s.pictures, take], picture: take.id }));
      } catch (e) {
        return fail(e, "The picture could not be made.");
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

    /** Turns the scene's storyboard picture into a moving clip. */
    /** Turns the scene's chosen picture into a moving clip. */
    async sceneClip(videoId: unknown, sceneId: unknown, override: unknown): Promise<TakeResult> {
      try {
        const frames = await clipFrames(videoId, sceneId);
        if (!frames.ok) return frames;
        const { video, scene, index } = frames;
        const choice = choose("clip", override);
        const media = await makeClip(ctx.key, choice, {
          image: frames.start,
          end: frames.end,
          prompt: [
            frames.exact && "This shot continues the previous one without a cut: begin exactly on the given first frame and carry the same movement on.",
            scene.action,
            scene.camera && `Camera: ${scene.camera}.`,
            frames.end &&
              `The second picture is the last frame: move smoothly to it and end exactly on it, with no cut, no fade and no jump. It is the first frame of the next shot, which begins: ${video.scenes[index + 1].action}`,
            "Keep the characters and the place exactly as in the picture. No text on screen.",
          ]
            .filter(Boolean)
            .join(" "),
          seconds: scene.seconds,
          detail: `${video.title} · scene ${video.scenes.indexOf(scene) + 1}`,
        });
        const take = { ...(await saveTake(ctx.dataDir(), "videos", video.id, media, "ai", choiceLabel("clip", choice))), from: frames.from, ...(frames.to && { to: frames.to }) };
        return change(video.id, scene.id, (s) => ({ ...s, clips: [...s.clips, take], clip: take.id }));
      } catch (e) {
        return fail(e, "The clip could not be made.");
      }
    },

    /** Makes the scene's storyboard picture speak its first recorded AI line. */
    async sceneLipSync(videoId: unknown, sceneId: unknown, override: unknown): Promise<TakeResult> {
      try {
        const { scene: asked } = find(videoId, sceneId);
        if (!asked.lines.some((l) => l.audioFile)) return { ok: false, error: "This scene has no recorded line yet. Make the voices first." };
        const frames = await clipFrames(videoId, sceneId);
        if (!frames.ok) return frames;
        const { video, scene } = frames;
        const line = scene.lines.find((l) => l.audioFile);
        const audioPath = line?.audioFile ? audioFilePath(ctx.dataDir(), line.audioFile) : null;
        if (!audioPath) return { ok: false, error: "This scene has no recorded line yet. Make the voices first." };
        const choice = choose("lipsync", override);
        const media = await makeLipSync(ctx.key, choice, {
          image: frames.start,
          audio: { bytes: await readFile(audioPath), mime: "audio/mpeg" },
          detail: `${video.title} · scene ${video.scenes.indexOf(scene) + 1}`,
        });
        const take = { ...(await saveTake(ctx.dataDir(), "videos", video.id, media, "lipsync", choiceLabel("lipsync", choice))), from: frames.from };
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
