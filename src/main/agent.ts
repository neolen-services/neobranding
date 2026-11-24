// The in-app agent: a chat with Claude that can use the app's own actions as tools.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// The loop runs here, on the user's computer, because every tool reads or
// changes local data. Each chat is stored whole (the exact messages sent to
// Claude) so a conversation can be continued later.
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  AGENT_TOOLS,
  parsePermissions,
  REFERENCE_PATTERN,
  type AgentApproval,
  type AgentChat,
  type AgentChatSummary,
  type AgentMessage,
  type AgentPart,
  type AgentPermissions,
  type AgentProgress,
  type AgentReply,
} from "../shared/agent";
import { estimateCostUsd } from "../shared/analysis";
import { parseBrandKit } from "../shared/brand";
import { parseIdea, type Idea, type IdeaDraft } from "../shared/ideas";
import type { ResearchItem } from "../shared/research";
import { describeClaudeError } from "./analyze";
import {
  deleteAudio,
  generateMusic,
  generateSoundEffect,
  generateSpeech,
  listAudio,
  listVoices,
  SPEECH_MAX_CHARACTERS,
  SPEECH_MODELS,
} from "./audio";
import { generateIdeas } from "./generate";
import { addResearch, analyzeResearch, deleteResearch, listResearch, updateResearch } from "./research";
import type { Store } from "./store";
import { recordClaude } from "./usage";
import type { ApiProvider } from "../shared/settings";
import { studioOps } from "./studioOps";
import { parseProduction, speakerName, VIDEO_STAGES, videoStage, type Video } from "../shared/studio";

type Message = Anthropic.Beta.BetaMessageParam;
type Tool = Anthropic.Beta.BetaTool;

/** What the agent needs from the rest of the app. */
export type AgentContext = {
  /** Renders an animation page to an MP4; only the desktop app can. */
  render?: (page: string, seconds: number, ffmpeg: string) => Promise<Buffer>;
  dataDir: () => string;
  store: () => Store;
  key: (provider: ApiProvider) => string;
};

/** A chat as kept in the database. */
type StoredChat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  costUsd: number;
  /** Exactly what is sent to Claude, including its tool calls and their results. */
  messages: Message[];
  /** When each of the user's messages was sent and how long the agent then worked, keyed by its position in `messages`. */
  turns?: Record<number, { at: string; ms: number }>;
  /**
   * Set while the chat is paused: the last message holds actions the agent
   * asked for, and these are the ones the user has to approve or decline
   * before any of them runs.
   */
  awaiting?: AgentApproval[];
};

/** What Claude is told when the user says no to an action. */
const DECLINED = "The creator declined this action, so it was not done. Do not try it again unless they ask for it.";
const PERMISSIONS_SETTING = "agent_permissions";

/**
 * The agent ends an answer with a line like "Replies: Save all three | Do nothing".
 * (A tool was tried for this first, but text written in the same reply as a
 * tool call does not come back as text, so the answer itself went missing.)
 */
const REPLIES_LINE = /\n*^[ \t]*Replies:[ \t]*(.+)$\s*$/im;

const MAX_STEPS = 30;
const ANALYSE_AT_ONCE = 3;

const SYSTEM = `You are the assistant built into AI Shorts, a desktop app that one creator uses to build a personal brand with short videos (Reels, Shorts, TikTok). You work inside the app: your tools read and change the creator's real data.

What the app holds:
- Brand: the creator's name, topics, audience, content pillars, voice and platforms.
- Research: posts by other creators that this creator saved because they liked them and they performed well. Each can be analysed once by Claude (hook, structure, why it works); the analysis is saved and reused.
- Ideas: video ideas the creator kept. An idea has no script of its own; its script is written when it is made into a Studio video.
- Studio: where a video is made in five steps: script, cast, storyboard (every scene's storyboard side by side), clips (every scene's clip and the voices) and preview (the whole video played through). A Studio video's script is a list of scenes, each generated with AI or filmed by the creator, with a speaker on every line, a claim with its evidence level, and a check against the creator's rules. A series is a season plan (running question, ending, episodes, story so far) whose episodes are Studio videos. Every video and series is made one of three ways, chosen by the creator: AI only, filmed by the creator only, or a mix; the script is written to fit, and an episode follows its series. A video can be started from several saved ideas at once, which become one video, and a series can be planned from saved ideas. In Studio the creator starts from one saved idea, which already says whether it is a single video or a series and how it is made, and goes straight to the script (or, for a series, the season plan).
- Characters (the app-wide list; a video's "cast" is the characters its script uses, set up on that video's Cast tab, where a role can be given to an existing character so its voice and pictures are reused): recurring characters, each with a personality, a way of talking, a look and an ElevenLabs voice. The creator is always the host and is filmed; the narrator speaks in the brand's speaking voice.

How to work:
- Look before you answer. Read the brand and the relevant posts or ideas with your tools instead of guessing; never invent posts, numbers or ideas that are not in the data.
- Do what was asked, then say what you did and what you found. Lead with the answer.
- This conversation itself uses a little of the creator's Claude credit, so never say that nothing was charged. Some tools spend more. Rough costs: analysing a post about $0.06, a round of generated ideas about $0.25, a Studio video's script about $0.10. Go ahead when the creator asked for that action and the total is under about $0.50. Above that, say what it would cost and ask first.
- You can change things: the brand kit (update_brand), a saved idea (update_idea), a post's rating or note, and you can delete posts, ideas and generated audio. Change only what the creator asked to change, and read the item first so the rest of it stays as it was.
- Approval: for some actions the app itself stops and shows the creator an Allow or Decline prompt before the action runs. Which ones is the creator's setting and you cannot see it. So when the creator has asked for a change, just call the tool; do not also ask "shall I?" in text. If a tool result says the creator declined, do not call it again; say it was not done and ask what they would like instead.
- Storyboard, then clips: after a script is approved, each AI scene gets a storyboard (make_scene_pictures): one sheet of four frames showing what happens in the scene from its first moment to its last. The creator looks through the storyboards of the whole video first; only then is a clip made that follows a scene's storyboard (make_scene_clip). A lip-synced clip (make_scene_lipsync) makes the speaking character's own reference picture say the line. The creator approves each scene's storyboard themself on the video's Storyboard step, where the storyboards are also checked and fixed; you cannot approve one for them, and a clip cannot be made for a scene whose storyboard is not approved. Storyboards are cheap and clips are costly. Make storyboards and clips from the first scene down: a scene marked continues_previous_scene carries straight on with no cut, so its storyboard is drawn from the one before it and its clip opens on the last frame of the clip before it. Remake a continuing scene's clip after the clip before it changes. Characters look the same across scenes only if they have a reference picture (make_character_picture), so make those first. Three services can do this work (fal.ai, Google, ElevenLabs); the creator's defaults are in Settings, and you only name a service when they ask for one. You cannot see pictures or clips: never describe how one looks, point to it with the video's tag.
- Studio rules: a script's approval is the creator's decision. Never approve a script unless they said so in this conversation, and you can never tick the "I have checked this source" box: only they can, in Studio. You cannot look sources up, so never state that a claim is confirmed; say what they should check. After writing a script, give the claim, the first hook and any failed checks in a few lines and point to the video with its tag; do not paste the whole script.
- Deleting cannot be undone. Only delete when the creator has, in this conversation, clearly asked you to delete that specific item; if you are proposing it yourself, ask first and wait.
- generate_ideas returns candidates that are NOT saved. Show them, and save only the ones the creator picks (save_generated_ideas), unless they already told you to save.
- You can also write ideas yourself with create_idea when the creator wants something specific; base them on what the analysed posts show works.
- Where the topic is health: keep claims accurate and proportionate, never promise cures or diagnose, and do not present the creator as a medical professional unless their brand says they are one.
- Audio (ElevenLabs): you can make voiceovers, sound effects and music. These use the creator's ElevenLabs credits, not Claude credit, and you cannot see the balance. Go ahead with a short request (a voiceover of a few lines, one sound effect, music up to a minute); for more than that (several voiceovers, text over about 2,000 characters, music over a minute) say what you are about to make and ask first.
  - For a voiceover, use the brand's speaking voice (speakingVoice in get_brand) when one is set and the creator has not asked for a different voice; then there is no need to call list_voices. Otherwise call list_voices first unless you already have a voice id from this conversation. If the creator has their own voices (category "cloned" or "professional"), prefer one of those; if several voices could fit and they have not said which, ask. Speak only the words to be said: leave out timings, shot directions and on-screen text.
  - After generating, put the tag [[audio:<id>]] on its own line in your answer. The app shows a player there. Never describe how the audio sounds: you cannot hear it.
- If something cannot be done with your tools (the brand's colours or speaking voice, settings or API keys, posting to social media, editing video), say so plainly and say where in the app it is done, if it can be.

Referring to posts and ideas: whenever you mention a specific saved post or saved idea, put a reference tag where its name would go: [[post:<id>]] for a post, [[idea:<id>]] for a saved idea, using the id from your tools. The app replaces the tag with a chip showing the creator's name or the idea's title, which opens it when clicked. So write "[[post:abc]] opens with a question", not "Pranav Mohan's post [[post:abc]] opens…", and never show a bare id. Candidates from generate_ideas are not saved and have no tag; name them by title.

When the creator points at something: their messages can hold the same tags, added by picking an item in the app: [[post:<id>]], [[idea:<id>]], [[audio:<id>]] (a generated audio file), [[brand:kit]] (their brand kit), [[research:all]] (their whole Research library, every saved post), [[ideas:all]] (all their saved ideas), [[video:<id>]] (a Studio video), [[series:<id>]] (a series) or [[character:<id>]] (one of the creator's characters). You may use the video, series and character tags yourself when you mention one. A tag means exactly that item or section. Read it with the matching tool (get_research_post, get_idea, list_generated_audio, get_brand, list_research_posts, list_ideas, get_video, list_series, list_cast) before you answer or change it, and never ask which item they mean. For a whole section, answer about all of it: for example how many posts there are and what each one got.

Offering next steps: when your answer leaves an obvious choice of what to do next, make the very last line of your reply the word "Replies:" followed by two or three short button labels separated by " | ", each at most four words and written as the creator would say it. For example: Replies: Save all three | Write the script | Do nothing. The app turns that line into buttons and hides it. Skip the line when there is no real next step, and do not also list those choices in the text.

How to write: plain, direct sentences for a busy reader. Short paragraphs; bullet or numbered lists for several items; bold for the few words that matter most. No tables. A short bold line may introduce a list. Lead with the answer.`;

