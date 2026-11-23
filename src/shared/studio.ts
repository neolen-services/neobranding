// Studio types: the cast, series and videos being made. Shared by the main process and the UI.
import type { SpeakingVoice } from "./brand";
import { VIDEO_FORMATS } from "./analysis";
import { parseTakes, type Take } from "./media";
import type { Animation } from "./motion";

/** A recurring character. Made once and reused in any video or series. */
export type Character = {
  id: string;
  name: string;
  /** Their job in the story, e.g. "the sceptical friend". */
  role: string;
  personality: string;
  /** How they talk: sentence length, slang, a catchphrase. */
  speech: string;
  /** What they look like, including a fixed outfit or colour. */
  look: string;
  /** The style they are drawn in: the id of one of VIDEO_STYLES, or the creator's own words. "" when it has not been said. */
  style: string;
  /** The ElevenLabs voice their lines are spoken in, or null until one is chosen. */
  voice: SpeakingVoice | null;
  /** Pictures of the character. The first is the main one: their portrait, which is also what lip-sync makes speak. */
  pictures: Take[];
  /**
   * Their character sheet: one wide picture showing them from the front, from the back and their face close up.
   * It is what storyboards and clips are given to keep them looking the same. Null until one is made.
   */
  sheet: Take | null;
  createdAt: string;
};

/** The styles a video's AI scenes can be made in. `prompt` is what the picture and video models are told. */
export const VIDEO_STYLES = [
  { id: "real", label: "Realistic", note: "Looks filmed with a camera", prompt: "Photorealistic live-action film: real people and places, natural light, shallow depth of field. Not animated, not illustrated." },
  { id: "motion", label: "Motion graphics", note: "Animated type and shapes, made by Claude", prompt: "Motion graphics: animated typography, shapes, icons and simple diagrams on designed backgrounds. No photographs and no drawn people." },
  { id: "anime", label: "Anime", note: "Japanese animation", prompt: "Anime: hand-drawn Japanese animation with clean line art, flat cel shading and expressive faces. Not photorealistic." },
  { id: "3d", label: "3D animation", note: "Like a modern animated film", prompt: "3D animated film: stylised characters with soft, rounded shapes, detailed materials and warm cinematic light. Not photorealistic." },
  { id: "cartoon", label: "2D cartoon", note: "Flat, bold and simple", prompt: "2D cartoon: bold outlines, flat bright colours and simple shapes. Not photorealistic." },
  { id: "comic", label: "Comic book", note: "Inked, with strong shadows", prompt: "Comic book art: inked outlines, strong shadows, halftone shading and saturated colours. Not photorealistic." },
  { id: "clay", label: "Claymation", note: "Stop-motion clay figures", prompt: "Claymation: stop-motion figures and sets made of modelling clay, with visible fingerprints and soft studio light." },
  { id: "watercolour", label: "Watercolour", note: "Soft painted illustration", prompt: "Watercolour illustration: soft washes of colour, visible paper texture and loose painted edges. Not photorealistic." },
  { id: "pixel", label: "Pixel art", note: "Like an old video game", prompt: "Pixel art: low-resolution sprites and backgrounds with a limited colour palette, like a 16-bit video game." },
] as const;

/**
 * The one style made without any picture or video service: Claude writes each scene as an animation
 * and the app renders it. A video in this style has animations where others have storyboards.
 */
export const MOTION_STYLE = "motion";
export const isMotion = (video: Pick<Video, "style" | "production">) => video.style === MOTION_STYLE && video.production !== "me";

/** The styles a character can be drawn in: every video style that has people or creatures in it. */
export const CHARACTER_STYLES = VIDEO_STYLES.filter((s) => s.id !== "motion");
/**
 * Whether a character suits a video: drawn in its style, or with no style of their own yet.
 * A character in another style can still be used; storyboards redraw them in the video's style.
 */
export const suitsStyle = (character: Pick<Character, "style">, style: string) => !character.style || !style || character.style === style;

/**
 * The formats a video can be built as: the same list a saved post's analysis uses, so what worked
 * in research can be asked for here. "" lets the script writer choose.
 */
export const SCRIPT_FORMATS = VIDEO_FORMATS.filter((f) => f !== "Other");

/** The lengths a video can be asked for, in seconds. */
export const VIDEO_LENGTHS = [15, 30, 45, 60, 90] as const;
/** The length a video is written to when none is asked for. */
export const DEFAULT_LENGTH = 45;

