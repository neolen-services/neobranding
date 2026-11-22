// The Studio's work: writing a video's script as scenes, planning a series, and voicing lines.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { estimateCostUsd } from "../shared/analysis";
import type { BrandKit } from "../shared/brand";
import type { Idea } from "../shared/ideas";
import type { ResearchItem } from "../shared/research";
import {
  CONCEPT_COUNT,
  parseCharacter,
  parseSeries,
  parseVideo,
  SPEAKER_ME,
  SPEAKER_NARRATOR,
  speakerName,
  type Character,
  type Concept,
  type Production,
  type Series,
  type StudioResult,
  type Video,
  type VideoVoicesResult,
} from "../shared/studio";
import { describeClaudeError } from "./analyze";
import { generateSpeech } from "./audio";
import { describeBrand } from "./generate";
import { recordClaude } from "./usage";

const WORDS_PER_SECOND = 2.5;
/** Health topics switch on the health rules. The app itself is not about any one subject. */
const HEALTH_TOPIC = /health|fitness|medic|nutrition|wellness|diet|longevity|sleep|weight/i;

const NewCharacter = z.object({ name: z.string(), role: z.string(), personality: z.string(), speech: z.string(), look: z.string() });

const VideoSchema = z.object({
  claim: z.object({ fact: z.string(), source: z.string(), evidence: z.enum(["strong", "early", "personal", "none"]), action: z.string() }),
  hooks: z.array(z.string()),
  overlay: z.string(),
  scenes: z.array(
    z.object({
      made_by: z.enum(["ai", "me"]),
      seconds: z.number(),
      place: z.string(),
      characters: z.array(z.string()),
      action: z.string(),
      camera: z.string(),
      text: z.string(),
      sound: z.string(),
      lines: z.array(z.object({ speaker: z.string(), text: z.string(), delivery: z.string() })),
    }),
  ),
  checks: z.array(z.object({ rule: z.string(), ok: z.boolean(), note: z.string() })),
  caption: z.string(),
  kept: z.array(z.string()),
  changed: z.array(z.string()),
  story_update: z.array(z.string()),
  look: z.string(),
  new_characters: z.array(NewCharacter),
});

const SeriesSchema = z.object({
  premise: z.string(),
  question: z.string(),
  ending: z.string(),
  episodes: z.array(z.object({ teaches: z.string(), ends_on: z.string() })),
  new_characters: z.array(NewCharacter),
});

const GENERAL_RULES = [
  "Every factual statement in the script is covered by the claim. No invented numbers, studies, quotes or results.",
  "A made-up character is plainly fiction. No invented real person, patient or testimonial is presented as real.",
];
const HEALTH_RULES = [
  "No promise of a cure and no diagnosing.",
  "Fear is not the hook: the opening uses curiosity or surprise, not a scare.",
  "A personal result is said to be one person's experience, not proof.",
  "The creator is not presented as a medical professional unless their bio says they are one.",
  "Where the evidence is early or personal, the script says so in plain words.",
];

