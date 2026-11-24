// The video editor: a project made of media files and a timeline that says how they are put together.
// Shared by the main process (which stores, transcribes and exports) and the interface (which previews and edits).
//
// The timeline is plain data, so the editing agent and the creator change the same thing, and nothing
// touches the media files themselves. Every time is in seconds.

/** A file in the project: a video, a piece of audio or a picture. Kept in the project's own folder. */
export type EditAsset = {
  id: string;
  kind: "video" | "audio" | "image";
  /** Relative to the data folder: edits/<project id>/<file>. */
  file: string;
  /** What the creator called it, or where it came from ("Scene 2 clip", "Voice: Narrator, line 3"). */
  name: string;
  /** Length in seconds; for a picture, how long it is shown by default. */
  seconds: number;
  width: number;
  height: number;
  /** Whether a video has a sound track of its own. */
  hasAudio: boolean;
  origin: "upload" | "studio" | "generated";
  /** Words heard in it with their times inside the file, once transcribed (or known from the script). */
  words: EditWord[] | null;
  /** True when `words` were estimated from a known text rather than heard. */
  wordsEstimated?: boolean;
  /** A strip of small frames from the video, one every `every` seconds, side by side in one picture, for the timeline. */
  thumbs?: { file: string; count: number; every: number };
  /** A picture of the sound's waveform across the whole file, for the timeline. */
  wave?: string;
  createdAt: string;
};

export type EditWord = { text: string; start: number; end: number };

export const LOOKS = ["none", "warm", "cool", "bw", "vivid", "contrast", "faded"] as const;
export type Look = (typeof LOOKS)[number];
export const LOOK_LABELS: Record<Look, string> = { none: "None", warm: "Warm", cool: "Cool", bw: "Black and white", vivid: "Vivid", contrast: "Contrast", faded: "Faded film" };

export const MOTIONS = ["none", "zoom-in", "zoom-out", "punch-in", "pan-left", "pan-right", "shake"] as const;
export type Motion = (typeof MOTIONS)[number];
export const MOTION_LABELS: Record<Motion, string> = { none: "None", "zoom-in": "Slow zoom in", "zoom-out": "Slow zoom out", "punch-in": "Punch in", "pan-left": "Pan left", "pan-right": "Pan right", shake: "Shake (an impact)" };

/** How a clip comes in. Each plays over the clip's own first moments, so nothing moves in time. */
export const TRANSITIONS = ["cut", "fade", "flash", "zoom", "whip"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export const TRANSITION_LABELS: Record<Transition, string> = { cut: "Cut", fade: "Fade from black", flash: "White flash", zoom: "Zoom in", whip: "Whip blur" };
/** How long a transition lasts, in seconds. */
export const TRANSITION_SECONDS = 0.3;

/** One piece of the main picture track. Pieces play one after another, in order. */
export type EditClip = {
  id: string;
  assetId: string;
  /** The part of the file used: from `in` to `out` seconds. */
  in: number;
  out: number;
  /** 0.25 to 4. Below 1 is slow motion. */
  speed: number;
  look: Look;
  motion: Motion;
  /** How this piece comes in. */
  transition: Transition;
  /** Loudness of the clip's own sound, 0 (muted) to 2. */
  volume: number;
};

export type AudioRole = "voice" | "music" | "sfx";

/** A sound placed on the timeline at `start`: a voice line, a music track or a sound effect. */
export type EditAudio = {
  id: string;
  assetId: string;
  role: AudioRole;
  /** Where on the timeline it starts. */
  start: number;
  in: number;
  out: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
};

export const CAPTION_STYLES = ["bold", "karaoke", "clean", "boxed"] as const;
export type CaptionStyleName = (typeof CAPTION_STYLES)[number];
export const CAPTION_STYLE_LABELS: Record<CaptionStyleName, string> = {
  bold: "Bold pop: big white words with a dark outline",
  karaoke: "Highlight: the word being said lights up",
  clean: "Clean: smaller text with a soft shadow",
  boxed: "Boxed: text on a solid band",
};

export type CaptionStyle = {
  name: CaptionStyleName;
  /** Height of the caption's centre, as a share of the frame from the top. Kept clear of the platforms' buttons. */
  y: number;
  /** Text colour and the colour a highlighted word or the box takes. */
  color: string;
  accent: string;
  /** Capital letters throughout. */
  upper: boolean;
  /** 0.6 to 1.6 times the normal size. */
  size: number;
};

/** One caption on screen: a few words, with the time each word is said (for the highlight). */
export type EditCaption = { id: string; start: number; end: number; words: EditWord[] };

export type TextPosition = "top" | "middle" | "bottom";
export type TextStyleName = "title" | "label" | "plain";

/** Text placed over the picture: a hook, a label, a call to action. */
export type EditText = { id: string; text: string; start: number; end: number; position: TextPosition; style: TextStyleName; /** Pops in, growing from small with a little overshoot. */ pop?: boolean };

export type EditExport = { file: string; srt: string; seconds: number; createdAt: string };

export type EditProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The Studio video it was started from, if any. */
  fromVideoId: string;
  /**
   * For the render behind a Studio video's Export step: that video's id. Such a project is rebuilt from Studio on each
   * export and kept out of the Editor's list. "" for the creator's own projects.
   */
  forStudio: string;
  width: number;
  height: number;
  fps: number;
  assets: EditAsset[];
  clips: EditClip[];
  audio: EditAudio[];
  captions: EditCaption[];
  captionStyle: CaptionStyle;
  /** Captions are drawn only when this is on, so they can be kept but hidden. */
  showCaptions: boolean;
  texts: EditText[];
  exports: EditExport[];
  /** Spent by the editing agent and by anything it made (transcripts, music), in US dollars. */
  costUsd: number;
};

