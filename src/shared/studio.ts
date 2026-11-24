// Studio types: the cast, series and videos being made. Shared by the main process and the UI.
import type { SpeakingVoice } from "./brand";
import { VIDEO_FORMATS } from "./analysis";
import { parseTakes, type Take } from "./media";
import type { Animation } from "./motion";
import { CAPTION_STYLES, DEFAULT_CAPTION_STYLE, LOOKS, MOTIONS, TRANSITIONS, type CaptionStyle, type Look, type Motion, type Transition } from "./edit";

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
  /** Each word as heard in the recording, with its time in it; set once the recording is transcribed. */
  words?: { text: string; start: number; end: number }[];
  /** The recording those words were heard in (its audioId), so a new recording is transcribed again. */
  wordsFor?: string;
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
  /**
   * Full-size pictures of the storyboard's first and last frames, which the clip is pinned to start and end on.
   * `board` is the storyboard they were drawn from; once another one is in use they are drawn again.
   * `first` is null for a scene that carries on: it opens on the last frame of the clip before instead.
   */
  keyframes: { board: string; first: Take | null; last: Take | null } | null;
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

/** What the continuity check found on reading the whole script: things that contradict each other from scene to scene. */
export type ScriptReview = {
  /** The script it read, as scriptSignature gives it. Once the script changes, it has to be checked again. */
  signature: string;
  ok: boolean;
  /** Each contradiction, with the number of the scene it shows up in (1-based). [] when there is none. */
  problems: { scene: number; problem: string }[];
  /** What to ask for in a rewrite to put every problem right; "" when nothing needs changing. */
  fix: string;
  checkedAt: string;
};

/** What one place in the script looks like, written once so every storyboard and clip of it shows the same set. */
export type PlaceSet = {
  /** The place's name exactly as the scenes use it. */
  place: string;
  /** Its layout, furniture and props (each named the same way every time), where people are, and the light and time of day. */
  description: string;
};

const placeKey = (place: string) => place.trim().toLowerCase();
/** The description of a scene's place, or "" when the script has none. */
export const setOf = (video: Pick<Video, "sets">, place: string) => (placeKey(place) ? (video.sets.find((s) => placeKey(s.place) === placeKey(place))?.description ?? "") : "");

