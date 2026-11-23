// Downloads posts (videos and pictures) for research and keeps them on disk.
// Plain Node code with relative imports only: it runs in the Electron main
// process and in the dev server's middleware (see electron.vite.config.ts).
//
// Tools, in the tools folder (see setToolsDir), fetched on first use:
//   yt-dlp(.exe)                the downloader
//   ffmpeg, ffprobe             joins picture and sound for full quality
// Layout under the data folder:
//   research/<id>/N.<ext>       part N of the post: a video (with poster N.jpg) or a picture
//   research/<id>/meta.json     the ResearchItem
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzePost, groupPosts, stylePost, type ConceptGroup } from "./analyze";
import { recordUsage } from "./usage";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  cleanGroupName,
  detectPlatform,
  postKey,
  PLATFORM_LABELS,
  SUPPORTED_LINKS_HINT,
  type GroupingResult,
  type ResearchAudio,
  type ResearchEdit,
  type ResearchItem,
  type ResearchMedia,
  type ResearchResult,
} from "../shared/research";

const YT_DLP_RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const YT_DLP_ASSET =
  process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp";

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const VIDEO_EXTENSIONS = ["mp4", "webm", "mkv", "mov", "m4v"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const ID_PATTERN = /^[0-9a-f-]{36}$/;
const FILE_PATTERN = /^[\w.-]+$/;

const researchDir = (dataDir: string) => join(dataDir, "research");

// Downloaded tools are not user data: they are large and differ per operating
// system, so they are kept outside the data folder and fetched again on a new computer.
let toolsDir = "";
export function setToolsDir(dir: string): void {
  toolsDir = dir;
}
const binDirFor = (dataDir: string) => toolsDir || join(dataDir, "bin");

/** Downloads a file, writing to a temporary name first so a broken download is never used. */
async function downloadTo(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
  const partial = `${target}.partial`;
  await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(partial));
  await rename(partial, target);
}

/** Fetches yt-dlp from its official releases the first time it is needed. */
async function ensureYtDlp(dataDir: string): Promise<string> {
  const binDir = binDirFor(dataDir);
  const target = join(binDir, YT_DLP_ASSET);
  if (existsSync(target)) return target;

  await mkdir(binDir, { recursive: true });
  try {
    await downloadTo(YT_DLP_RELEASE + YT_DLP_ASSET, target);
  } catch {
    throw new Error("Could not download the video downloader. Check your internet connection.");
  }
  await chmod(target, 0o755);
  return target;
}

// FFmpeg joins the separate picture and sound files that sites offer for their
// best quality. These builds are published by the yt-dlp project.
const FFMPEG_RELEASE = "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/";
const FFMPEG_ASSET =
  process.platform === "win32"
    ? "ffmpeg-master-latest-win64-gpl.zip"
    : process.platform === "linux" && process.arch === "x64"
      ? "ffmpeg-master-latest-linux64-gpl.tar.xz"
      : null; // No build for this system: videos are saved at the best ready-made quality instead.
const EXE = process.platform === "win32" ? ".exe" : "";

let ffmpegSetup: Promise<string | null> | undefined;

/**
 * Fetches FFmpeg the first time it is needed and returns the folder holding it,
 * or null if it is unavailable. Never throws: without FFmpeg the app still
 * saves videos, at lower quality.
 */
