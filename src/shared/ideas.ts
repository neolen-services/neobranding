// Short-video idea types, shared by the main process and the UI.
import { parseProduction, type Production } from "./studio";

/** What an idea is for: one video, or a series of episodes. */
export type IdeaKind = "video" | "series";
export const ideaKind = (idea: { kind?: IdeaKind }): IdeaKind => (idea.kind === "series" ? "series" : "video");

/**
 * What an idea needs to be made. "ai": something a phone cannot film (a made-up character, a talking object,
 * inside the body). "you": the creator on camera (their own routine, face or story). "either": it works both ways.
 */
export type IdeaNeeds = "ai" | "you" | "either";
export const IDEA_NEEDS: Record<IdeaNeeds, string> = { ai: "Needs AI", you: "Needs you on camera", either: "AI or filmed" };
const parseNeeds = (v: unknown): IdeaNeeds | undefined => (v === "ai" || v === "you" || v === "either" ? v : undefined);

/** What an idea needs; for an older idea, read from how it was meant to be made. */
export function ideaNeeds(idea: { needs?: IdeaNeeds; production?: Production }): IdeaNeeds {
  if (idea.needs) return idea.needs;
  return idea.production === "ai" ? "ai" : idea.production === "me" ? "you" : "either";
}

/** How a video made from an idea starts out being made, before the creator changes it. */
export function suggestedProduction(idea: { needs?: IdeaNeeds; production?: Production }): Production {
  if (idea.production) return idea.production;
  return idea.needs === "ai" ? "ai" : idea.needs === "you" ? "me" : "mix";
}

/** Why an idea cannot be made the chosen way, or "" when it can. A mix can make anything. */
export function productionClash(idea: { needs?: IdeaNeeds; production?: Production }, production: Production): string {
  const needs = ideaNeeds(idea);
  if (needs === "ai" && production === "me") return "This idea needs things a phone cannot film, so filming it all yourself will not work. Choose a mix or AI only, or the script will have to drop those parts.";
  if (needs === "you" && production === "ai") return "This idea needs you on camera. With AI only you are never seen or heard, so the script will tell it through a made-up character instead.";
  return "";
}

/** What the model suggests for one video, or for one series. */
export type IdeaDraft = {
  /** A single video, or a series. Missing on older ideas, which are all single videos. For a series, hook is its running question, outline lists its episodes and cta says how the season ends. */
  kind?: IdeaKind;
  title: string;
  /** The opening line, spoken in the first three seconds. */
  hook: string;
  /** Beat-by-beat outline of what to say. */
  outline: string[];
  /** Closing call to action. */
  cta: string;
  caption: string;
  hashtags: string[];
  /** One of the brand's content pillars. */
  pillar: string;
  /** The platform it suits best, on ideas written before the platform was chosen with the video; "" otherwise. */
  platform: string;
  /** Exactly who the video is for. Missing on ideas made before this existed. */
  viewer?: string;
  /** The one thing that viewer can do or check afterwards. */
  takeaway?: string;
  /** What it needs to be made: AI for what a phone cannot film, the creator on camera, or either way. Missing on older ideas. */
  needs?: IdeaNeeds;
  /** On ideas written before `needs`: how they were meant to be made. Only a starting choice when a video is made from it. */
  production?: Production;

  // Where the idea came from and how it was judged. Missing on ideas made before the process existed.
  /** Other opening lines that were considered. */
  altHooks?: string[];
  /** The saved post whose structure this idea borrows. */
  modelledOnId?: string;
  /** That post's creator, for display. */
  modelledOnLabel?: string;
  /** A repeatable format this idea belongs to, e.g. "Myth vs fact Mondays". */
  series?: string;
  /** 0 to 100, from a separate judging pass. */
  score?: number;
  scoreReason?: string;
};

/** An idea Claude suggested that the creator has neither saved nor dismissed yet. Kept in the data folder so a round is not lost by leaving the page. */
export type IdeaSuggestion = IdeaDraft & {
  /** Becomes the idea's id if it is saved. */
  key: string;
  suggestedAt: string;
};
/** The most suggestions kept waiting; older ones drop off. */
export const MAX_SUGGESTIONS = 60;

/** How many analysed posts are needed before ideas can be generated from them. */
export const MIN_ANALYSED_POSTS = 5;

/** A suggestion the user chose to keep. */
export type Idea = IdeaDraft & {
  id: string;
  createdAt: string;
};

export type GenerateOptions = {
  count: number;
  /** Limit to one pillar, or "" for any. */
  pillar: string;
  /** Free-text steer, e.g. "about sleep" or "react to a news story". */
  notes: string;
  /** Write new episodes of this existing series, or "" for any. */
  series?: string;
  /** Whether each idea is one video or a whole series. Left out, single videos. */
  kind?: IdeaKind;
  /** The saved posts to learn from. Empty or left out means every analysed post. */
  postIds?: string[];
};

export type GenerateResult =
  | {
      ok: true;
      ideas: IdeaDraft[];
      /** How many ideas were written before judging cut them down. */
      considered: number;
      /** Estimated cost of this round in US dollars. */
      costUsd: number;
    }
  | { ok: false; error: string };

export function parseIdea(input: unknown): Idea {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const id = str(i.id);
  const title = str(i.title);
  if (!id || !title) throw new Error("An idea needs an id and a title.");
  return {
    id,
    kind: i.kind === "series" ? "series" : "video",
    title,
    hook: str(i.hook),
    outline: list(i.outline),
    cta: str(i.cta),
    caption: str(i.caption),
    hashtags: list(i.hashtags),
    pillar: str(i.pillar),
    platform: str(i.platform),
    viewer: str(i.viewer),
    takeaway: str(i.takeaway),
    needs: parseNeeds(i.needs),
    production: i.production === undefined ? undefined : parseProduction(i.production),
    altHooks: list(i.altHooks),
    modelledOnId: str(i.modelledOnId),
    modelledOnLabel: str(i.modelledOnLabel),
    series: str(i.series),
    score: typeof i.score === "number" ? i.score : undefined,
    scoreReason: str(i.scoreReason),
    createdAt: str(i.createdAt) || new Date().toISOString(),
  };
}
