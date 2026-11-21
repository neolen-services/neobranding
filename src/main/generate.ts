// Turns analysed posts into video ideas for the brand.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// Two separate Claude calls:
//   1. The writer remixes: each idea borrows the structure of one saved post
//      and fills it with the brand's own topic and angle.
//   2. The judge, playing a sceptical viewer, scores every idea. Only the best
//      are returned. Keeping the judge separate stops the writer grading itself.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { estimateCostUsd } from "../shared/analysis";
import type { BrandKit } from "../shared/brand";
import { MIN_ANALYSED_POSTS, type GenerateOptions, type GenerateResult, type Idea, type IdeaDraft } from "../shared/ideas";
import type { ResearchItem } from "../shared/research";
import { describeClaudeError } from "./analyze";

/** Ideas written per idea asked for; the judge cuts them back down. */
const CANDIDATES_PER_IDEA = 5;
const MAX_CANDIDATES = 30;
/** The posts given to the writer as templates, strongest first. */
const MAX_TEMPLATES = 30;

const WriterSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string(),
      modelledOn: z.string(),
      hooks: z.array(z.string()),
      outline: z.array(z.string()),
      cta: z.string(),
      caption: z.string(),
      hashtags: z.array(z.string()),
      pillar: z.string(),
      platform: z.string(),
      series: z.string(),
    }),
  ),
});

const JudgeSchema = z.object({
  scores: z.array(
    z.object({
      idea: z.number(),
      bestHook: z.number(),
      stopScroll: z.number(),
      clarity: z.number(),
      brandFit: z.number(),
      easyToFilm: z.number(),
      reason: z.string(),
    }),
  ),
});

const WRITER_SYSTEM = `You write ideas for vertical videos of 30 to 60 seconds (Reels, Shorts, TikTok) for one creator.

You are given the creator's brand and a library of posts that already performed well, each with a code (P1, P2, …) and an analysis of its structure. Work by remixing: every idea takes ONE library post as its template, keeps that post's structure (how it opens, how it is built, how it ends) and replaces the subject with something from the creator's own topics, told from the creator's own angle and in their voice.

Rules:
- Borrow structure, never content. Do not reuse another creator's lines, story, numbers or claims.
- The creator must be able to film it alone with a phone this week.
- Spread the ideas across different templates and across the creator's content pillars. Do not lean on one template.
- Where the topic is health: keep claims accurate and proportionate, never promise cures or diagnose, and do not present the creator as a medical professional unless their bio says they are one.

For each idea give:
- title: a short working title for the creator's own list.
- modelledOn: the code of the template post, exactly as given (for example "P3").
- hooks: exactly three different opening lines for the first three seconds, each one sentence, each using the template's kind of hook.
- outline: four to six beats following the template's skeleton, each one short sentence saying what to say or show.
- cta: one closing line asking for a single action.
- caption: a ready-to-post caption of one to three sentences in the creator's voice.
- hashtags: three to six hashtags, each starting with #.
- pillar: the exact title of the content pillar it belongs to, copied from the brand.
- platform: the one platform from the brand's list that it suits best, copied exactly.
- series: a short name for a repeatable format this idea could belong to, so that several ideas share the same series name when they use the same kind of structure. Use at most four different series names across all ideas.`;

const JUDGE_SYSTEM = `You are a sceptical viewer scrolling short videos, and also an experienced short-form editor. You did not write these ideas and have no reason to be kind to them. Most ideas are average: use the whole scale, and give high scores rarely.

For each idea, read its three opening lines and its outline, then give:
- idea: the idea's number, as given.
- bestHook: the number (1, 2 or 3) of the strongest opening line.
- stopScroll: 1 to 10. Would the best opening line make a stranger in the target audience stop scrolling? 5 is "might, might not".
- clarity: 1 to 10. Is it obvious within seconds what the video is about and what the viewer gets?
- brandFit: 1 to 10. Does it fit this creator's topics, audience and voice?
- easyToFilm: 1 to 10. Can one person film it with a phone in under an hour?
- reason: one or two sentences saying what is strong and what is weak. Be specific.`;

