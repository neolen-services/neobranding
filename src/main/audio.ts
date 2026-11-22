// Makes audio with ElevenLabs (voiceover, sound effects, music) and keeps it on disk.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// Layout under the data folder:
//   audio/<id>.mp3    the sound
//   audio/<id>.json   its GeneratedAudio record
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recordUsage } from "./usage";
import type { AudioKind, AudioResult, GeneratedAudio, Voice, VoicePreviewResult, VoicesResult } from "../shared/audio";

// The address can be overridden so tests can run against a stand-in server.
const API = process.env.ELEVENLABS_API_BASE?.trim() || "https://api.elevenlabs.io";
const FILE_PATTERN = /^[0-9a-f-]{36}\.mp3$/;

/** Models, set explicitly because the API's own defaults are older ones being retired. */
export const SPEECH_MODELS = ["eleven_v4", "eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"] as const;
const SPEECH_MODEL_DEFAULT = "eleven_v4";
/** The shortest per-request limit among the speech models, so any of them accepts the text. */
export const SPEECH_MAX_CHARACTERS = 5000;
const SOUND_MODEL = "eleven_text_to_sound_v3";
const MUSIC_MODEL = "music_v2_5";

const NO_KEY = "Add your ElevenLabs API key in Settings first.";
const audioDir = (dataDir: string) => join(dataDir, "audio");
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/** Turns an ElevenLabs error reply into something a person can act on. */
async function explain(response: Response): Promise<string> {
  let message = "";
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body.detail;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail)) message = detail.map((d) => (d as { msg?: string }).msg).filter(Boolean).join("; ");
    else if (detail && typeof detail === "object") message = String((detail as { message?: unknown }).message ?? "");
  } catch {
    // No readable body; fall back to the status code.
  }
  if (response.status === 401) return "ElevenLabs did not accept the API key. Check it in Settings.";
  if (response.status === 402) return `Your ElevenLabs plan does not cover this${message ? `: ${message}` : "."}`;
  if (response.status === 429) return "ElevenLabs is limiting requests right now. Wait a moment and try again.";
  return message ? `ElevenLabs: ${message}` : `ElevenLabs returned an error (${response.status}).`;
}

/**
 * Tidies a pasted key: people often copy it with quotes, a trailing line
 * break, or the header name in front ("xi-api-key: sk_…").
 */
function cleanKey(pasted: string): string {
  const key = pasted
    .trim()
    .replace(/^(xi-api-key|authorization)\s*[:=]\s*/i, "")
    .replace(/^bearer\s+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, "");
  // A full key is "sk_" plus 48 characters. Exactly those 48 on their own is the
  // key copied without its prefix, so the prefix is put back.
  return /^[A-Za-z0-9]{48}$/.test(key) ? `sk_${key}` : key;
}

/**
 * Says what is wrong with a key that cannot be an ElevenLabs key, or "" if it
 * looks right. ElevenLabs keys start with "sk_"; anything else is refused by
 * them, so it is caught here with a description of what was saved (never the
 * key itself).
 */
function keyProblem(pasted: string): string {
  const key = cleanKey(pasted);
  if (!key) return NO_KEY;
  const howToGetOne =
    "ElevenLabs shows the full key only once, when it is created: on elevenlabs.io go to Developers, API keys, create a new key, copy it straight away and paste it into Settings.";
  // A real key is "sk_" followed by 48 plain characters, 51 in all.
  if (/^sk_[\x21-\x7e]+$/.test(key)) {
    return key.length === 51
      ? ""
      : `The ElevenLabs key saved in Settings starts with "sk_" but is ${key.length} characters long; a full key is exactly 51. Part of it is missing or extra. ${howToGetOne}`;
  }
  if (key.startsWith("sk_")) {
    return `The ElevenLabs key saved in Settings contains characters a key cannot have, such as "…". It looks like the shortened version shown in the key list, not the full key. ${howToGetOne}`;
  }
  const looksLike = /^[0-9a-f]{32}$/i.test(key)
    ? " It looks like an old-style key or a key ID."
    : key.includes("…") || key.includes("*") || key.includes("...")
      ? " It looks like the shortened version shown in the key list, not the full key."
      : "";
  return `The ElevenLabs key saved in Settings is ${key.length} characters long and does not start with "sk_", so ElevenLabs refuses it.${looksLike} ${howToGetOne}`;
}