/** Where a video will be posted. `prompt` is what the script writer is told about the place. */
export const VIDEO_PLATFORMS = [
  { id: "instagram", label: "Instagram Reels", prompt: "Instagram Reels. People watch with the sound off as often as on, so the on-screen words must carry the point alone; the caption sits over the bottom of the picture; saves and shares matter most." },
  { id: "youtube", label: "YouTube Shorts", prompt: "YouTube Shorts. Viewers arrive by search as well as by scrolling, so say the subject plainly in the first line and in the caption; the video loops, so the end can lead back into the start." },
  { id: "tiktok", label: "TikTok", prompt: "TikTok. The opening second decides everything, the tone is loose and spoken, and a question that invites replies does better than a polished sign-off." },
] as const;
export const platformLabel = (platform: string) => VIDEO_PLATFORMS.find((p) => p.id === platform)?.label ?? "";

/** The style every new video starts with. */
export const DEFAULT_STYLE = "real";
/** What a style is called: a preset's name, or the creator's own words. */
export const styleLabel = (style: string) => VIDEO_STYLES.find((s) => s.id === style)?.label ?? (style || "No style chosen");
/** What the picture and video models are told about a style: a preset's wording, or the creator's own words. "" for none. */
export const stylePrompt = (style: string) => VIDEO_STYLES.find((s) => s.id === style)?.prompt ?? style;

/** The picture that shows what a character looks like to a picture or video model: their sheet, or their portrait until they have one. */
export const characterReference = (character: Character): Take | undefined => character.sheet ?? character.pictures[0];

/** Who says a line: the creator on camera, the narrator (the brand's speaking voice), or a character's id. */
export const SPEAKER_ME = "me";
export const SPEAKER_NARRATOR = "narrator";

export type SceneLine = {
  /** SPEAKER_ME, SPEAKER_NARRATOR or a character id. */
  speaker: string;
  /** Exactly the words spoken. */
  text: string;
  /** How it is said, e.g. "calm", "mocking". "" for plain. */
  delivery: string;
  /** The generated audio of this line (a file in the audio folder), once made. Never set for the creator's own lines. */
  audioId?: string;
  audioFile?: string;
};

/** One continuous shot of a few seconds: the unit a video is built from. */
export type Scene = {
  id: string;
  /** Generated with AI, or filmed by the creator. */
  madeBy: "ai" | "me";
  /** It carries straight on from the scene before, with no cut: its clip opens on the last frame of that scene's clip. Never true for the first scene. */
  continues: boolean;
  seconds: number;
  place: string;
  /** Ids of the characters seen in it. */
  characters: string[];
  /** What happens. */
  action: string;
  /** Framing and movement, e.g. "close-up, slow push in". */
  camera: string;
  /** Text on screen, or "". */
  text: string;
  /** A sound effect or music cue, or "". */
  sound: string;
  lines: SceneLine[];
  /** Every storyboard made for the scene (one sheet of frames showing what happens in it), and the id of the one in use ("" for none). */
  pictures: Take[];
  picture: string;
  /** A motion graphics scene's animation, in place of a storyboard; null for every other scene. */
  animation: Animation | null;
  /** The id of the storyboard (or animation) the creator approved, or "". A storyboard made or chosen afterwards needs approving again. */
  approved: string;
  /** What the storyboard check said about one of this scene's storyboards, or null when none has been checked. */
  review: StoryboardReview | null;
  /** Every clip made or filmed for the scene, and the id of the one in use. */
  clips: Take[];
  clip: string;
};

/** What the check found on looking at a scene's storyboard. */
export type StoryboardReview = {
  /** The id of the storyboard that was looked at. */
  picture: string;
  /** Whether it is good to approve as it is: nothing in it would make the video wrong. */
  ok: boolean;
  /** What must be fixed because it would make the video wrong, one problem each; [] when nothing is. */
  problems: string[];
  /** Small flaws a viewer would not notice in the finished video. Listed for the creator, never a reason to make it again. */
  minor: string[];
  /** What to ask for when making it again, ready to use as the change note; "" when nothing needs changing. */
  fix: string;
  checkedAt: string;
};

/** Whether a scene's storyboard is settled: the creator approved the one in use. A scene the creator films has none to approve. */
/** The id of what a scene's clip is made from: its animation when it has one, else the storyboard in use. "" for none. */
export const boardId = (scene: Scene) => scene.animation?.id ?? scene.picture;
export const storyboardApproved = (scene: Scene) => scene.madeBy === "me" || (boardId(scene) !== "" && scene.approved === boardId(scene));