const VIDEO_SYSTEM = `You write short vertical videos (Reels, Shorts, TikTok) for one creator, as a list of scenes that can each be generated with AI or filmed by the creator.

The aim is not the most views. It is the right followers: people who match the creator's audience. So the opening must name that viewer or their exact problem, and the video must leave them one thing to do or check.

You are given the creator's brand, what the video is about, the cast of characters available, and sometimes a series plan or the analysis of a post to remake.

Write:
- claim: the one true thing the video is built on.
  - fact: one sentence. If the video makes no factual claim (pure story, behind the scenes), give "" and evidence "none".
  - evidence: "strong" (well-replicated research or official guidelines), "early" (small or new studies), "personal" (the creator's own experience), or "none".
  - source: say what kind of source supports it and what the creator should look up to confirm it, for example "Reviews of trials on light walking after meals; confirm on PubMed". You cannot browse, so NEVER invent a study title, author, journal, year or link, and never state numbers you are not sure of. The creator confirms the source themselves.
  - action: the one thing the viewer should do or check.
- hooks: exactly three opening lines for the first three seconds, strongest first, each naming the viewer or their problem. The first is the one the scenes use.
- overlay: the on-screen text of the opening, eight words or fewer.
- scenes: the whole video in order. Each scene is ONE continuous shot of 3 to 8 seconds:
  - made_by: "me" when the creator is on camera (they deliver the fact and the closing ask in their own face and voice unless told otherwise), "ai" for everything else: characters, the inside of the body, anything a phone cannot film.
  - seconds, place (a short name, reused exactly when scenes share a place), characters (names of cast members seen; [] for none), action (what happens, one sentence), camera (framing and movement), text (on-screen words, six or fewer, or ""), sound (a sound effect or music cue, or "").
  - lines: what is said in the scene, each with speaker, text (the exact words) and delivery (one or two words such as "calm" or "mocking", or ""). speaker is exactly "ME" (the creator on camera), "NARRATOR" (a voice over the scene), or the exact name of a cast member.
  - Only ONE speaker is seen talking in a scene. A conversation is cut into alternating close shots. A wide shot with several characters has no spoken line, or a NARRATOR line.
- checks: go through every rule you are given and report honestly: rule (copied), ok (true or false), note (one short sentence: what you found or what must change). If something fails, still write the best script you can and say what to fix.
- caption: a ready-to-post caption of one to three sentences in the creator's voice.
- kept and changed: only for a remake, otherwise []. kept = what you borrowed from the original (format, kind of hook, order of beats). changed = what is new (characters, place, every word, the topic).
- story_update: only for a series episode, otherwise []. Two to four short facts this episode adds to the story so far.
- look: one sentence on the visual style all the AI scenes share (kind of image, colour, light), for example "Realistic film, warm evening light, shallow focus". Keep the series' look when one is given.
- new_characters: characters the script needs that are not in the cast, each with name, role, personality, speech (how they talk) and look (including one fixed colour or item of clothing). [] when the cast is enough. Keep casts small.

Rules for the writing:
- Write backwards from the action: decide what the viewer should do, then the proof, then what is at stake, then the hook.
- Spoken words must fit: no more than ${WORDS_PER_SECOND} words for each second of a scene. Count them.
- Entertainment is the delivery, never the goal. A story may dramatise the problem, never the evidence.
- A remake borrows the structure of the original, never its words, characters, setting, examples or closing line.
- A series episode must make sense to someone who has seen no other episode: it teaches one complete thing, then stops just before the next answer, and ends with on-screen text asking the viewer to follow for the next part.
- Write characters the way their personality and speech notes say.`;

const SERIES_SYSTEM = `You plan a short season of vertical videos for one creator: a series people follow because one question runs through it and every episode also gives them something complete.

Give:
- premise: what the series is, in one or two sentences.
- question: the one running question viewers wait to have answered.
- ending: how the season ends. If the series is a real experiment whose result is not known, say instead what will be measured, when, and that the result is shown whatever it is. Never invent a result.
- episodes: five to eight, in order. For each: teaches (the one complete thing a viewer gets from it, even if it is the only episode they ever see) and ends_on (what it stops on to make them want the next: a number not yet shown, a result still to come, a decision, a setback). Vary how episodes end.
- new_characters: the recurring characters the series needs that are not already in the cast, each with name, role, personality, speech (how they talk) and look (including one fixed colour or item of clothing). Two to four at most; [] if the creator alone carries it.

Plan the season from its ending backwards. Keep every claim something that can be honestly supported; where the topic is health, never promise cures and never invent a patient presented as real.`;

