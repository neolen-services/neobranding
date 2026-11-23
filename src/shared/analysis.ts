// Post analysis types, shared by the main process and the UI.

/** Fixed lists, so analyses can be counted and compared across posts. */
export const VIDEO_FORMATS = [
  "Myth vs fact",
  "List",
  "Story",
  "How-to",
  "Demo",
  "Reaction",
  "Opinion to camera",
  "Before and after",
  "Day in the life",
  "Skit",
  "Montage",
  "Other",
] as const;

/** How a post was made to look. "Filmed" is a real camera; the rest are drawn, generated or animated. */
export const VISUAL_STYLES = [
  "Filmed",
  "Realistic AI",
  "Anime",
  "3D animation",
  "2D cartoon",
  "Comic book",
  "Claymation",
  "Watercolour",
  "Pixel art",
  "Motion graphics",
  "Screen recording",
  "Mixed",
  "Other",
] as const;

export const HOOK_TYPES = [
  "Question",
  "Bold claim",
  "Contrarian take",
  "Surprising number",
  "Problem callout",
  "Story opener",
  "Visual surprise",
  "Direct promise",
  "Curiosity gap",
  "Other",
] as const;

/** What Claude found when it looked at a saved post. Saved with the post and reused. */
export type PostAnalysis = {
  /** One or two sentences on what the post is and does. */
  summary: string;
  format: (typeof VIDEO_FORMATS)[number];
  /** How it was made to look. Missing on a post analysed before styles were looked at: analyse it again to fill it in. */
  style?: (typeof VISUAL_STYLES)[number];
  /** One sentence on the look within that style: colour, light, kind of drawing, how text is set. */
  styleNotes?: string;
  topic: string;
  /** The feeling the post plays on, e.g. curiosity, fear of missing out. */
  emotion: string;
  hookType: (typeof HOOK_TYPES)[number];
  /** The exact first line spoken, or "" if nothing is said. */
  spokenHook: string;
  /** What is seen in the first seconds. */
  visualHook: string;
  /** Text shown on screen in the opening, or "". */
  openingText: string;
  /** What happens, in order. */
  beats: string[];
  /** The closing ask, or "". */
  cta: string;
  whyItWorks: string[];
  /** The reusable structure, with the topic swapped for placeholders. */
  skeleton: string[];

  // Measured by the app, not judged by Claude.
  durationSeconds: number | null;
  /** Number of cuts found by scene detection. */
  cuts: number | null;
  wordsPerMinute: number | null;
  /** How many frames or pictures Claude was shown. */
  framesUsed: number;
  /** Whether a transcript was available. If not, analysing again after transcribing gives a better result. */
  usedTranscript: boolean;
  /** Estimated cost of this analysis in US dollars. */
  costUsd: number;
  analyzedAt: string;
};

/** Claude Opus 5.5 prices in US dollars per million tokens, used for cost estimates. */
const PRICE_IN = 4;
const PRICE_OUT = 20;

export function estimateCostUsd(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): number {
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.05;
  return (input * PRICE_IN + (usage.output_tokens ?? 0) * PRICE_OUT) / 1_000_000;
}

export const formatUsd = (amount: number) => (amount < 0.01 ? "under $0.01" : `$${amount.toFixed(2)}`);