export function ensureFfmpeg(dataDir: string): Promise<string | null> {
  const binDir = binDirFor(dataDir);
  if (existsSync(join(binDir, `ffmpeg${EXE}`)) && existsSync(join(binDir, `ffprobe${EXE}`))) {
    return Promise.resolve(binDir);
  }
  if (!FFMPEG_ASSET) return Promise.resolve(null);

  // One download at a time, even if two posts are saved together.
  ffmpegSetup ??= (async () => {
    const archive = join(binDir, FFMPEG_ASSET);
    try {
      await mkdir(binDir, { recursive: true });
      await downloadTo(FFMPEG_RELEASE + FFMPEG_ASSET, archive);
      // Windows ships bsdtar, which reads zip files and matches wildcards by default.
      const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      const { code } = await run(tar, [
        "-xf",
        archive,
        "-C",
        binDir,
        "--strip-components=2",
        ...(process.platform === "win32" ? [] : ["--wildcards"]),
        `*/bin/ffmpeg${EXE}`,
        `*/bin/ffprobe${EXE}`,
      ]);
      if (code !== 0 || !existsSync(join(binDir, `ffmpeg${EXE}`))) return null;
      return binDir;
    } catch {
      return null;
    } finally {
      await rm(archive, { force: true });
      await rm(`${archive}.partial`, { force: true });
      ffmpegSetup = undefined;
    }
  })();
  return ffmpegSetup;
}