const describeCast = (characters: Character[]) =>
  characters.length
    ? characters
        .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${[c.personality, c.speech && `Talks: ${c.speech}`, c.look && `Look: ${c.look}`].filter(Boolean).join(" ")}`)
        .join("\n")
    : "(no characters yet; propose the ones the video needs)";

function describePost(post: ResearchItem): string {
  const a = post.analysis!;
  return [
    `Format: ${a.format}. Topic: ${a.topic}. Kind of hook: ${a.hookType}.`,
    `Length: ${a.durationSeconds ? `${Math.round(a.durationSeconds)}s` : "unknown"}.`,
    `What happens: ${a.beats.map((b, i) => `${i + 1}) ${b}`).join(" ")}`,
    `Structure: ${a.skeleton.map((s, i) => `${i + 1}) ${s}`).join(" ")}`,
    `Why it works: ${a.whyItWorks.join(" ")}`,
  ].join("\n");
}

const describeIdea = (idea: Idea) =>
  [
    `Title: ${idea.title}`,
    idea.viewer && `For: ${idea.viewer}`,
    `Opening line: ${idea.hook}`,
    `Outline: ${idea.outline.map((b, i) => `${i + 1}) ${b}`).join(" ")}`,
    `Closing ask: ${idea.cta}`,
    idea.takeaway && `The viewer leaves with: ${idea.takeaway}`,
    idea.pillar && `Content pillar: ${idea.pillar}`,
  ]
    .filter(Boolean)
    .join("\n");

/** What the writer is told about how a video's scenes are made. */
const VIDEO_PRODUCTION: Record<Production, string> = {
  mix: "A mix. The creator films the scenes they are in; AI generates the rest.",
  ai: 'AI only. Every scene is generated, so made_by is "ai" for all of them. The creator is never on camera and never speaks: no line has the speaker ME. The fact and the closing ask are said by NARRATOR or by a character.',
  me: 'Filmed by the creator only. Nothing is generated, so made_by is "me" for every scene, and every scene must be something one person can film with a phone. Every spoken line has the speaker ME, on camera or as their own voice over the shot. There are no characters: characters is [] in every scene, new_characters is [] and look is "".',
};
const SERIES_PRODUCTION: Record<Production, string> = {
  mix: "A mix. The creator hosts on camera, and AI generates the characters and anything a phone cannot film.",
  ai: "AI only. Every scene of every episode is generated and the creator never appears, so recurring characters and a narrator carry the series.",
  me: "Filmed by the creator only. Nothing is generated, so there are no characters (new_characters is []) and every episode must be something one person can film with a phone.",
};

const ConceptsSchema = z.object({
  concepts: z.array(
    z.object({
      title: z.string(),
      angle: z.string(),
      hook: z.string(),
      characters: z.string(),
      tension: z.string(),
      victory: z.string(),
      ending: z.string(),
      viewer: z.string(),
      takeaway: z.string(),
      why: z.string(),
    }),
  ),
});

const CONCEPT_SYSTEM = `You help one creator decide what a short vertical video, or a series of them, should be, before any script is written.

You are given the creator's brand, what they asked for, any saved ideas they picked, how it will be made, and sometimes how their earlier videos did and what they have already made.

First think through at least ten clearly different ways to make it: different angles on the subject, different formats (a ranking, a test on themselves, a story, a myth and its correction, a day-by-day experiment, a conversation between characters, a before and after), different openings. Then return the ${CONCEPT_COUNT} strongest, strongest first. No two may share both an angle and a format.

EVERY idea must be a story with these four parts, in this order. An idea that is missing one is not finished:
1. characters: characters you care about. Who the viewer roots for, and the one detail that makes them care (what they want, what they are afraid of, what they keep getting wrong). It can be the creator, a made-up character, or something given a voice (an organ, a habit, a houseplant).
2. tension: escalating tension. What stands in their way and how it gets worse step by step, at least two steps, each raising the stakes.
3. victory: the moment of victory. The single moment the viewer has been waiting for, where the thing finally works or the truth lands. This is where the video's one true fact or its one thing to do belongs.
4. ending: a surprising ending. A last beat the viewer did not see coming that changes how they see what came before. For a series, this is how the season ends.

