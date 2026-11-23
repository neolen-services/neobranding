// Which service makes pictures, clips and lip-synced clips. Shared by the main process and the UI.
import type { ApiProvider } from "./settings";

/** The three jobs a service can do for a scene. */
export type MediaTask = "picture" | "clip" | "lipsync";
export const MEDIA_TASKS: Record<MediaTask, { label: string; description: string }> = {
  picture: { label: "Pictures", description: "A scene's storyboard (one sheet of four frames), or a picture of a character, made from a description and reference pictures." },
  clip: { label: "Clips", description: "A few seconds of video that follows a scene's storyboard." },
  lipsync: { label: "Lip-sync", description: "A character's picture made to speak a recorded line." },
};

export type MediaProvider = "fal" | "google" | "elevenlabs";
export const MEDIA_PROVIDERS: Record<MediaProvider, { label: string; key: ApiProvider; note: string }> = {
  fal: { label: "fal.ai", key: "fal", note: "One key for many models. Files you send are stored at a web address anyone with the link can open." },
  google: { label: "Google", key: "google", note: "Google's own models with a Gemini API key. Cannot lip-sync to a recorded voice." },
  elevenlabs: { label: "ElevenLabs", key: "elevenlabs", note: "Uses your ElevenLabs key. Pictures and video need their Pro plan or above." },
};

export type MediaChoice = { provider: MediaProvider; model: string };
export type MediaSettings = Record<MediaTask, MediaChoice>;

/**
 * Models known to work with the request each service expects, as read from
 * their documentation in November 2026. Services rename and retire models
 * often, so a model id can also be typed in by hand in Settings.
 */
export const MEDIA_MODELS: Record<MediaTask, (MediaChoice & { label: string })[]> = {
  picture: [
    { provider: "fal", model: "google/nano-banana-2.1/edit", label: "Nano Banana 2.1" },
    { provider: "fal", model: "fal-ai/nano-banana-pro/edit", label: "Nano Banana Pro" },
    { provider: "google", model: "gemini-nano-banana-2.1", label: "Nano Banana 2.1" },
    { provider: "google", model: "gemini-3-pro-image", label: "Nano Banana Pro" },
    { provider: "elevenlabs", model: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image" },
    { provider: "elevenlabs", model: "gemini-3-pro-image", label: "Gemini 3 Pro Image" },
  ],
  clip: [
    { provider: "fal", model: "google/gemini-omni-flash/v1.2/reference-to-video", label: "Gemini Omni Flash 1.2" },
    { provider: "fal", model: "fal-ai/kling-video/o3/pro/reference-to-video", label: "Kling O3 Pro" },
    { provider: "google", model: "gemini-omni-1.2-flash", label: "Gemini Omni Flash 1.2" },
    { provider: "elevenlabs", model: "veo-3.1-fast-generate-001", label: "Veo 3.1 Fast" },
    { provider: "elevenlabs", model: "veo-3.1-generate-001", label: "Veo 3.1" },
  ],
  lipsync: [
    { provider: "fal", model: "fal-ai/sync-lipsync/v3/image-to-video", label: "Sync 3" },
    { provider: "fal", model: "veed/fabric-1.0", label: "VEED Fabric" },
    { provider: "elevenlabs", model: "creatify-aurora", label: "Creatify Aurora" },
  ],
};

export const DEFAULT_MEDIA: MediaSettings = {
  picture: { provider: "fal", model: "google/nano-banana-2.1/edit" },
  clip: { provider: "fal", model: "google/gemini-omni-flash/v1.2/reference-to-video" },
  lipsync: { provider: "fal", model: "fal-ai/sync-lipsync/v3/image-to-video" },
};

/**
 * List prices in US dollars, as each service published them in November 2026: for one picture at the
 * size the app asks for, or for one second of 720p video. Used only to estimate; the service's own
 * bill is the real figure. A model that is not here, and anything on ElevenLabs (which charges
 * credits that vary with the settings), has no estimate.
 */
const MEDIA_PRICES: Record<string, { image?: number; second?: number }> = {
  "fal:google/nano-banana-2.1/edit": { image: 0.044 },
  "fal:google/nano-banana-2.1": { image: 0.04 },
  "fal:fal-ai/nano-banana-pro/edit": { image: 0.15 },
  "fal:fal-ai/nano-banana-pro": { image: 0.15 },
  "fal:google/gemini-omni-flash/v1.2/reference-to-video": { second: 0.0819 },
  "fal:google/gemini-omni-flash/v1.2/image-to-video": { second: 0.0819 },
  "fal:fal-ai/kling-video/o3/pro/reference-to-video": { second: 0.112 },
  "fal:fal-ai/sync-lipsync/v3/image-to-video": { second: 0.1333 },
  "fal:veed/fabric-1.0": { second: 0.15 },
  "google:gemini-nano-banana-2.1": { image: 0.0336 },
  "google:gemini-3-pro-image": { image: 0.134 },
  "google:gemini-omni-1.2-flash": { second: 0.07 },
};

/** What one picture, or a clip of `seconds`, is estimated to cost on a service, or null when there is no price to go by. */
export function mediaCost(choice: MediaChoice, seconds?: number): number | null {
  const price = MEDIA_PRICES[`${choice.provider}:${choice.model}`] ?? MEDIA_PRICES[`${choice.provider}:${choice.model.replace(/\/edit$/, "")}`];
  if (!price) return null;
  if (price.image !== undefined) return price.image;
  return price.second !== undefined && seconds ? price.second * seconds : null;
}

/** The service and model named at the end of an older log line's detail ("… · fal.ai · Nano Banana 2.1"), from before they were logged apart. */
export function choiceFromLabel(task: MediaTask, detail: string): MediaChoice | null {
  const known = MEDIA_MODELS[task].find((m) => detail.endsWith(`${MEDIA_PROVIDERS[m.provider].label} · ${m.label}`));
  if (known) return { provider: known.provider, model: known.model };
  const provider = (Object.keys(MEDIA_PROVIDERS) as MediaProvider[]).find((p) => detail.includes(` · ${MEDIA_PROVIDERS[p].label} · `));
  return provider ? { provider, model: "" } : null;
}

const isProvider = (v: unknown): v is MediaProvider => v === "fal" || v === "google" || v === "elevenlabs";

/** A choice from untrusted input, or null if it is not usable. A model id is only ever plain characters. */
export function parseChoice(input: unknown): MediaChoice | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const model = typeof c.model === "string" ? c.model.trim() : "";
  if (!isProvider(c.provider) || !/^[\w./:-]{2,120}$/.test(model)) return null;
  return { provider: c.provider, model };
}