function run(bin: string, args: string[], cwd?: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Arguments are passed as an array, never through a shell.
    // ELECTRON_RUN_AS_NODE lets yt-dlp use the desktop app's own executable as Node.
    const child = spawn(bin, args, { cwd, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), DOWNLOAD_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.resume();
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/** Turns yt-dlp's error output into something a person can act on. */
function explain(stderr: string, site: string): string {
  const text = stderr.toLowerCase();
  if (/login required|log in|sign in|rate-limit|rate limit|cookies|not available to|empty media response/.test(text)) {
    return `${site} would not serve this link without a login. It may be private, age-restricted, or ${site} is limiting anonymous requests right now. Try again later or try another link.`;
  }
  if (/private/.test(text)) return "This post is private.";
  if (/unsupported url/.test(text)) return "Nothing to save was found at this link.";
  if (/requested format is not available|ffmpeg/.test(text)) {
    return "This video is only offered as separate picture and sound files, which the app cannot join yet.";
  }
  if (/unable to download|timed out|getaddrinfo|connection/.test(text)) {
    return "The download failed. Check your internet connection and try again.";
  }
  const lastError = stderr
    .split("\n")
    .filter((l) => l.startsWith("ERROR"))
    .pop();
  return lastError ? lastError.replace(/^ERROR:\s*/, "") : "The post could not be downloaded.";
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const extensionOf = (file: string) => file.split(".").pop()!.toLowerCase();

/** A saved post as it is read back: unrated with an empty note until the creator rates it or writes one. */
const normalize = (stored: Record<string, unknown>): ResearchItem => ({ rating: null, note: "", ...stored }) as unknown as ResearchItem;

export async function listResearch(dataDir: string): Promise<ResearchItem[]> {
  const root = researchDir(dataDir);
  if (!existsSync(root)) return [];
  const items: ResearchItem[] = [];
  for (const id of await readdir(root)) {
    try {
      items.push(normalize(JSON.parse(await readFile(join(root, id, "meta.json"), "utf8"))));
    } catch {
      // A folder without readable metadata is an interrupted download; skip it.
    }
  }
  return items.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * Collects what one download run left in the folder. yt-dlp numbers the parts
 * of a post from 1 (a carousel has several): a video part is `N.mp4` with its
 * poster `N.jpg`; an image part is just `N.jpg`, the full-size picture.
 */
function collectMedia(files: string[]): ResearchMedia[] {
  const parts = new Map<number, { video: string; image: string }>();
  for (const file of files) {
    const match = /^(\d+)\.(\w+)$/.exec(file);
    if (!match) continue;
    const part = parts.get(Number(match[1])) ?? { video: "", image: "" };
    if (VIDEO_EXTENSIONS.includes(match[2].toLowerCase())) part.video = file;
    else if (IMAGE_EXTENSIONS.includes(match[2].toLowerCase())) part.image = file;
    parts.set(Number(match[1]), part);
  }
  return [...parts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, part]): ResearchMedia | null =>
      part.video
        ? { kind: "video", file: part.video, posterFile: part.image }
        : part.image
          ? { kind: "image", file: part.image, posterFile: "" }
          : null,
    )
    .filter((m): m is ResearchMedia => m !== null);
}

const ALREADY_SAVED = "This post is already saved.";
// A marker older than this was left by a copy of the app that stopped mid-save.
const CLAIM_STALE_MS = DOWNLOAD_TIMEOUT_MS + 10 * 60 * 1000;

/**
 * Marks a post as being saved by creating research/.saving-<hash>. Creating a
 * folder either succeeds or fails as a whole, so of two saves started at the
 * same moment exactly one gets it. Returns the function that removes the
 * marker, or null if someone else is saving this post right now.
 */
async function claimPost(dataDir: string, key: string): Promise<(() => Promise<void>) | null> {
  await mkdir(researchDir(dataDir), { recursive: true });
  const marker = join(researchDir(dataDir), `.saving-${createHash("sha1").update(key).digest("hex").slice(0, 16)}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(marker);
      return () => rm(marker, { recursive: true, force: true });
    } catch {
      const age = await stat(marker).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age < CLAIM_STALE_MS) return null;
      await rm(marker, { recursive: true, force: true });
    }
  }
  return null;
}

/** Called with every post that has just been saved, whichever way it arrived. */
let afterSave: (item: ResearchItem) => void = () => undefined;
export function onPostSaved(hook: (item: ResearchItem) => void): void {
  afterSave = hook;
}

/** Downloads and saves a post from its link. */
export async function addResearch(dataDir: string, sourceUrl: string, deepgramKey: string): Promise<ResearchResult> {
  const result = await savePost(dataDir, sourceUrl, deepgramKey);
  if (result.ok) afterSave(result.item);
  return result;
}

async function savePost(dataDir: string, sourceUrl: string, deepgramKey: string): Promise<ResearchResult> {
  const url = sourceUrl.trim();
  const platform = detectPlatform(url);
  if (!platform) return { ok: false, error: SUPPORTED_LINKS_HINT };

  // The same post can arrive under different links (tracking added by "copy
  // link" or by sharing), so posts are compared by what they point to.
  const key = postKey(url) ?? url;
  const alreadySaved = async () =>
    (await listResearch(dataDir)).some((i) => postKey(i.pageUrl) === key || postKey(i.sourceUrl) === key);
  if (await alreadySaved()) return { ok: false, error: ALREADY_SAVED };

  // Only one save of a post runs at a time, even across two copies of the app
  // on the same data folder; the check above alone would let both through.
  const release = await claimPost(dataDir, key);
  if (!release) return { ok: false, error: "This post is already being saved." };
  if (await alreadySaved()) {
    await release();
    return { ok: false, error: ALREADY_SAVED };
  }

  const id = randomUUID();
  const dir = join(researchDir(dataDir), id);
  try {
    const ytDlp = await ensureYtDlp(dataDir);
    const ffmpegDir = await ensureFfmpeg(dataDir);
    await mkdir(dir, { recursive: true });

    const { stderr } = await run(ytDlp, [
      "--no-progress",
      "--no-warnings",
      // YouTube needs a JavaScript runtime; use the Node this app is already running on.
      "--js-runtimes",
      `node:${process.execPath}`,
      // Photo posts have no video; keep going so their pictures are still written.
      "--ignore-no-formats-error",
      // Keeps the site's raw replies (in the working folder), which name the sound a video uses.
      "--write-pages",
      ...(ffmpegDir
        ? [
            // Best picture up to 1080p joined with the best sound, as an MP4 that plays everywhere.
            "--ffmpeg-location",
            ffmpegDir,
            "--format",
            "bv*+ba/b/bv*",
            "--format-sort",
            "res:1080,vcodec:h264,acodec:m4a",
            "--merge-output-format",
            "mp4",
          ]
        : // Without FFmpeg: the best ready-made file with picture and sound (360p on YouTube).
          ["--format", "b"]),
      "--write-info-json",
      // For a photo this "thumbnail" is the full-size picture itself.
      "--write-thumbnail",
      "--output",
      join(dir, "%(playlist_index|1)s.%(ext)s"),
      "--",
      url,
    ], dir);

    // yt-dlp exits with an error for photo posts ("No video formats found") even
    // though the pictures were saved, so success is judged by what is on disk.
    const files = await readdir(dir);
    const media = collectMedia(files);
    if (media.length === 0) {
      await rm(dir, { recursive: true, force: true });
      return { ok: false, error: explain(stderr, PLATFORM_LABELS[platform]) };
    }

    // A carousel's caption and author are in 0.info.json; a single post's are in 1.info.json.
    const infoFile = files.includes("0.info.json") ? "0.info.json" : "1.info.json";
    const info = JSON.parse(await readFile(join(dir, infoFile), "utf8")) as Record<string, unknown>;
    const audio = await readAudio(dir, info);
    // The raw details can be several megabytes; everything the app uses is copied into meta.json.
    await removeRawFiles(dir);
    const caption = str(info.description);
    const timestamp = num(info.timestamp);
    const item: ResearchItem = {
      id,
      platform,
      sourceUrl: url,
      pageUrl: str(info.webpage_url) || url,
      title: str(info.title),
      caption,
      hashtags: [...new Set(caption.match(/#[\p{L}\p{N}_]+/gu) ?? [])],
      author: str(info.uploader) || str(info.channel),
      // Instagram: "channel" is the handle and "uploader_id" a numeric id. YouTube: "uploader_id" is "@handle".
      authorHandle: (platform === "youtube" ? str(info.uploader_id) : str(info.channel) || str(info.uploader_id)).replace(
        /^@/,
        "",
      ),
      publishedAt: timestamp ? new Date(timestamp * 1000).toISOString() : "",
      durationSeconds: num(info.duration),
      likeCount: num(info.like_count),
      commentCount: num(info.comment_count),
      viewCount: num(info.view_count),
      media,
      audio,
      transcript: "",
      transcriptError: "",
      rating: null,
      note: "",
      savedAt: new Date().toISOString(),
    };
    await writeMeta(dataDir, item);
    // The post is saved either way; a failed transcript is recorded on the item.
    const hasVideo = media.some((m) => m.kind === "video");
    return { ok: true, item: deepgramKey && hasVideo ? await transcribe(dataDir, item, deepgramKey) : item };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    return { ok: false, error: e instanceof Error ? e.message : "The post could not be downloaded." };
  } finally {
    await release();
  }
}

const writeMeta = (dataDir: string, item: ResearchItem) =>
  writeFile(join(researchDir(dataDir), item.id, "meta.json"), JSON.stringify(item, null, 2));

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

/** Sends one video file to Deepgram. Returns the spoken text and how many seconds were transcribed, or throws a readable Error. */
async function transcribeFile(path: string, deepgramKey: string): Promise<{ text: string; seconds: number }> {
  const video = await readFile(path);
  let response: Response;
  try {
    // nova-3 with language=multi handles mixed-language speech (for example Hindi and English).
    response = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=multi", {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramKey}`,
        "Content-Type": MIME_TYPES[extensionOf(path)] ?? "application/octet-stream",
      },
      body: video,
    });
  } catch {
    throw new Error("Could not reach Deepgram. Check your internet connection.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Deepgram rejected the API key. Check it in Settings.");
  }
  if (response.status === 402) throw new Error("Your Deepgram account is out of credit.");
  if (response.status === 429) throw new Error("Deepgram's rate limit was reached. Try again in a minute.");
  if (!response.ok) throw new Error(`Deepgram could not transcribe this video (HTTP ${response.status}).`);

  const body = (await response.json()) as {
    metadata?: { duration?: number };
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return {
    text: body.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "",
    seconds: typeof body.metadata?.duration === "number" ? body.metadata.duration : 0,
  };
}