For each idea give:
- title: a working title, eight words or fewer.
- angle: one sentence on what makes this take different from the others.
- hook: for a video, the opening line said in the first three seconds, naming the viewer or their problem. For a series, the one running question viewers wait to have answered.
- characters, tension, victory, ending: one or two concrete sentences each, as described above. For a series, describe them across the whole season.
- viewer: exactly who it is for, in one phrase.
- takeaway: the one thing that viewer does or checks afterwards.
- why: one honest sentence on why this could find the creator's kind of viewer, including its weak point if it has one.

Rules:
- Stay inside what the creator asked for and the saved ideas they picked. These are different ways to make THAT, not unrelated topics.
- Fit how it is made. An AI-only idea never needs the creator on camera, so its characters are made up or given a voice. A filmed-only idea is something one person can film with a phone, so the character is the creator and nothing is generated.
- The aim is the right followers, not the most views. Never rely on fear, invented numbers, invented studies or made-up testimonials.
- The victory and the ending must be honest. A story may dramatise the problem, never the evidence. If the idea is a real experiment whose result is not known yet, the ending is what will be measured and shown whatever it is; never invent a result.
- When asked to change ONE idea, return exactly one: that idea changed as the note asks, keeping whatever the note does not mention, and still with all four parts.`;

/** The saved posts the creator picked as inspiration, by their analysis only. */
const describeInspiration = (posts: ResearchItem[]) =>
  posts.filter((p) => p.analysis).length
    ? `SAVED POSTS THE CREATOR PICKED AS INSPIRATION (analysis only; their words are deliberately not shown to you)\nBorrow what makes them work: the format, the kind of hook, the order of beats. Never their words, characters, setting, examples or closing line.\n\n${posts
        .filter((p) => p.analysis)
        .map((p, i) => `Post ${i + 1}${p.rating ? ` (the creator rated it ${p.rating} of 5)` : ""}${p.note ? `\nThe creator's note on it: ${p.note}` : ""}\n${describePost(p)}`)
        .join("\n\n")}`
    : "";

const describeConcept = (c: Concept) =>
  [
    `Title: ${c.title}`,
    `Angle: ${c.angle}`,
    `Opening or running question: ${c.hook}`,
    `1. Characters you care about: ${c.characters}`,
    `2. Escalating tension: ${c.tension}`,
    `3. Moment of victory: ${c.victory}`,
    `4. Surprising ending: ${c.ending}`,
    `For: ${c.viewer}`,
    `The viewer leaves with: ${c.takeaway}`,
  ].join("\n");

export type SuggestInput = {
  kind: "video" | "series";
  title: string;
  /** What the creator asked for, in their words. */
  brief: string;
  brand: BrandKit;
  production: Production;
  ideas: Idea[];
  /** Saved posts picked as inspiration. */
  posts: ResearchItem[];
  /** How the creator's earlier posted videos did, as lines of text, or "". */
  learned: string;
  /** Titles of what is already in Studio, so the suggestions do not repeat them. */
  made: string[];
  /** What the creator wants different this time. */
  note?: string;
  /** The ideas suggested before, when asking for new ones. */
  previous?: Concept[];
  /** The one idea to change as the note asks, instead of suggesting new ones. */
  revise?: Concept;
};

/** Suggests the strongest different ways to make a video or series, or changes one of them as the creator asks. */
export async function suggestConcepts(apiKey: string, input: SuggestInput): Promise<StudioResult<{ concepts: Concept[]; costUsd: number }>> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  const { kind, brand, ideas, note, previous, revise } = input;
  if (revise && !note?.trim()) return { ok: false, error: "Say what should change first." };
  const parts = [
    `THE CREATOR'S BRAND\n${describeBrand(brand)}`,
    `WHAT THEY ARE MAKING\n${kind === "series" ? "A series: a season of short videos with one running question." : "A single short video."}\nWorking title: ${input.title}\nWhat they asked for: ${input.brief.trim() || "(nothing more than the title and the saved ideas)"}`,
    `HOW IT IS MADE\n${(kind === "series" ? SERIES_PRODUCTION : VIDEO_PRODUCTION)[input.production]}`,
    ideas.length ? `SAVED IDEAS THE CREATOR PICKED\n${ideas.map((idea, i) => `Idea ${i + 1}\n${describeIdea(idea)}`).join("\n\n")}` : "",
    describeInspiration(input.posts),
    input.learned ? `HOW THIS CREATOR'S EARLIER VIDEOS DID (best first)\n${input.learned}` : "",
    input.made.length ? `ALREADY IN THEIR STUDIO (do not repeat these)\n${input.made.map((t) => `- ${t}`).join("\n")}` : "",
    revise
      ? `THE ONE IDEA TO CHANGE\n${describeConcept(revise)}\n\nTHE CREATOR'S NOTE: ${note}\nReturn exactly one idea: this one, changed as the note asks.`
      : previous?.length
        ? `THE IDEAS SUGGESTED BEFORE, WHICH THE CREATOR DID NOT CHOOSE\n${previous.map((c) => `- ${c.title}: ${c.angle}`).join("\n")}\n\nTHE CREATOR'S NOTE: ${note?.trim() || "(none: they simply want different ones)"}\nSuggest ${CONCEPT_COUNT} new ideas that follow the note and are not these again.`
        : note?.trim()
          ? `THE CREATOR'S DIRECTION: ${note}`
          : "",
  ];
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      // If the model declines for policy reasons, let the API retry on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: CONCEPT_SYSTEM,
      messages: [{ role: "user", content: parts.filter(Boolean).join("\n\n") }],
      output_config: { format: betaZodOutputFormat(ConceptsSchema) },
    });
    recordClaude("concepts", response.usage, input.title);
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to suggest ideas for this." };
    const out = response.parsed_output;
    // An idea without all four parts of its story is not offered.
    const whole = (out?.concepts ?? []).filter((c) => [c.title, c.hook, c.characters, c.tension, c.victory, c.ending].every((part) => part.trim()));
    const concepts = whole.slice(0, revise ? 1 : CONCEPT_COUNT).map((c): Concept => ({ ...c, id: randomUUID() }));
    if (response.stop_reason === "max_tokens" || concepts.length === 0) return { ok: false, error: "The ideas came back incomplete. Try again." };
    return { ok: true, value: { concepts, costUsd: estimateCostUsd(response.usage) } };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}