async function call(apiKey: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "xi-api-key": cleanKey(apiKey), ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const failed = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? `ElevenLabs could not be reached: ${e.message}` : "ElevenLabs could not be reached." });

/** Where each voice's sample can be fetched, from the last time the voices were listed. */
const previewUrls = new Map<string, string>();

/** The voices this account can use: its own (including cloned ones) and ElevenLabs' ready-made ones. */
export async function listVoices(apiKey: string): Promise<VoicesResult> {
  const problem = keyProblem(apiKey);
  if (problem) return { ok: false, error: problem };
  try {
    const voices: Voice[] = [];
    let token = "";
    // A few pages are plenty; accounts rarely hold hundreds of voices.
    for (let page = 0; page < 3; page++) {
      const response = await call(apiKey, `/v2/voices?page_size=100&include_total_count=false${token ? `&next_page_token=${encodeURIComponent(token)}` : ""}`);
      if (!response.ok) return { ok: false, error: await explain(response) };
      const body = (await response.json()) as {
        voices?: { voice_id: string; name?: string; category?: string; description?: string | null; labels?: Record<string, string> | null; preview_url?: string | null }[];
        has_more?: boolean;
        next_page_token?: string | null;
      };
      for (const v of body.voices ?? []) {
        const preview = typeof v.preview_url === "string" && v.preview_url.startsWith("https://") ? v.preview_url : "";
        if (preview) previewUrls.set(v.voice_id, preview);
        voices.push({ id: v.voice_id, name: v.name ?? "", category: v.category ?? "", description: v.description ?? "", labels: v.labels ?? {}, hasPreview: preview !== "" });
      }
      if (!body.has_more || !body.next_page_token) break;
      token = body.next_page_token;
    }
    return { ok: true, voices };
  } catch (e) {
    return failed(e);
  }
}

/** Fetches a voice's short sample. The address comes only from ElevenLabs' own voice list. */
export async function voicePreview(apiKey: string, voiceId: string): Promise<VoicePreviewResult> {
  const problem = keyProblem(apiKey);
  if (problem) return { ok: false, error: problem };
  try {
    if (!previewUrls.has(voiceId)) {
      const listed = await listVoices(apiKey);
      if (!listed.ok) return listed;
    }
    const url = previewUrls.get(voiceId);
    if (!url) return { ok: false, error: "ElevenLabs has no sample for this voice." };
    const response = await fetch(url);
    if (!response.ok) return { ok: false, error: "The sample could not be loaded." };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 5_000_000) return { ok: false, error: "The sample could not be loaded." };
    return { ok: true, mimeType: response.headers.get("content-type")?.split(";")[0] || "audio/mpeg", base64: bytes.toString("base64") };
  } catch (e) {
    return failed(e);
  }
}

/** Saves the audio in a successful reply and returns its record. */
async function keep(
  dataDir: string,
  response: Response,
  record: Omit<GeneratedAudio, "id" | "file" | "bytes" | "createdAt">,
): Promise<AudioResult> {
  if (!response.ok) return { ok: false, error: await explain(response) };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) return { ok: false, error: "ElevenLabs returned an empty file." };
  const id = randomUUID();
  const audio: GeneratedAudio = { ...record, id, file: `${id}.mp3`, bytes: bytes.length, createdAt: new Date().toISOString() };
  await mkdir(audioDir(dataDir), { recursive: true });
  await writeFile(join(audioDir(dataDir), audio.file), bytes);
  await writeFile(join(audioDir(dataDir), `${id}.json`), JSON.stringify(audio, null, 2));
  // ElevenLabs says what it charged in a reply header on some requests.
  const credits = Number(response.headers.get("character-cost"));
  recordUsage({
    feature: audio.kind,
    detail: audio.title,
    ...(audio.kind === "voiceover" && { characters: audio.prompt.length }),
    ...(Number.isFinite(credits) && credits > 0 && { credits }),
  });
  return { ok: true, audio };
}