const TOOLS: Tool[] = [
  {
    name: "get_brand",
    description: "Read the creator's brand kit: name, topics, audience, positioning, content pillars, voice and platforms.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_research_posts",
    description:
      "List every post saved in Research, with its numbers, the creator's rating and note, and (if analysed) its format, hook type and topic. Use this first for any question about the research library.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_research_post",
    description: "Read one saved post in full: caption, transcript, the sound it uses and its complete analysis.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "save_research_post",
    description:
      "Download a post from an Instagram link (reel, video, photo, carousel) or a YouTube Shorts link and save it to Research. Free, apart from a small transcription cost if a Deepgram key is set.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "analyze_research_posts",
    description:
      "Have Claude analyse saved posts (frames, transcript, caption) and store the result. Costs about $0.06 per post. Posts already analysed are skipped unless reanalyse is true. Pass ids, or all_unanalysed to do every post that has no analysis yet.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        all_unanalysed: { type: "boolean" },
        reanalyse: { type: "boolean" },
      },
    },
  },
  {
    name: "rate_research_post",
    description: "Set the creator's rating (0 to 5, or null to clear) and/or note on a saved post.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, rating: { type: ["number", "null"] }, note: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "delete_research_post",
    description: "Permanently delete a saved post and its downloaded files. Only after the creator clearly asked for this post to be deleted.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "update_brand",
    description:
      "Change parts of the creator's brand kit. Send only the fields to change; the rest stay as they are. A list field (topics, goals, pillars, voice, platforms) is replaced whole, so send the complete new list, including the entries that stay. Colours and the speaking voice cannot be changed here.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        topics: { type: "array", items: { type: "string" } },
        goals: { type: "array", items: { type: "string" } },
        goalDetails: { type: "string", description: "What success looks like, in the creator's words." },
        audience: { type: "string" },
        tagline: { type: "string" },
        positioning: { type: "string" },
        mission: { type: "string" },
        bio: { type: "string" },
        pillars: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, topic: { type: "string" }, description: { type: "string" } },
            required: ["title"],
          },
        },
        voice: {
          type: "array",
          description: "Tone of voice traits.",
          items: { type: "object", properties: { trait: { type: "string" }, description: { type: "string" } }, required: ["trait"] },
        },
        platforms: {
          type: "array",
          items: {
            type: "object",
            properties: { platform: { type: "string" }, handle: { type: "string" }, focus: { type: "string" }, bio: { type: "string" } },
            required: ["platform"],
          },
        },
      },
    },
  },
  {
    name: "list_ideas",
    description: "List the creator's saved video ideas: title, opening line, series, pillar, platform, and score.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_idea",
    description: "Read one saved idea in full, including its outline, caption, and the reason for its score.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "generate_ideas",
    description:
      "Run the app's idea process: write five times as many ideas as asked for, each modelled on an analysed post, have a separate judge score them, and return the best. Costs about $0.25 and takes one to two minutes. Needs at least 5 analysed posts. The returned ideas are candidates and are not saved.",
    input_schema: {
      type: "object",
      properties: {
        count: { type: "integer", description: "How many to return, 1 to 10." },
        pillar: { type: "string", description: "Exact title of one content pillar, or omit for any." },
        series: { type: "string", description: "Exact name of an existing series to write more episodes of, or omit." },
        notes: { type: "string", description: "Any extra direction from the creator." },
        post_ids: { type: "array", items: { type: "string" }, description: "Ids of the analysed saved posts to learn from. Leave out to use every analysed post." },
        kind: { type: "string", enum: ["video", "series"], description: "Whether each idea is one video or a whole series of episodes. Leave out for single videos." },
      },
      required: ["count"],
    },
  },
  {
    name: "save_generated_ideas",
    description: "Save candidates returned by generate_ideas in this chat to the creator's ideas, by their candidate codes (for example G1, G3).",
    input_schema: { type: "object", properties: { codes: { type: "array", items: { type: "string" } } }, required: ["codes"] },
  },
  {
    name: "create_idea",
    description: "Save a video idea that you wrote yourself. Free.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        hook: { type: "string", description: "The opening line for the first three seconds." },
        alt_hooks: { type: "array", items: { type: "string" } },
        outline: { type: "array", items: { type: "string" }, description: "Four to six beats." },
        cta: { type: "string" },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        pillar: { type: "string" },
        platform: { type: "string" },
        series: { type: "string" },
        modelled_on_post_id: { type: "string", description: "Id of the saved post whose structure it borrows, if any." },
      },
      required: ["title", "hook", "outline", "cta", "caption"],
    },
  },
  {
    name: "delete_idea",
    description: "Permanently delete a saved idea. Only after the creator clearly asked for this idea to be deleted.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "update_idea",
    description:
      "Change parts of a saved idea. Send the id and only the fields to change; the rest stay as they are. A list field (alt_hooks, outline, hashtags) is replaced whole.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        hook: { type: "string", description: "The opening line for the first three seconds." },
        alt_hooks: { type: "array", items: { type: "string" } },
        outline: { type: "array", items: { type: "string" } },
        cta: { type: "string" },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        pillar: { type: "string" },
        platform: { type: "string" },
        series: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_generated_audio",
    description: "Permanently delete one generated audio file (voiceover, sound effect or music). Only after the creator clearly asked for it to be deleted.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_voices",
    description:
      "List the ElevenLabs voices this creator can use: their own (category cloned or professional) and ready-made ones, each with id, name, category, description and labels such as accent, gender and use case. Free.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "generate_voiceover",
    description: `Turn text into speech with an ElevenLabs voice and save it. Uses ElevenLabs credits by the character. At most ${SPEECH_MAX_CHARACTERS} characters per call; split longer text into parts.`,
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Exactly the words to be spoken, nothing else." },
        voice_id: { type: "string", description: "A voice id from list_voices." },
        title: { type: "string", description: "A short name for it, e.g. the idea's title." },
        model: { type: "string", enum: [...SPEECH_MODELS], description: "Leave out for the best quality. eleven_flash_v2_5 is faster and cheaper." },
      },
      required: ["text", "voice_id"],
    },
  },
  {
    name: "generate_sound_effect",
    description: "Make a short sound effect from a description (for example 'soft whoosh', 'cash register ding') and save it. Uses ElevenLabs credits.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What the sound is, in plain words." },
        seconds: { type: "number", description: "Length from 0.5 to 30. Leave out to let ElevenLabs choose." },
        loop: { type: "boolean", description: "True for a sound meant to repeat seamlessly." },
        title: { type: "string" },
      },
      required: ["description"],
    },
  },
  {
    name: "generate_music",
    description: "Make a music track from a description of its mood, style and tempo, and save it. Uses ElevenLabs credits; some plans do not include music. Instrumental unless told otherwise.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Mood, genre, instruments, tempo. Do not name real artists or songs." },
        seconds: { type: "integer", description: "Length from 3 to 600. Default 30." },
        instrumental: { type: "boolean", description: "False to allow vocals. Default true." },
        title: { type: "string" },
      },
      required: ["description"],
    },
  },
  {
    name: "list_generated_audio",
    description: "List the audio already made and saved: id, kind, title, the text or description it came from, voice and date.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_cast",
    description: "List the creator's cast: each character's id, name, role, personality, how they talk, look, and whether they have a voice.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_series",
    description: "List the creator's series with their full plans: premise, running question, ending, episodes, cast and story so far.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_videos",
    description: "List the videos in Studio: id, title, single or episode, new or remake, the stage reached, and results if posted.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_video",
    description: "Read one Studio video in full: what it is about, its claim and source, hooks, every scene with its lines and speakers, the rule checks, and its results if posted.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_character",
    description: "Add a character to the creator's characters. Free. Give a voice_id from list_voices if the creator named a voice; otherwise leave it out and they choose one on the Characters page.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string", description: "Their job in the story." },
        personality: { type: "string" },
        speech: { type: "string", description: "How they talk." },
        look: { type: "string", description: "What they look like, with one fixed colour or item of clothing." },
        voice_id: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_character",
    description: "Change parts of a character. Send the id and only the fields to change.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        role: { type: "string" },
        personality: { type: "string" },
        speech: { type: "string" },
        look: { type: "string" },
        voice_id: { type: "string", description: "A voice id from list_voices." },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_character",
    description: "Permanently delete a character. Only after the creator clearly asked for it.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "plan_series",
    description: "Have Claude plan a season from a title, a few words and optionally saved ideas: running question, ending, five to eight episodes and any characters it needs. Costs a few cents and takes about 30 seconds. The plan is saved.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, about: { type: "string" }, idea_ids: { type: "array", items: { type: "string" }, description: "Ids of saved ideas the season is built from; each can become an episode." }, made_with: { type: "string", enum: ["ai", "me", "mix"], description: "How it is made: ai (every scene generated, the creator never on camera), me (the creator films everything, nothing generated) or mix. Only set what the creator said; left out, it is a mix." } },
      required: ["title"],
    },
  },
  {
    name: "update_series",
    description: "Change parts of a series plan. Send the id and only the fields to change. episodes replaces the whole list, so send every episode.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        premise: { type: "string" },
        question: { type: "string" },
        ending: { type: "string" },
        episodes: { type: "array", items: { type: "object", properties: { teaches: { type: "string" }, endsOn: { type: "string" } } } },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_series",
    description: "Permanently delete a series plan. Its videos are kept. Only after the creator clearly asked for it.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "start_video",
    description: "Start a video in Studio. Give one of: idea_ids (one or more saved ideas, which become ONE video), post_id (the creator's own version of an analysed saved post), series_id with episode (a planned episode), or title with about. With idea_ids, title and about are optional: about is what exactly the creator wants from those ideas. Free; it does not write the script.",
    input_schema: {
      type: "object",
      properties: {
        idea_ids: { type: "array", items: { type: "string" }, description: "Ids of saved ideas to turn into this one video." },
        idea_id: { type: "string", description: "A single saved idea; the same as idea_ids with one id." },
        made_with: { type: "string", enum: ["ai", "me", "mix"], description: "How it is made: ai (every scene generated, the creator never on camera), me (the creator films everything, nothing generated) or mix. Only set what the creator said; left out, it is a mix." },
        post_id: { type: "string" },
        inspiration_post_ids: { type: "array", items: { type: "string" }, description: "Ids of analysed saved posts to take inspiration from, alongside or instead of ideas. Their structure is borrowed, never their words. Not a remake of any one of them." },
        series_id: { type: "string" },
        episode: { type: "integer", description: "1 for the first episode." },
        title: { type: "string" },
        about: { type: "string" },
      },
    },
  },
  {
    name: "write_video_script",
    description: "Write a Studio video's script as scenes, with its claim, hooks and rule checks. Costs about $0.10 and takes about 40 seconds. With a note, rewrites the existing script as the note asks. Any rewrite takes the creator's approval back.",
    input_schema: { type: "object", properties: { id: { type: "string" }, note: { type: "string", description: "What to change, in the creator's words." } }, required: ["id"] },
  },
  {
    name: "update_video",
    description: "Make a small edit to a Studio video: its title, what it is about, how the whole video is made (made_with), the words of one line, whether one scene is generated with AI or filmed by the creator, or whether one scene carries on from the scene before. Scenes and lines are numbered from 1. Editing a line takes the creator's approval back. Changing made_with does not change a script already written: rewrite it with write_video_script and a note.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        about: { type: "string" },
        scene: { type: "integer" },
        line: { type: "integer" },
        text: { type: "string", description: "The new words for that line." },
        made_by: { type: "string", enum: ["ai", "me"], description: "Who makes that scene." },
        carries_on: { type: "boolean", description: "For that scene: true when it carries straight on from the scene before with no cut (its clip then opens on the last frame of that scene's clip), false when it is a new shot: a cut. Not for scene 1." },
        made_with: { type: "string", enum: ["ai", "me", "mix"], description: "How it is made: ai (every scene generated, the creator never on camera), me (the creator films everything, nothing generated) or mix. For the whole video." },
      },
      required: ["id"],
    },
  },
  {
    name: "approve_video_script",
    description: "Mark a Studio video's script as approved. Only when the creator has said, in this conversation, that they approve it. It fails if the creator has not ticked the source check themselves; you cannot tick it for them.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "make_video_voices",
    description: "Speak every AI line of an approved script that has no audio yet, each in its character's voice. Uses the creator's ElevenLabs credits by the character.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "record_video_results",
    description: "Save how a posted video did, from numbers the creator gives you. Never estimate or invent a number: leave out what they did not say.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        posted_on: { type: "string", description: "YYYY-MM-DD" },
        url: { type: "string" },
        views: { type: "integer" },
        saves: { type: "integer" },
        shares: { type: "integer" },
        follows: { type: "integer" },
        comments: { type: "integer" },
        note: { type: "string", description: "Where people stopped watching, or anything else worth remembering." },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_video",
    description: "Permanently delete a Studio video and its script. Only after the creator clearly asked for it.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "make_character_picture",
    description: "Make a reference picture of a character from their look, so scenes can keep them the same. Billed by the creator's picture service.",
    input_schema: { type: "object", properties: { id: { type: "string" }, service: { type: "string", enum: ["fal", "google", "elevenlabs"], description: "Only if the creator named a service; otherwise leave out to use their default." },
        model: { type: "string", description: "Only with service, and only if the creator named a model id." }, }, required: ["id"] },
  },
  {
    name: "make_scene_pictures",
    description: "Make the storyboard (one sheet of four frames showing what happens in the scene) for scenes of a Studio video whose script is approved. Without scenes, makes one for every AI scene that has none, from the first scene down. With a single scene and a note, makes another attempt changed as the note says. Billed per picture by the creator's picture service.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The video's id." },
        scenes: { type: "array", items: { type: "integer" }, description: "Scene numbers from 1. Leave out for every AI scene without a picture." },
        note: { type: "string", description: "What to change from the last attempt." },
        service: { type: "string", enum: ["fal", "google", "elevenlabs"], description: "Only if the creator named a service; otherwise leave out to use their default." },
        model: { type: "string", description: "Only with service, and only if the creator named a model id." },
      },
      required: ["id"],
    },
  },
  {
    name: "make_scene_clip",
    description: "Turn one scene's chosen picture into a moving clip. This is the costly step and can take minutes. Only for a scene whose picture the creator is happy with.",
    input_schema: { type: "object", properties: { id: { type: "string" }, scene: { type: "integer" }, service: { type: "string", enum: ["fal", "google", "elevenlabs"], description: "Only if the creator named a service; otherwise leave out to use their default." },
        model: { type: "string", description: "Only with service, and only if the creator named a model id." }, }, required: ["id", "scene"] },
  },
  {
    name: "make_scene_lipsync",
    description: "Make the character in one scene's chosen picture speak that scene's first recorded line. Needs the picture and the voice to exist. Google cannot do this.",
    input_schema: { type: "object", properties: { id: { type: "string" }, scene: { type: "integer" }, service: { type: "string", enum: ["fal", "google", "elevenlabs"], description: "Only if the creator named a service; otherwise leave out to use their default." },
        model: { type: "string", description: "Only with service, and only if the creator named a model id." }, }, required: ["id", "scene"] },
  },
  {
    name: "get_app_status",
    description: "Check which services are connected (Claude, Deepgram, Telegram keys saved or not) and where the data folder is.",
    input_schema: { type: "object", properties: {} },
  },
];

