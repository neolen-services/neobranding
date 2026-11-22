// Makes pictures, clips and lip-synced clips with whichever service the user chose,
// and keeps the results in the data folder.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// Each service is called the way its own documentation described in November 2026:
//   fal.ai      its official client: files are uploaded to its CDN, models run on its queue
//   Google      POST /v1beta/interactions, answered in one go with the file as base64 (or a link)
//   ElevenLabs  POST /v1/flows/image or /v1/flows/video, then polling until a download link is ready
// Layout under the data folder:
//   videos/<video id>/<take id>.<ext>     a scene's pictures and clips
//   cast/<character id>/<take id>.<ext>   a character's reference pictures
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createFalClient } from "@fal-ai/client";
import { choiceLabel, MEDIA_FILE, MEDIA_PROVIDERS, type MediaChoice, type MediaTask, type Take, type UploadedFile } from "../shared/media";
import type { ApiProvider } from "../shared/settings";
import { recordUsage } from "./usage";

export type Media = { bytes: Buffer; mime: string };
type Keys = (provider: ApiProvider) => string;

// Overridable so the calls can be tested against stand-in servers.
const FAL_BASE = process.env.FAL_API_BASE?.trim();
const GOOGLE_API = process.env.GOOGLE_API_BASE?.trim() || "https://generativelanguage.googleapis.com";
const ELEVEN_API = process.env.ELEVENLABS_API_BASE?.trim() || "https://api.elevenlabs.io";

const MINUTE = 60_000;
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
const MIME_OF: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const b64 = (m: Media) => m.bytes.toString("base64");

/** Fetches a finished file. `headers` only when the link needs the key (Google's file links do). */
async function download(url: string, fallbackMime: string, headers?: Record<string, string>): Promise<Media> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5 * MINUTE) });
  if (!response.ok) throw new Error(`The finished file could not be downloaded (HTTP ${response.status}).`);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  return { bytes: Buffer.from(await response.arrayBuffer()), mime: EXTENSIONS[mime] ? mime : fallbackMime };
}

function needKey(keys: Keys, choice: MediaChoice): string {
  const provider = MEDIA_PROVIDERS[choice.provider];
  const key = keys(provider.key).trim();
  if (!key) throw new Error(`Add your ${provider.label} API key in Settings first.`);
  return key;
}

// ---------- fal.ai ----------

function falClient(key: string) {
  return createFalClient({
    credentials: key,
    // In tests every request goes to the stand-in server, with the real address kept in a header.
    ...(FAL_BASE && {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const real = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
        return fetch(`${FAL_BASE}${real.pathname}${real.search}`, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-real-host": real.host } });
      },
    }),
  });
}

async function fal(key: string, model: string, input: (upload: (file: Media) => Promise<string>) => Promise<Record<string, unknown>>) {
  const client = falClient(key);
  // In tests files travel inside the request; for real they are uploaded to fal's CDN as fal recommends.
  const upload = (file: Media) =>
    FAL_BASE ? Promise.resolve(`data:${file.mime};base64,${b64(file)}`) : client.storage.upload(new Blob([new Uint8Array(file.bytes)], { type: file.mime }));
  try {
    const result = await client.subscribe(model, { input: await input(upload), pollInterval: 3000 });
    return result.data as { images?: { url?: string }[]; video?: { url?: string } };
  } catch (e) {
    const body = (e as { body?: { detail?: unknown } }).body?.detail;
    const detail = typeof body === "string" ? body : Array.isArray(body) ? body.map((d) => (d as { msg?: string }).msg).filter(Boolean).join("; ") : "";
    throw new Error(`fal.ai: ${detail || (e instanceof Error ? e.message : "the request failed")}`);
  }
}

// ---------- Google ----------

type GoogleBlock = { type?: string; data?: string; uri?: string; mime_type?: string };

