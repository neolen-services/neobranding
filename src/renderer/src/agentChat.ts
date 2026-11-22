import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentApproval, AgentChat, AgentChatSummary, AgentMessage, AgentReply } from "@shared/agent";
import type { GeneratedAudio } from "@shared/audio";
import type { Idea } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import type { Character, Series, Video } from "@shared/studio";
import { api } from "./api";

/** What a reference tag in the agent's text points at. */
export type AgentRefs = {
  posts: Map<string, ResearchItem>;
  ideas: Map<string, Idea>;
  audio: Map<string, GeneratedAudio>;
  videos: Map<string, Video>;
  series: Map<string, Series>;
  characters: Map<string, Character>;
};
export const NO_REFS: AgentRefs = { posts: new Map(), ideas: new Map(), audio: new Map(), videos: new Map(), series: new Map(), characters: new Map() };

/** A chat kept open as a tab in the top bar. */
export type AgentTab = { id: string; title: string; running: boolean; /** It has an answer you have not looked at. */ unread: boolean };

const shortTitle = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

/**
 * The agent chats' state. It lives at the top of the app, so chats carry on
 * when you change screen or move between the page and the floating window.
 * Several chats can be open, and each can be working at the same time; one
 * of them is the chat being looked at.
 */
export function useAgentChat() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [chats, setChats] = useState<AgentChatSummary[]>([]);
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [costUsd, setCostUsd] = useState(0);
  /** Actions the chat being looked at is waiting for a yes or no on. */
  const [approvals, setApprovals] = useState<AgentApproval[]>([]);
  /** Goes up each time the agent finishes working, since it may have changed the app's data. */
  const [revision, setRevision] = useState(0);
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState("");
  /** Why each chat's last message failed, if it did. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Chats shown as tabs, oldest first, with the title each had when it was opened. */
  const [open, setOpen] = useState<{ id: string; title: string }[]>([]);
  /** Chats that finished answering while another chat was on screen. */
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const [refs, setRefs] = useState<AgentRefs>(NO_REFS);
  const current = useRef(chatId);
  current.current = chatId;

  const running = runningIds.has(chatId);

  const refreshChats = useCallback(() => api.listAgentChats().then(setChats).catch(() => undefined), []);
  /** Re-reads posts and ideas so reference chips can show their names, including ones the agent just made. */
  const refreshRefs = useCallback(async () => {
    const [posts, ideas, audio, videos, series, characters] = await Promise.all([
      api.listResearch().catch(() => []),
      api.listIdeas().catch(() => []),
      api.listAudio().catch(() => []),
      api.listVideos().catch(() => []),
      api.listSeries().catch(() => []),
      api.listCast().catch(() => []),
    ]);
    setRefs({
      posts: new Map(posts.map((p) => [p.id, p])),
      ideas: new Map(ideas.map((i) => [i.id, i])),
      audio: new Map(audio.map((a) => [a.id, a])),
      videos: new Map(videos.map((v) => [v.id, v])),
      series: new Map(series.map((s) => [s.id, s])),
      characters: new Map(characters.map((c) => [c.id, c])),
    });
  }, []);
  const checkKey = useCallback(() => api.hasApiKey("anthropic").then(setHasKey), []);

  useEffect(() => {
    void checkKey();
    void refreshChats();
    void refreshRefs();
  }, [checkKey, refreshChats, refreshRefs]);

  // While the chat being looked at is working, ask what it is doing once a second.
  useEffect(() => {
    if (!running) return;
    setStatus("Thinking");
    const timer = setInterval(async () => {
      const p = await api.agentProgress(chatId).catch(() => null);
      if (p?.running && current.current === chatId) setStatus(p.status);
    }, 1000);
    return () => clearInterval(timer);
  }, [running, chatId]);

  const show = (chat: AgentChat) => {
    setMessages(chat.messages);
    setCostUsd(chat.costUsd);
    setApprovals(chat.approvals ?? []);
  };
  const addTab = (id: string, title: string) => setOpen((list) => (list.some((t) => t.id === id) ? list : [...list, { id, title }]));

  function newChat() {
    setChatId(crypto.randomUUID());
    setMessages([]);
    setCostUsd(0);
    setApprovals([]);
  }

  /** Looks at another chat. One that is still working keeps working and shows how far it has got. */
  async function openChat(id: string) {
    if (!id) return newChat();
    if (id === current.current) return;
    setChatId(id);
    current.current = id;
    setUnread((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
    setMessages([]);
    setCostUsd(0);
    setApprovals([]);
    const chat = await api.getAgentChat(id);
    if (current.current !== id) return;
    if (chat) {
      show(chat);
      addTab(id, chat.title);
    }
    void refreshRefs();
  }

  /** Marks a chat as working while `work` runs, then shows what came back. */
  async function run(id: string, work: () => Promise<AgentReply>) {
    setErrors(({ [id]: _cleared, ...rest }) => rest);
    setRunningIds((ids) => new Set(ids).add(id));
    try {
      const reply = await work();
      if (!reply.ok) setErrors((all) => ({ ...all, [id]: reply.error }));
      // If another chat is on screen now, this one's answer is read when it is opened again.
      if (current.current === id && reply.chat) show(reply.chat);
      else if (current.current !== id) setUnread((ids) => new Set(ids).add(id));
    } catch (e) {
      setErrors((all) => ({ ...all, [id]: e instanceof Error ? e.message : "The agent could not be reached." }));
    } finally {
      setRunningIds((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
      void refreshChats();
      void refreshRefs();
      setRevision((n) => n + 1);
    }
  }

  /**
   * Sends a message. `text` may hold reference tags ([[post:<id>]]…); `plain`
   * is the same message with names in their place, used for the tab's title.
   */
  async function send(text: string, plain = text) {
    const said = text.trim();
    const id = chatId;
    if (!said || runningIds.has(id) || approvals.length > 0) return;
    setMessages((list) => [...list, { role: "user", text: said, at: new Date().toISOString() }]);
    addTab(id, shortTitle(plain));
    await run(id, () => api.sendToAgent(id, said));
  }

  /** Allows or declines the actions the chat is waiting on (approval id to true or false), then lets the agent carry on. */
  async function decide(decisions: Record<string, boolean>) {
    const id = chatId;
    if (runningIds.has(id) || approvals.length === 0) return;
    setApprovals([]);
    await run(id, () => api.decideAgent(id, decisions));
  }

  /** Takes a chat off the top bar. It stays in the history. */
  function closeTab(id: string) {
    setOpen((list) => list.filter((t) => t.id !== id));
    if (id === chatId) newChat();
  }

  async function deleteChat(id = chatId) {
    if (runningIds.has(id)) return;
    await api.deleteAgentChat(id);
    await refreshChats();
    setOpen((list) => list.filter((t) => t.id !== id));
    if (id === chatId) newChat();
  }

  const titleOf = (id: string, fallback = "") => chats.find((c) => c.id === id)?.title ?? fallback;
  const tabs: AgentTab[] = open.map((t) => ({ id: t.id, title: titleOf(t.id, t.title), running: runningIds.has(t.id), unread: unread.has(t.id) }));

  return {
    hasKey,
    checkKey,
    chats,
    tabs,
    /** Ids of chats that are working, and of chats with an answer not yet looked at. */
    runningIds,
    unread,
    chatId,
    /** Whether the chat being looked at exists in the history yet. */
    saved: chats.some((c) => c.id === chatId),
    title: titleOf(chatId, open.find((t) => t.id === chatId)?.title ?? ""),
    messages,
    costUsd,
    running,
    status,
    error: errors[chatId] ?? "",
    refs,
    approvals,
    revision,
    send,
    decide,
    newChat,
    openChat,
    closeTab,
    deleteChat,
  };
}

export type AgentChatState = ReturnType<typeof useAgentChat>;