// ---------- What is running right now ----------

const progress = new Map<string, string>();
/** Candidates from generate_ideas, per chat, until they are saved or the app closes. */
const candidates = new Map<string, Map<string, IdeaDraft>>();

export const agentProgress = (chatId: string): AgentProgress => ({
  running: progress.has(chatId),
  status: progress.get(chatId) ?? "",
});

// ---------- Tools ----------

type Input = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

function postSummary(p: ResearchItem) {
  return {
    id: p.id,
    creator: p.author || p.authorHandle,
    platform: p.platform,
    kind: p.media.some((m) => m.kind === "video") ? "video" : "pictures",
    likes: p.likeCount,
    comments: p.commentCount,
    views: p.viewCount,
    creators_rating: p.rating,
    creators_note: p.note || undefined,
    concept_group: p.group || undefined,
    saved_on: p.savedAt.slice(0, 10),
    caption_start: short(p.caption, 140),
    has_transcript: p.transcript !== "",
    analysed: Boolean(p.analysis),
    ...(p.analysis && {
      format: p.analysis.format,
      visual_style: p.analysis.style,
      hook_type: p.analysis.hookType,
      topic: p.analysis.topic,
      seconds: p.analysis.durationSeconds ? Math.round(p.analysis.durationSeconds) : undefined,
    }),
  };
}

function ideaSummary(i: Idea) {
  return {
    id: i.id,
    kind: i.kind === "series" ? "an idea for a series (its outline lists the episodes)" : "an idea for a single video",
    title: i.title,
    hook: i.hook,
    series: i.series || undefined,
    pillar: i.pillar || undefined,
    platform: i.platform || undefined,
    score: i.score,
    modelled_on: i.modelledOnLabel || undefined,
    saved_on: i.createdAt.slice(0, 10),
  };
}