async function google(key: string, body: Record<string, unknown>, want: "image" | "video", extraHeaders: Record<string, string> = {}): Promise<Media> {
  const response = await fetch(`${GOOGLE_API}/v1beta/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
    // A clip is made before the request returns, which can take several minutes.
    signal: AbortSignal.timeout(15 * MINUTE),
  });
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string }; steps?: { type?: string; content?: GoogleBlock[] }[] };
  if (!response.ok) throw new Error(`Google: ${json.error?.message ?? `the request failed (HTTP ${response.status})`}`);
  const block = (json.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).find((c) => c.type === want);
  const fallback = want === "image" ? "image/png" : "video/mp4";
  if (block?.data) return { bytes: Buffer.from(block.data, "base64"), mime: block.mime_type && EXTENSIONS[block.mime_type] ? block.mime_type : fallback };
  if (block?.uri) return download(block.uri, fallback, { "x-goog-api-key": key });
  throw new Error(`Google returned no ${want}. It may have declined the request; try different wording.`);
}

// ---------- ElevenLabs ----------

const inline = (file: Media) => ({ type: "inline_base64", content_base64: b64(file), mime_type: file.mime });

async function eleven(key: string, kind: "image" | "video", body: Record<string, unknown>): Promise<Media> {
  // The same tidying as for speech: a key pasted without its "sk_" still works.
  const cleaned = key.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, "");
  const headers = { "xi-api-key": /^[A-Za-z0-9]{48}$/.test(cleaned) ? `sk_${cleaned}` : cleaned, "Content-Type": "application/json" };
  const explain = async (response: Response) => {
    const json = (await response.json().catch(() => ({}))) as { detail?: { status?: string; message?: string } | { msg?: string }[] | string };
    const detail = json.detail;
    if (response.status === 402) return "ElevenLabs: pictures and video need the Pro plan or above on your ElevenLabs account.";
    if (response.status === 401) return "ElevenLabs rejected the key, or the key has no Image & Video permission. Check it on elevenlabs.io.";
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).filter(Boolean).join("; ") : detail?.message;
    return `ElevenLabs: ${message || `the request failed (HTTP ${response.status})`}`;
  };

  const started = await fetch(`${ELEVEN_API}/v1/flows/${kind}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(2 * MINUTE) });
  if (!started.ok) throw new Error(await explain(started));
  const { id } = (await started.json()) as { id?: string };
  if (!id) throw new Error("ElevenLabs did not start the generation.");

  // ElevenLabs asks for at least 2 seconds between checks for a picture and 10 for video.
  const wait = kind === "image" ? 2500 : 10_000;
  for (let waited = 0; waited < 20 * MINUTE; waited += wait) {
    await pause(wait);
    const checked = await fetch(`${ELEVEN_API}/v1/flows/${kind}/${id}`, { headers, signal: AbortSignal.timeout(MINUTE) });
    if (!checked.ok) throw new Error(await explain(checked));
    const state = (await checked.json()) as { status?: string; content_url?: string; content_mime_type?: string; error_message?: string };
    if (state.status === "failed") throw new Error(`ElevenLabs: ${state.error_message || "the generation failed."}`);
    if (state.status === "completed" && state.content_url) return download(state.content_url, kind === "image" ? "image/png" : "video/mp4");
  }
  throw new Error("ElevenLabs took too long. Try again.");
}

// ---------- The three jobs ----------

const used = (task: MediaTask, choice: MediaChoice, detail: string, seconds?: number) =>
  recordUsage({ feature: task, detail: `${detail} · ${choiceLabel(task, choice)}`, ...(seconds && { seconds }) });

/** A still (9:16, or 16:9 when `wide`) from a description, using the reference pictures to keep characters and places the same. */
export async function makePicture(keys: Keys, choice: MediaChoice, input: { prompt: string; references: Media[]; detail: string; /** Tall unless a wide picture is asked for. */ wide?: boolean }): Promise<Media> {
  const key = needKey(keys, choice);
  const { prompt, references } = input;
  const shape = input.wide ? "16:9" : "9:16";
  let made: Media;
  if (choice.provider === "fal") {
    // fal's "edit" models need at least one picture; without references the same model's plain form is used.
    const model = references.length ? choice.model : choice.model.replace(/\/edit$/, "");
    const data = await fal(key, model, async (upload) => ({
      prompt,
      aspect_ratio: shape,
      num_images: 1,
      output_format: "png",
      ...(references.length && { image_urls: await Promise.all(references.map(upload)) }),
    }));
    const url = data.images?.[0]?.url;
    if (!url) throw new Error("fal.ai returned no picture.");
    made = await download(url, "image/png");
  } else if (choice.provider === "google") {
    made = await google(
      key,
      {
        model: choice.model,
        input: [{ type: "text", text: prompt }, ...references.map((r) => ({ type: "image", mime_type: r.mime, data: b64(r) }))],
        response_format: { type: "image", aspect_ratio: shape },
      },
      "image",
      { "Api-Revision": "2026-05-20" },
    );
  } else {
    made = await eleven(key, "image", { model_id: choice.model, prompt, aspect_ratio: shape, ...(references.length && { images: references.map(inline) }) });
  }
  used("picture", choice, input.detail);
  return made;
}