export const pickedPicture = (scene: Scene) => scene.pictures.find((t) => t.id === scene.picture);
export const pickedClip = (scene: Scene) => scene.clips.find((t) => t.id === scene.clip);

/**
 * Whether an AI scene that carries on from the one before really does, once both have a clip.
 * "joined": its clip was made to open on the last frame of the clip now in use before it.
 * "stale": one of the two was made or changed since, so there is a jump between them.
 * Null when there is nothing to judge: a new shot, a scene the creator films or added a clip for, or a clip still missing.
 */
export function joinState(scenes: Scene[], index: number): "joined" | "stale" | null {
  const scene = scenes[index];
  const before = scenes[index - 1];
  if (!scene || !before || !scene.continues || scene.madeBy !== "ai") return null;
  const clip = pickedClip(scene);
  const beforeClip = pickedClip(before);
  if (!clip || !beforeClip || clip.source === "filmed") return null;
  return clip.from === beforeClip.id ? "joined" : "stale";
}

export type EvidenceLevel = "strong" | "early" | "personal" | "none";
export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  strong: "Strong evidence",
  early: "Early evidence",
  personal: "Personal experience",
  none: "No factual claim",
};

/** The one true thing a video is built on. */
export type Claim = {
  fact: string;
  /** Where it comes from. Claude suggests what to look for; the creator confirms the real source. */
  source: string;
  evidence: EvidenceLevel;
  /** The one thing the viewer should do or check. */
  action: string;
  /** The creator has looked at the source themselves. */
  checked: boolean;
};

/** How a video or series is made: every scene generated, every scene filmed by the creator, or both. */
export type Production = "ai" | "me" | "mix";
export const PRODUCTIONS: { id: Production; label: string; note: string }[] = [
  { id: "mix", label: "Mix of both", note: "You film the scenes you are in. AI makes the rest." },
  { id: "ai", label: "AI only", note: "Every scene is generated. You are never on camera." },
  { id: "me", label: "Filmed by me", note: "You film every scene and say every line. Nothing is generated." },
];
export const productionLabel = (p: Production) => PRODUCTIONS.find((x) => x.id === p)?.label ?? "Mix of both";
/** Anything saved before this choice existed was a mix. */
export const parseProduction = (v: unknown): Production => (v === "ai" || v === "me" ? v : "mix");
/** The most saved ideas one video or series can be started from. */
export const MAX_IDEAS = 10;

/** One rule the script was checked against. */
export type ScriptCheck = { rule: string; ok: boolean; note: string };

export type Video = {
  id: string;
  title: string;
  format: "single" | "episode";
  source: "new" | "remake";
  /** What the video is about, in the creator's or the idea's words. The script is written from this. */
  brief: string;
  /** The style its AI scenes are made in: the id of one of VIDEO_STYLES, or the creator's own words. "" uses its series' style. */
  style: string;
  /** The finer look within that style, e.g. "warm evening light, shallow focus". "" uses its series' look. */
  look: string;
  /** The format it is built as, one of SCRIPT_FORMATS, or "" when the script writer chooses. */
  videoFormat: string;
  /** How long it should run, in seconds; 0 leaves it at DEFAULT_LENGTH. */
  targetSeconds: number;
  /** Where it will be posted: the id of one of VIDEO_PLATFORMS, or "" when it is not said. */
  platform: string;
  /** The language its spoken lines and on-screen words are written in, in the creator's words; "" follows the idea. */
  language: string;
  /** For a motion graphics video: the stylesheet Claude designed, which every scene's animation is built on. "" until it is made. */
  design: string;
  /** Whether its scenes are generated, filmed by the creator, or both. The script is written to fit. */
  production: Production;
  /** The saved ideas it was started from; [] for none. */
  ideaIds: string[];
  /** Saved posts picked as inspiration: their structure is borrowed, never their words. [] for none. */
  postIds: string[];
  /** Where else it came from, each "" when not applicable. */
  postId: string;
  seriesId: string;
  /** 1-based episode number in its series, or null. */
  episode: number | null;

  // Filled in when the script is written.
  claim: Claim | null;
  /** Three opening lines; the first is the one the scenes use. */
  hooks: string[];
  /** The on-screen text of the opening. */
  overlay: string;
  scenes: Scene[];
  checks: ScriptCheck[];
  caption: string;
  /** For a remake: what was borrowed from the original and what is new. */
  kept: string[];
  changed: string[];
  /** For an episode: what this episode adds to the series' story so far. */
  storyUpdate: string[];
  /** When the creator approved the script, or "". */
  approvedAt: string;
  /** How it did after posting, typed in by the creator. null until then. */
  results: VideoResults | null;
  /** Estimated Claude cost of writing it, in US dollars. */
  costUsd: number;
  createdAt: string;
  updatedAt: string;
};