/** The brand fields update_brand may change, with the name each is shown under. */
const BRAND_LABELS = {
  name: "Name",
  topics: "Topics",
  goals: "Goals",
  goalDetails: "What success looks like",
  audience: "Audience",
  tagline: "Tagline",
  positioning: "Positioning",
  mission: "Mission",
  bio: "Bio",
  pillars: "Content pillars",
  voice: "Tone of voice",
  platforms: "Platforms",
} as const;
const BRAND_FIELDS = Object.keys(BRAND_LABELS) as (keyof typeof BRAND_LABELS)[];

/** What update_idea is sent, and the idea field each one changes. */
const IDEA_FIELDS: Record<string, keyof IdeaDraft> = {
  title: "title",
  hook: "hook",
  alt_hooks: "altHooks",
  outline: "outline",
  cta: "cta",
  caption: "caption",
  hashtags: "hashtags",
  pillar: "pillar",
  platform: "platform",
  series: "series",
};
const IDEA_LABELS: Record<string, string> = {
  title: "Title",
  hook: "Opening line",
  alt_hooks: "Other opening lines",
  outline: "Outline",
  cta: "Call to action",
  caption: "Caption",
  hashtags: "Hashtags",
  pillar: "Pillar",
  platform: "Platform",
  series: "Series",
};

/** A new value as one readable line for the approval prompt. */
function asLine(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value.map((v) =>
      v && typeof v === "object" ? text((v as Input).title ?? (v as Input).trait ?? (v as Input).platform) : text(v),
    );
    return parts.filter(Boolean).join(", ") || "(empty)";
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return short(text(value).replace(/\s+/g, " "), 220) || "(empty)";
}

/**
 * Describes an action the user is about to be asked to approve: which item it
 * touches and what would change. Never throws; a missing item is described as such.
 */
async function describeCall(ctx: AgentContext, id: string, name: string, input: Input): Promise<AgentApproval> {
  const title = AGENT_TOOLS.find((t) => t.name === name)?.title ?? name;
  const lines: string[] = [];
  const changed = (labels: Record<string, string>) => {
    for (const [field, label] of Object.entries(labels)) {
      if (input[field] !== undefined) lines.push(`- **${label}:** ${asLine(input[field])}`);
    }
  };
  try {
    switch (name) {
      case "delete_research_post":
        lines.push(`[[post:${text(input.id)}]]`, "The post and its downloaded files are removed for good.");
        break;
      case "rate_research_post":
        lines.push(`[[post:${text(input.id)}]]`);
        if (typeof input.rating === "number") lines.push(`- **Rating:** ${input.rating} of 5`);
        if (input.rating === null) lines.push("- **Rating:** cleared");
        if (typeof input.note === "string") lines.push(`- **Note:** ${asLine(input.note)}`);
        break;
      case "delete_idea":
        lines.push(`[[idea:${text(input.id)}]]`, "The idea and its script are removed for good.");
        break;
      case "update_idea":
        lines.push(`[[idea:${text(input.id)}]]`);
        changed(IDEA_LABELS);
        break;
      case "update_brand":
        lines.push("[[brand:kit]]");
        changed(BRAND_LABELS);
        break;
      case "delete_generated_audio": {
        const audio = (await listAudio(ctx.dataDir())).find((a) => a.id === text(input.id));
        lines.push(audio ? `“${audio.title}”` : "An audio file that is no longer saved.", "The file is removed for good.");
        break;
      }
      case "update_video":
      case "approve_video_script":
      case "delete_video":
      case "write_video_script":
      case "make_video_voices":
      case "make_scene_clip":
      case "make_scene_lipsync":
      case "make_scene_pictures":
      case "record_video_results": {
        const { id: _id, ...rest } = input;
        lines.push(`[[video:${text(input.id)}]]`);
        if (name === "delete_video") lines.push("The video and its script are removed for good.");
        for (const [field, value] of Object.entries(rest)) lines.push(`- **${field.replace(/_/g, " ")}:** ${asLine(value)}`);
        break;
      }
      case "update_series":
      case "delete_series": {
        const { id: _id, ...rest } = input;
        lines.push(`[[series:${text(input.id)}]]`);
        if (name === "delete_series") lines.push("The plan is removed for good. Its videos are kept.");
        for (const [field, value] of Object.entries(rest)) lines.push(`- **${field}:** ${asLine(value)}`);
        break;
      }
      case "update_character":
      case "delete_character": {
        const { id: _id, ...rest } = input;
        lines.push(`[[character:${text(input.id)}]]`);
        if (name === "delete_character") lines.push("The character is removed for good.");
        for (const [field, value] of Object.entries(rest)) lines.push(`- **${field.replace(/_/g, " ")}:** ${asLine(value)}`);
        break;
      }
      default:
        for (const [field, value] of Object.entries(input)) lines.push(`- **${field.replace(/_/g, " ")}:** ${asLine(value)}`);
    }
  } catch {
    // The description is a courtesy; the action itself reports what is wrong when it runs.
  }
  return { id, tool: name, title, detail: lines.join("\n") };
}

/** What the agent may do without asking. Saved in the data folder with the other settings. */
export function getAgentPermissions(ctx: AgentContext): AgentPermissions {
  try {
    return parsePermissions(JSON.parse(ctx.store().getSetting(PERMISSIONS_SETTING) || "{}"));
  } catch {
    return parsePermissions({});
  }
}

/** Changes the permission of the named tools and returns the full, updated set. */
export function setAgentPermissions(ctx: AgentContext, changes: unknown): AgentPermissions {
  const merged = parsePermissions({ ...getAgentPermissions(ctx), ...(changes && typeof changes === "object" ? changes : {}) });
  ctx.store().setSetting(PERMISSIONS_SETTING, JSON.stringify(merged));
  return merged;
}

/** The service a tool call asked for, or undefined to use the creator's default. */
const service = (input: Input) => (text(input.service) ? { provider: text(input.service), model: text(input.model) || undefined } : undefined);

/** A list of ids from a tool call. */
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function videoSummary(v: Video) {
  return {
    id: v.id,
    title: v.title,
    kind: `${v.format === "episode" ? `episode ${v.episode ?? ""} of a series` : "single video"}, ${v.source === "remake" ? "remake" : "new idea"}`,
    made_with: v.production === "ai" ? "AI only" : v.production === "me" ? "filmed by the creator only" : "a mix of AI and filmed scenes",
    from_idea_ids: v.ideaIds.length ? v.ideaIds : undefined,
    stage: VIDEO_STAGES[videoStage(v)],
    script: v.scenes.length === 0 ? "not written" : v.approvedAt ? "approved by the creator" : "written, waiting for the creator to approve",
    source_checked_by_creator: v.claim ? v.claim.checked : undefined,
    seconds: v.scenes.reduce((n, s) => n + s.seconds, 0) || undefined,
    scenes_with_picture: v.scenes.length ? `${v.scenes.filter((s) => s.picture).length} of ${v.scenes.length}` : undefined,
    scenes_with_clip: v.scenes.length ? `${v.scenes.filter((s) => s.clip).length} of ${v.scenes.length}` : undefined,
    results: v.results ?? undefined,
  };
}