/** A picture given to a video service to guide a clip, and what it is. */
export type ClipReference = { media: Media; /** What the picture is and how to use it, as the end of "… is". */ role: string };

/**
 * A 9:16 clip of about `seconds` that follows reference pictures: the scene's storyboard first, then
 * anything else that guides it. `opening` is the exact frame the clip opens on (the last frame of the clip
 * before it); only some services can pin a first frame, the others are shown it as one more reference.
 * Each service names the pictures in its own way, so the roles are written into the prompt here.
 */
export async function makeClip(keys: Keys, choice: MediaChoice, input: { references: ClipReference[]; opening?: Media; prompt: string; seconds: number; detail: string }): Promise<Media> {
  const key = needKey(keys, choice);
  const kling = choice.provider === "fal" && /kling/i.test(choice.model);
  const veo = choice.provider === "elevenlabs" && /^veo/i.test(choice.model);
  const openingRole = "the exact frame this shot opens on: begin on it and carry on from it with no cut";
  // Kling pins the opening frame itself; every other service is shown it as a reference, right after the storyboard.
  const shown: ClipReference[] = input.opening && !kling ? [input.references[0], { media: input.opening, role: openingRole }, ...input.references.slice(1)] : input.references;
  // The most reference pictures each service takes, as their guides say.
  const references = shown.slice(0, kling ? 4 : choice.provider === "fal" ? 10 : choice.provider === "google" ? 6 : veo ? 3 : 9);
  const name = (i: number) => (kling ? `@Image${i + 1}` : choice.provider === "fal" ? `<IMAGE_REF_${i}>` : `Reference picture ${i + 1}`);
  const prompt = [...references.map((r, i) => `${name(i)} is ${r.role}.`), input.opening && kling && "The first frame is given: carry on from it with no cut.", input.prompt].filter(Boolean).join("\n");
  const seconds = Math.min(Math.max(Math.round(input.seconds), 3), 15);
  let made: Media;
  if (choice.provider === "fal") {
    const data = await fal(key, choice.model, async (upload) => ({
      prompt,
      image_urls: await Promise.all(references.map((r) => upload(r.media))),
      aspect_ratio: "9:16",
      ...(kling
        ? { ...(input.opening && { start_image_url: await upload(input.opening) }), duration: String(seconds), generate_audio: false }
        : { resolution: "720p", duration: seconds }),
    }));
    if (!data.video?.url) throw new Error("fal.ai returned no clip.");
    made = await download(data.video.url, "video/mp4");
  } else if (choice.provider === "google") {
    made = await google(
      key,
      {
        model: choice.model,
        input: [...references.map((r) => ({ type: "image", data: b64(r.media), mime_type: r.media.mime })), { type: "text", text: prompt }],
        response_format: { type: "video", aspect_ratio: "9:16", duration: `${seconds}s` },
        // Says the pictures are references, so none of them is taken as the first frame.
        generation_config: { video_config: { task: "reference_to_video" } },
      },
      "video",
    );
  } else {
    made = await eleven(key, "video", {
      model_id: choice.model,
      prompt,
      aspect_ratio: "9:16",
      // Veo on ElevenLabs makes 8 seconds when it is given reference pictures.
      duration_secs: veo ? 8 : seconds,
      images: references.map((r) => (veo ? { image: inline(r.media), role: "subject" } : inline(r.media))),
      generate_audio: false,
    });
  }
  used("clip", choice, input.detail, veo ? 8 : seconds);
  return made;
}

/** A character's still made to speak a recorded line. The clip is as long as the recording. */
export async function makeLipSync(keys: Keys, choice: MediaChoice, input: { image: Media; audio: Media; detail: string }): Promise<Media> {
  const key = needKey(keys, choice);
  let made: Media;
  if (choice.provider === "fal") {
    const data = await fal(key, choice.model, async (upload) => ({
      image_url: await upload(input.image),
      audio_url: await upload(input.audio),
      ...(/fabric/i.test(choice.model) && { resolution: "720p" }),
    }));
    if (!data.video?.url) throw new Error("fal.ai returned no clip.");
    made = await download(data.video.url, "video/mp4");
  } else if (choice.provider === "elevenlabs") {
    made = await eleven(key, "video", { model_id: choice.model, image: inline(input.image), audio: inline(input.audio), resolution: "720p" });
  } else {
    throw new Error("Google cannot lip-sync to a recorded voice. Choose fal.ai or ElevenLabs for lip-sync.");
  }
  used("lipsync", choice, input.detail);
  return made;
}