export type EditSummary = { id: string; title: string; updatedAt: string; seconds: number; clips: number; cover: string; exported: boolean };

/**
 * One message of an editing chat as the interface shows it: what was said, and what the editor did.
 * An answer carries the checkpoint saved before its turn, so the whole turn can be undone.
 */
export type EditChatEntry = { role: "user" | "assistant"; text: string; actions: string[]; checkpoint?: string };
export type EditChatView = { entries: EditChatEntry[]; costUsd: number };
export type EditAgentReply = { ok: true; chat: EditChatView } | { ok: false; error: string; chat?: EditChatView };

export type EditResult = { ok: true; project: EditProject } | { ok: false; error: string };

/** What the interface draws for one caption or text as the export is made, and how long it stays. */
export type OverlayFrame = { start: number; end: number; png: string };

/** The part of a project that editing changes: everything but its media, exports and spending. */
export type EditTimeline = Pick<EditProject, "title" | "clips" | "audio" | "captions" | "captionStyle" | "showCaptions" | "texts">;
export const timelineOf = (p: EditProject): EditTimeline => ({
  title: p.title,
  clips: p.clips,
  audio: p.audio,
  captions: p.captions,
  captionStyle: p.captionStyle,
  showCaptions: p.showCaptions,
  texts: p.texts,
});

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { name: "bold", y: 0.68, color: "#FFFFFF", accent: "#FFD400", upper: false, size: 1 };

// ---------- Reading stored projects ----------

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
export const EDIT_FILE = /^edits\/[\w-]{1,64}\/[\w.-]{1,80}\.(png|jpg|jpeg|webp|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg)$/;

function parseWords(v: unknown): EditWord[] | null {
  if (!Array.isArray(v)) return null;
  return list(v).map((w) => ({ text: str(w.text), start: num(w.start, 0, 0), end: num(w.end, 0, 0) })).filter((w) => w.text);
}

