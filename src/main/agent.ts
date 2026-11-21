// The in-app agent: a chat with Claude that can use the app's own actions as tools.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// The loop runs here, on the user's computer, because every tool reads or
// changes local data. Each chat is stored whole (the exact messages sent to
// Claude) so a conversation can be continued later.
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentChat, AgentChatSummary, AgentMessage, AgentPart, AgentProgress, AgentReply } from "../shared/agent";
import { estimateCostUsd } from "../shared/analysis";
import { parseIdea, type Idea, type IdeaDraft } from "../shared/ideas";
import type { ResearchItem } from "../shared/research";
import { describeClaudeError } from "./analyze";
import { generateIdeas } from "./generate";
import { addResearch, analyzeResearch, deleteResearch, listResearch, updateResearch } from "./research";
import { writeScript } from "./script";
import type { Store } from "./store";

type Message = Anthropic.Beta.BetaMessageParam;
type Tool = Anthropic.Beta.BetaTool;

/** What the agent needs from the rest of the app. */
export type AgentContext = {
  dataDir: () => string;
  store: () => Store;
  key: (provider: "anthropic" | "deepgram" | "telegram") => string;
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
};

/**
 * The agent ends an answer with a line like "Replies: Save all three | Do nothing".
 * (A tool was tried for this first, but text written in the same reply as a
 * tool call does not come back as text, so the answer itself went missing.)
 */
const REPLIES_LINE = /\n*^[ \t]*Replies:[ \t]*(.+)$\s*$/im;

const MAX_STEPS = 30;
const ANALYSE_AT_ONCE = 3;

