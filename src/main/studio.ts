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
  parseCharacter,
  parseSeries,
  parseVideo,
  SPEAKER_ME,
  SPEAKER_NARRATOR,
  isMotion,
  speakerName,
  stylePrompt,
  type Character,
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
/** How many lines are sent to be spoken at the same time. */
const VOICES_AT_ONCE = 4;
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
      flow: z.enum(["continues", "cut"]),
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
  - source: say what kind of source supports it and what the creator should look up to confirm it, for example "Published tests of how long the product lasts; confirm on the testing body's own page". You cannot browse, so NEVER invent a study title, author, journal, year or link, and never state numbers you are not sure of. The creator confirms the source themselves.
  - action: the one thing the viewer should do or check.
- hooks: exactly three opening lines for the first three seconds, strongest first, each naming the viewer or their problem. The first is the one the scenes use.
- overlay: the on-screen text of the opening, eight words or fewer.
- scenes: the whole video in order. Each scene is ONE continuous shot of 4 to 8 seconds, never shorter (a shorter beat belongs inside the scene next to it):
  - made_by: "me" when the creator is on camera (they deliver the fact and the closing ask in their own face and voice unless told otherwise), "ai" for everything else: characters, places a camera cannot go, anything a phone cannot film.
  - flow: "continues" when this scene carries straight on from the one before it: the same place and the same moment, the action picking up exactly where the last frame left off, so the two play as one take (the camera may move or push in, but there is no cut). "cut" when it is a new shot: another place, another time, another subject, or a deliberate change of angle. The first scene is always "cut".
  - seconds, place (a short name, reused exactly when scenes share a place), characters (names of cast members seen; [] for none), action (what happens, one sentence), camera (framing and movement), text (on-screen words, six or fewer, or ""), sound (a sound effect or music cue, or "").
  - lines: what is said in the scene, each with speaker, text (the exact words) and delivery (one or two words such as "calm" or "mocking", or ""). speaker is exactly "ME" (the creator on camera), "NARRATOR" (a voice over the scene), or the exact name of a cast member.
  - Only ONE speaker is seen talking in a scene. A conversation is cut into alternating close shots. A wide shot with several characters has no spoken line, or a NARRATOR line.
- checks: go through every rule you are given and report honestly: rule (copied), ok (true or false), note (one short sentence: what you found or what must change). If something fails, still write the best script you can and say what to fix.
- caption: a ready-to-post caption of one to three sentences in the creator's voice.
- kept and changed: only for a remake, otherwise []. kept = what you borrowed from the original (format, kind of hook, order of beats). changed = what is new (characters, place, every word, the topic).
- story_update: only for a series episode, otherwise []. Two to four short facts this episode adds to the story so far.
- look: one sentence on the finer look all the AI scenes share within the video's style (colour, light, lens, mood), for example "Warm evening light, shallow focus, muted colours". The style itself (realistic, anime and so on) is given to you; do not contradict it. Keep the series' look when one is given.
- new_characters: characters the script needs that are not in the cast, each with name, role, personality, speech (how they talk) and look (including one fixed colour or item of clothing). [] when the cast is enough. Keep casts small.

Rules for the writing:
- Make it play like one piece of film, not a slideshow. A viewer must never see the place, the angle and the subject all change at once every few seconds. Use as few places as the story allows, usually one to three, and stay in a place for several scenes before leaving it. Most scenes should be "continues". Cut only when the cut means something: a reaction, a reveal, a jump in place or time. When you cut within a place, the same people, clothes, props and light are still there.
- Shape the video as a story in four parts, in this order: characters the viewer cares about (who they root for, and the one detail that makes them care), escalating tension (what stands in the way, getting worse at least twice), a moment of victory (where the video's one true fact or its one thing to do lands), and a surprising ending (a last beat the viewer did not see coming). The victory and the ending must be honest: a story may dramatise the problem, never the evidence, and never invent a result.
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
    `Format: ${a.format}.${a.style ? ` Visual style: ${a.style}${a.styleNotes ? ` (${a.styleNotes})` : ""}.` : ""} Topic: ${a.topic}. Kind of hook: ${a.hookType}.`,
    `Length: ${a.durationSeconds ? `${Math.round(a.durationSeconds)}s` : "unknown"}.`,
    `What happens: ${a.beats.map((b, i) => `${i + 1}) ${b}`).join(" ")}`,
    `Structure: ${a.skeleton.map((s, i) => `${i + 1}) ${s}`).join(" ")}`,
    `Why it works: ${a.whyItWorks.join(" ")}`,
  ].join("\n");
}