/** A short fingerprint of everything in the script a viewer sees or hears, so a check is known to be about this version of it. */
export function scriptSignature(video: Pick<Video, "scenes" | "sets">): string {
  const text = JSON.stringify([
    video.sets.map((s) => [s.place, s.description]),
    video.scenes.map((s) => [s.madeBy, s.continues, s.place, s.characters, s.action, s.camera, s.text, s.lines.map((l) => [l.speaker, l.text])]),
  ]);
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = (Math.imul(a, 33) ^ c) >>> 0;
    b = (Math.imul(b, 31) + c) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}${text.length.toString(36)}`;
}

/** Where the continuity check stands for the script as it is now. */
export function scriptReviewState(video: Video): "unchecked" | "stale" | "failed" | "passed" {
  const r = video.scriptReview;
  if (!r) return "unchecked";
  if (r.signature !== scriptSignature(video)) return "stale";
  return r.ok ? "passed" : "failed";
}

/** One piece of music in a video: what plays under a run of scenes, why, and the track made for it. */
export type MusicCue = {
  id: string;
  /** The first and last scene it plays under, numbered from 1. */
  fromScene: number;
  toScene: number;
  /** A few words for the creator, e.g. "Soft piano, hopeful". */
  label: string;
  /** What the music service is asked for: genre, mood, tempo, instruments and how it moves. */
  prompt: string;
  /** Why this music suits these scenes. */
  why: string;
  /** How loud under the video, 0 to 1. Kept low under speech. */
  volume: number;
  /** The track made for it, a file of the audio folder, or "" until it is made. */
  audioId: string;
  audioFile: string;
  /** The prompt the track was made from. A different prompt now means the track has to be made again. */
  madeFrom: string;
};

/** The music for a video: planned by Claude, made by ElevenLabs, changed with the creator's feedback until they approve it. */
export type VideoMusic = {
  /** The plan in a sentence or two. */
  summary: string;
  /** [] when the video has no music. */
  cues: MusicCue[];
  /** Each round of the creator's feedback, oldest first, with what Claude changed for it. */
  rounds: { feedback: string; reply: string; at: string }[];
  /** The scenes it was planned for, so a rewritten script shows the plan is out of date. */
  scenesKey: string;
  approvedAt: string;
  /** Estimated Claude cost of planning it, in US dollars. Music is charged by ElevenLabs. */
  costUsd: number;
};

/** The scenes as music is fitted to them: their ids and lengths. */
export const musicScenesKey = (video: Pick<Video, "scenes">) => video.scenes.map((s) => `${s.id}:${s.seconds}`).join(",");
/** A cue whose track is missing or was made from an earlier prompt. */
export const cueNeedsTrack = (c: MusicCue) => !c.audioFile || c.madeFrom !== c.prompt;
/** How long a cue plays: the scenes it covers. */
export const cueSeconds = (video: Pick<Video, "scenes">, c: MusicCue) => video.scenes.slice(c.fromScene - 1, c.toScene).reduce((n, s) => n + s.seconds, 0);

/** Where a video's music stands. */
export function musicState(video: Video): "none" | "stale" | "unmade" | "ready" | "approved" {
  const m = video.music;
  if (!m) return "none";
  if (m.scenesKey !== musicScenesKey(video)) return "stale";
  if (m.cues.some(cueNeedsTrack)) return "unmade";
  return m.approvedAt ? "approved" : "ready";
}

/** A sound effect on one scene: a whoosh, a pop, a riser, or the sound of the place. */
export type SceneSound = {
  id: string;
  /** The scene it plays in, numbered from 1, and when, in seconds from that scene's start. */
  scene: number;
  at: number;
  label: string;
  /** What the sound service is asked for. */
  prompt: string;
  seconds: number;
  volume: number;
  audioId: string;
  audioFile: string;
  /** The prompt the sound was made from; a different prompt now means it is made again. */
  madeFrom: string;
};

/** What one scene gets: how it comes in, how the camera moves, and its own look if it differs from the video's. */
export type SceneEffect = { scene: number; transition: Transition; motion: Motion; look: Look | ""; why: string };

/**
 * The effects of a video, planned by Claude and changed with the creator's feedback until they approve them.
 * Four sections, each with its own switch: captions, transitions and motion, sound effects, and the look.
 */
export type VideoEffects = {
  summary: string;
  captions: { on: boolean; style: CaptionStyle; wordsAtATime: number };
  moves: { on: boolean; scenes: SceneEffect[] };
  sounds: { on: boolean; items: SceneSound[] };
  look: { on: boolean; look: Look };
  /** On-screen text pops in. */
  textPop: boolean;
  /** A closing call to action over the last seconds: "Follow for more", the creator's handle. */
  endCard: { on: boolean; text: string; seconds: number };
  rounds: { feedback: string; reply: string; at: string }[];
  scenesKey: string;
  approvedAt: string;
  costUsd: number;
};

export const soundNeedsMaking = (s: SceneSound) => !s.audioFile || s.madeFrom !== s.prompt;

/** Where a video's effects stand. */
export function effectsState(video: Video): "none" | "stale" | "unmade" | "ready" | "approved" {
  const e = video.effects;
  if (!e) return "none";
  if (e.scenesKey !== musicScenesKey(video)) return "stale";
  if (e.sounds.on && e.sounds.items.some(soundNeedsMaking)) return "unmade";
  return e.approvedAt ? "approved" : "ready";
}

/** The effects for no effects at all, kept as a choice. */
export function noEffects(video: Video): VideoEffects {
  return {
    summary: "No effects.",
    captions: { on: false, style: DEFAULT_CAPTION_STYLE, wordsAtATime: 3 },
    moves: { on: false, scenes: [] },
    sounds: { on: false, items: [] },
    look: { on: false, look: "none" },
    textPop: false,
    endCard: { on: false, text: "", seconds: 2.5 },
    rounds: video.effects?.rounds ?? [],
    scenesKey: musicScenesKey(video),
    approvedAt: new Date().toISOString(),
    costUsd: video.effects?.costUsd ?? 0,
  };
}

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
  /** Each place the scenes happen in, described in detail. [] on videos written before places were described. */
  sets: PlaceSet[];
  checks: ScriptCheck[];
  /** The last continuity check of the script, or null when it has not been checked. */
  scriptReview: ScriptReview | null;
  /** The music, or null until it is planned. */
  music: VideoMusic | null;
  /** The effects (captions, transitions and motion, sound effects, look), or null until they are planned. */
  effects: VideoEffects | null;
  caption: string;
  /** For a remake: what was borrowed from the original and what is new. */
  kept: string[];
  changed: string[];
  /** For an episode: what this episode adds to the series' story so far. */
  storyUpdate: string[];
  /** When the creator approved the script, or "". */
  approvedAt: string;
  /** When the finished video was last exported from Studio, or "". */
  exportedAt: string;
  /** Claude's look at the exported video, or null until it has been checked. */
  finalCheck: FinalCheck | null;
  /** What to post with it on each platform, or null until it is written. */
  postKit: PostKit | null;
  /** The cover picture made from the export, or null. */
  cover: { file: string; time: number; title: string } | null;
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
export const VIDEO_STAGES = ["Script", "Cast", "Storyboard", "Clips", "Music", "Effects", "Export"] as const;

/** What comes back from making or adding a picture or clip. */
export type TakeResult = { ok: true; video: Video } | { ok: false; error: string };

/** How far a video has got: an index into VIDEO_STAGES. */
export function videoStage(video: Video): number {
  if (video.scenes.length === 0 || !video.approvedAt) return 0;
  if (video.results || video.exportedAt || video.effects?.approvedAt) return 6;
  if (video.effects || video.music?.approvedAt) return 5;
  if (video.music) return 4;
  if (video.scenes.some((s) => s.clips.length > 0)) return 3;
  return video.scenes.some((s) => s.pictures.length > 0 || s.animation) ? 2 : 1;
}

/** Whether the script can be approved, or why not. */
export function approvalProblem(video: Video): string {
  if (video.scenes.length === 0) return "Write the script first.";
  if (video.claim && video.claim.evidence !== "none" && !video.claim.checked) {
    return "Check the claim's source yourself and tick the box before approving.";
  }
  if (scriptReviewState(video) === "failed") return "The continuity check found things in the script that contradict each other. Fix them, or rewrite, before approving.";
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

function parseKeyframes(input: unknown): Scene["keyframes"] {
  if (!input || typeof input !== "object") return null;
  const k = input as Record<string, unknown>;
  if (!str(k.board)) return null;
  return { board: str(k.board), first: parseTakes([k.first])[0] ?? null, last: parseTakes([k.last])[0] ?? null };
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
    keyframes: parseKeyframes(input.keyframes),
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
          ...(Array.isArray(l.words) && str(l.wordsFor)
            ? {
                words: objs(l.words)
                  .map((w) => ({ text: str(w.text), start: typeof w.start === "number" ? w.start : 0, end: typeof w.end === "number" ? w.end : 0 }))
                  .filter((w) => w.text),
                wordsFor: str(l.wordsFor),
              }
            : {}),
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
    sets: objs(i.sets)
      .map((s) => ({ place: str(s.place), description: str(s.description) }))
      .filter((s) => s.place && s.description),
    checks: objs(i.checks)
      .map((c) => ({ rule: str(c.rule), ok: c.ok === true, note: str(c.note) }))
      .filter((c) => c.rule),
    scriptReview: parseScriptReview(i.scriptReview),
    music: parseMusic(i.music),
    effects: parseEffects(i.effects),
    caption: str(i.caption),
    kept: strs(i.kept),
    changed: strs(i.changed),
    storyUpdate: strs(i.storyUpdate),
    approvedAt: str(i.approvedAt),
    exportedAt: str(i.exportedAt),
    finalCheck: parseFinalCheck(i.finalCheck),
    postKit: parsePostKit(i.postKit),
    cover: (() => {
      const c = i.cover && typeof i.cover === "object" ? (i.cover as Record<string, unknown>) : null;
      return c && /^videos\/[\w-]{1,64}\/[\w-]{1,64}\.jpg$/.test(str(c.file)) ? { file: str(c.file), time: typeof c.time === "number" ? c.time : 0, title: str(c.title) } : null;
    })(),
    results: i.results ? parseResults(i.results) : null,
    costUsd: typeof i.costUsd === "number" ? i.costUsd : 0,
    createdAt: str(i.createdAt) || now(),
    updatedAt: str(i.updatedAt) || now(),
  };
}

/** Where in Studio a problem found in the finished video is put right. */
export const FIX_STEPS = ["script", "cast", "storyboard", "clips", "music", "effects", "export"] as const;
export type FixStep = (typeof FIX_STEPS)[number];

/** Claude's look at the exported video: what a viewer would notice, and where each is fixed. */
export type FinalCheck = {
  /** The export it looked at, so a newer export shows the check is out of date. */
  exportFile: string;
  at: string;
  ok: boolean;
  summary: string;
  issues: { time: number; scene: number; problem: string; fix: string; step: FixStep; serious: boolean }[];
  costUsd: number;
};

/** What to post with the video on each platform, within each platform's limits. */
export type PostKit = {
  at: string;
  tiktok: { caption: string; hashtags: string[] };
  instagram: { caption: string; hashtags: string[] };
  youtube: { title: string; description: string; hashtags: string[] };
  costUsd: number;
};

/** The platforms' limits the posting kit is written to. */
export const POST_LIMITS = { tiktokCaption: 2200, instagramCaption: 2200, instagramHashtags: 30, youtubeTitle: 100, youtubeDescription: 5000 };

function parseFinalCheck(input: unknown): FinalCheck | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  return {
    exportFile: str(c.exportFile),
    at: str(c.at),
    ok: c.ok === true,
    summary: str(c.summary),
    issues: objs(c.issues).map((x) => ({
      time: typeof x.time === "number" ? x.time : 0,
      scene: typeof x.scene === "number" ? Math.max(0, Math.round(x.scene)) : 0,
      problem: str(x.problem),
      fix: str(x.fix),
      step: (FIX_STEPS as readonly string[]).includes(str(x.step)) ? (str(x.step) as FixStep) : "export",
      serious: x.serious === true,
    })),
    costUsd: typeof c.costUsd === "number" ? c.costUsd : 0,
  };
}

function parsePostKit(input: unknown): PostKit | null {
  if (!input || typeof input !== "object") return null;
  const k = input as Record<string, unknown>;
  const part = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const tags = (v: unknown) => strs(v).map((t) => t.replace(/^#*/, "").replace(/\s+/g, "")).filter(Boolean);
  return {
    at: str(k.at),
    tiktok: { caption: str(part(k.tiktok).caption), hashtags: tags(part(k.tiktok).hashtags) },
    instagram: { caption: str(part(k.instagram).caption), hashtags: tags(part(k.instagram).hashtags) },
    youtube: { title: str(part(k.youtube).title), description: str(part(k.youtube).description), hashtags: tags(part(k.youtube).hashtags) },
    costUsd: typeof k.costUsd === "number" ? k.costUsd : 0,
  };
}

export function parseEffects(input: unknown): VideoEffects | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback);
  const part = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const on = (v: unknown) => part(v).on === true;
  const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
  const caps = part(e.captions);
  const st = part(caps.style);
  const colour = (v: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(str(v)) ? str(v) : fallback);
  return {
    summary: str(e.summary),
    captions: {
      on: on(e.captions),
      style: {
        name: pick(st.name, CAPTION_STYLES, DEFAULT_CAPTION_STYLE.name),
        y: num(st.y, DEFAULT_CAPTION_STYLE.y, 0.1, 0.9),
        color: colour(st.color, DEFAULT_CAPTION_STYLE.color),
        accent: colour(st.accent, DEFAULT_CAPTION_STYLE.accent),
        upper: st.upper === true,
        size: num(st.size, 1, 0.6, 1.6),
      },
      wordsAtATime: Math.round(num(caps.wordsAtATime, 3, 1, 5)),
    },
    moves: {
      on: on(e.moves),
      scenes: objs(part(e.moves).scenes).map((m) => ({
        scene: Math.max(1, Math.round(num(m.scene, 1))),
        transition: pick(m.transition, TRANSITIONS, "cut"),
        motion: pick(m.motion, MOTIONS, "none"),
        look: m.look === "" || m.look === undefined ? "" : pick(m.look, LOOKS, "none"),
        why: str(m.why),
      })),
    },
    sounds: {
      on: on(e.sounds),
      items: objs(part(e.sounds).items)
        .map((x) => {
          const file = str(x.audioFile);
          const ok = /^[\w.-]+$/.test(file);
          return {
            id: str(x.id) || crypto.randomUUID(),
            scene: Math.max(1, Math.round(num(x.scene, 1))),
            at: num(x.at, 0, 0),
            label: str(x.label),
            prompt: str(x.prompt),
            seconds: num(x.seconds, 1, 0.5, 10),
            volume: num(x.volume, 0.6, 0, 1),
            audioId: ok ? str(x.audioId) : "",
            audioFile: ok ? file : "",
            madeFrom: ok ? str(x.madeFrom) : "",
          };
        })
        .filter((x) => x.prompt),
    },
    look: { on: on(e.look), look: pick(part(e.look).look, LOOKS, "none") },
    textPop: e.textPop === true,
    endCard: { on: on(e.endCard) && str(part(e.endCard).text).trim() !== "", text: str(part(e.endCard).text).slice(0, 120), seconds: num(part(e.endCard).seconds, 2.5, 1, 5) },
    rounds: objs(e.rounds).map((r) => ({ feedback: str(r.feedback), reply: str(r.reply), at: str(r.at) })),
    scenesKey: str(e.scenesKey),
    approvedAt: str(e.approvedAt),
    costUsd: num(e.costUsd, 0),
  };
}

function parseMusic(input: unknown): VideoMusic | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    summary: str(m.summary),
    cues: objs(m.cues)
      .map((c) => {
        const file = str(c.audioFile);
        const ok = /^[\w.-]+$/.test(file);
        return {
          id: str(c.id) || crypto.randomUUID(),
          fromScene: Math.max(1, Math.round(num(c.fromScene, 1))),
          toScene: Math.max(1, Math.round(num(c.toScene, 1))),
          label: str(c.label),
          prompt: str(c.prompt),
          why: str(c.why),
          volume: Math.min(Math.max(num(c.volume, 0.3), 0), 1),
          audioId: ok ? str(c.audioId) : "",
          audioFile: ok ? file : "",
          madeFrom: ok ? str(c.madeFrom) : "",
        };
      })
      .filter((c) => c.prompt && c.toScene >= c.fromScene),
    rounds: objs(m.rounds).map((r) => ({ feedback: str(r.feedback), reply: str(r.reply), at: str(r.at) })),
    scenesKey: str(m.scenesKey),
    approvedAt: str(m.approvedAt),
    costUsd: num(m.costUsd, 0),
  };
}

function parseScriptReview(input: unknown): ScriptReview | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const signature = str(r.signature);
  if (!signature) return null;
  const problems = objs(r.problems)
    .map((p) => ({ scene: typeof p.scene === "number" ? Math.max(0, Math.round(p.scene)) : 0, problem: str(p.problem) }))
    .filter((p) => p.problem);
  return { signature, ok: r.ok === true && problems.length === 0, problems, fix: str(r.fix), checkedAt: str(r.checkedAt) };
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