/** Reads a project saved by any version of the app, filling in what is missing. Throws only if it is not a project at all. */
export function parseProject(input: unknown): EditProject {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof p.id !== "string" || !/^[\w-]{1,64}$/.test(p.id)) throw new Error("That is not a project.");
  const now = new Date().toISOString();
  const assets = list(p.assets)
    .filter((a) => typeof a.id === "string" && EDIT_FILE.test(str(a.file)))
    .map(
      (a): EditAsset => ({
        id: str(a.id),
        kind: pick(a.kind, ["video", "audio", "image"] as const, "video"),
        file: str(a.file),
        name: str(a.name, "Media"),
        seconds: num(a.seconds, 0, 0),
        width: num(a.width, 0, 0),
        height: num(a.height, 0, 0),
        hasAudio: a.hasAudio === true,
        origin: pick(a.origin, ["upload", "studio", "generated"] as const, "upload"),
        words: parseWords(a.words),
        wordsEstimated: a.wordsEstimated === true || undefined,
        thumbs: (() => {
          const t = (a.thumbs && typeof a.thumbs === "object" ? a.thumbs : null) as Record<string, unknown> | null;
          return t && EDIT_FILE.test(str(t.file)) ? { file: str(t.file), count: num(t.count, 1, 1, 200), every: num(t.every, 1, 0.05, 600) } : undefined;
        })(),
        wave: EDIT_FILE.test(str(a.wave)) ? str(a.wave) : undefined,
        createdAt: str(a.createdAt, now),
      }),
    );
  const known = new Set(assets.map((a) => a.id));
  const style = (p.captionStyle && typeof p.captionStyle === "object" ? p.captionStyle : {}) as Record<string, unknown>;
  return {
    id: p.id,
    title: str(p.title, "Untitled edit") || "Untitled edit",
    createdAt: str(p.createdAt, now),
    updatedAt: str(p.updatedAt, now),
    fromVideoId: str(p.fromVideoId),
    forStudio: str(p.forStudio),
    width: num(p.width, 1080, 240, 4096),
    height: num(p.height, 1920, 240, 4096),
    fps: num(p.fps, 30, 12, 60),
    assets,
    clips: list(p.clips)
      .filter((c) => known.has(str(c.assetId)))
      .map((c) => ({
        id: str(c.id) || crypto.randomUUID(),
        assetId: str(c.assetId),
        in: num(c.in, 0, 0),
        out: num(c.out, 0, 0),
        speed: num(c.speed, 1, 0.25, 4),
        look: pick(c.look, LOOKS, "none"),
        motion: pick(c.motion, MOTIONS, "none"),
        transition: pick(c.transition, TRANSITIONS, "cut"),
        volume: num(c.volume, 1, 0, 2),
      })),
    audio: list(p.audio)
      .filter((a) => known.has(str(a.assetId)))
      .map((a) => ({
        id: str(a.id) || crypto.randomUUID(),
        assetId: str(a.assetId),
        role: pick(a.role, ["voice", "music", "sfx"] as const, "voice"),
        start: num(a.start, 0, 0),
        in: num(a.in, 0, 0),
        out: num(a.out, 0, 0),
        volume: num(a.volume, 1, 0, 2),
        fadeIn: num(a.fadeIn, 0, 0, 10),
        fadeOut: num(a.fadeOut, 0, 0, 10),
      })),
    captions: list(p.captions).map((c) => ({ id: str(c.id) || crypto.randomUUID(), start: num(c.start, 0, 0), end: num(c.end, 0, 0), words: parseWords(c.words) ?? [] })),
    captionStyle: {
      name: pick(style.name, CAPTION_STYLES, DEFAULT_CAPTION_STYLE.name),
      y: num(style.y, DEFAULT_CAPTION_STYLE.y, 0.1, 0.9),
      color: /^#[0-9a-f]{6}$/i.test(str(style.color)) ? str(style.color) : DEFAULT_CAPTION_STYLE.color,
      accent: /^#[0-9a-f]{6}$/i.test(str(style.accent)) ? str(style.accent) : DEFAULT_CAPTION_STYLE.accent,
      upper: style.upper === true,
      size: num(style.size, 1, 0.6, 1.6),
    },
    showCaptions: p.showCaptions !== false,
    texts: list(p.texts).map((t) => ({
      id: str(t.id) || crypto.randomUUID(),
      text: str(t.text),
      start: num(t.start, 0, 0),
      end: num(t.end, 0, 0),
      position: pick(t.position, ["top", "middle", "bottom"] as const, "top"),
      style: pick(t.style, ["title", "label", "plain"] as const, "title"),
      pop: t.pop === true || undefined,
    })),
    exports: list(p.exports)
      .filter((e) => EDIT_FILE.test(str(e.file)))
      .map((e) => ({ file: str(e.file), srt: str(e.srt), seconds: num(e.seconds, 0, 0), createdAt: str(e.createdAt, now) })),
    costUsd: num(p.costUsd, 0, 0),
  };
}