/** Transcribes every video in the post and stores the text. Never throws. */
async function transcribe(dataDir: string, item: ResearchItem, deepgramKey: string): Promise<ResearchItem> {
  const videos = item.media.filter((m) => m.kind === "video");
  let transcript = "";
  let transcriptError = "";
  try {
    const texts: string[] = [];
    for (const video of videos) {
      const heard = await transcribeFile(join(researchDir(dataDir), item.id, video.file), deepgramKey);
      recordUsage({ feature: "transcript", detail: item.author || item.authorHandle, seconds: heard.seconds });
      texts.push(heard.text);
    }
    transcript =
      videos.length > 1
        ? texts.map((t, i) => `Video ${i + 1}:\n${t || "(no speech)"}`).join("\n\n")
        : (texts[0] ?? "");
    if (!texts.some(Boolean)) {
      transcript = "";
      transcriptError = videos.length === 0 ? "This post has no video to transcribe." : "No speech was found.";
    }
  } catch (e) {
    transcriptError = e instanceof Error ? e.message : "The video could not be transcribed.";
  }
  const updated = { ...item, transcript, transcriptError };
  await writeMeta(dataDir, updated);
  return updated;
}

/** Transcribes (or re-transcribes) a post that is already saved. */
export async function transcribeResearch(
  dataDir: string,
  id: string,
  deepgramKey: string,
): Promise<ResearchResult> {
  if (!deepgramKey) return { ok: false, error: "Add your Deepgram API key in Settings first." };
  const item = (await listResearch(dataDir)).find((i) => i.id === id);
  if (!item) return { ok: false, error: "That post is no longer saved." };
  return { ok: true, item: await transcribe(dataDir, item, deepgramKey) };
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Finds every value stored under a key, anywhere inside a parsed JSON reply. */
function findAll(value: unknown, key: string, found: unknown[] = []): unknown[] {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key && v) found.push(v);
      findAll(v, key, found);
    }
  }
  return found;
}