/** What the creator records a few days after posting. A number is null when it was left empty. */
export type VideoResults = {
  /** The day it was posted, YYYY-MM-DD, or "". */
  postedOn: string;
  /** Where it was posted, or "". */
  url: string;
  views: number | null;
  saves: number | null;
  shares: number | null;
  follows: number | null;
  comments: number | null;
  /** Where people stopped watching, or anything else worth remembering. */
  note: string;
};
export const RESULT_COUNTS = ["views", "saves", "shares", "follows", "comments"] as const;

export type SeriesEpisode = {
  /** The one thing the episode teaches or shows. */
  teaches: string;
  /** What it stops on, to make the viewer want the next one. */
  endsOn: string;
};

export type Series = {
  id: string;
  title: string;
  /** What the creator asked for, in their words. The ideas and the season plan are made from this. */
  brief: string;
  /** What the series is, in a sentence or two. */
  premise: string;
  /** The running question viewers wait to have answered. */
  question: string;
  /** How the season ends, or what will be measured and when if the ending is not known. */
  ending: string;
  characterIds: string[];
  /** The style every episode's AI scenes are made in: the id of one of VIDEO_STYLES, or the creator's own words. */
  style: string;
  /** The finer look within that style that every episode shares. */
  look: string;
  /** The format every episode is built as, one of SCRIPT_FORMATS, or "" when the script writer chooses. */
  videoFormat: string;
  /** How long each episode should run, in seconds; 0 leaves it at DEFAULT_LENGTH. */
  targetSeconds: number;
  /** Where the episodes will be posted: the id of one of VIDEO_PLATFORMS, or "" when it is not said. */
  platform: string;
  /** The language the episodes' spoken lines and on-screen words are written in, in the creator's words; "" follows the idea. */
  language: string;
  /** How every episode is made, unless one is changed. */
  production: Production;
  /** The saved ideas the season was planned from; [] for none. */
  ideaIds: string[];
  /** Saved posts picked as inspiration; [] for none. */
  postIds: string[];
  episodes: SeriesEpisode[];
  /** What has happened and been shown so far; grows as episodes are approved. */
  storySoFar: string[];
  costUsd: number;
  createdAt: string;
};

/** The stages of a video as the agent names them. */
export const VIDEO_STAGES = ["Idea", "Script", "Storyboard", "Preview", "Make", "Finish"] as const;

/** What comes back from making or adding a picture or clip. */
export type TakeResult = { ok: true; video: Video } | { ok: false; error: string };

/** How far a video has got: an index into VIDEO_STAGES. */
export function videoStage(video: Video): number {
  if (video.scenes.length === 0) return 0;
  if (!video.approvedAt) return 1;
  if (video.results) return 5;
  if (video.scenes.some((s) => s.clips.length > 0)) return 4;
  return video.scenes.some((s) => s.pictures.length > 0) ? 3 : 2;
}

/** Whether the script can be approved, or why not. */
export function approvalProblem(video: Video): string {
  if (video.scenes.length === 0) return "Write the script first.";
  if (video.claim && video.claim.evidence !== "none" && !video.claim.checked) {
    return "Check the claim's source yourself and tick the box before approving.";
  }
  return "";
}

export type StudioResult<T> = { ok: true; value: T } | { ok: false; error: string };
/** What "make voices" did. */
export type VideoVoicesResult = { ok: true; video: Video; made: number; skipped: string[] } | { ok: false; error: string };

