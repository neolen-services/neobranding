// The video editor's projects: storing them, bringing media in (files or a Studio video), transcribing,
// showing frames to the editing agent, and exporting the finished MP4 with FFmpeg.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  captionsToSrt,
  clipLength,
  EDIT_FILE,
  emptyProject,
  estimateWords,
  parseProject,
  projectLength,
  wordsToCaptions,
  type EditAsset,
  type EditAudio,
  type EditClip,
  type EditProject,
  type EditResult,
  type EditSummary,
  type EditTimeline,
  type EditWord,
  type Look,
  type Motion,
  type OverlayFrame,
} from "../shared/edit";
import type { UploadedFile } from "../shared/media";
import { parseCharacter, parseVideo, pickedClip, pickedPicture, speakerName, type Video } from "../shared/studio";
import { audioFilePath, generateMusic, generateSoundEffect } from "./audio";
import { fromUpload, mediaFilePath } from "./media";
import { ensureFfmpeg } from "./research";
import type { Store } from "./store";
import { recordUsage } from "./usage";

const EXE = process.platform === "win32" ? ".exe" : "";
const run = promisify(execFile);

const EXTENSION_OF: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
};
const KIND_OF: Record<string, EditAsset["kind"]> = { mp4: "video", mov: "video", webm: "video", m4v: "video", png: "image", jpg: "image", jpeg: "image", webp: "image", mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio" };
const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4" };
const MAX_UPLOAD = 500 * 1024 * 1024;
/** How long a picture is shown when it is put on the timeline. */
const PICTURE_SECONDS = 3;

export type EditContext = { dataDir: () => string; store: () => Store };

/** What is happening in an export right now, by project id: a share from 0 to 1. */
const exporting = new Map<string, number>();
export const exportProgress = (id: string) => exporting.get(id) ?? null;

const tools = async (dataDir: string) => {
  const dir = await ensureFfmpeg(dataDir);
  if (!dir) throw new Error("FFmpeg could not be set up on this computer, so media cannot be read or exported. Check your internet connection and try again.");
  return { ffmpeg: join(dir, `ffmpeg${EXE}`), ffprobe: join(dir, `ffprobe${EXE}`) };
};

/** Length, size and whether there is sound, read with ffprobe. */
async function probe(dataDir: string, path: string): Promise<{ seconds: number; width: number; height: number; hasAudio: boolean; hasVideo: boolean }> {
  const { ffprobe } = await tools(dataDir);
  const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", path], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const info = JSON.parse(stdout) as { streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[]; format?: { duration?: string } };
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const seconds = Number(info.format?.duration ?? video?.duration ?? 0);
  return { seconds: Number.isFinite(seconds) ? seconds : 0, width: video?.width ?? 0, height: video?.height ?? 0, hasAudio: streams.some((s) => s.codec_type === "audio"), hasVideo: Boolean(video) };
}

export function editOps(ctx: EditContext) {
  const db = ctx.store;
  const projects = (): EditProject[] =>
    db()
      .listDocs<unknown>("edits")
      .flatMap((p) => {
        try {
          return [parseProject(p)];
        } catch {
          return [];
        }
      });
  const find = (id: unknown) => projects().find((p) => p.id === String(id));
  const save = (project: EditProject): EditProject => {
    const clean = parseProject({ ...project, updatedAt: new Date().toISOString() });
    db().saveDoc("edits", clean);
    return clean;
  };
  const folder = (id: string) => join(ctx.dataDir(), "edits", id);
  const failed = (e: unknown, fallback: string): EditResult => ({ ok: false, error: e instanceof Error ? e.message : fallback });

  /** Stores bytes as a new file of the project and reads what it is. */
  async function addFile(project: EditProject, bytes: Buffer, extension: string, name: string, origin: EditAsset["origin"]): Promise<EditAsset> {
    const kind = KIND_OF[extension];
    if (!kind) throw new Error(`${name}: that kind of file is not supported. Use MP4, MOV, WebM, PNG, JPEG, WebP, MP3, WAV, M4A or OGG.`);
    if (bytes.length === 0) throw new Error(`${name} is empty.`);
    const id = randomUUID();
    const file = `edits/${project.id}/${id}.${extension}`;
    if (!EDIT_FILE.test(file)) throw new Error("That file cannot be stored.");
    await mkdir(folder(project.id), { recursive: true });
    const path = join(ctx.dataDir(), file);
    await writeFile(path, bytes);
    try {
      const info = kind === "image" ? { ...(await probe(ctx.dataDir(), path)), seconds: PICTURE_SECONDS, hasAudio: false } : await probe(ctx.dataDir(), path);
      if (kind === "video" && !info.hasVideo) throw new Error(`${name} has no picture in it.`);
      const asset: EditAsset = { id, kind, file, name, seconds: info.seconds, width: info.width, height: info.height, hasAudio: kind !== "image" && info.hasAudio, origin, words: null, createdAt: new Date().toISOString() };
      return { ...asset, ...(await timelinePictures(ctx.dataDir(), project.id, asset)) };
    } catch (e) {
      await rm(path, { force: true });
      throw e instanceof Error && e.message.startsWith(name) ? e : new Error(`${name} could not be read. It may be damaged or in a format FFmpeg does not know.`);
    }
  }

  const copyIn = async (project: EditProject, source: string, name: string, origin: EditAsset["origin"]) => {
    const extension = source.split(".").pop()!.toLowerCase();
    return addFile(project, await readFile(source), extension, name, origin);
  };

  /** Makes the timeline pictures a file is missing (for projects made before they existed). Saves only if any were made. */
  async function prepare(id: unknown): Promise<EditProject | null> {
    const project = find(id);
    if (!project) return null;
    let changed = false;
    const assets: EditAsset[] = [];
    for (const a of project.assets) {
      const wants = (a.kind === "video" && !a.thumbs) || ((a.kind === "audio" || a.hasAudio) && !a.wave);
      if (!wants) {
        assets.push(a);
        continue;
      }
      const made = await timelinePictures(ctx.dataDir(), project.id, a).catch(() => ({}));
      if (Object.keys(made).length) changed = true;
      assets.push({ ...a, ...made });
    }
    if (!changed) return project;
    const latest = find(project.id) ?? project;
    // Only the pictures are added; the timeline as it is now is kept.
    return save({ ...latest, assets: latest.assets.map((a) => assets.find((b) => b.id === a.id) ?? a) });
  }

  const summary = (p: EditProject): EditSummary => {
    const first = p.clips[0] && p.assets.find((a) => a.id === p.clips[0].assetId);
    return { id: p.id, title: p.title, updatedAt: p.updatedAt, seconds: projectLength(p), clips: p.clips.length, cover: first && first.kind !== "audio" ? first.file : "", exported: p.exports.length > 0 };
  };

  return {
    projects,
    find,
    save,
    prepare,

    /** Puts the timeline back as it was at a checkpoint. The media stays as it is now, so nothing added since is lost. */
    restore(id: unknown, timeline: EditTimeline): EditResult {
      const project = find(id);
      if (!project) return { ok: false, error: "That project is gone." };
      const known = new Set(project.assets.map((a) => a.id));
      return {
        ok: true,
        project: save({
          ...project,
          ...timeline,
          clips: timeline.clips.filter((c) => known.has(c.assetId)),
          audio: timeline.audio.filter((a) => known.has(a.assetId)),
        }),
      };
    },

    /** Makes the captions again from every word that will be heard, a few words at a time. */
    remakeCaptions(id: unknown, maxWords: unknown): EditResult {
      const project = find(id);
      if (!project) return { ok: false, error: "That project is gone." };
      const captions = captionsFromSpeech(project, Math.min(Math.max(Math.round(Number(maxWords) || 3), 1), 5));
      if (captions.length === 0) return { ok: false, error: "Nothing heard in this video has been transcribed yet. Transcribe its voice or video files first (in Media)." };
      return { ok: true, project: save({ ...project, captions, showCaptions: true }) };
    },
    list: (): EditSummary[] => projects().map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),

    create(title: unknown): EditResult {
      const name = String(title ?? "").trim().slice(0, 120) || "Untitled edit";
      return { ok: true, project: save(emptyProject(randomUUID(), name)) };
    },

    /** Saves the creator's own change to the timeline. The media list cannot be changed this way, only the arrangement. */
    update(input: unknown): EditResult {
      try {
        const next = parseProject(input);
        const before = find(next.id);
        if (!before) return { ok: false, error: "That project is gone." };
        return { ok: true, project: save({ ...next, assets: before.assets, exports: before.exports, costUsd: before.costUsd, createdAt: before.createdAt }) };
      } catch (e) {
        return failed(e, "The change could not be saved.");
      }
    },

    async remove(id: unknown): Promise<void> {
      const project = find(id);
      if (!project) return;
      db().deleteDoc("edits", project.id);
      await rm(folder(project.id), { recursive: true, force: true });
    },

    /**
     * Adds files the creator chose. Videos and pictures are put on the end of the picture track; sound files
     * wait in the media list until they are placed.
     */
    async importFiles(id: unknown, files: unknown): Promise<EditResult> {
      const project = find(id);
      if (!project) return { ok: false, error: "That project is gone." };
      const items = Array.isArray(files) ? (files as { name?: unknown; file?: UploadedFile }[]) : [];
      const added: EditAsset[] = [];
      try {
        for (const item of items) {
          const media = fromUpload(item.file);
          const name = String(item.name ?? "File").slice(0, 120);
          if (media.bytes.length > MAX_UPLOAD) throw new Error(`${name} is over 500 MB. Trim or compress it first.`);
          const extension = EXTENSION_OF[media.mime] ?? name.split(".").pop()?.toLowerCase() ?? "";
          added.push(await addFile(project, media.bytes, extension, name, "upload"));
        }
      } catch (e) {
        if (added.length === 0) return failed(e, "The files could not be added.");
      }
      const clips = added.filter((a) => a.kind !== "audio").map((a) => newClip(a));
      return { ok: true, project: save({ ...project, assets: [...project.assets, ...added], clips: [...project.clips, ...clips] }) };
    },

    /**
     * Starts a project from a Studio video: every scene's clip (or its storyboard where there is no clip yet),
     * each recorded line placed where its scene starts, the script's on-screen text, and captions from the words
     * of the script timed to the recordings.
     */
    async fromVideo(videoId: unknown): Promise<EditResult> {
      const raw = db().listDocs<unknown>("videos").map(parseVideo).find((v) => v.id === String(videoId));
      if (!raw) return { ok: false, error: "That Studio video is gone." };
      const video: Video = raw;
      if (video.scenes.length === 0) return { ok: false, error: "That video has no script yet." };
      const cast = db().listDocs<unknown>("characters").map(parseCharacter);
      let project = emptyProject(randomUUID(), video.title);
      project.fromVideoId = video.id;
      try {
        let t = 0;
        const sceneStart: number[] = [];
        for (const [i, scene] of video.scenes.entries()) {
          sceneStart.push(t);
          const clip = pickedClip(scene);
          const picture = pickedPicture(scene);
          const take = clip ?? picture;
          const source = take ? mediaFilePath(ctx.dataDir(), take.file) : null;
          // Lines are said one after another from where the scene starts, a little apart.
          const lines: { asset: EditAsset; at: number }[] = [];
          let said = 0.15;
          const ownSound = clip && (clip.source === "lipsync" || clip.source === "filmed");
          for (const [j, line] of scene.lines.entries()) {
            const path = line.audioFile ? audioFilePath(ctx.dataDir(), line.audioFile) : null;
            if (!path || ownSound) continue;
            const asset = await copyIn(project, path, `Scene ${i + 1}, line ${j + 1}: ${speakerName(line.speaker, cast)}`, "studio");
            asset.words = estimateWords(line.text, asset.seconds);
            asset.wordsEstimated = true;
            lines.push({ asset, at: said });
            said += asset.seconds + 0.12;
            project.assets.push(asset);
          }
          if (source && existsSync(source)) {
            const asset = await copyIn(project, source, `Scene ${i + 1} ${clip ? "clip" : "storyboard"}`, "studio");
            if (ownSound && scene.lines.length) {
              asset.words = estimateWords(scene.lines.map((l) => l.text).join(" "), asset.seconds);
              asset.wordsEstimated = true;
            }
            project.assets.push(asset);
            const c = newClip(asset);
            if (!clip) c.out = Math.max(scene.seconds, said);
            // When the lines run longer than the clip, the clip is slowed to fit them (to half speed at most).
            const length = c.out - c.in;
            if (clip && said > length + 0.2) c.speed = Math.max(length / said, 0.5);
            if (asset.kind === "image") c.motion = "zoom-in";
            project.clips.push(c);
          }
          // A scene with nothing to show yet (still to be filmed) takes only as long as its recorded lines.
          const shown = Boolean(source && existsSync(source));
          const sceneLength = shown ? clipLength(project.clips[project.clips.length - 1]) : lines.length ? said : 0;
          for (const l of lines) project.audio.push(newAudio(l.asset, "voice", t + l.at));
          if (scene.text && sceneLength > 0) project.texts.push({ id: randomUUID(), text: scene.text, start: t, end: t + Math.min(sceneLength, 3.5), position: "top", style: "title" });
          t += sceneLength;
        }
        sceneStart.push(t);
        // The video's music, each piece under the scenes it was chosen for. Music is kept low under speech by the export.
        for (const cue of video.music?.cues ?? []) {
          const path = cue.audioFile && cue.madeFrom === cue.prompt ? audioFilePath(ctx.dataDir(), cue.audioFile) : null;
          if (!path) continue;
          const asset = await copyIn(project, path, `Music: ${cue.label}`, "studio");
          project.assets.push(asset);
          const start = sceneStart[cue.fromScene - 1] ?? 0;
          const end = sceneStart[Math.min(cue.toScene, video.scenes.length)] ?? t;
          project.audio.push({ ...newAudio(asset, "music", start), out: Math.min(asset.seconds, Math.max(end - start, 0.5)), volume: cue.volume, fadeIn: 0.4, fadeOut: 0.8 });
        }
      } catch (e) {
        await rm(folder(project.id), { recursive: true, force: true });
        return failed(e, "The video could not be brought in.");
      }
      project.captions = captionsFromSpeech(project);
      project = save(project);
      return { ok: true, project };
    },

    /** Hears the words in a video or sound file with Deepgram, with the time of each word. */
    async transcribe(id: unknown, assetId: unknown, deepgramKey: string): Promise<EditResult & { seconds?: number }> {
      const project = find(id);
      const asset = project?.assets.find((a) => a.id === assetId);
      if (!project || !asset) return { ok: false, error: "That file is not in the project." };
      if (asset.kind === "image" || (asset.kind === "video" && !asset.hasAudio)) return { ok: false, error: `${asset.name} has no sound to transcribe.` };
      if (!deepgramKey) return { ok: false, error: "Add your Deepgram API key in Settings to transcribe." };
      try {
        const heard = await hearWords(join(ctx.dataDir(), asset.file), deepgramKey);
        recordUsage({ feature: "transcript", detail: `Editor: ${project.title}`, seconds: heard.seconds });
        const next = { ...project, assets: project.assets.map((a) => (a.id === asset.id ? { ...a, words: heard.words, wordsEstimated: undefined } : a)) };
        return { ok: true, project: save(next), seconds: heard.seconds };
      } catch (e) {
        return failed(e, "It could not be transcribed.");
      }
    },

    /** Small pictures of a video at the given times (or a picture as it is), for the editing agent to look at. */
    async frames(id: unknown, assetId: unknown, times: number[]): Promise<{ time: number; base64: string }[]> {
      const project = find(id);
      const asset = project?.assets.find((a) => a.id === assetId);
      if (!project || !asset || asset.kind === "audio") throw new Error("That file has no picture.");
      const { ffmpeg } = await tools(ctx.dataDir());
      const work = await mkdtemp(join(tmpdir(), "edit-look-"));
      try {
        const out: { time: number; base64: string }[] = [];
        const at = asset.kind === "image" ? [0] : times.map((t) => Math.min(Math.max(t, 0), Math.max(asset.seconds - 0.05, 0))).slice(0, 8);
        for (const [i, time] of at.entries()) {
          const file = join(work, `${i}.jpg`);
          await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-ss", time.toFixed(2), "-i", join(ctx.dataDir(), asset.file), "-frames:v", "1", "-vf", "scale=-2:640", "-q:v", "5", file], { windowsHide: true });
          out.push({ time, base64: (await readFile(file)).toString("base64") });
        }
        return out;
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },

    /** Makes music with ElevenLabs and puts it under the whole video, in place of any music there was. */
    async makeMusic(id: unknown, description: unknown, elevenKey: string): Promise<EditResult> {
      const project = find(id);
      const said = String(description ?? "").trim();
      if (!project) return { ok: false, error: "That project is gone." };
      if (!said) return { ok: false, error: "Describe the music first." };
      try {
        const made = await this.generateAudio(project.id, "music", said, Math.max(Math.ceil(projectLength(project) + 1), 10), elevenKey);
        const item = newAudio(made.asset, "music", 0);
        return { ok: true, project: save({ ...made.project, audio: [...made.project.audio.filter((a) => a.role !== "music"), item] }) };
      } catch (e) {
        return failed(e, "The music could not be made.");
      }
    },

    /** Makes music or a sound effect with ElevenLabs and adds it to the project's media. */
    async generateAudio(id: unknown, kind: "music" | "sfx", description: string, seconds: number, elevenKey: string): Promise<{ project: EditProject; asset: EditAsset }> {
      const project = find(id);
      if (!project) throw new Error("That project is gone.");
      const made =
        kind === "music"
          ? await generateMusic(ctx.dataDir(), elevenKey, { description, seconds, instrumental: true, title: `${project.title}: music` })
          : await generateSoundEffect(ctx.dataDir(), elevenKey, { description, seconds, title: `${project.title}: ${description}` });
      if (!made.ok) throw new Error(made.error);
      const path = audioFilePath(ctx.dataDir(), made.audio.file);
      if (!path) throw new Error("The sound was made but its file is missing.");
      const asset = await copyIn(project, path, `${kind === "music" ? "Music" : "Sound"}: ${description.slice(0, 60)}`, "generated");
      return { project: save({ ...project, assets: [...project.assets, asset] }), asset };
    },

    /**
     * Makes the MP4. `overlays` are the captions and text, drawn by the interface exactly as the preview shows them,
     * each a full-frame transparent picture with the time it is on screen. They cover the whole video in order.
     */
    async exportVideo(id: unknown, overlays: unknown): Promise<EditResult> {
      const project = find(id);
      if (!project) return { ok: false, error: "That project is gone." };
      if (project.clips.length === 0) return { ok: false, error: "Put at least one clip on the timeline first." };
      if (exporting.has(project.id)) return { ok: false, error: "This project is already being exported." };
      const frames = (Array.isArray(overlays) ? overlays : []) as OverlayFrame[];
      exporting.set(project.id, 0);
      const work = await mkdtemp(join(tmpdir(), "edit-export-"));
      try {
        const { ffmpeg } = await tools(ctx.dataDir());
        const name = `export-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const file = `edits/${project.id}/${name}.mp4`;
        const total = projectLength(project);
        const args = await exportArgs(ctx.dataDir(), project, frames, work, join(ctx.dataDir(), file), total);
        await runWithProgress(ffmpeg, args, total, (share) => exporting.set(project.id, share));
        const srt = `edits/${project.id}/${name}.srt`;
        if (project.captions.length) await writeFile(join(ctx.dataDir(), srt), captionsToSrt(project.captions), "utf8");
        const latest = find(project.id) ?? project;
        return { ok: true, project: save({ ...latest, exports: [{ file, srt: project.captions.length ? srt : "", seconds: total, createdAt: new Date().toISOString() }, ...latest.exports].slice(0, 10) }) };
      } catch (e) {
        return failed(e, "The video could not be exported.");
      } finally {
        exporting.delete(project.id);
        await rm(work, { recursive: true, force: true });
      }
    },
  };
}

export function newClip(asset: EditAsset): EditClip {
  return { id: randomUUID(), assetId: asset.id, in: 0, out: asset.kind === "image" ? PICTURE_SECONDS : asset.seconds, speed: 1, look: "none", motion: "none", transition: "cut", volume: 1 };
}

export function newAudio(asset: EditAsset, role: EditAudio["role"], start: number): EditAudio {
  return { id: randomUUID(), assetId: asset.id, role, start, in: 0, out: asset.seconds, volume: role === "music" ? 0.35 : 1, fadeIn: role === "music" ? 0.5 : 0, fadeOut: role === "music" ? 1.5 : 0 };
}

/**
 * Captions from every word that will be heard: the voice lines and music-free sound on the timeline, and the
 * clips' own sound, each moved to where it plays.
 */
export function captionsFromSpeech(project: EditProject, maxWords = 3) {
  const asset = (id: string) => project.assets.find((a) => a.id === id);
  const words: EditWord[] = [];
  let t = 0;
  for (const c of project.clips) {
    const a = asset(c.assetId);
    if (a?.words && c.volume > 0) for (const w of a.words) if (w.start >= c.in && w.end <= c.out + 0.05) words.push({ text: w.text, start: t + (w.start - c.in) / c.speed, end: t + (Math.min(w.end, c.out) - c.in) / c.speed });
    t += clipLength(c);
  }
  for (const item of project.audio.filter((x) => x.role === "voice")) {
    const a = asset(item.assetId);
    if (a?.words) for (const w of a.words) if (w.start >= item.in && w.end <= item.out + 0.05) words.push({ text: w.text, start: item.start + w.start - item.in, end: item.start + Math.min(w.end, item.out) - item.in });
  }
  return wordsToCaptions(words, maxWords);
}

/** Sends a file to Deepgram and returns each word with its time. */
async function hearWords(path: string, key: string): Promise<{ words: EditWord[]; seconds: number }> {
  let response: Response;
  try {
    response = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=multi", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": AUDIO_MIME[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" },
      body: await readFile(path),
    });
  } catch {
    throw new Error("Could not reach Deepgram. Check your internet connection.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("Deepgram rejected the API key. Check it in Settings.");
  if (response.status === 402) throw new Error("Your Deepgram account is out of credit.");
  if (!response.ok) throw new Error(`Deepgram could not transcribe it (HTTP ${response.status}).`);
  const body = (await response.json()) as { metadata?: { duration?: number }; results?: { channels?: { alternatives?: { words?: { word?: string; punctuated_word?: string; start?: number; end?: number }[] }[] }[] } };
  const words = (body.results?.channels?.[0]?.alternatives?.[0]?.words ?? [])
    .map((w) => ({ text: (w.punctuated_word || w.word || "").trim(), start: Number(w.start ?? 0), end: Number(w.end ?? 0) }))
    .filter((w) => w.text);
  return { words, seconds: Number(body.metadata?.duration ?? 0) || 0 };
}

/**
 * Small pictures for the timeline: a strip of frames from a video (one every second or so, up to 40), and a picture
 * of the waveform of anything with sound. Best effort: a file that cannot be drawn simply has none.
 */
async function timelinePictures(dataDir: string, projectId: string, asset: EditAsset): Promise<Partial<EditAsset>> {
  const out: Partial<EditAsset> = {};
  const { ffmpeg } = await tools(dataDir);
  const source = join(dataDir, asset.file);
  if (asset.kind === "video" && asset.seconds > 0) {
    const count = Math.min(Math.max(Math.round(asset.seconds), 1), 40);
    const every = asset.seconds / count;
    const file = `edits/${projectId}/${asset.id}-thumbs.jpg`;
    try {
      await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-vf", `fps=${(1 / every).toFixed(4)},scale=-2:96,tile=${count}x1`, "-frames:v", "1", "-q:v", "6", join(dataDir, file)], { windowsHide: true });
      if (existsSync(join(dataDir, file))) out.thumbs = { file, count, every };
    } catch {
      // No strip; the timeline shows the clip's name instead.
    }
  }
  if (asset.kind === "audio" || asset.hasAudio) {
    const file = `edits/${projectId}/${asset.id}-wave.png`;
    try {
      const width = Math.min(Math.max(Math.round(asset.seconds * 60), 200), 4000);
      await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-filter_complex", `[0:a]aformat=channel_layouts=mono,showwavespic=s=${width}x64:colors=white:scale=sqrt`, "-frames:v", "1", join(dataDir, file)], { windowsHide: true });
      if (existsSync(join(dataDir, file))) out.wave = file;
    } catch {
      // No waveform.
    }
  }
  return out;
}

// ---------- Export ----------

const LOOK_FILTERS: Record<Look, string> = {
  none: "",
  warm: "colorbalance=rs=0.06:gs=0.01:bs=-0.06:rm=0.05:bm=-0.05",
  cool: "colorbalance=rs=-0.05:bs=0.07:rm=-0.04:bm=0.06",
  bw: "hue=s=0,eq=contrast=1.1",
  vivid: "eq=saturation=1.35:contrast=1.06",
  contrast: "eq=contrast=1.22:brightness=-0.02",
  faded: "eq=contrast=0.86:saturation=0.78:brightness=0.04",
};

/** The zoom and pan of a clip, as FFmpeg's zoompan, over `frames` frames. */
function motionFilter(motion: Motion, frames: number, w: number, h: number, fps: number) {
  if (motion === "none") return "";
  const n = Math.max(frames - 1, 1);
  const centre = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  const z =
    motion === "zoom-in" ? `z='1+0.12*on/${n}':${centre}` :
    motion === "zoom-out" ? `z='1.12-0.12*on/${n}':${centre}` :
    motion === "punch-in" ? `z='1.18':${centre}` :
    motion === "pan-left" ? `z='1.15':x='(iw-iw/zoom)*(1-on/${n})':y='ih/2-(ih/zoom/2)'` :
    `z='1.15':x='(iw-iw/zoom)*on/${n}':y='ih/2-(ih/zoom/2)'`;
  return `zoompan=${z}:d=1:s=${w}x${h}:fps=${fps}`;
}

/** FFmpeg changes speed in steps of half to double; other speeds are made from several steps. */
function tempo(speed: number) {
  const steps: string[] = [];
  let left = speed;
  while (left > 2) {
    steps.push("atempo=2");
    left /= 2;
  }
  while (left < 0.5) {
    steps.push("atempo=0.5");
    left /= 0.5;
  }
  if (Math.abs(left - 1) > 0.001) steps.push(`atempo=${left.toFixed(4)}`);
  return steps.join(",");
}

async function exportArgs(dataDir: string, p: EditProject, overlays: OverlayFrame[], work: string, out: string, total: number): Promise<string[]> {
  const W = p.width;
  const H = p.height;
  const fps = p.fps;
  const inputs: string[] = [];
  const graph: string[] = [];
  let n = 0;
  const asset = (id: string) => p.assets.find((a) => a.id === id)!;
  const path = (a: EditAsset) => {
    const full = mediaFilePath(dataDir, a.file);
    if (!full || !existsSync(full)) throw new Error(`${a.name} is missing from the project's folder.`);
    return full;
  };

  // The picture track: each clip cut, sized to fill the frame, moved, coloured and faded, with its own sound.
  const segments: string[] = [];
  for (const [i, c] of p.clips.entries()) {
    const a = asset(c.assetId);
    const length = clipLength(c);
    const source = c.out - c.in;
    if (a.kind === "image") inputs.push("-loop", "1", "-framerate", String(fps), "-t", source.toFixed(3), "-i", path(a));
    else inputs.push("-ss", c.in.toFixed(3), "-t", source.toFixed(3), "-i", path(a));
    const k = n++;
    const frames = Math.max(Math.round(length * fps), 1);
    const video = [
      Math.abs(c.speed - 1) > 0.001 ? `setpts=PTS/${c.speed}` : "",
      `scale=${W}:${H}:force_original_aspect_ratio=increase`,
      `crop=${W}:${H}`,
      "setsar=1",
      `fps=${fps}`,
      motionFilter(c.motion, frames, W, H, fps),
      LOOK_FILTERS[c.look],
      c.transition === "fade" ? `fade=t=in:st=0:d=${Math.min(0.35, length / 2).toFixed(2)}` : "",
      `trim=duration=${length.toFixed(3)}`,
      "setpts=PTS-STARTPTS",
      "format=yuv420p",
    ].filter(Boolean);
    graph.push(`[${k}:v]${video.join(",")}[v${i}]`);
    if (a.kind === "video" && a.hasAudio && c.volume > 0) {
      graph.push(`[${k}:a]${[tempo(c.speed), `volume=${c.volume}`, "aresample=48000", "aformat=channel_layouts=stereo", "apad", `atrim=duration=${length.toFixed(3)}`, "asetpts=PTS-STARTPTS"].filter(Boolean).join(",")}[a${i}]`);
    } else {
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${length.toFixed(3)}[a${i}]`);
    }
    segments.push(`[v${i}][a${i}]`);
  }
  graph.push(`${segments.join("")}concat=n=${p.clips.length}:v=1:a=1[vcat][acat]`);
  // Sound that runs on past the last clip holds its final frame.
  const picture = p.clips.reduce((t, c) => t + clipLength(c), 0);
  let video = "vcat";
  if (total > picture + 0.01) {
    graph.push(`[vcat]tpad=stop_mode=clone:stop_duration=${(total - picture).toFixed(3)}[vpad]`);
    video = "vpad";
  }

  // Captions and text, drawn by the interface, as one see-through picture track over the top.
  if (overlays.length) {
    const lines: string[] = ["ffconcat version 1.0"];
    for (const [i, o] of overlays.entries()) {
      const match = /^data:image\/png;base64,(.+)$/.exec(String(o.png ?? ""));
      if (!match) throw new Error("A caption picture could not be read.");
      const name = `o${i}.png`;
      await writeFile(join(work, name), Buffer.from(match[1], "base64"));
      lines.push(`file '${name}'`, `duration ${Math.max(Number(o.end) - Number(o.start), 0.001).toFixed(3)}`);
    }
    // The last picture is listed twice so its duration is kept.
    lines.push(`file 'o${overlays.length - 1}.png'`);
    await writeFile(join(work, "overlays.txt"), lines.join("\n"), "utf8");
    inputs.push("-f", "concat", "-safe", "0", "-i", join(work, "overlays.txt"));
    const k = n++;
    graph.push(`[${k}:v]format=rgba,scale=${W}:${H},fps=${fps}[ov]`);
    graph.push(`[${video}][ov]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[vout]`);
  } else {
    graph.push(`[${video}]format=yuv420p[vout]`);
  }

  // Sound: voices and effects mixed with the clips' sound; music under it, turned down while anyone speaks.
  const speech: string[] = ["[acat]"];
  const music: string[] = [];
  for (const [j, item] of p.audio.entries()) {
    const a = asset(item.assetId);
    if (item.out - item.in <= 0.01 || item.volume <= 0) continue;
    inputs.push("-i", path(a));
    const k = n++;
    const length = item.out - item.in;
    const delay = Math.round(item.start * 1000);
    const chain = [
      `atrim=start=${item.in.toFixed(3)}:end=${item.out.toFixed(3)}`,
      "asetpts=PTS-STARTPTS",
      item.fadeIn > 0 ? `afade=t=in:st=0:d=${Math.min(item.fadeIn, length).toFixed(2)}` : "",
      item.fadeOut > 0 ? `afade=t=out:st=${Math.max(length - item.fadeOut, 0).toFixed(2)}:d=${Math.min(item.fadeOut, length).toFixed(2)}` : "",
      `volume=${item.volume}`,
      "aresample=48000",
      "aformat=channel_layouts=stereo",
      delay > 0 ? `adelay=${delay}|${delay}` : "",
    ].filter(Boolean);
    graph.push(`[${k}:a]${chain.join(",")}[x${j}]`);
    (item.role === "music" ? music : speech).push(`[x${j}]`);
  }
  graph.push(speech.length > 1 ? `${speech.join("")}amix=inputs=${speech.length}:normalize=0:duration=longest[speech]` : `[acat]anull[speech]`);
  if (music.length) {
    graph.push(music.length > 1 ? `${music.join("")}amix=inputs=${music.length}:normalize=0:duration=longest[music]` : `${music[0]}anull[music]`);
    graph.push(`[speech]asplit=2[sp1][sp2]`);
    graph.push(`[music][sp2]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[ducked]`);
    graph.push(`[sp1][ducked]amix=inputs=2:normalize=0:duration=first[mix]`);
  } else {
    graph.push(`[speech]anull[mix]`);
  }
  // Platforms play everything at about -14 LUFS; levelled here, the video is neither quieter nor louder than the rest of the feed.
  graph.push(`[mix]apad,atrim=duration=${total.toFixed(3)},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);

  return [
    "-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
    ...inputs,
    "-filter_complex", graph.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k",
    "-t", total.toFixed(3),
    "-movflags", "+faststart",
    out,
  ];
}

/** Runs FFmpeg, reporting how far it has got, and throws with its error message if it fails. */
function runWithProgress(ffmpeg: string, args: string[], total: number, onProgress: (share: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const match = /out_time_us=(\d+)/.exec(chunk.toString());
      if (match && total > 0) onProgress(Math.min(Number(match[1]) / 1e6 / total, 0.99));
    });
    child.stderr.on("data", (chunk: Buffer) => (errors = (errors + chunk.toString()).slice(-4000)));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg could not make the video: ${errors.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`}`))));
  });
}