/**
 * Works out which sound a post uses. YouTube reports a song in the normal
 * details. Instagram only mentions it in its raw reply, which yt-dlp writes
 * to *.dump files when asked (--write-pages).
 */
async function readAudio(dir: string, info: Record<string, unknown>): Promise<ResearchAudio | null> {
  if (text(info.track)) {
    return { kind: "music", title: text(info.track), artist: text(info.artist), trending: false, url: "" };
  }

  type Clip = {
    music_info?: {
      music_asset_info?: { title?: string; display_artist?: string; audio_cluster_id?: string; audio_asset_id?: string };
      music_consumption_info?: { is_trending_in_clips?: boolean };
    } | null;
    original_sound_info?: {
      audio_asset_id?: string;
      original_audio_title?: string;
      ig_artist?: { username?: string };
      consumption_info?: { is_trending_in_clips?: boolean };
    } | null;
  };
  const soundPage = (id: unknown) => (text(id) ? `https://www.instagram.com/reels/audio/${text(id)}/` : "");

  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".dump"))) {
    let reply: unknown;
    try {
      reply = JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch {
      continue; // Not every raw reply is JSON.
    }
    for (const clip of findAll(reply, "clips_metadata") as Clip[]) {
      const song = clip.music_info?.music_asset_info;
      if (song && text(song.title)) {
        return {
          kind: "music",
          title: text(song.title),
          artist: text(song.display_artist),
          trending: clip.music_info?.music_consumption_info?.is_trending_in_clips === true,
          url: soundPage(song.audio_cluster_id ?? song.audio_asset_id),
        };
      }
      const original = clip.original_sound_info;
      if (original) {
        return {
          kind: "original",
          title: text(original.original_audio_title) || "Original audio",
          artist: text(original.ig_artist?.username),
          trending: original.consumption_info?.is_trending_in_clips === true,
          url: soundPage(original.audio_asset_id),
        };
      }
    }
  }
  return null;
}