const describeIdea = (idea: Idea) =>
  [
    idea.kind === "series" && "This is an idea for a SERIES: its opening line is the running question, its outline lists the episodes and its closing ask says how the season ends.",
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

/** The saved posts the creator picked as inspiration, by their analysis only. */
const describeInspiration = (posts: ResearchItem[]) =>
  posts.filter((p) => p.analysis).length
    ? `SAVED POSTS THE CREATOR PICKED AS INSPIRATION (analysis only; their words are deliberately not shown to you)\nBorrow what makes them work: the format, the kind of hook, the order of beats. Never their words, characters, setting, examples or closing line.\n\n${posts
        .filter((p) => p.analysis)
        .map((p, i) => `Post ${i + 1}${p.rating ? ` (the creator rated it ${p.rating} of 5)` : ""}${p.note ? `\nThe creator's note on it: ${p.note}` : ""}\n${describePost(p)}`)
        .join("\n\n")}`
    : "";

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
    ideas.length === 1 ? `THE SAVED IDEA IT COMES FROM\n${describeIdea(ideas[0])}` : "",
    ideas.length > 1
      ? `THE SAVED IDEAS IT COMES FROM\nThe creator picked these to become ONE video. Find the single thread that joins them. If they do not fit one video, build on the first and take only what helps from the others. What the creator wrote under "About" decides how they are used.\n\n${ideas.map((idea, i) => `Idea ${i + 1}\n${describeIdea(idea)}`).join("\n\n")}`
      : "",
    describeInspiration(input.inspiration ?? []),
    post?.analysis && video.source === "remake" ? `THE POST TO REMAKE (analysis only; its words are deliberately not shown to you)\n${describePost(post)}` : "",
    series
      ? `THE SERIES\nTitle: ${series.title}${series.look ? `\nLook: ${series.look}` : ""}\nPremise: ${series.premise}\nRunning question: ${series.question}\nEnding: ${series.ending}\nThis is episode ${video.episode ?? "?"} of ${series.episodes.length}.${episodeLine ? ` It teaches: ${episodeLine.teaches}. It ends on: ${episodeLine.endsOn}.` : ""}\nStory so far:\n${series.storySoFar.length ? series.storySoFar.map((s) => `- ${s}`).join("\n") : "(nothing yet: this is the start)"}`
      : "",
    how !== "me" && stylePrompt(video.style || series?.style || "")
      ? `THE STYLE OF THE AI SCENES\n${stylePrompt(video.style || series?.style || "")}\n${
          isMotion(video)
            ? 'Every AI scene is an animation of type, shapes, icons and diagrams, not a filmed or drawn shot. So: there are no characters at all (characters is [] in every scene and new_characters is []); lines in AI scenes are spoken by NARRATOR; "action" says what appears on screen and how it moves (what is drawn, what it turns into, what number or word lands); "camera" says how the layout moves (a push in, a slide, a wipe) or is ""; "place" is ""; "text" carries the few words that must be on screen; and every scene has flow "cut".'
            : "Write scenes that suit this style and can be drawn in it."
        }`
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
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      // If the model declines for policy reasons, let the API retry on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: VIDEO_SYSTEM,
      messages: [{ role: "user", content: parts.filter(Boolean).join("\n\n") }],
      output_config: { format: betaZodOutputFormat(VideoSchema) },
    }).finalMessage();
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
        // Animations are cut together; only filmed or drawn shots can carry on from one another.
        continues: index > 0 && s.flow === "continues" && !isMotion(video),
        animation: null,
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