/** Runs one tool and returns what Claude should see, plus what it cost. Throws with a message for Claude on failure. */
async function runTool(
  ctx: AgentContext,
  chatId: string,
  name: string,
  input: Input,
  say: (status: string) => void,
): Promise<{ result: unknown; costUsd?: number }> {
  const dataDir = ctx.dataDir();
  const store = ctx.store();
  const studio = studioOps(ctx);
  const findPost = async (id: unknown) => {
    const post = (await listResearch(dataDir)).find((p) => p.id === text(id));
    if (!post) throw new Error("No saved post has that id. Call list_research_posts for the current ids.");
    return post;
  };
  const findIdea = (id: unknown) => {
    const idea = store.listIdeas().find((i) => i.id === text(id));
    if (!idea) throw new Error("No saved idea has that id. Call list_ideas for the current ids.");
    return idea;
  };

  switch (name) {
    case "get_brand": {
      const brand = store.getBrand();
      if (!brand) throw new Error("The creator has not set up a brand yet.");
      // Colours are for the app's look, not for the agent.
      const { colors: _colors, ...rest } = brand;
      return { result: rest };
    }

    case "list_research_posts": {
      const posts = await listResearch(dataDir);
      return { result: { count: posts.length, analysed: posts.filter((p) => p.analysis).length, posts: posts.map(postSummary) } };
    }

    case "get_research_post": {
      const p = await findPost(input.id);
      return {
        result: {
          ...postSummary(p),
          link: p.pageUrl || p.sourceUrl,
          published: p.publishedAt || undefined,
          caption: p.caption,
          hashtags: p.hashtags,
          transcript: p.transcript || (p.transcriptError ? `(not transcribed: ${p.transcriptError})` : "(no transcript)"),
          sound: p.audio ?? "unknown",
          analysis: p.analysis ?? "(not analysed yet)",
        },
      };
    }

    case "save_research_post": {
      say("Downloading the post");
      const saved = await addResearch(dataDir, text(input.url), ctx.key("deepgram"));
      if (!saved.ok) throw new Error(saved.error);
      return { result: { saved: postSummary(saved.item) } };
    }

    case "analyze_research_posts": {
      const posts = await listResearch(dataDir);
      const wanted = input.all_unanalysed === true ? posts.filter((p) => !p.analysis) : posts.filter((p) => list(input.ids).includes(p.id));
      const todo = input.reanalyse === true ? wanted : wanted.filter((p) => !p.analysis);
      const skipped = wanted.length - todo.length;
      if (wanted.length === 0) {
        return { result: input.all_unanalysed === true ? "Every saved post is already analysed." : "None of those ids match a saved post." };
      }

      const done: unknown[] = [];
      const failed: unknown[] = [];
      let costUsd = 0;
      let finished = 0;
      const queue = [...todo];
      const worker = async () => {
        for (let post = queue.shift(); post; post = queue.shift()) {
          const outcome = await analyzeResearch(dataDir, post.id, ctx.key("anthropic")).catch((e) => ({
            ok: false as const,
            error: e instanceof Error ? e.message : "The analysis failed.",
          }));
          finished++;
          say(`Analysing posts: ${finished} of ${todo.length} done`);
          if (outcome.ok && outcome.item.analysis) {
            costUsd += outcome.item.analysis.costUsd;
            const a = outcome.item.analysis;
            done.push({ ...postSummary(outcome.item), summary: a.summary, spoken_hook: a.spokenHook, why_it_works: a.whyItWorks });
          } else {
            failed.push({ creator: post.author || post.authorHandle, error: outcome.ok ? "No analysis came back." : outcome.error });
          }
        }
      };
      say(`Analysing posts: 0 of ${todo.length} done`);
      await Promise.all(Array.from({ length: Math.min(ANALYSE_AT_ONCE, todo.length) }, worker));
      return { result: { analysed: done, failed, already_analysed_and_skipped: skipped, cost_usd: Number(costUsd.toFixed(3)) }, costUsd };
    }

    case "rate_research_post": {
      await findPost(input.id);
      const rating = typeof input.rating === "number" ? Math.min(Math.max(Math.round(input.rating), 0), 5) : input.rating === null ? null : undefined;
      const updated = await updateResearch(dataDir, text(input.id), {
        ...(rating !== undefined && { rating }),
        ...(typeof input.note === "string" && { note: input.note }),
      });
      if (!updated.ok) throw new Error(updated.error);
      return { result: { updated: postSummary(updated.item) } };
    }

    case "delete_research_post": {
      const p = await findPost(input.id);
      await deleteResearch(dataDir, p.id);
      return { result: `Deleted the post by ${p.author || p.authorHandle}.` };
    }

    case "update_brand": {
      const brand = store.getBrand();
      if (!brand) throw new Error("The creator has not set up a brand yet.");
      const changes = Object.fromEntries(BRAND_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
      if (Object.keys(changes).length === 0) throw new Error("Nothing to change: send at least one field.");
      // The same check the brand form uses; colours and the speaking voice are carried over untouched.
      const updated = parseBrandKit({ ...brand, ...changes });
      store.saveBrand(updated);
      const { colors: _colors, ...rest } = updated;
      return { result: { changed: Object.keys(changes), brand: rest } };
    }

    case "update_idea": {
      const idea = findIdea(input.id);
      const changes = Object.fromEntries(
        Object.entries(IDEA_FIELDS)
          .filter(([sent]) => input[sent] !== undefined)
          .map(([sent, field]) => [field, input[sent]]),
      );
      if (Object.keys(changes).length === 0) throw new Error("Nothing to change: send at least one field.");
      const updated = parseIdea({ ...idea, ...changes });
      store.saveIdea(updated);
      return { result: { changed: Object.keys(changes), idea: ideaSummary(updated) } };
    }

    case "delete_generated_audio": {
      const audio = (await listAudio(dataDir)).find((a) => a.id === text(input.id));
      if (!audio) throw new Error("No generated audio has that id. Call list_generated_audio for the current ids.");
      await deleteAudio(dataDir, audio.id);
      return { result: `Deleted the audio “${audio.title}”.` };
    }

    case "list_ideas": {
      const ideas = store.listIdeas();
      return { result: { count: ideas.length, ideas: ideas.map(ideaSummary) } };
    }

    case "get_idea":
      return { result: findIdea(input.id) };

    case "generate_ideas": {
      const brand = store.getBrand();
      if (!brand) throw new Error("The creator has not set up a brand yet.");
      say("Writing and judging ideas (one to two minutes)");
      const outcome = await generateIdeas(
        ctx.key("anthropic"),
        brand,
        await listResearch(dataDir),
        {
          count: typeof input.count === "number" ? input.count : 5,
          pillar: text(input.pillar),
          series: text(input.series),
          notes: text(input.notes),
          postIds: ids(input.post_ids),
          kind: input.kind === "series" ? "series" : "video",
        },
        store.listIdeas(),
      );
      if (!outcome.ok) throw new Error(outcome.error);
      const held = candidates.get(chatId) ?? new Map<string, IdeaDraft>();
      candidates.set(chatId, held);
      const start = held.size;
      const coded = outcome.ideas.map((idea, i) => {
        const code = `G${start + i + 1}`;
        held.set(code, idea);
        const { modelledOnId: _id, ...shown } = idea;
        return { code, ...shown };
      });
      return {
        result: { written: outcome.considered, kept: coded.length, cost_usd: Number(outcome.costUsd.toFixed(3)), saved: false, candidates: coded },
        costUsd: outcome.costUsd,
      };
    }

    case "save_generated_ideas": {
      const held = candidates.get(chatId);
      const saved: unknown[] = [];
      const unknown: string[] = [];
      for (const raw of list(input.codes)) {
        const code = raw.toUpperCase();
        const draft = held?.get(code);
        if (!draft) {
          unknown.push(raw);
          continue;
        }
        const idea = parseIdea({ ...draft, id: randomUUID(), createdAt: new Date().toISOString() });
        store.saveIdea(idea);
        held!.delete(code);
        saved.push(ideaSummary(idea));
      }
      return { result: { saved, not_found: unknown.length ? unknown : undefined } };
    }

    case "create_idea": {
      const model = text(input.modelled_on_post_id) ? await findPost(input.modelled_on_post_id) : undefined;
      const idea = parseIdea({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        title: input.title,
        hook: input.hook,
        altHooks: input.alt_hooks,
        outline: input.outline,
        cta: input.cta,
        caption: input.caption,
        hashtags: input.hashtags,
        pillar: input.pillar,
        platform: input.platform,
        series: input.series,
        modelledOnId: model?.id,
        modelledOnLabel: model ? model.author || model.authorHandle : undefined,
      });
      store.saveIdea(idea);
      return { result: { saved: ideaSummary(idea) } };
    }

    case "delete_idea": {
      const idea = findIdea(input.id);
      store.deleteIdea(idea.id);
      return { result: `Deleted the idea “${idea.title}”.` };
    }

    case "list_voices": {
      const outcome = await listVoices(ctx.key("elevenlabs"));
      if (!outcome.ok) throw new Error(outcome.error);
      // The creator's own voices first, then the ready-made ones.
      const own = (v: { category: string }) => (v.category === "cloned" || v.category === "professional" || v.category === "generated" ? 0 : 1);
      const voices = [...outcome.voices].sort((a, b) => own(a) - own(b));
      return {
        result: {
          count: voices.length,
          voices: voices.map((v) => ({ id: v.id, name: v.name, category: v.category, description: short(v.description, 140) || undefined, labels: v.labels })),
        },
      };
    }

    case "generate_voiceover": {
      say("Generating the voiceover");
      let voiceName: string | undefined;
      const voices = await listVoices(ctx.key("elevenlabs"));
      if (voices.ok) voiceName = voices.voices.find((v) => v.id === text(input.voice_id))?.name;
      const outcome = await generateSpeech(dataDir, ctx.key("elevenlabs"), {
        text: text(input.text),
        voiceId: text(input.voice_id),
        voiceName,
        title: text(input.title),
        model: text(input.model),
      });
      if (!outcome.ok) throw new Error(outcome.error);
      const a = outcome.audio;
      return { result: { saved: { id: a.id, kind: a.kind, title: a.title, voice: a.voiceName, characters: a.prompt.length, model: a.model }, show_with: `[[audio:${a.id}]]` } };
    }

    case "generate_sound_effect": {
      say("Generating the sound effect");
      const outcome = await generateSoundEffect(dataDir, ctx.key("elevenlabs"), {
        description: text(input.description),
        seconds: typeof input.seconds === "number" ? input.seconds : undefined,
        loop: input.loop === true,
        title: text(input.title),
      });
      if (!outcome.ok) throw new Error(outcome.error);
      return { result: { saved: { id: outcome.audio.id, kind: outcome.audio.kind, title: outcome.audio.title }, show_with: `[[audio:${outcome.audio.id}]]` } };
    }

    case "generate_music": {
      say("Composing the music (this can take a minute)");
      const outcome = await generateMusic(dataDir, ctx.key("elevenlabs"), {
        description: text(input.description),
        seconds: typeof input.seconds === "number" ? input.seconds : undefined,
        instrumental: input.instrumental !== false,
        title: text(input.title),
      });
      if (!outcome.ok) throw new Error(outcome.error);
      return { result: { saved: { id: outcome.audio.id, kind: outcome.audio.kind, title: outcome.audio.title }, show_with: `[[audio:${outcome.audio.id}]]` } };
    }

    case "list_generated_audio": {
      const items = await listAudio(dataDir);
      return {
        result: {
          count: items.length,
          audio: items.map((a) => ({ id: a.id, kind: a.kind, title: a.title, from: short(a.prompt, 160), voice: a.voiceName, made_on: a.createdAt.slice(0, 10) })),
        },
      };
    }

    case "list_cast":
      return { result: { characters: studio.cast().map((c) => ({ ...c, voice: c.voice?.name ?? "(none chosen)" })) } };

    case "list_series":
      return { result: { series: studio.series() } };

    case "list_videos":
      return { result: { videos: studio.videos().map(videoSummary) } };

    case "get_video": {
      const video = studio.findVideo(input.id);
      if (!video) throw new Error("No Studio video has that id. Call list_videos for the current ids.");
      const names = studio.cast();
      return {
        result: {
          ...videoSummary(video),
          about: video.brief,
          claim: video.claim ?? "(none)",
          hooks: video.hooks,
          on_screen_opening: video.overlay,
          scenes: video.scenes.map((s, i) => ({
            scene: i + 1,
            made_by: s.madeBy === "me" ? "filmed by the creator" : "AI",
            seconds: s.seconds,
            place: s.place,
            action: s.action,
            camera: s.camera,
            on_screen: s.text || undefined,
            continues_previous_scene: s.continues || undefined,
            pictures_made: s.pictures.length,
            clips_made: s.clips.length,
            lines: s.lines.map((l, n) => ({ line: n + 1, speaker: speakerName(l.speaker, names), text: l.text, delivery: l.delivery || undefined, has_voice: Boolean(l.audioId) })),
          })),
          rule_checks: video.checks,
          caption: video.caption,
          kept_from_original: video.kept.length ? video.kept : undefined,
          new_in_this_version: video.changed.length ? video.changed : undefined,
        },
      };
    }

    case "create_character":
    case "update_character": {
      const existing = name === "update_character" ? studio.cast().find((c) => c.id === text(input.id)) : undefined;
      if (name === "update_character" && !existing) throw new Error("No character has that id. Call list_cast for the current ids.");
      let voice = existing?.voice ?? null;
      if (text(input.voice_id)) {
        const voices = await listVoices(ctx.key("elevenlabs"));
        if (!voices.ok) throw new Error(voices.error);
        const found = voices.voices.find((v) => v.id === text(input.voice_id));
        if (!found) throw new Error("That voice id is not in the creator's ElevenLabs account. Call list_voices.");
        voice = { id: found.id, name: found.name, category: found.category };
      }
      const fields = Object.fromEntries(["name", "role", "personality", "speech", "look"].filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
      const saved = studio.saveCharacter({ ...existing, ...fields, voice });
      if (!saved.ok) throw new Error(saved.error);
      return { result: { saved: { ...saved.value, voice: saved.value.voice?.name ?? "(none chosen)" }, show_with: `[[character:${saved.value.id}]]` } };
    }

    case "delete_character": {
      const character = studio.cast().find((c) => c.id === text(input.id));
      if (!character) throw new Error("No character has that id.");
      studio.deleteCharacter(character.id);
      return { result: `Deleted the character ${character.name}.` };
    }

    case "plan_series": {
      say("Planning the season (about 30 seconds)");
      const planned = await studio.plan(input.title, input.about, { ideaIds: ids(input.idea_ids), production: parseProduction(input.made_with) });
      if (!planned.ok) throw new Error(planned.error);
      return { result: { saved: planned.value, show_with: `[[series:${planned.value.id}]]` }, costUsd: planned.value.costUsd };
    }

    case "update_series": {
      const series = studio.series().find((s) => s.id === text(input.id));
      if (!series) throw new Error("No series has that id. Call list_series for the current ids.");
      const fields = Object.fromEntries(["title", "premise", "question", "ending", "episodes"].filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));
      const saved = studio.saveSeries({ ...series, ...fields });
      if (!saved.ok) throw new Error(saved.error);
      return { result: { saved: saved.value } };
    }

    case "delete_series": {
      const series = studio.series().find((s) => s.id === text(input.id));
      if (!series) throw new Error("No series has that id.");
      studio.deleteSeries(series.id);
      return { result: `Deleted the series “${series.title}”. Its videos were kept.` };
    }

    case "start_video": {
      const started = await studio.createVideo({
        ideaId: text(input.idea_id) || undefined,
        ideaIds: ids(input.idea_ids),
        postIds: ids(input.inspiration_post_ids),
        production: input.made_with === undefined ? undefined : parseProduction(input.made_with),
        postId: text(input.post_id) || undefined,
        seriesId: text(input.series_id) || undefined,
        episode: typeof input.episode === "number" ? input.episode : undefined,
        title: text(input.title) || undefined,
        brief: text(input.about) || undefined,
      });
      if (!started.ok) throw new Error(started.error);
      return { result: { started: videoSummary(started.value), show_with: `[[video:${started.value.id}]]`, next: "write_video_script writes the script (about $0.10)." } };
    }

    case "write_video_script": {
      const before = studio.findVideo(input.id);
      if (!before) throw new Error("No Studio video has that id. Call list_videos for the current ids.");
      say(`Writing the script for “${short(before.title, 40)}” (about 40 seconds)`);
      const written = await studio.writeScript(before.id, input.note);
      if (!written.ok) throw new Error(written.error);
      const v = written.value;
      return {
        result: {
          video: videoSummary(v),
          claim: v.claim,
          hooks: v.hooks,
          failed_checks: v.checks.filter((c) => !c.ok),
          scenes: v.scenes.length,
          next: "The creator reads it in Studio, checks the source themselves, and approves it there. Point them to it with the video's tag.",
          show_with: `[[video:${v.id}]]`,
        },
        costUsd: v.costUsd - before.costUsd,
      };
    }

    case "update_video": {
      const video = studio.findVideo(input.id);
      if (!video) throw new Error("No Studio video has that id.");
      let next = {
        ...video,
        ...(text(input.title) && { title: text(input.title) }),
        ...(typeof input.about === "string" && { brief: input.about }),
        ...(input.made_with !== undefined && { production: parseProduction(input.made_with) }),
      };
      if (typeof input.scene === "number") {
        const index = Math.round(input.scene) - 1;
        const scene = video.scenes[index];
        if (!scene) throw new Error(`This video has ${video.scenes.length} scenes.`);
        let changed = scene;
        if (input.made_by === "ai" || input.made_by === "me") changed = { ...changed, madeBy: input.made_by };
        if (typeof input.line === "number" && text(input.text)) {
          const at = Math.round(input.line) - 1;
          if (!scene.lines[at]) throw new Error(`Scene ${index + 1} has ${scene.lines.length} lines.`);
          // New words need a new recording, and the creator's approval again.
          changed = { ...changed, lines: changed.lines.map((l, n) => (n === at ? { speaker: l.speaker, delivery: l.delivery, text: text(input.text) } : l)) };
          next = { ...next, approvedAt: "" };
        }
        next = { ...next, scenes: video.scenes.map((s, n) => (n === index ? changed : s)) };
      }
      const saved = studio.saveVideo(next);
      if (!saved.ok) throw new Error(saved.error);
      if (typeof input.scene === "number" && typeof input.carries_on === "boolean") {
        const flowed = await studio.sceneFlow(video.id, video.scenes[Math.round(input.scene) - 1].id, input.carries_on);
        if (!flowed.ok) throw new Error(flowed.error);
        return { result: { saved: videoSummary(flowed.video) } };
      }
      return { result: { saved: videoSummary(saved.value) } };
    }

    case "approve_video_script": {
      say("Checking the script for continuity");
      const approved = await studio.approve(input.id);
      if (!approved.ok) throw new Error(approved.error);
      return { result: { approved: videoSummary(approved.value) } };
    }

    case "make_video_voices": {
      say("Making the voices");
      const made = await studio.voices(input.id);
      if (!made.ok) throw new Error(made.error);
      return { result: { lines_spoken: made.made, not_done: made.skipped.length ? made.skipped : undefined, show_with: `[[video:${made.video.id}]]` } };
    }

    case "record_video_results": {
      const video = studio.findVideo(input.id);
      if (!video) throw new Error("No Studio video has that id.");
      const saved = studio.recordResults(video.id, {
        ...video.results,
        ...(text(input.posted_on) && { postedOn: text(input.posted_on) }),
        ...(text(input.url) && { url: text(input.url) }),
        ...Object.fromEntries(["views", "saves", "shares", "follows", "comments"].filter((f) => typeof input[f] === "number").map((f) => [f, input[f]])),
        ...(typeof input.note === "string" && { note: input.note }),
      });
      if (!saved.ok) throw new Error(saved.error);
      return { result: { saved: saved.value.results } };
    }

    case "delete_video": {
      const video = studio.findVideo(input.id);
      if (!video) throw new Error("No Studio video has that id.");
      studio.deleteVideo(video.id);
      return { result: `Deleted the video “${video.title}”.` };
    }

    case "make_character_picture": {
      say("Making the reference picture");
      const made = await studio.characterPicture(input.id, service(input));
      if (!made.ok) throw new Error(made.error);
      return { result: { character: made.value.name, reference_pictures: made.value.pictures.length, show_with: `[[character:${made.value.id}]]` } };
    }

    case "make_scene_pictures": {
      const video = studio.findVideo(input.id);
      if (!video) throw new Error("No Studio video has that id.");
      const asked = Array.isArray(input.scenes) ? input.scenes.filter((n): n is number => typeof n === "number").map((n) => Math.round(n) - 1) : null;
      const targets = video.scenes.map((s, i) => ({ s, i })).filter(({ s, i }) => (asked ? asked.includes(i) : s.madeBy === "ai" && s.pictures.length === 0));
      if (targets.length === 0) return { result: asked ? "None of those scene numbers exist." : "Every AI scene already has a picture." };
      const done: number[] = [];
      for (const [n, { s, i }] of targets.entries()) {
        say(`Making picture ${n + 1} of ${targets.length}`);
        const made = await studio.scenePicture(video.id, s.id, service(input), input.note);
        // The first failure (no key, no credit) would repeat for every scene, so stop there.
        if (!made.ok) return { result: { pictures_made_for_scenes: done, stopped_at_scene: i + 1, error: made.error } };
        done.push(i + 1);
      }
      return { result: { pictures_made_for_scenes: done, show_with: `[[video:${video.id}]]`, next: "The creator looks at them in Studio and says which to redo." } };
    }

    case "make_scene_clip":
    case "make_scene_lipsync": {
      const video = studio.findVideo(input.id);
      const scene = video?.scenes[Math.round(Number(input.scene)) - 1];
      if (!video || !scene) throw new Error("That video or scene does not exist. Call get_video.");
      say(name === "make_scene_clip" ? "Making the clip (this can take minutes)" : "Lip-syncing (this can take minutes)");
      const made = name === "make_scene_clip" ? await studio.sceneClip(video.id, scene.id, service(input)) : await studio.sceneLipSync(video.id, scene.id, service(input));
      if (!made.ok) throw new Error(made.error);
      return { result: { done_for_scene: Math.round(Number(input.scene)), show_with: `[[video:${video.id}]]` } };
    }

    case "get_app_status":
      return {
        result: {
          elevenlabs_key_saved: ctx.key("elevenlabs") !== "",
          claude_key_saved: ctx.key("anthropic") !== "",
          deepgram_key_saved: ctx.key("deepgram") !== "",
          telegram_bot_token_saved: ctx.key("telegram") !== "",
          data_folder: dataDir,
          where_to_change: "Settings, at the bottom of the app's menu",
        },
      };

    default:
      throw new Error(`There is no tool called ${name}.`);
  }
}

/** A few words for the chat about what a tool call did. */
function stepLabel(name: string, input: Input): string {
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (name) {
    case "get_brand":
      return "Read your brand";
    case "list_research_posts":
      return "Looked through your saved posts";
    case "get_research_post":
      return "Read a saved post";
    case "save_research_post":
      return "Saved a post to Research";
    case "analyze_research_posts":
      return input.all_unanalysed === true ? "Analysed your unanalysed posts" : `Analysed ${n(input.ids)} ${n(input.ids) === 1 ? "post" : "posts"}`;
    case "rate_research_post":
      return "Updated a post's rating or note";
    case "delete_research_post":
      return "Deleted a saved post";
    case "list_ideas":
      return "Looked through your saved ideas";
    case "get_idea":
      return "Read a saved idea";
    case "generate_ideas":
      return "Wrote and judged new ideas";
    case "save_generated_ideas":
      return `Saved ${n(input.codes)} ${n(input.codes) === 1 ? "idea" : "ideas"}`;
    case "create_idea":
      return `Saved the idea “${short(text(input.title), 50)}”`;
    case "delete_idea":
      return "Deleted an idea";
    case "update_brand":
      return "Changed your brand kit";
    case "update_idea":
      return "Changed an idea";
    case "delete_generated_audio":
      return "Deleted generated audio";
    case "list_cast":
      return "Looked through your cast";
    case "list_series":
      return "Looked through your series";
    case "list_videos":
      return "Looked through your Studio videos";
    case "get_video":
      return "Read a Studio video";
    case "create_character":
      return `Created the character ${short(text(input.name), 40)}`;
    case "update_character":
      return "Changed a character";
    case "delete_character":
      return "Deleted a character";
    case "plan_series":
      return `Planned the series “${short(text(input.title), 40)}”`;
    case "update_series":
      return "Changed a series plan";
    case "delete_series":
      return "Deleted a series";
    case "start_video":
      return "Started a video in Studio";
    case "write_video_script":
      return text(input.note) ? "Rewrote a video's script" : "Wrote a video's script";
    case "update_video":
      return "Changed a Studio video";
    case "approve_video_script":
      return "Approved a video's script";
    case "make_video_voices":
      return "Made a video's voices";
    case "record_video_results":
      return "Recorded a video's results";
    case "delete_video":
      return "Deleted a Studio video";
    case "make_character_picture":
      return "Made a character's reference picture";
    case "make_scene_pictures":
      return "Made scene pictures";
    case "make_scene_clip":
      return "Made a scene's clip";
    case "make_scene_lipsync":
      return "Lip-synced a scene";
    case "list_voices":
      return "Looked through your ElevenLabs voices";
    case "generate_voiceover":
      return "Generated a voiceover";
    case "generate_sound_effect":
      return "Generated a sound effect";
    case "generate_music":
      return "Composed a music track";
    case "list_generated_audio":
      return "Looked through your generated audio";
    case "get_app_status":
      return "Checked the app's connections";
    default:
      return name;
  }
}

/** Shown while a tool is running. */
const RUNNING: Record<string, string> = {
  get_brand: "Reading your brand",
  list_research_posts: "Reading your saved posts",
  get_research_post: "Reading a saved post",
  save_research_post: "Downloading the post",
  analyze_research_posts: "Analysing posts",
  rate_research_post: "Updating a post",
  delete_research_post: "Deleting a post",
  list_ideas: "Reading your saved ideas",
  get_idea: "Reading a saved idea",
  generate_ideas: "Writing and judging ideas (one to two minutes)",
  save_generated_ideas: "Saving ideas",
  create_idea: "Saving an idea",
  delete_idea: "Deleting an idea",
  update_brand: "Changing your brand kit",
  update_idea: "Changing an idea",
  delete_generated_audio: "Deleting generated audio",
  list_cast: "Reading your cast",
  list_series: "Reading your series",
  list_videos: "Reading your Studio videos",
  get_video: "Reading a Studio video",
  create_character: "Creating a character",
  update_character: "Changing a character",
  delete_character: "Deleting a character",
  plan_series: "Planning the season",
  update_series: "Changing a series plan",
  delete_series: "Deleting a series",
  start_video: "Starting a video",
  write_video_script: "Writing the script",
  update_video: "Changing a video",
  approve_video_script: "Approving the script",
  make_video_voices: "Making the voices",
  record_video_results: "Saving the results",
  delete_video: "Deleting a video",
  make_character_picture: "Making the reference picture",
  make_scene_pictures: "Making storyboards",
  make_scene_clip: "Making the clip",
  make_scene_lipsync: "Lip-syncing",
  list_voices: "Reading your ElevenLabs voices",
  generate_voiceover: "Generating the voiceover",
  generate_sound_effect: "Generating the sound effect",
  generate_music: "Composing the music",
  list_generated_audio: "Reading your generated audio",
  get_app_status: "Checking the app's connections",
};

// ---------- Chats ----------

/** Turns the stored messages into what the chat screen shows. */
function toView(chat: StoredChat): AgentChat {
  const failed = new Set<string>();
  const declined = new Set<string>();
  for (const m of chat.messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type !== "tool_result" || !block.is_error) continue;
      failed.add(block.tool_use_id);
      if (block.content === DECLINED) declined.add(block.tool_use_id);
    }
  }
  // Actions that are waiting for approval have not happened, so they are not listed as done.
  const paused = chat.awaiting?.length ? chat.messages.at(-1) : undefined;

  const messages: AgentMessage[] = [];
  for (const m of chat.messages) {
    if (m.role === "user") {
      // Only what the creator typed is a message; tool results travel in the same role but are not shown.
      if (typeof m.content === "string" && m.content) messages.push({ role: "user", text: m.content });
      continue;
    }
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const parts: AgentPart[] = [];
    let replies: string[] | undefined;
    for (const block of m.content) {
      if (block.type === "text" && block.text.trim()) {
        const offered = REPLIES_LINE.exec(block.text);
        if (offered) {
          replies = offered[1]
            .split("|")
            .map((r) => r.trim())
            .filter(Boolean)
            .slice(0, 3);
        }
        const shown = block.text.replace(REPLIES_LINE, "").trim();
        if (shown) parts.push({ type: "text", text: shown });
      }
      if (block.type === "tool_use" && m !== paused) {
        if (declined.has(block.id)) {
          const title = AGENT_TOOLS.find((t) => t.name === block.name)?.title ?? block.name;
          parts.push({ type: "step", label: title, ok: false, declined: true });
        } else {
          parts.push({ type: "step", label: stepLabel(block.name, (block.input ?? {}) as Input), ok: !failed.has(block.id) });
        }
      }
    }
    // One turn of the agent spans several requests; show it as one message.
    let last = messages.at(-1);
    if (last?.role !== "assistant") {
      last = { role: "assistant", parts: [] };
      messages.push(last);
    }
    last.parts.push(...parts);
    // Only buttons offered with the latest part of the turn still apply.
    last.replies = replies?.length ? replies : undefined;
  }

  // Add when each message was sent and how long the agent worked after it.
  let userIndex = -1;
  chat.messages.forEach((m, i) => {
    if (m.role !== "user" || typeof m.content !== "string") return;
    userIndex = messages.findIndex((v, n) => n > userIndex && v.role === "user");
    const turn = chat.turns?.[i];
    const sent = messages[userIndex];
    if (!turn || !sent || sent.role !== "user") return;
    sent.at = turn.at;
    const answer = messages[userIndex + 1];
    if (answer?.role === "assistant" && turn.ms > 0) answer.workedMs = turn.ms;
  });
  return {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    costUsd: chat.costUsd,
    messages,
    approvals: chat.awaiting?.length ? chat.awaiting : undefined,
  };
}