const SYSTEM = `You are the assistant built into a desktop app that one creator uses to build a personal brand with short videos (Reels, Shorts, TikTok). You work inside the app: your tools read and change the creator's real data.

What the app holds:
- Brand: the creator's name, topics, audience, content pillars, voice and platforms.
- Research: posts by other creators that this creator saved because they liked them and they performed well. Each can be analysed once by Claude (hook, structure, why it works); the analysis is saved and reused.
- Ideas: video ideas the creator kept, each optionally with a timed shooting script.

How to work:
- Look before you answer. Read the brand and the relevant posts or ideas with your tools instead of guessing; never invent posts, numbers or ideas that are not in the data.
- Do what was asked, then say what you did and what you found. Lead with the answer.
- This conversation itself uses a little of the creator's Claude credit, so never say that nothing was charged. Some tools spend more. Rough costs: analysing a post about $0.05, a round of generated ideas about $0.25, a script about $0.06. Go ahead when the creator asked for that action and the total is under about $0.50. Above that, say what it would cost and ask first.
- Deleting cannot be undone. Only delete when the creator has, in this conversation, clearly asked you to delete that specific item; if you are proposing it yourself, ask first and wait.
- generate_ideas returns candidates that are NOT saved. Show them, and save only the ones the creator picks (save_generated_ideas), unless they already told you to save.
- You can also write ideas yourself with create_idea when the creator wants something specific; base them on what the analysed posts show works.
- Where the topic is health: keep claims accurate and proportionate, never promise cures or diagnose, and do not present the creator as a medical professional unless their brand says they are one.
- If something cannot be done with your tools (editing the brand, changing settings or API keys, posting to social media, editing video), say so plainly and say where in the app it is done, if it can be.

Referring to posts and ideas: whenever you mention a specific saved post or saved idea, put a reference tag where its name would go: [[post:<id>]] for a post, [[idea:<id>]] for a saved idea, using the id from your tools. The app replaces the tag with a chip showing the creator's name or the idea's title, which opens it when clicked. So write "[[post:abc]] opens with a question", not "Pranav Mohan's post [[post:abc]] opens…", and never show a bare id. Candidates from generate_ideas are not saved and have no tag; name them by title.

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
      "Have Claude analyse saved posts (frames, transcript, caption) and store the result. Costs about $0.05 per post. Posts already analysed are skipped unless reanalyse is true. Pass ids, or all_unanalysed to do every post that has no analysis yet.",
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
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, creator_asked_to_delete: { type: "boolean" } },
      required: ["id", "creator_asked_to_delete"],
    },
  },
  {
    name: "list_ideas",
    description: "List the creator's saved video ideas: title, opening line, series, pillar, platform, score and whether a script exists.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_idea",
    description: "Read one saved idea in full, including its outline, caption, the reason for its score and its script if it has one.",
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
        platform: { type: "string", description: "Exact name of one of the brand's platforms, or omit for any." },
        series: { type: "string", description: "Exact name of an existing series to write more episodes of, or omit." },
        notes: { type: "string", description: "Any extra direction from the creator." },
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
    name: "write_script",
    description:
      "Write and save a timed shooting script for a saved idea: three opening lines, second-by-second beats, sound and caption. Costs about $0.06. Replaces the idea's existing script if it has one.",
    input_schema: { type: "object", properties: { idea_id: { type: "string" } }, required: ["idea_id"] },
  },
  {
    name: "delete_idea",
    description: "Permanently delete a saved idea and its script. Only after the creator clearly asked for this idea to be deleted.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, creator_asked_to_delete: { type: "boolean" } },
      required: ["id", "creator_asked_to_delete"],
    },
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
    saved_on: p.savedAt.slice(0, 10),
    caption_start: short(p.caption, 140),
    has_transcript: p.transcript !== "",
    analysed: Boolean(p.analysis),
    ...(p.analysis && {
      format: p.analysis.format,
      hook_type: p.analysis.hookType,
      topic: p.analysis.topic,
      seconds: p.analysis.durationSeconds ? Math.round(p.analysis.durationSeconds) : undefined,
    }),
  };
}

function ideaSummary(i: Idea) {
  return {
    id: i.id,
    title: i.title,
    hook: i.hook,
    series: i.series || undefined,
    pillar: i.pillar || undefined,
    platform: i.platform || undefined,
    score: i.score,
    modelled_on: i.modelledOnLabel || undefined,
    has_script: Boolean(i.script),
    saved_on: i.createdAt.slice(0, 10),
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
      if (input.creator_asked_to_delete !== true) throw new Error("Not deleted. Ask the creator to confirm first.");
      const p = await findPost(input.id);
      await deleteResearch(dataDir, p.id);
      return { result: `Deleted the post by ${p.author || p.authorHandle}.` };
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
          platform: text(input.platform),
          series: text(input.series),
          notes: text(input.notes),
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

    case "write_script": {
      const brand = store.getBrand();
      if (!brand) throw new Error("The creator has not set up a brand yet.");
      const idea = findIdea(input.idea_id);
      say(`Writing the script for “${short(idea.title, 40)}”`);
      const model = idea.modelledOnId ? (await listResearch(dataDir)).find((p) => p.id === idea.modelledOnId && p.analysis) : undefined;
      const outcome = await writeScript(ctx.key("anthropic"), brand, idea, model);
      if (!outcome.ok) throw new Error(outcome.error);
      store.saveIdea(parseIdea({ ...idea, script: outcome.script }));
      return { result: { idea: idea.title, script: outcome.script }, costUsd: outcome.script.costUsd };
    }

    case "delete_idea": {
      if (input.creator_asked_to_delete !== true) throw new Error("Not deleted. Ask the creator to confirm first.");
      const idea = findIdea(input.id);
      store.deleteIdea(idea.id);
      return { result: `Deleted the idea “${idea.title}”.` };
    }

    case "get_app_status":
      return {
        result: {
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
    case "write_script":
      return "Wrote a script";
    case "delete_idea":
      return "Deleted an idea";
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
  write_script: "Writing a script",
  delete_idea: "Deleting an idea",
  get_app_status: "Checking the app's connections",
};

// ---------- Chats ----------

/** Turns the stored messages into what the chat screen shows. */
function toView(chat: StoredChat): AgentChat {
  const failed = new Set<string>();
  for (const m of chat.messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const block of m.content) if (block.type === "tool_result" && block.is_error) failed.add(block.tool_use_id);
  }

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
      if (block.type === "tool_use") {
        parts.push({ type: "step", label: stepLabel(block.name, (block.input ?? {}) as Input), ok: !failed.has(block.id) });
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
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, costUsd: chat.costUsd, messages };
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

/** Adds the user's message to a chat (creating it if new) and runs the agent until it has answered. */
export async function sendToAgent(ctx: AgentContext, chatId: string, userText: string): Promise<AgentReply> {
  const said = userText.trim();
  if (!/^[\w-]{8,64}$/.test(chatId)) return { ok: false, error: "That chat cannot be opened." };
  if (!said) return { ok: false, error: "Type a message first." };
  const apiKey = ctx.key("anthropic");
  if (!apiKey) return { ok: false, error: "Add your Claude API key in Settings first." };
  if (progress.has(chatId)) return { ok: false, error: "The agent is still working on your last message in this chat." };

  const now = new Date().toISOString();
  const chat: StoredChat = ctx.store().getChat<StoredChat>(chatId) ?? {
    id: chatId,
    title: short(said.replace(/\s+/g, " "), 60),
    createdAt: now,
    updatedAt: now,
    costUsd: 0,
    messages: [],
  };
  chat.messages.push({ role: "user", content: said });
  const started = Date.now();
  const turn = { at: now, ms: 0 };
  (chat.turns ??= {})[chat.messages.length - 1] = turn;
  const save = () => {
    turn.ms = Date.now() - started;
    chat.updatedAt = new Date().toISOString();
    ctx.store().saveChat(chat.id, chat.updatedAt, chat);
  };
  const say = (status: string) => progress.set(chatId, status);

  say("Thinking");
  save();
  const client = new Anthropic({ apiKey });

  try {
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

      // Run every requested tool and answer them all in one message.
      const results = await Promise.all(
        calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
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