const StoryboardSchema = z.object({
  scenes: z.array(
    z.object({
      scene: z.number(),
      characters: z.array(z.object({ name: z.string(), same_person: z.boolean(), difference: z.string() })),
      must_fix: z.array(z.string()),
      minor: z.array(z.string()),
      fix: z.string(),
    }),
  ),
});

const STORYBOARD_SYSTEM = `You check the storyboards of a short vertical video before any costly video is made from them. You are shown the script of each scene and, as pictures, its storyboard: one sheet of four frames in a 2 by 2 grid, read left to right and top to bottom, showing one continuous shot from its first moment (frame 1) to its last (frame 4).

HOW THE STORYBOARD IS USED
A video model is given the sheet as a guide, together with the script and each character's own reference picture, and makes one moving shot. It takes from the sheet what happens and in what order, who is in the shot and roughly where, the place, the framing and the look. It does not copy the sheet pixel by pixel, and small differences between frames never reach the video. But who is in the shot does reach it: if the storyboard shows a different-looking person from the character's reference picture, the video model is pulled between the two and the character comes out wrong. So judge each sheet by one question: would a video made from it come out wrong?

MUST FIX: only what would make the video wrong
- The wrong thing happens: the action, the place or the order of events does not match the script, or the action does not start in frame 1 and finish by frame 4.
- The wrong people: a character the script puts in the shot is missing, someone who speaks is not there, or a main character is plainly a different person from their reference picture (when you are shown one), from their description, or from the other frames. A different face shape, age, hair, build or outfit counts; a slightly different expression or angle does not.
- Not one shot: the frames show different places or times, or a cut, so it cannot be one continuous take.
- It is not a storyboard: not four frames in a grid, or frames in an order that cannot be followed.
- Writing in the frames (captions, speech bubbles, labels) other than small frame numbers, because a video model tends to copy it.
- A scene marked as carrying on does not start where the scene before ends: a different place, different people, or a clearly different position.
- A main character is badly malformed (extra limbs, a broken face) in a way that would be copied.

MINOR: note it, but it is not a reason to make the sheet again
- People, objects or furniture in the background that differ between frames.
- Small drift in a prop, a colour, a hairstyle, the light or the exact framing.
- A frame that is a little less sharp, or frame numbers that look different.
- Anything a viewer would not notice in a few seconds of moving video.
Making a sheet again redraws all four frames and brings new small flaws of its own, so asking for a redraw over a minor flaw makes things worse, not better. When in doubt, it is minor.

THE CHARACTERS: ALWAYS COMPARE
When you are shown a character's reference picture, compare it with that character in every frame of every sheet you check, on every check, including a re-check. Look at the face shape, age, skin, hair and its style, any beard or glasses, the build, and the clothes and their colours. Answer in "characters" for each character who is in the scene: same_person true only if a viewer would take them for the same person in the same outfit; difference says in one sentence what differs and in which frames ("" when the same). A different expression, pose or camera angle is not a difference. A face too small or turned away to judge counts as the same. A character who is clearly a different person, or in different clothes, in any frame is always something that must be fixed, never minor.

IF YOU CHECKED A SCENE BEFORE
For some scenes you are told what the last check asked for and that the sheet was made again since. For those scenes do two things only: say whether each thing that had to be fixed is fixed now, and say whether the new sheet has anything that MUST be fixed. The comparison of the characters with their reference pictures is still done in full. Do not go looking for new small flaws. If what was asked for is fixed and nothing else would make the video wrong, the sheet is done.

Answer for every scene you were asked to check, using its number.
- characters: one entry for each character in the scene whose reference picture you were shown; [] when you were shown none or nobody is in the shot.
- must_fix: each such problem in one plain sentence that names the frame and says what is wrong. [] when there is none, which should be the usual answer for a sheet that tells the scene's story.
- minor: up to three small flaws, one short sentence each. [] is fine.
- fix: only when must_fix is not empty: one or two sentences the creator can send to the picture model to put right everything in must_fix at once, written as an instruction ("Show ...", "Keep ..."). Otherwise "".
Write plainly, for a creator who is not a film maker.`;