export const listAgentChats = (ctx: AgentContext): AgentChatSummary[] =>
  ctx
    .store()
    .listChats<StoredChat>()
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));

export function getAgentChat(ctx: AgentContext, id: string): AgentChat | null {
  const chat = ctx.store().getChat<StoredChat>(id);
  return chat ? toView(chat) : null;
}

export function deleteAgentChat(ctx: AgentContext, id: string): void {
  ctx.store().deleteChat(id);
  candidates.delete(id);
}

/** A message with its reference tags replaced by names, for the chat's title. */
async function withNames(ctx: AgentContext, said: string): Promise<string> {
  if (!said.includes("[[")) return said;
  const [posts, audio] = await Promise.all([listResearch(ctx.dataDir()), listAudio(ctx.dataDir())]);
  const ideas = ctx.store().listIdeas();
  const studio = studioOps(ctx);
  return said.replace(REFERENCE_PATTERN, (_tag, kind: string, id: string) => {
    if (kind === "brand") return "Brand kit";
    if (kind === "research") return "Research";
    if (kind === "ideas") return "Ideas";
    if (kind === "video") return studio.findVideo(id)?.title ?? "a video";
    if (kind === "series") return studio.series().find((x) => x.id === id)?.title ?? "a series";
    if (kind === "character") return studio.cast().find((x) => x.id === id)?.name ?? "a character";
    if (kind === "post") {
      const p = posts.find((x) => x.id === id);
      return p ? p.author || p.authorHandle || "a saved post" : "a saved post";
    }
    if (kind === "idea") return ideas.find((x) => x.id === id)?.title ?? "an idea";
    return audio.find((x) => x.id === id)?.title ?? "an audio file";
  });
}