/** How a new video is started: from a saved post, a series episode, or saved ideas and/or the creator's own words. */
export type NewVideo = {
  ideaId?: string;
  /** Several saved ideas to turn into one video. */
  ideaIds?: string[];
  /** Saved posts to take inspiration from (not a remake of any one of them). */
  postIds?: string[];
  /** A saved post to make "my version" of. */
  postId?: string;
  seriesId?: string;
  episode?: number;
  /** Left out, the first idea's title is used. */
  title?: string;
  /** What exactly the creator wants, in their words. */
  brief?: string;
  /** Left out, an episode follows its series and anything else is a mix. */
  production?: Production;
  /** The style its AI scenes are made in: the id of one of VIDEO_STYLES, or the creator's own words. */
  style?: string;
  /** The format it is built as, one of SCRIPT_FORMATS. Left out, the script writer chooses. */
  videoFormat?: string;
  /** How long it should run, in seconds. */
  targetSeconds?: number;
  /** Where it will be posted: the id of one of VIDEO_PLATFORMS. */
  platform?: string;
  /** The language it is written in. */
  language?: string;
};

/** What a new series is planned from, besides its title and what it is about. */
export type NewSeries = { ideaIds?: string[]; postIds?: string[]; production?: Production; /** The style every episode's AI scenes are made in. */ style?: string; /** The format every episode is built as. */ videoFormat?: string; targetSeconds?: number; platform?: string; language?: string };
/** A series started from an idea, before its season is planned. */
export type SeriesStart = NewSeries & { title?: string; brief?: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const objs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const now = () => new Date().toISOString();
/** Idea ids from untrusted input: no blanks, no repeats, no more than MAX_IDEAS. */
export const ideaList = (v: unknown) => [...new Set(strs(v))].slice(0, MAX_IDEAS);

function parseVoice(input: unknown): SpeakingVoice | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  const id = str(v.id);
  if (!/^[\w-]{6,64}$/.test(id)) return null;
  return { id, name: str(v.name) || "Voice", category: str(v.category) };
}

/** Validates and normalises a character from untrusted input. Throws with a readable message. */
export function parseCharacter(input: unknown): Character {
  const i = (input ?? {}) as Record<string, unknown>;
  const id = str(i.id);
  const name = str(i.name);
  if (!id || !name) throw new Error("A character needs a name.");
  return {
    id,
    name,
    role: str(i.role),
    personality: str(i.personality),
    speech: str(i.speech),
    look: str(i.look),
    style: str(i.style),
    voice: parseVoice(i.voice),
    pictures: parseTakes(i.pictures),
    sheet: parseTakes([i.sheet])[0] ?? null,
    createdAt: str(i.createdAt) || now(),
  };
}

function parseAnimation(input: unknown): Animation | null {
  if (!input || typeof input !== "object") return null;
  const a = input as Record<string, unknown>;
  if (!str(a.id) || typeof a.html !== "string") return null;
  return { id: str(a.id), html: a.html, css: typeof a.css === "string" ? a.css : "", madeAt: str(a.madeAt) };
}

function parseReview(input: unknown): StoryboardReview | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (!str(r.picture)) return null;
  return { picture: str(r.picture), ok: r.ok === true, problems: strs(r.problems), minor: strs(r.minor), fix: str(r.fix), checkedAt: str(r.checkedAt) };
}

function parseScene(input: Record<string, unknown>, index: number): Scene {
  const seconds = typeof input.seconds === "number" && Number.isFinite(input.seconds) ? input.seconds : 5;
  return {
    id: str(input.id) || `scene-${index + 1}`,
    madeBy: input.madeBy === "me" ? "me" : "ai",
    continues: index > 0 && input.continues === true,
    seconds: Math.min(Math.max(Math.round(seconds), 1), 30),
    place: str(input.place),
    characters: strs(input.characters),
    action: str(input.action),
    camera: str(input.camera),
    text: str(input.text),
    sound: str(input.sound),
    pictures: parseTakes(input.pictures),
    picture: str(input.picture),
    animation: parseAnimation(input.animation),
    approved: str(input.approved),
    review: parseReview(input.review),
    clips: parseTakes(input.clips),
    clip: str(input.clip),
    lines: objs(input.lines)
      .map((l): SceneLine => {
        const file = str(l.audioFile);
        return {
          speaker: str(l.speaker) || SPEAKER_NARRATOR,
          text: str(l.text),
          delivery: str(l.delivery),
          // A stored file name is only ever a plain name inside the audio folder.
          ...(str(l.audioId) && /^[\w.-]+$/.test(file) ? { audioId: str(l.audioId), audioFile: file } : {}),
        };
      })
      .filter((l) => l.text),
  };
}