// ---------- Files in the data folder ----------

/** Saves a picture or clip under `videos/<owner>` or `cast/<owner>` and returns its record. */
export async function saveTake(dataDir: string, folder: "videos" | "cast", ownerId: string, media: Media, source: Take["source"], madeWith: string): Promise<Take> {
  const extension = EXTENSIONS[media.mime];
  if (!extension) throw new Error("That kind of file is not supported. Use PNG, JPEG, WebP, MP4, MOV or WebM.");
  if (media.bytes.length === 0) throw new Error("The file is empty.");
  const id = randomUUID();
  const file = `${folder}/${ownerId}/${id}.${extension}`;
  if (!MEDIA_FILE.test(file)) throw new Error("That file cannot be stored.");
  await mkdir(dirname(join(dataDir, file)), { recursive: true });
  await writeFile(join(dataDir, file), media.bytes);
  return { id, file, source, madeWith, createdAt: new Date().toISOString() };
}

/**
 * The last frame of a stored clip, as a picture: what the next scene's clip starts on when it
 * carries on from this one. `toolsDir` is where FFmpeg lives. The frame is written to a
 * temporary folder that is removed again before returning.
 */
export async function lastFrame(dataDir: string, clip: Take, toolsDir: string): Promise<Media> {
  const source = mediaFilePath(dataDir, clip.file);
  if (!source) throw new Error("That clip's file is missing.");
  const work = await mkdtemp(join(tmpdir(), "last-frame-"));
  try {
    const out = join(work, "frame.png");
    // Reads only the final second and keeps overwriting one file, so what is left is the very last frame.
    await promisify(execFile)(
      join(toolsDir, `ffmpeg${process.platform === "win32" ? ".exe" : ""}`),
      ["-y", "-hide_banner", "-loglevel", "error", "-sseof", "-1", "-i", source, "-update", "1", "-frames:v", "9999", out],
      { windowsHide: true },
    );
    return { bytes: await readFile(out), mime: "image/png" };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * A stored picture made small enough to send to Claude to look at: at most 1568 pixels on its long
 * side, as a JPEG. Without FFmpeg (`toolsDir` null), or if it cannot be shrunk, the picture is sent as it is.
 */
export async function forLooking(dataDir: string, take: Take, toolsDir: string | null): Promise<Media> {
  const source = mediaFilePath(dataDir, take.file);
  if (!source) throw new Error("That picture's file is missing.");
  if (toolsDir) {
    const work = await mkdtemp(join(tmpdir(), "look-"));
    try {
      const out = join(work, "small.jpg");
      await promisify(execFile)(
        join(toolsDir, `ffmpeg${process.platform === "win32" ? ".exe" : ""}`),
        ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-vf", "scale=w=1568:h=1568:force_original_aspect_ratio=decrease", "-frames:v", "1", "-q:v", "4", out],
        { windowsHide: true },
      );
      return { bytes: await readFile(out), mime: "image/jpeg" };
    } catch {
      // Falls through to the picture as it is.
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  return loadTake(dataDir, take);
}

/** Reads a stored take back, to send it on to a service. */
export async function loadTake(dataDir: string, take: Take): Promise<Media> {
  const path = mediaFilePath(dataDir, take.file);
  if (!path) throw new Error("That file is not in the data folder.");
  return { bytes: await readFile(path), mime: MIME_OF[take.file.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" };
}

export const deleteTake = (dataDir: string, take: Take) => {
  const path = mediaFilePath(dataDir, take.file);
  return path ? rm(path, { force: true }) : Promise.resolve();
};

/** Resolves a stored media path, or null if it is not a plain stored file. */
export function mediaFilePath(dataDir: string, file: string): string | null {
  return MEDIA_FILE.test(file) ? join(dataDir, file) : null;
}

/** A file handed over from the interface, as bytes. */
export function fromUpload(upload: UploadedFile | undefined): Media {
  const mime = String(upload?.mime ?? "").split(";")[0].trim();
  const bytes = upload?.bytes ? Buffer.from(upload.bytes) : typeof upload?.base64 === "string" ? Buffer.from(upload.base64, "base64") : Buffer.alloc(0);
  return { bytes, mime };
}