/** Deletes yt-dlp's raw working files once what the app needs has been read from them. */
async function removeRawFiles(dir: string): Promise<void> {
  const raw = (await readdir(dir)).filter((f) => f.endsWith(".info.json") || f.endsWith(".dump"));
  await Promise.all(raw.map((f) => rm(join(dir, f), { force: true })));
}

/** Looks up the sound for a post that is already saved, without downloading it again. */
export async function refreshResearchAudio(dataDir: string, id: string): Promise<ResearchResult> {
  const item = (await listResearch(dataDir)).find((i) => i.id === id);
  if (!item) return { ok: false, error: "That post is no longer saved." };

  const work = join(researchDir(dataDir), id, "audio-check");
  try {
    const ytDlp = await ensureYtDlp(dataDir);
    await mkdir(work, { recursive: true });
    const { stderr } = await run(
      ytDlp,
      [
        "--no-progress",
        "--no-warnings",
        "--js-runtimes",
        `node:${process.execPath}`,
        "--ignore-no-formats-error",
        "--skip-download",
        "--write-info-json",
        "--write-pages",
        "--output",
        join(work, "%(playlist_index|1)s.%(ext)s"),
        "--",
        item.pageUrl || item.sourceUrl,
      ],
      work,
    );
    const files = await readdir(work);
    const infoFile = files.includes("0.info.json") ? "0.info.json" : files.find((f) => f.endsWith(".info.json"));
    if (!infoFile) return { ok: false, error: explain(stderr, PLATFORM_LABELS[item.platform]) };
    const info = JSON.parse(await readFile(join(work, infoFile), "utf8")) as Record<string, unknown>;
    const updated = { ...item, audio: await readAudio(work, info) };
    await writeMeta(dataDir, updated);
    return { ok: true, item: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The sound could not be looked up." };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Has Claude break the post down and saves the result with it. Costs money
 * once per post: the saved analysis is what every later step reads.
 */
/** The concept groups posts are in, largest first, each with what a couple of its posts are. */
function conceptGroups(items: ResearchItem[]): ConceptGroup[] {
  const groups = new Map<string, ConceptGroup>();
  for (const item of items) {
    if (!item.group) continue;
    const group = groups.get(item.group) ?? { name: item.group, count: 0, examples: [] };
    group.count++;
    if (group.examples.length < 2 && item.analysis?.summary) group.examples.push(item.analysis.summary);
    groups.set(item.group, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** A group name from Claude or the user, tidied, and spelt like the existing group it matches. */
function settleGroup(name: unknown, existing: ConceptGroup[]): string {
  const clean = cleanGroupName(name);
  return existing.find((g) => g.name.toLowerCase() === clean.toLowerCase())?.name ?? clean;
}

/** Adds the visual style to a post that was analysed before styles were recorded, leaving the rest of its analysis as it is. */
export async function styleResearch(dataDir: string, id: string, claudeKey: string): Promise<ResearchResult> {
  const item = (await listResearch(dataDir)).find((i) => i.id === id);
  if (!item) return { ok: false, error: "That post is no longer saved." };
  if (!item.analysis) return { ok: false, error: "Analyse this post first." };
  const result = await stylePost(claudeKey, item, join(researchDir(dataDir), id), await ensureFfmpeg(dataDir));
  if (!result.ok) return result;
  // Read the post again before saving, in case its rating or note changed meanwhile.
  const latest = (await listResearch(dataDir)).find((i) => i.id === id) ?? item;
  if (!latest.analysis) return { ok: false, error: "Analyse this post first." };
  const updated = { ...latest, analysis: { ...latest.analysis, style: result.style, styleNotes: result.styleNotes } };
  await writeMeta(dataDir, updated);
  return { ok: true, item: updated };
}

/**
 * Sorts analysed posts into concept groups in one request. By default only the
 * posts that have no group yet are sorted, into the existing groups where they
 * fit; with `all`, every analysed post is sorted afresh.
 */
export async function groupResearch(dataDir: string, claudeKey: string, all = false): Promise<GroupingResult> {
  const items = await listResearch(dataDir);
  const toSort = items.filter((i) => i.analysis && (all || !i.group));
  if (toSort.length === 0) return { ok: true, items, grouped: 0 };
  const existing = all ? [] : conceptGroups(items);
  const result = await groupPosts(claudeKey, toSort, existing);
  if (!result.ok) return result;

  // Names that differ only in capitals are one group.
  const settled: ConceptGroup[] = [...existing];
  let grouped = 0;
  for (const post of toSort) {
    const name = settleGroup(result.groups.get(post.id), settled);
    if (!name) continue;
    if (!settled.some((g) => g.name === name)) settled.push({ name, count: 0, examples: [] });
    // Read the post again before saving, in case its rating or note changed meanwhile.
    const latest = (await listResearch(dataDir)).find((i) => i.id === post.id);
    if (!latest) continue;
    await writeMeta(dataDir, { ...latest, group: name });
    grouped++;
  }
  return { ok: true, items: await listResearch(dataDir), grouped };
}

/** Analyses under way, by post id, so a post asked for twice at once is only analysed (and paid for) once. */
const analysing = new Map<string, Promise<ResearchResult>>();

/** Has Claude analyse a saved post and put it in a concept group. */
export function analyzeResearch(dataDir: string, id: string, claudeKey: string): Promise<ResearchResult> {
  const running = analysing.get(id);
  if (running) return running;
  const work = runAnalysis(dataDir, id, claudeKey).finally(() => analysing.delete(id));
  analysing.set(id, work);
  return work;
}

async function runAnalysis(dataDir: string, id: string, claudeKey: string): Promise<ResearchResult> {
  const everything = await listResearch(dataDir);
  const item = everything.find((i) => i.id === id);
  if (!item) return { ok: false, error: "That post is no longer saved." };
  const groups = conceptGroups(everything.filter((i) => i.id !== id));

  // Frames need FFmpeg; without it the analysis falls back to the text alone.
  const toolsDir = await ensureFfmpeg(dataDir);
  const result = await analyzePost(claudeKey, item, join(researchDir(dataDir), id), toolsDir, groups);
  if (!result.ok) return result;

  // Read the post again before saving, in case its rating or note changed meanwhile.
  const latest = (await listResearch(dataDir)).find((i) => i.id === id) ?? item;
  // A group the user chose by hand is kept when a post is analysed again.
  const updated = { ...latest, analysis: result.analysis, group: latest.group || settleGroup(result.group, groups) };
  await writeMeta(dataDir, updated);
  return { ok: true, item: updated };
}

/** Saves the user's rating and note for a post. */
export async function updateResearch(dataDir: string, id: string, edit: ResearchEdit): Promise<ResearchResult> {
  const item = (await listResearch(dataDir)).find((i) => i.id === id);
  if (!item) return { ok: false, error: "That post is no longer saved." };

  const updated = { ...item };
  if (edit.rating !== undefined) {
    const rating = edit.rating === null ? null : Math.round(Number(edit.rating));
    if (rating !== null && !(rating >= 0 && rating <= 5)) return { ok: false, error: "A rating is a number from 0 to 5." };
    updated.rating = rating;
  }
  if (edit.note !== undefined) updated.note = String(edit.note).trim();
  if (edit.group !== undefined) updated.group = settleGroup(edit.group, conceptGroups((await listResearch(dataDir)).filter((i) => i.id !== id)));
  await writeMeta(dataDir, updated);
  return { ok: true, item: updated };
}

export async function deleteResearch(dataDir: string, id: string): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  await rm(join(researchDir(dataDir), id), { recursive: true, force: true });
}

/** Resolves a stored file, or null if the id or name is not a plain stored file. */
export function researchFilePath(dataDir: string, id: string, file: string): string | null {
  if (!ID_PATTERN.test(id) || !FILE_PATTERN.test(file) || file.startsWith(".")) return null;
  const path = join(researchDir(dataDir), id, file);
  return existsSync(path) ? path : null;
}