/** Characters the model proposed, as new cast members without a voice. */
function castFrom(proposed: z.infer<typeof NewCharacter>[], existing: Character[]): Character[] {
  const taken = new Set(existing.map((c) => c.name.toLowerCase()));
  const made: Character[] = [];
  for (const p of proposed) {
    const name = p.name.trim();
    if (!name || taken.has(name.toLowerCase()) || /^(me|narrator)$/i.test(name)) continue;
    taken.add(name.toLowerCase());
    made.push(parseCharacter({ ...p, id: randomUUID(), voice: null }));
  }
  return made;
}

export type WriteVideoInput = {
  video: Video;
  brand: BrandKit;
  characters: Character[];
  /** The saved ideas it was started from, to be turned into one video. */
  ideas?: Idea[];
  /** The suggested idea the creator approved, if they chose one. */
  concept?: Concept;
  /** Saved posts picked as inspiration (not the one post a remake is built on). */
  inspiration?: ResearchItem[];
  /** The post being remade; only its analysis is passed on, never its words. */
  post?: ResearchItem;
  series?: Series;
  /** What the creator wants changed, when the script is sent back. */
  note?: string;
  /** How the creator's earlier posted videos did, as lines of text, or "". */
  learned?: string;
};

/** Writes (or rewrites) a video's claim, hooks, scenes and checks. Returns the video and any characters it added to the cast. */
export async function writeVideo(apiKey: string, input: WriteVideoInput): Promise<StudioResult<{ video: Video; newCharacters: Character[] }>> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  const { video, brand, characters, post, series, note, learned } = input;
  const ideas = input.ideas ?? [];
  const how = video.production;
  if (video.source === "remake" && !post?.analysis) {
    return { ok: false, error: "The post this is a version of has to be analysed first, so its structure can be used without its words." };
  }
  const cast = series ? characters.filter((c) => series.characterIds.includes(c.id)) : characters;
  const rules = [...GENERAL_RULES, ...(HEALTH_TOPIC.test(brand.topics.join(" ")) ? HEALTH_RULES : [])];
  const episodeLine = series && video.episode ? series.episodes[video.episode - 1] : undefined;

  const parts = [
    `THE CREATOR'S BRAND\n${describeBrand(brand)}`,
    `THE VIDEO\nTitle: ${video.title}\nKind: ${video.format === "episode" ? "an episode of a series" : "a single video"}, ${video.source === "remake" ? "a remake of the post analysed below" : "a new idea"}.\nAbout: ${video.brief || "(use the title)"}`,
    `HOW IT IS MADE\n${VIDEO_PRODUCTION[how]}`,
    input.concept ? `THE IDEA THE CREATOR APPROVED\nWrite this video. Keep its angle and its opening, and play out its four story parts in order: the characters, the rising tension, the moment of victory, the surprising ending. Anything else below is background.\n${describeConcept(input.concept)}` : "",
    ideas.length === 1 ? `THE SAVED IDEA IT COMES FROM\n${describeIdea(ideas[0])}` : "",
    ideas.length > 1
      ? `THE SAVED IDEAS IT COMES FROM\nThe creator picked these to become ONE video. Find the single thread that joins them. If they do not fit one video, build on the first and take only what helps from the others. What the creator wrote under "About" decides how they are used.\n\n${ideas.map((idea, i) => `Idea ${i + 1}\n${describeIdea(idea)}`).join("\n\n")}`
      : "",
    describeInspiration(input.inspiration ?? []),
    post?.analysis && video.source === "remake" ? `THE POST TO REMAKE (analysis only; its words are deliberately not shown to you)\n${describePost(post)}` : "",
    series
      ? `THE SERIES\nTitle: ${series.title}${series.look ? `\nLook: ${series.look}` : ""}\nPremise: ${series.premise}\nRunning question: ${series.question}\nEnding: ${series.ending}\nThis is episode ${video.episode ?? "?"} of ${series.episodes.length}.${episodeLine ? ` It teaches: ${episodeLine.teaches}. It ends on: ${episodeLine.endsOn}.` : ""}\nStory so far:\n${series.storySoFar.length ? series.storySoFar.map((s) => `- ${s}`).join("\n") : "(nothing yet: this is the start)"}`
      : "",
    how === "me"
      ? `THE CAST\nNone. The creator (speaker "ME") films this alone.`
      : `THE CAST AVAILABLE\n${describeCast(cast)}\n${how === "ai" ? "The creator does not appear in this video." : 'The creator (speaker "ME") is always available and is filmed, never generated.'}`,
    `RULES TO CHECK THE SCRIPT AGAINST\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
    learned
      ? `HOW THIS CREATOR'S EARLIER VIDEOS DID (best first, by saves, shares and follows for the views they got)\n${learned}\nLearn from the openings that found the right viewers. Do not reuse their wording.`
      : "",
    "Target length: 30 to 60 seconds in total.",
    note && video.scenes.length
      ? `THE CURRENT SCRIPT, WHICH THE CREATOR SENT BACK\n${JSON.stringify({ claim: video.claim, hooks: video.hooks, scenes: video.scenes.map((s) => ({ place: s.place, action: s.action, lines: s.lines.map((l) => `${speakerName(l.speaker, characters)}: ${l.text}`) })) })}\n\nTHE CREATOR'S NOTE: ${note}\nChange what the note asks for and keep the rest as it is.`
      : note
        ? `THE CREATOR'S DIRECTION: ${note}`
        : "",
  ];

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 12000,
      // If the model declines for policy reasons, let the API retry on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: VIDEO_SYSTEM,
      messages: [{ role: "user", content: parts.filter(Boolean).join("\n\n") }],
      output_config: { format: betaZodOutputFormat(VideoSchema) },
    });
    recordClaude("video", response.usage, video.title);
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to write this script." };
    const out = response.parsed_output;
    if (response.stop_reason === "max_tokens" || !out || out.scenes.length === 0) {
      return { ok: false, error: "The script came back incomplete. Try again." };
    }

    // The creator's choice of how it is made holds even if the writer strayed from it.
    const newCharacters = how === "me" ? [] : castFrom(out.new_characters, characters);
    const everyone = [...characters, ...newCharacters];
    const idOf = (name: string) => everyone.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())?.id;
    const speaker = (name: string) => {
      if (how === "me") return SPEAKER_ME;
      if (/^me$/i.test(name.trim())) return how === "ai" ? SPEAKER_NARRATOR : SPEAKER_ME;
      return idOf(name) ?? SPEAKER_NARRATOR;
    };

    const written = parseVideo({
      ...video,
      // A rewritten claim has to be checked again.
      claim: { ...out.claim, checked: false },
      hooks: out.hooks,
      overlay: out.overlay,
      scenes: out.scenes.map((s, index) => ({
        id: randomUUID(),
        // A rewrite keeps what was already made for the scene in the same position.
        pictures: video.scenes[index]?.pictures ?? [],
        picture: video.scenes[index]?.picture ?? "",
        clips: video.scenes[index]?.clips ?? [],
        clip: video.scenes[index]?.clip ?? "",
        madeBy: how === "mix" ? s.made_by : how,
        seconds: s.seconds,
        place: s.place,
        characters: how === "me" ? [] : s.characters.map(idOf).filter(Boolean),
        action: s.action,
        camera: s.camera,
        text: s.text,
        sound: s.sound,
        lines: s.lines.map((l) => ({ speaker: speaker(l.speaker), text: l.text, delivery: l.delivery })),
      })),
      checks: out.checks,
      caption: out.caption,
      kept: video.source === "remake" ? out.kept : [],
      changed: video.source === "remake" ? out.changed : [],
      storyUpdate: series ? out.story_update : [],
      look: how === "me" ? "" : video.look || series?.look || out.look,
      approvedAt: "",
      costUsd: video.costUsd + estimateCostUsd(response.usage),
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, value: { video: written, newCharacters } };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}