/** Adds the user's message to a chat (creating it if new) and runs the agent until it has answered or needs an approval. */
export async function sendToAgent(ctx: AgentContext, chatId: string, userText: string): Promise<AgentReply> {
  const said = userText.trim();
  if (!/^[\w-]{8,64}$/.test(chatId)) return { ok: false, error: "That chat cannot be opened." };
  if (!said) return { ok: false, error: "Type a message first." };
  const apiKey = ctx.key("anthropic");
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  if (progress.has(chatId)) return { ok: false, error: "The agent is still working on your last message in this chat." };

  const now = new Date().toISOString();
  const existing = ctx.store().getChat<StoredChat>(chatId);
  if (existing?.awaiting?.length) {
    return { ok: false, error: "Allow or decline the action the agent is waiting on first.", chat: toView(existing) };
  }
  const chat: StoredChat = existing ?? {
    id: chatId,
    title: short((await withNames(ctx, said)).replace(/\s+/g, " "), 60),
    createdAt: now,
    updatedAt: now,
    costUsd: 0,
    messages: [],
  };
  chat.messages.push({ role: "user", content: said });
  (chat.turns ??= {})[chat.messages.length - 1] = { at: now, ms: 0 };
  return runAgent(ctx, chat, apiKey);
}

/**
 * Answers the approvals a chat is paused on and carries on. `decisions` maps
 * each approval's id to true (allow) or false; anything not answered counts
 * as declined.
 */
