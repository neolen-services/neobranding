// Asks Claude for short-video ideas tailored to the brand.
// Plain Node code with relative imports only: it runs in the Electron main
// process and in the dev server's middleware (see electron.vite.config.ts).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { BrandKit } from "../shared/brand";
import type { GenerateOptions, GenerateResult } from "../shared/ideas";

const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string(),
      hook: z.string(),
      outline: z.array(z.string()),
      cta: z.string(),
      caption: z.string(),
      hashtags: z.array(z.string()),
      pillar: z.string(),
      platform: z.string(),
    }),
  ),
});

const SYSTEM = `You are a short-form video strategist. You suggest ideas for vertical videos of 30 to 60 seconds (Reels, Shorts, TikTok) for one creator, whose brand is described in the user's message.

Each idea must be something this specific creator could film this week, alone, with a phone. Ground every idea in their topics, audience, goals and content pillars, and write the spoken parts in their voice. Make the ideas clearly different from one another in angle and format (for example: myth check, personal story, quick how-to, reaction, behind the scenes, one surprising number).

For each idea give:
- title: a short working title for the creator's own list, not shown to viewers.
- hook: the exact opening line, spoken in the first three seconds. One sentence, concrete, no clickbait the video does not pay off.
- outline: three to five beats, each one short sentence saying what to say or show.
- cta: one closing line that asks for a single action.
- caption: a ready-to-post caption of one to three sentences in the creator's voice.
- hashtags: three to six hashtags, each starting with #.
- pillar: the exact title of the content pillar it belongs to, copied from the brand.
- platform: the one platform from the brand's list that it suits best, copied exactly.

Where the topic is health: keep claims accurate and proportionate, prefer what the evidence supports, never promise cures or diagnose, and do not present the creator as a medical professional unless their bio says they are one.`;

function describeBrand(brand: BrandKit): string {
  const lines = [
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
  ];
  return lines.join("\n");
}

export async function generateIdeas(
  apiKey: string,
  brand: BrandKit,
  options: GenerateOptions,
  existingTitles: string[],
): Promise<GenerateResult> {
  if (!apiKey) return { ok: false, error: "Add your Anthropic API key first." };

  const count = Math.min(Math.max(Math.round(options.count) || 5, 1), 10);
  const request = [
    `Suggest ${count} short-video ideas for this brand.`,
    options.pillar && `Every idea must belong to the content pillar "${options.pillar}".`,
    options.platform && `Every idea must be made for ${options.platform}.`,
    options.notes && `Extra direction from the creator: ${options.notes}`,
    existingTitles.length > 0 &&
      `The creator already has these ideas, so do not repeat or lightly reword them:\n${existingTitles
        .slice(-60)
        .map((t) => `- ${t}`)
        .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // If the model declines for policy reasons, let the API retry on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: `${describeBrand(brand)}\n\n---\n\n${request}` }],
      output_config: { format: betaZodOutputFormat(IdeasSchema) },
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "Claude declined this request. Try different direction notes." };
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return { ok: false, error: "The response was cut off. Try asking for fewer ideas." };
    }
    return { ok: true, ideas: response.parsed_output.ideas };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "That API key was rejected. Check it and save it again." };
    }
    if (e instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: "This API key is not allowed to use the model." };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Rate limit reached. Wait a minute and try again." };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: "Could not reach Anthropic. Check your internet connection." };
    }
    if (e instanceof Anthropic.APIError) {
      return { ok: false, error: `Anthropic returned an error (${e.status ?? "unknown"}): ${e.message}` };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Could not generate ideas." };
  }
}
