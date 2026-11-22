// Short-video idea types, shared by the main process and the UI.
import { parseProduction, type Production } from "./studio";

/** What an idea is for: one video, or a series of episodes. */
export type IdeaKind = "video" | "series";
export const ideaKind = (idea: { kind?: IdeaKind }): IdeaKind => (idea.kind === "series" ? "series" : "video");

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
  /** The platform it suits best. */
  platform: string;
  /** Exactly who the video is for. Missing on ideas made before this existed. */
  viewer?: string;
  /** The one thing that viewer can do or check afterwards. */
  takeaway?: string;
  /** How it was meant to be made when it was written: AI only, filmed by the creator, or a mix. Missing on older ideas. */
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
  /** Limit to one platform, or "" for any. */
  platform: string;
  /** Free-text steer, e.g. "about sleep" or "react to a news story". */
  notes: string;
  /** Write new episodes of this existing series, or "" for any. */
  series?: string;
  /** Whether each idea is one video or a whole series. Left out, single videos. */
  kind?: IdeaKind;
  /** How the ideas will be made. Left out, they are written to be filmed by the creator alone, as before. */
  production?: Production;
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