/** Saved settings, with the default for any job that has none. */
export function parseMediaSettings(input: unknown): MediaSettings {
  const saved = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    picture: parseChoice(saved.picture) ?? DEFAULT_MEDIA.picture,
    clip: parseChoice(saved.clip) ?? DEFAULT_MEDIA.clip,
    lipsync: parseChoice(saved.lipsync) ?? DEFAULT_MEDIA.lipsync,
  };
}

/** "fal.ai · Nano Banana 2.1", or the raw model id for one typed in by hand. */
export function choiceLabel(task: MediaTask, choice: MediaChoice): string {
  const known = MEDIA_MODELS[task].find((m) => m.provider === choice.provider && m.model === choice.model);
  return `${MEDIA_PROVIDERS[choice.provider].label} · ${known?.label ?? choice.model}`;
}

/** A picture or a clip made for a scene or a character. Several can exist; one is the one in use. */
export type Take = {
  id: string;
  /** Path inside the data folder, e.g. "videos/<video id>/<take id>.png". */
  file: string;
  /** How it came to be. */
  source: "ai" | "lipsync" | "filmed" | "upload";
  /** The service and model that made it, for display. "" for a file you added. */
  madeWith: string;
  /**
   * For a clip: the id of what it was made from. That is the scene's storyboard, or, for a scene that
   * carries on from the one before, that scene's clip (this clip opens on its last frame).
   */
  from?: string;
  createdAt: string;
};

/** A stored media file is only ever addressed by a path of this shape. */
export const MEDIA_FILE = /^(videos|cast)\/[\w-]{1,64}\/[\w-]{1,64}\.(png|jpg|jpeg|webp|mp4|mov|webm)$/;

export function parseTakes(input: unknown): Take[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((t): Take[] => {
    if (!t || typeof t !== "object") return [];
    const { id, file, source, madeWith, from, createdAt } = t as Record<string, unknown>;
    if (typeof id !== "string" || typeof file !== "string" || !MEDIA_FILE.test(file)) return [];
    return [
      {
        id,
        file,
        source: source === "lipsync" || source === "filmed" || source === "upload" ? source : "ai",
        madeWith: typeof madeWith === "string" ? madeWith : "",
        ...(typeof from === "string" && from ? { from } : {}),
        createdAt: typeof createdAt === "string" ? createdAt : "",
      },
    ];
  });
}

/** A file handed over from the interface: raw bytes from the desktop app, or base64 from the browser version. */
export type UploadedFile = { bytes?: Uint8Array; base64?: string; mime: string };