/**
 * Looks at the storyboards of a video's scenes and says, for each, whether it is good to make the video from.
 * `sheets` are the storyboards to look at, with the scene number each belongs to; `check` are the numbers to answer for
 * (a sheet can be shown only so the next scene's continuity can be judged).
 */
export async function reviewStoryboards(
  apiKey: string,
  input: {
    video: Video;
    characters: Character[];
    look: string;
    sheets: { scene: number; bytes: Buffer; mime: string }[];
    check: number[];
    /** What each character should look like, as a picture: their character sheet or portrait. */
    faces?: { name: string; bytes: Buffer; mime: string }[];
    /** For a scene whose storyboard was made again after a check: what that check said had to be fixed. */
    before?: { scene: number; problems: string[]; fix: string }[];
  },
): Promise<StudioResult<{ reviews: { scene: number; ok: boolean; problems: string[]; minor: string[]; fix: string }[]; costUsd: number }>> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  if (input.sheets.length === 0 || input.check.length === 0) return { ok: false, error: "There is no storyboard to check yet." };
  const { video } = input;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 24000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
      system: STORYBOARD_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text: [
                `THE VIDEO\n${video.title}${input.look ? `\nLook: ${input.look}` : ""}`,
                `THE CHARACTERS\n${input.characters.length ? input.characters.map((c) => `${c.name}: ${c.look || c.role}`).join("\n") : "None."}`,
                `THE SCENES\n${video.scenes
                  .map(
                    (s, i) =>
                      `Scene ${i + 1} (${s.seconds}s, ${s.madeBy === "me" ? "filmed by the creator, no storyboard" : i > 0 && s.continues ? `carries on from scene ${i} with no cut` : "a new shot"})\nPlace: ${s.place || "not given"}\nWhat happens: ${s.action}${s.camera ? `\nCamera: ${s.camera}` : ""}${
                        s.lines.length ? `\nSaid: ${s.lines.map((l) => `${speakerName(l.speaker, input.characters)}: ${l.text}`).join(" / ")}` : ""
                      }`,
                  )
                  .join("\n\n")}`,
                input.before?.length
                  ? `CHECKED BEFORE\nThese storyboards were made again after the last check. For each, this is what had to be fixed:\n${input.before
                      .map((b) => `Scene ${b.scene}: ${b.problems.join(" ") || "(nothing listed)"}${b.fix ? ` The creator asked the picture model: ${b.fix}` : ""}`)
                      .join("\n")}`
                  : "",
                `CHECK THESE SCENES: ${input.check.join(", ")}. The storyboards follow, each after its scene number.`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
            ...(input.faces ?? []).flatMap((face) => [
              { type: "text" as const, text: `What ${face.name} looks like (their reference picture, not a storyboard):` },
              { type: "image" as const, source: { type: "base64" as const, media_type: face.mime as "image/jpeg" | "image/png" | "image/webp", data: face.bytes.toString("base64") } },
            ]),
            ...input.sheets.flatMap((sheet) => [
              { type: "text" as const, text: `Storyboard of scene ${sheet.scene}${input.check.includes(sheet.scene) ? "" : " (shown for continuity only, do not answer for it)"}:` },
              { type: "image" as const, source: { type: "base64" as const, media_type: sheet.mime as "image/jpeg" | "image/png" | "image/webp", data: sheet.bytes.toString("base64") } },
            ]),
          ],
        },
      ],
      output_config: { format: betaZodOutputFormat(StoryboardSchema) },
    }).finalMessage();
    recordClaude("storyboard", response.usage, video.title);
    if (response.stop_reason === "refusal") return { ok: false, error: "Claude declined to check these storyboards." };
    const out = response.parsed_output;
    if (response.stop_reason === "max_tokens" || !out) return { ok: false, error: "The check came back incomplete. Try again." };
    const reviews = out.scenes
      .filter((r) => input.check.includes(Math.round(r.scene)))
      .map((r) => {
        // A character who is not the same person as their reference picture is always something to fix, whatever else was said.
        const changed = r.characters.filter((c) => !c.same_person && c.name.trim());
        const likeness = changed.map((c) => `${c.name.trim()} does not look like their reference picture${c.difference.trim() ? `: ${c.difference.trim()}` : "."}`);
        const problems = [...likeness, ...r.must_fix.map((p) => p.trim()).filter(Boolean)];
        const redraw = changed.length ? `Draw ${changed.map((c) => c.name.trim()).join(" and ")} exactly as in their reference picture in every frame: the same face, age, hair, build and clothes.` : "";
        return { scene: Math.round(r.scene), ok: problems.length === 0, problems, minor: r.minor.map((p) => p.trim()).filter(Boolean).slice(0, 3), fix: problems.length ? [redraw, r.fix.trim()].filter(Boolean).join(" ") : "" };
      });
    if (reviews.length === 0) return { ok: false, error: "The check came back empty. Try again." };
    return { ok: true, value: { reviews, costUsd: estimateCostUsd(response.usage) } };
  } catch (e) {
    return { ok: false, error: describeClaudeError(e) };
  }
}