export function emptyProject(id: string, title: string): EditProject {
  return parseProject({ id, title });
}

// ---------- Timing ----------

/** How long a clip lasts on the timeline. */
export const clipLength = (c: EditClip) => Math.max(c.out - c.in, 0) / c.speed;

/** Where each clip starts on the timeline. */
export function clipStarts(project: EditProject): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of project.clips) {
    starts.push(t);
    t += clipLength(c);
  }
  return starts;
}

/** How long the whole video is: the picture track, or a voice line that runs on past it. Music and sound effects are cut at the end. */
export function projectLength(project: EditProject): number {
  const picture = project.clips.reduce((n, c) => n + clipLength(c), 0);
  const sound = Math.max(0, ...project.audio.filter((a) => a.role === "voice").map((a) => a.start + Math.max(a.out - a.in, 0)));
  return Math.max(picture, sound);
}

/** The clip on screen at time `t`, and how far into its file that is. */
export function clipAt(project: EditProject, t: number): { clip: EditClip; index: number; start: number; fileTime: number } | null {
  const starts = clipStarts(project);
  for (let i = 0; i < project.clips.length; i++) {
    const c = project.clips[i];
    const len = clipLength(c);
    if (t >= starts[i] && (t < starts[i] + len || i === project.clips.length - 1)) {
      return { clip: c, index: i, start: starts[i], fileTime: c.in + Math.min(t - starts[i], len) * c.speed };
    }
  }
  return null;
}

/**
 * Groups words said at known times into captions: a few words each, broken at the end of a sentence,
 * after a pause, or when a caption would get too long to read at a glance.
 */
export function wordsToCaptions(words: EditWord[], maxWords = 3): EditCaption[] {
  const captions: EditCaption[] = [];
  let group: EditWord[] = [];
  const flush = () => {
    if (group.length) captions.push({ id: crypto.randomUUID(), start: group[0].start, end: group[group.length - 1].end, words: group });
    group = [];
  };
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = group[group.length - 1];
    if (last && (w.start - last.end > 0.45 || group.length >= maxWords || group.map((g) => g.text).join(" ").length + w.text.length > 18)) flush();
    group.push(w);
    if (/[.!?,;:]$/.test(w.text)) flush();
  }
  flush();
  // Each caption stays up until the next one, unless there is a real gap.
  for (let i = 0; i < captions.length - 1; i++) if (captions[i + 1].start - captions[i].end < 0.4) captions[i].end = captions[i + 1].start;
  return captions;
}

/** Spreads a known line of text over the time it takes to say, by the length of each word. For lines whose recording was never transcribed. */
export function estimateWords(text: string, seconds: number): EditWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const weight = parts.map((p) => Math.max(p.replace(/[^\p{L}\p{N}]/gu, "").length, 2) + (/[.!?,;:]$/.test(p) ? 3 : 0));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  const usable = Math.max(seconds - 0.1, 0.3);
  let t = 0.05;
  return parts.map((text, i) => {
    const d = (weight[i] / total) * usable;
    const w = { text, start: t, end: t + d * 0.92 };
    t += d;
    return w;
  });
}

const pad = (n: number, size = 2) => String(Math.floor(n)).padStart(size, "0");
const srtTime = (s: number) => `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)},${pad((s % 1) * 1000, 3)}`;

/** The captions as an .srt file, for platforms that take captions separately. */
export function captionsToSrt(captions: EditCaption[]): string {
  return captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.words.map((w) => w.text).join(" ")}\n`).join("\n");
}

/** A time as m:ss.s, for showing and for the agent. */
export const showTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