/** Plans a season from a title and a few words about it. Returns the series and any characters it added to the cast. */
export async function planSeries(
  apiKey: string,
  input: { title: string; about: string; brand: BrandKit; characters: Character[]; production: Production; ideas: Idea[]; concept?: Concept; posts?: ResearchItem[] },
): Promise<StudioResult<{ series: Series; newCharacters: Character[] }>> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the series a title first." };
  const how = input.production;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: SERIES_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `THE CREATOR'S BRAND\n${describeBrand(input.brand)}`,
            `THE SERIES\nTitle: ${title}\nAbout: ${input.about.trim() || "(use the title)"}`,
            `HOW IT IS MADE\n${SERIES_PRODUCTION[how]}`,
            input.concept ? `THE IDEA THE CREATOR APPROVED\nPlan this series. Keep its angle and its running question, and spread its four story parts across the season: the characters early, the tension rising episode by episode, the moment of victory late, the surprising ending last.\n${describeConcept(input.concept)}` : "",
            input.ideas.length
              ? `SAVED IDEAS THE CREATOR PICKED FOR THIS SERIES\nBuild the season from these. Each can become an episode, in the order that tells the best story; add episodes of your own where the season needs them. What the creator wrote under "About" decides how they are used.\n\n${input.ideas.map((idea, i) => `Idea ${i + 1}\n${describeIdea(idea)}`).join("\n\n")}`
              : "",
            describeInspiration(input.posts ?? []),
            how === "me"
              ? "THE CAST\nNone. The creator films this alone."
              : `THE CAST ALREADY MADE\n${describeCast(input.characters)}\n${how === "ai" ? "The creator does not appear in this series." : "The creator is always available as the host."}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      output_config: { format: betaZodOutputFormat(SeriesSchema) },
    });
    recordClaude("series", response.usage, title);
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to plan this series." };
    const out = response.parsed_output;
    if (response.stop_reason === "max_tokens" || !out || out.episodes.length === 0) {
      return { ok: false, error: "The plan came back incomplete. Try again." };
    }
    const newCharacters = how === "me" ? [] : castFrom(out.new_characters, input.characters);
    const series = parseSeries({
      id: randomUUID(),
      title,
      production: how,
      ideaIds: input.ideas.map((i) => i.id),
      premise: out.premise,
      question: out.question,
      ending: out.ending,
      characterIds: newCharacters.map((c) => c.id),
      episodes: out.episodes.map((e) => ({ teaches: e.teaches, endsOn: e.ends_on })),
      storySoFar: [],
      costUsd: estimateCostUsd(response.usage),
    });
    return { ok: true, value: { series, newCharacters } };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}

/** The lines of a video that are spoken by an AI voice and have no audio yet. */
export function linesToVoice(video: Video): number {
  return video.scenes.reduce((n, s) => n + s.lines.filter((l) => l.speaker !== SPEAKER_ME && !l.audioId).length, 0);
}

/**
 * Speaks every AI line that has no audio yet, in its character's voice (the
 * brand's speaking voice for the narrator). The creator's own lines are never
 * voiced: they say those on camera. Lines whose speaker has no voice are
 * skipped and named, so the rest still get made.
 */
export async function voiceVideo(
  dataDir: string,
  elevenKey: string,
  video: Video,
  characters: Character[],
  brand: BrandKit,
): Promise<VideoVoicesResult> {
  if (!video.approvedAt) return { ok: false, error: "Approve the script first, so voices are not made for words that will change." };
  const skipped = new Set<string>();
  let made = 0;
  let failure = "";
  const scenes = [];
  for (const [index, scene] of video.scenes.entries()) {
    const lines = [];
    for (const line of scene.lines) {
      if (line.speaker === SPEAKER_ME || line.audioId || failure) {
        lines.push(line);
        continue;
      }
      const who = speakerName(line.speaker, characters);
      const voice = line.speaker === SPEAKER_NARRATOR ? brand.speakingVoice : characters.find((c) => c.id === line.speaker)?.voice;
      if (!voice) {
        skipped.add(who);
        lines.push(line);
        continue;
      }
      const spoken = await generateSpeech(dataDir, elevenKey, {
        text: line.text,
        voiceId: voice.id,
        voiceName: voice.name,
        title: `${video.title} · scene ${index + 1} · ${who}`,
      });
      if (!spoken.ok) {
        // The first failure (a bad key, no credit) would repeat for every line, so stop there.
        failure = spoken.error;
        lines.push(line);
        continue;
      }
      made++;
      lines.push({ ...line, audioId: spoken.audio.id, audioFile: spoken.audio.file });
    }
    scenes.push({ ...scene, lines });
  }
  if (failure && made === 0) return { ok: false, error: failure };
  return { ok: true, video: { ...video, scenes, updatedAt: new Date().toISOString() }, made, skipped: [...skipped, ...(failure ? [`stopped early: ${failure}`] : [])] };
}