/** Plans a season from a title and a few words about it. Returns the series and any characters it added to the cast. */
export async function planSeries(
  apiKey: string,
  input: { title: string; about: string; brand: BrandKit; characters: Character[]; production: Production; ideas: Idea[]; posts?: ResearchItem[] },
): Promise<StudioResult<{ series: Series; newCharacters: Character[] }>> {
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the series a title first." };
  const how = input.production;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 24000,
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
    }).finalMessage();
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
  // Every line still to be spoken, with who speaks it. Lines are independent, so several are made at once.
  const todo: { scene: number; line: number; who: string; voice: { id: string; name: string } }[] = [];
  for (const [index, scene] of video.scenes.entries()) {
    for (const [at, line] of scene.lines.entries()) {
      if (line.speaker === SPEAKER_ME || line.audioId) continue;
      const who = speakerName(line.speaker, characters);
      const voice = line.speaker === SPEAKER_NARRATOR ? brand.speakingVoice : characters.find((c) => c.id === line.speaker)?.voice;
      if (voice) todo.push({ scene: index, line: at, who, voice });
      else skipped.add(who);
    }
  }
  const spoken = new Map<string, { audioId: string; audioFile: string }>();
  let next = 0;
  const worker = async () => {
    // The first failure (a bad key, no credit) would repeat for every line, so nothing new is started after it.
    while (next < todo.length && !failure) {
      const job = todo[next++];
      const result = await generateSpeech(dataDir, elevenKey, {
        text: video.scenes[job.scene].lines[job.line].text,
        voiceId: job.voice.id,
        voiceName: job.voice.name,
        title: `${video.title} · scene ${job.scene + 1} · ${job.who}`,
      });
      if (!result.ok) failure ||= result.error;
      else {
        made++;
        spoken.set(`${job.scene}:${job.line}`, { audioId: result.audio.id, audioFile: result.audio.file });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(VOICES_AT_ONCE, todo.length) }, worker));
  const scenes = video.scenes.map((scene, index) => ({ ...scene, lines: scene.lines.map((line, at) => ({ ...line, ...spoken.get(`${index}:${at}`) })) }));
  if (failure && made === 0) return { ok: false, error: failure };
  return { ok: true, video: { ...video, scenes, updatedAt: new Date().toISOString() }, made, skipped: [...skipped, ...(failure ? [`stopped early: ${failure}`] : [])] };
}