export async function generateSpeech(
  dataDir: string,
  apiKey: string,
  options: { text: string; voiceId: string; voiceName?: string; title?: string; model?: string },
): Promise<AudioResult> {
  const problem = keyProblem(apiKey);
  if (problem) return { ok: false, error: problem };
  const text = options.text.trim();
  if (!text) return { ok: false, error: "There is no text to speak." };
  if (text.length > SPEECH_MAX_CHARACTERS) {
    return { ok: false, error: `That text is ${text.length} characters; the limit for one voiceover is ${SPEECH_MAX_CHARACTERS}. Split it into parts.` };
  }
  if (!/^[\w-]{6,64}$/.test(options.voiceId)) return { ok: false, error: "Choose a voice first." };
  const model = (SPEECH_MODELS as readonly string[]).includes(options.model ?? "") ? options.model! : SPEECH_MODEL_DEFAULT;
  try {
    const response = await call(apiKey, `/v1/text-to-speech/${options.voiceId}?output_format=mp3_44100_128`, { text, model_id: model });
    return await keep(dataDir, response, {
      kind: "voiceover",
      title: options.title?.trim() || short(text, 60),
      prompt: text,
      voiceId: options.voiceId,
      voiceName: options.voiceName,
      model,
    });
  } catch (e) {
    return failed(e);
  }
}

export async function generateSoundEffect(
  dataDir: string,
  apiKey: string,
  options: { description: string; seconds?: number; loop?: boolean; title?: string },
): Promise<AudioResult> {
  const problem = keyProblem(apiKey);
  if (problem) return { ok: false, error: problem };
  const description = options.description.trim();
  if (!description) return { ok: false, error: "Describe the sound first." };
  try {
    const response = await call(apiKey, "/v1/sound-generation?output_format=mp3_44100_128", {
      text: description,
      model_id: SOUND_MODEL,
      // Left out, ElevenLabs picks a length that suits the description.
      ...(options.seconds && { duration_seconds: Math.min(Math.max(options.seconds, 0.5), 30) }),
      ...(options.loop && { loop: true }),
    });
    return await keep(dataDir, response, { kind: "sound_effect", title: options.title?.trim() || short(description, 60), prompt: description, model: SOUND_MODEL });
  } catch (e) {
    return failed(e);
  }
}

export async function generateMusic(
  dataDir: string,
  apiKey: string,
  options: { description: string; seconds?: number; instrumental?: boolean; title?: string },
): Promise<AudioResult> {
  const problem = keyProblem(apiKey);
  if (problem) return { ok: false, error: problem };
  const description = options.description.trim();
  if (!description) return { ok: false, error: "Describe the music first." };
  const seconds = Math.min(Math.max(Math.round(options.seconds || 30), 3), 600);
  try {
    const response = await call(apiKey, "/v1/music?output_format=auto", {
      prompt: description,
      model_id: MUSIC_MODEL,
      music_length_ms: seconds * 1000,
      force_instrumental: options.instrumental !== false,
    });
    return await keep(dataDir, response, { kind: "music", title: options.title?.trim() || short(description, 60), prompt: description, model: MUSIC_MODEL });
  } catch (e) {
    return failed(e);
  }
}

/** Everything generated so far, newest first. */
export async function listAudio(dataDir: string): Promise<GeneratedAudio[]> {
  let names: string[];
  try {
    names = await readdir(audioDir(dataDir));
  } catch {
    return [];
  }
  const items: GeneratedAudio[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    try {
      const audio = JSON.parse(await readFile(join(audioDir(dataDir), name), "utf8")) as GeneratedAudio;
      if (audio.id && FILE_PATTERN.test(audio.file) && existsSync(join(audioDir(dataDir), audio.file))) {
        items.push({ ...audio, kind: (["voiceover", "sound_effect", "music"] as AudioKind[]).includes(audio.kind) ? audio.kind : "voiceover" });
      }
    } catch {
      // A record that cannot be read is skipped.
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteAudio(dataDir: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  await rm(join(audioDir(dataDir), `${id}.mp3`), { force: true });
  await rm(join(audioDir(dataDir), `${id}.json`), { force: true });
}

/** Resolves a stored audio file, or null if the name is not a plain stored file. */
export function audioFilePath(dataDir: string, file: string): string | null {
  if (!FILE_PATTERN.test(file)) return null;
  const path = join(audioDir(dataDir), file);
  return existsSync(path) ? path : null;
}
