// Studio types: the cast, series and videos being made. Shared by the main process and the UI.
import type { SpeakingVoice } from "./brand";
import { parseTakes, type Take } from "./media";

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
  /** The ElevenLabs voice their lines are spoken in, or null until one is chosen. */
  voice: SpeakingVoice | null;
  /** Reference pictures that keep the character looking the same in every scene. The first is the main one. */
  pictures: Take[];
  createdAt: string;
};

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
  /** Every still made for the scene, and the id of the one in use ("" for none). */
  pictures: Take[];
  picture: string;
  /** Every clip made or filmed for the scene, and the id of the one in use. */
  clips: Take[];
  clip: string;
};

export const pickedPicture = (scene: Scene) => scene.pictures.find((t) => t.id === scene.picture);
export const pickedClip = (scene: Scene) => scene.clips.find((t) => t.id === scene.clip);

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

/** One way a video or series could go, suggested by Claude for the creator to choose from before anything is written. */
export type Concept = {
  id: string;
  title: string;
  /** What makes this take different from the others, in one sentence. */
  angle: string;
  /** A video's opening line, or a series' running question. */
  hook: string;
  /** The story every idea must have, in order: who we care about, how the tension rises, the win, and the ending nobody expects. */
  characters: string;
  tension: string;
  victory: string;
  ending: string;
  /** Exactly who it is for. */
  viewer: string;
  /** The one thing that viewer does or checks afterwards. */
  takeaway: string;
  /** Why it could work, with its weak point. */
  why: string;
};
/** The four parts of an idea's story, in the order they play out. */
export const STORY_PARTS = [
  ["characters", "Characters you care about"],
  ["tension", "Escalating tension"],
  ["victory", "Moment of victory"],
  ["ending", "Surprising ending"],
] as const satisfies readonly (readonly [keyof Concept, string])[];
/** How many ideas Claude suggests at a time. */
export const CONCEPT_COUNT = 5;

/** The idea step that videos and series share: what Claude suggested and what the creator settled on. */
export type IdeaStep = {
  /** The ideas Claude suggested; [] until asked. */
  concepts: Concept[];
  /** The suggested idea the creator approved, or "" (none yet, or they kept their own words). */
  conceptId: string;
  /** When the creator settled the idea, or "". */
  ideaApprovedAt: string;
  /** The title was filled in by the app, so the approved idea's title replaces it. */
  autoTitle: boolean;
};
export const approvedConcept = (item: IdeaStep) => item.concepts.find((c) => c.id === item.conceptId);

/** One rule the script was checked against. */
export type ScriptCheck = { rule: string; ok: boolean; note: string };

export type Video = IdeaStep & {
  id: string;
  title: string;
  format: "single" | "episode";
  source: "new" | "remake";
  /** What the video is about, in the creator's or the idea's words. The script is written from this. */
  brief: string;
  /** The visual style of its AI scenes, e.g. "realistic film, warm light". "" uses its series' look. */
  look: string;
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

export type Series = IdeaStep & {
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
  /** The visual style every episode's AI scenes share. */
  look: string;
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

/** The five stages of a video; the last two are built later. */
export const VIDEO_STAGES = ["Idea", "Script", "Preview", "Make", "Finish"] as const;

/** What comes back from making or adding a picture or clip. */
export type TakeResult = { ok: true; video: Video } | { ok: false; error: string };

/** How far a video has got: an index into VIDEO_STAGES. */
export function videoStage(video: Video): number {
  if (video.scenes.length === 0) return 0;
  if (!video.approvedAt) return 1;
  if (video.results) return 4;
  return video.scenes.some((s) => s.clips.length > 0) ? 3 : 2;
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
};

/** What a new series is planned from, besides its title and what it is about. */
export type NewSeries = { ideaIds?: string[]; postIds?: string[]; production?: Production };
/** A series started without a plan yet: its idea is settled first, then the season is planned. */
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

function parseIdeaStep(i: Record<string, unknown>): IdeaStep {
  const concepts = objs(i.concepts)
    .map((c): Concept => ({ id: str(c.id), title: str(c.title), angle: str(c.angle), hook: str(c.hook), characters: str(c.characters), tension: str(c.tension), victory: str(c.victory), ending: str(c.ending), viewer: str(c.viewer), takeaway: str(c.takeaway), why: str(c.why) }))
    .filter((c) => c.id && c.title);
  const conceptId = concepts.some((c) => c.id === str(i.conceptId)) ? str(i.conceptId) : "";
  return { concepts, conceptId, ideaApprovedAt: str(i.ideaApprovedAt), autoTitle: i.autoTitle === true };
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
    voice: parseVoice(i.voice),
    pictures: parseTakes(i.pictures),
    createdAt: str(i.createdAt) || now(),
  };
}

function parseScene(input: Record<string, unknown>, index: number): Scene {
  const seconds = typeof input.seconds === "number" && Number.isFinite(input.seconds) ? input.seconds : 5;
  return {
    id: str(input.id) || `scene-${index + 1}`,
    madeBy: input.madeBy === "me" ? "me" : "ai",
    seconds: Math.min(Math.max(Math.round(seconds), 1), 30),
    place: str(input.place),
    characters: strs(input.characters),
    action: str(input.action),
    camera: str(input.camera),
    text: str(input.text),
    sound: str(input.sound),
    pictures: parseTakes(input.pictures),
    picture: str(input.picture),
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
    ...parseIdeaStep(i),
    id,
    title,
    format: i.format === "episode" ? "episode" : "single",
    source: i.source === "remake" ? "remake" : "new",
    brief: str(i.brief),
    look: str(i.look),
    production: parseProduction(i.production),
    // Older videos kept a single idea as "ideaId".
    ideaIds: ideaList(i.ideaIds).length ? ideaList(i.ideaIds) : ideaList([i.ideaId]),
    postIds: ideaList(i.postIds),
    postId: str(i.postId),
    seriesId: str(i.seriesId),
    episode,
    claim: parseClaim(i.claim),
    hooks: strs(i.hooks).slice(0, 3),
    overlay: str(i.overlay),
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
    ...parseIdeaStep(i),
    id,
    title,
    brief: str(i.brief),
    premise: str(i.premise),
    question: str(i.question),
    ending: str(i.ending),
    characterIds: strs(i.characterIds),
    look: str(i.look),
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