export async function decideAgent(ctx: AgentContext, chatId: string, decisions: unknown): Promise<AgentReply> {
  const chat = ctx.store().getChat<StoredChat>(chatId);
  if (!chat) return { ok: false, error: "That chat cannot be opened." };
  if (!chat.awaiting?.length) return { ok: false, error: "Nothing in this chat is waiting for approval.", chat: toView(chat) };
  const apiKey = ctx.key("anthropic");
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first.", chat: toView(chat) };
  if (progress.has(chatId)) return { ok: false, error: "The agent is already working in this chat." };
  const answers = (decisions && typeof decisions === "object" ? decisions : {}) as Record<string, unknown>;
  return runAgent(ctx, chat, apiKey, (id) => answers[id] === true);
}

/**
 * Runs the agent on a chat until it has answered, needs an approval, or
 * fails. With `allowed`, the chat was paused on approvals: the actions it was
 * waiting to run are run (or refused) first.
 */
async function runAgent(ctx: AgentContext, chat: StoredChat, apiKey: string, allowed?: (approvalId: string) => boolean): Promise<AgentReply> {
  const chatId = chat.id;
  // Time is counted against the user's latest message; waiting for an approval is not counted.
  const turnKey = Math.max(-1, ...Object.keys(chat.turns ?? {}).map(Number));
  const turn = chat.turns?.[turnKey] ?? { at: new Date().toISOString(), ms: 0 };
  const before = turn.ms;
  const started = Date.now();
  const save = () => {
    turn.ms = before + (Date.now() - started);
    chat.updatedAt = new Date().toISOString();
    ctx.store().saveChat(chat.id, chat.updatedAt, chat);
  };
  const say = (status: string) => progress.set(chatId, status);

  /** Runs the requested tools (refusing the ones in `refused`) and answers them all in one message. */
  const runCalls = async (calls: Anthropic.Beta.BetaToolUseBlock[], refused: (id: string) => boolean) => {
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        if (refused(call.id)) return { type: "tool_result", tool_use_id: call.id, is_error: true, content: DECLINED };
        const input = (call.input ?? {}) as Input;
        say(RUNNING[call.name] ?? "Working");
        try {
          const { result, costUsd } = await runTool(ctx, chatId, call.name, input, say);
          chat.costUsd += costUsd ?? 0;
          return { type: "tool_result", tool_use_id: call.id, content: typeof result === "string" ? result : JSON.stringify(result) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message : "The action failed." };
        }
      }),
    );
    chat.messages.push({ role: "user", content: results });
    save();
  };

  say("Thinking");
  try {
    if (allowed) {
      const last = chat.messages.at(-1);
      const calls =
        last?.role === "assistant" && typeof last.content !== "string"
          ? last.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
          : [];
      const asked = new Set((chat.awaiting ?? []).map((a) => a.id));
      chat.awaiting = undefined;
      await runCalls(calls, (id) => asked.has(id) && !allowed(id));
      say("Thinking");
    } else {
      save();
    }
    const client = new Anthropic({ apiKey });

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "medium" },
        // If the model declines for policy reasons, let the API retry on its default fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // The instructions, tools and earlier turns are reused from cache on each step.
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools: TOOLS,
        messages: chat.messages,
      });
      chat.costUsd += estimateCostUsd(response.usage);
      recordClaude("agent", response.usage, chat.title);

      if (response.stop_reason === "refusal") {
        save();
        return { ok: false, error: "Claude declined this request. Try asking in a different way.", chat: toView(chat) };
      }

      // The reply goes back unchanged on the next request, thinking included.
      chat.messages.push({ role: "assistant", content: response.content });
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

      if (response.stop_reason === "max_tokens") {
        // A tool call cut off mid-way must not run; answer each so the chat stays usable.
        if (calls.length) {
          chat.messages.push({
            role: "user",
            content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: "Not run: the reply was cut off." })),
          });
        }
        save();
        return { ok: false, error: "The reply was too long and got cut off. Ask for a smaller piece at a time.", chat: toView(chat) };
      }
      if (response.stop_reason === "pause_turn") {
        save();
        continue;
      }
      if (calls.length === 0) {
        save();
        return { ok: true, chat: toView(chat) };
      }

      // Anything the user wants to be asked about stops the chat here, before
      // any action of this step runs. It carries on in decideAgent.
      const permissions = getAgentPermissions(ctx);
      const needApproval = calls.filter((c) => permissions[c.name] === "ask");
      if (needApproval.length) {
        chat.awaiting = await Promise.all(needApproval.map((c) => describeCall(ctx, c.id, c.name, (c.input ?? {}) as Input)));
        save();
        return { ok: true, chat: toView(chat) };
      }

      await runCalls(calls, () => false);
      say("Thinking");
    }
    save();
    return { ok: false, error: "The agent took too many steps and stopped. Ask it to continue.", chat: toView(chat) };
  } catch (e) {
    save();
    return { ok: false, error: describeClaudeError(e), chat: toView(chat) };
  } finally {
    progress.delete(chatId);
  }
}