export function describeBrand(brand: BrandKit): string {
  return [
    `Name: ${brand.name}`,
    `Topics: ${brand.topics.join(", ")}`,
    `Tagline: ${brand.tagline}`,
    `Positioning: ${brand.positioning}`,
    `Mission: ${brand.mission}`,
    `Bio: ${brand.bio}`,
    `Audience: ${brand.audience}`,
    `Goals: ${brand.goals.join(", ")}`,
    `What success looks like: ${brand.goalDetails}`,
    "",
    "Content pillars:",
    ...brand.pillars.map((p) => `- ${p.title}${p.topic ? ` (${p.topic})` : ""}: ${p.description}`),
    "",
    "Voice:",
    ...brand.voice.map((v) => `- ${v.trait}: ${v.description}`),
    "",
    "Platforms:",
    ...brand.platforms.map((p) => `- ${p.platform}${p.focus ? `: ${p.focus}` : ""}`),
  ].join("\n");
}

/** A post the user rated highly or that has more likes counts for more. */
const weight = (post: ResearchItem) => (post.rating ?? 3) * 1_000_000_000 + (post.likeCount ?? 0);

function describeTemplate(code: string, post: ResearchItem): string {
  const a = post.analysis!;
  return [
    `${code}: by ${post.author || post.authorHandle} on ${post.platform}`,
    `  Numbers: ${post.likeCount ?? "?"} likes, ${post.commentCount ?? "?"} comments${post.rating !== null ? `; the creator rated it ${post.rating}/5` : ""}`,
    post.note && `  The creator's note: ${post.note}`,
    `  Format: ${a.format}. Topic: ${a.topic}. Emotion: ${a.emotion}.`,
    `  Hook (${a.hookType}): says "${a.spokenHook || "(nothing spoken)"}"; shows ${a.visualHook || "(not described)"}${a.openingText ? `; on-screen text "${a.openingText}"` : ""}`,
    `  Length: ${a.durationSeconds ? `${Math.round(a.durationSeconds)}s` : "?"}${a.cuts !== null ? `, ${a.cuts} cuts` : ""}${a.wordsPerMinute ? `, ${a.wordsPerMinute} words a minute` : ""}`,
    `  Skeleton: ${a.skeleton.map((s, i) => `${i + 1}) ${s}`).join(" ")}`,
    `  Why it works: ${a.whyItWorks.join(" ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The creator's own posted videos with their latest numbers, best first, or ""
 * if none have been measured yet.
 */
function describeOwnResults(ideas: Idea[], templates: { code: string; post: ResearchItem }[]): string {
  const measured = ideas
    .map((idea) => ({ idea, last: idea.posted?.checks.at(-1) }))
    .filter((r) => r.last && (r.last.likes !== null || r.last.views !== null))
    .sort((a, b) => (b.last!.likes ?? 0) - (a.last!.likes ?? 0))
    .slice(0, 20);
  return measured
    .map(({ idea, last }) => {
      const code = templates.find((t) => t.post.id === idea.modelledOnId)?.code;
      const numbers = [
        last!.likes !== null && `${last!.likes} likes`,
        last!.comments !== null && `${last!.comments} comments`,
        last!.views !== null && `${last!.views} views`,
      ]
        .filter(Boolean)
        .join(", ");
      return [
        `- "${idea.title}": ${numbers}`,
        `  Opening line: ${idea.script?.hooks[0] || idea.hook}`,
        (idea.series || code) &&
          `  ${[idea.series && `Series: ${idea.series}`, code && `Modelled on ${code}`].filter(Boolean).join(". ")}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export async function generateIdeas(
  apiKey: string,
  brand: BrandKit,
  posts: ResearchItem[],
  options: GenerateOptions,
  /** The creator's saved ideas: used to avoid repeats and to learn from the ones already posted. */
  existing: Idea[],
): Promise<GenerateResult> {
  const existingTitles = existing.map((i) => i.title);
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };

  const analysed = posts.filter((p) => p.analysis).sort((a, b) => weight(b) - weight(a));
  if (analysed.length < MIN_ANALYSED_POSTS) {
    return {
      ok: false,
      error: `Analyse at least ${MIN_ANALYSED_POSTS} saved posts first. ${analysed.length} analysed so far.`,
    };
  }
  const templates = analysed.slice(0, MAX_TEMPLATES).map((post, i) => ({ code: `P${i + 1}`, post }));

  const wanted = Math.min(Math.max(Math.round(options.count) || 5, 1), 10);
  const candidates = Math.min(wanted * CANDIDATES_PER_IDEA, MAX_CANDIDATES);

  const request = [
    `Write ${candidates} ideas.`,
    options.pillar && `Every idea must belong to the content pillar "${options.pillar}".`,
    options.platform && `Every idea must be made for ${options.platform}.`,
    options.series &&
      `Every idea must be a new episode of the creator's existing series "${options.series}": same kind of structure, a different subject each time. Use that exact series name for every idea.`,
    options.notes && `Extra direction from the creator: ${options.notes}`,
    existingTitles.length > 0 &&
      `The creator already has these ideas, so do not repeat or lightly reword them:\n${existingTitles
        .slice(-60)
        .map((t) => `- ${t}`)
        .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const brandText = describeBrand(brand);
  const ownResults = describeOwnResults(existing, templates);
  const client = new Anthropic({ apiKey });
  const common = {
    model: "claude-opus-5-5",
    // Above about 16,000 the SDK insists on streaming; 30 ideas fit well inside this.
    max_tokens: 16000,
    // If the model declines for policy reasons, let the API retry on its default fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
  };

  try {
    // 1. Write.
    const written = await client.beta.messages.parse({
      ...common,
      system: WRITER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `THE CREATOR'S BRAND\n${brandText}\n\nLIBRARY OF POSTS THAT PERFORMED WELL\n${templates
            .map((t) => describeTemplate(t.code, t.post))
            .join("\n\n")}${
            ownResults
              ? `\n\nHOW THE CREATOR'S OWN POSTED VIDEOS DID\n${ownResults}\n\nLean towards the series, templates and kinds of opening that did best for this creator, and away from the ones that did worst. These are few results, so treat them as a hint, not a rule, and still spread the ideas.`
              : ""
          }\n\n---\n\n${request}`,
        },
      ],
      output_config: { format: betaZodOutputFormat(WriterSchema) },
    });
    if (written.stop_reason === "refusal") return { ok: false, error: "Claude declined this request. Try different direction notes." };
    const drafts = written.parsed_output?.ideas ?? [];
    if (written.stop_reason === "max_tokens" || drafts.length === 0) {
      return { ok: false, error: "The ideas came back incomplete. Try asking for fewer." };
    }

    // 2. Judge.
    const judged = await client.beta.messages.parse({
      ...common,
      system: JUDGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `THE CREATOR\n${brandText}\n\n${
            ownResults
              ? `HOW THE CREATOR'S OWN POSTED VIDEOS DID\n${ownResults}\n\nThis is real evidence of what this creator's audience responds to. Let it move your stopScroll score a little where an idea closely resembles one of these, up or down. It is a small sample.\n\n`
              : ""
          }IDEAS TO JUDGE\n${drafts
            .map((d, i) =>
              [
                `Idea ${i + 1}: ${d.title}`,
                ...d.hooks.map((h, n) => `  Opening line ${n + 1}: ${h}`),
                `  Outline: ${d.outline.join(" / ")}`,
                `  Closing ask: ${d.cta}`,
              ].join("\n"),
            )
            .join("\n\n")}`,
        },
      ],
      output_config: { format: betaZodOutputFormat(JudgeSchema) },
    });
    const scores = new Map((judged.parsed_output?.scores ?? []).map((s) => [Math.round(s.idea) - 1, s]));
    const costUsd = estimateCostUsd(written.usage) + estimateCostUsd(judged.usage);
    const clamp = (n: number) => Math.min(Math.max(n, 1), 10);

    const ideas: IdeaDraft[] = drafts
      .map((d, i): IdeaDraft => {
        const s = scores.get(i);
        const template = templates.find((t) => t.code === d.modelledOn.trim().toUpperCase());
        const best = s ? Math.min(Math.max(Math.round(s.bestHook) - 1, 0), d.hooks.length - 1) : 0;
        // Stopping the scroll matters most; the rest decide between ideas that both do.
        const score = s
          ? Math.round(
              (clamp(s.stopScroll) * 0.5 + clamp(s.clarity) * 0.15 + clamp(s.brandFit) * 0.2 + clamp(s.easyToFilm) * 0.15) * 10,
            )
          : undefined;
        return {
          title: d.title,
          hook: d.hooks[best] ?? "",
          altHooks: d.hooks.filter((_, n) => n !== best),
          outline: d.outline,
          cta: d.cta,
          caption: d.caption,
          hashtags: d.hashtags,
          pillar: d.pillar,
          platform: d.platform,
          series: d.series,
          modelledOnId: template?.post.id,
          modelledOnLabel: template ? template.post.author || template.post.authorHandle : undefined,
          score,
          scoreReason: s?.reason,
        };
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, wanted);

    return { ok: true, ideas, considered: drafts.length, costUsd };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}