function parseClaim(input: unknown): Claim | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const evidence = (["strong", "early", "personal", "none"] as const).find((e) => e === c.evidence) ?? "none";
  const fact = str(c.fact);
  if (!fact && evidence === "none") return null;
  return { fact, source: str(c.source), evidence, action: str(c.action), checked: c.checked === true };
}

/** Validates what the creator typed about a posted video. */
export function parseResults(input: unknown): VideoResults {
  const r = (input ?? {}) as Record<string, unknown>;
  const count = (v: unknown) => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[,\s]/g, "")) : v;
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const url = str(r.url);
  return {
    postedOn: /^\d{4}-\d{2}-\d{2}$/.test(str(r.postedOn)) ? str(r.postedOn) : "",
    url: /^https?:\/\//i.test(url) ? url : "",
    views: count(r.views),
    saves: count(r.saves),
    shares: count(r.shares),
    follows: count(r.follows),
    comments: count(r.comments),
    note: str(r.note),
  };
}

/** Validates and normalises a video from untrusted input, filling in anything an older version did not save. */
export function parseVideo(input: unknown): Video {
  const i = (input ?? {}) as Record<string, unknown>;
  const id = str(i.id);
  const title = str(i.title);
  if (!id || !title) throw new Error("A video needs a title.");
  const episode = typeof i.episode === "number" && i.episode >= 1 ? Math.round(i.episode) : null;
  return {
    id,
    title,
    format: i.format === "episode" ? "episode" : "single",
    source: i.source === "remake" ? "remake" : "new",
    brief: str(i.brief),
    style: str(i.style),
    look: str(i.look),
    videoFormat: str(i.videoFormat),
    targetSeconds: typeof i.targetSeconds === "number" && i.targetSeconds > 0 ? Math.min(Math.round(i.targetSeconds), 180) : 0,
    platform: str(i.platform),
    language: str(i.language),
    production: parseProduction(i.production),
    ideaIds: ideaList(i.ideaIds),
    postIds: ideaList(i.postIds),
    postId: str(i.postId),
    seriesId: str(i.seriesId),
    episode,
    claim: parseClaim(i.claim),
    hooks: strs(i.hooks).slice(0, 3),
    overlay: str(i.overlay),
    design: typeof i.design === "string" ? i.design : "",
    scenes: objs(i.scenes).map(parseScene),
    checks: objs(i.checks)
      .map((c) => ({ rule: str(c.rule), ok: c.ok === true, note: str(c.note) }))
      .filter((c) => c.rule),
    caption: str(i.caption),
    kept: strs(i.kept),
    changed: strs(i.changed),
    storyUpdate: strs(i.storyUpdate),
    approvedAt: str(i.approvedAt),
    results: i.results ? parseResults(i.results) : null,
    costUsd: typeof i.costUsd === "number" ? i.costUsd : 0,
    createdAt: str(i.createdAt) || now(),
    updatedAt: str(i.updatedAt) || now(),
  };
}

/** Validates and normalises a series from untrusted input. */
export function parseSeries(input: unknown): Series {
  const i = (input ?? {}) as Record<string, unknown>;
  const id = str(i.id);
  const title = str(i.title);
  if (!id || !title) throw new Error("A series needs a title.");
  return {
    id,
    title,
    brief: str(i.brief),
    premise: str(i.premise),
    question: str(i.question),
    ending: str(i.ending),
    characterIds: strs(i.characterIds),
    style: str(i.style),
    look: str(i.look),
    videoFormat: str(i.videoFormat),
    targetSeconds: typeof i.targetSeconds === "number" && i.targetSeconds > 0 ? Math.min(Math.round(i.targetSeconds), 180) : 0,
    platform: str(i.platform),
    language: str(i.language),
    production: parseProduction(i.production),
    ideaIds: ideaList(i.ideaIds),
    postIds: ideaList(i.postIds),
    episodes: objs(i.episodes)
      .map((e) => ({ teaches: str(e.teaches), endsOn: str(e.endsOn) }))
      .filter((e) => e.teaches || e.endsOn),
    storySoFar: strs(i.storySoFar),
    costUsd: typeof i.costUsd === "number" ? i.costUsd : 0,
    createdAt: str(i.createdAt) || now(),
  };
}

/** The name shown for whoever says a line. */
export function speakerName(speaker: string, characters: Character[]): string {
  if (speaker === SPEAKER_ME) return "You";
  if (speaker === SPEAKER_NARRATOR) return "Narrator";
  return characters.find((c) => c.id === speaker)?.name ?? "Unknown character";
}
