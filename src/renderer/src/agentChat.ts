import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentChat, AgentChatSummary, AgentMessage } from "@shared/agent";
import type { Idea } from "@shared/ideas";
import type { ResearchItem } from "@shared/research";
import { api } from "./api";

/** What a reference tag in the agent's text points at. */
export type AgentRefs = { posts: Map<string, ResearchItem>; ideas: Map<string, Idea> };

/** A chat kept open as a tab in the footer. */
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
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState("");
  /** Why each chat's last message failed, if it did. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Chats shown as tabs, oldest first, with the title each had when it was opened. */
  const [open, setOpen] = useState<{ id: string; title: string }[]>([]);
  /** Chats that finished answering while another chat was on screen. */
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const [refs, setRefs] = useState<AgentRefs>({ posts: new Map(), ideas: new Map() });
  const current = useRef(chatId);
  current.current = chatId;

  const running = runningIds.has(chatId);

  const refreshChats = useCallback(() => api.listAgentChats().then(setChats).catch(() => undefined), []);
  /** Re-reads posts and ideas so reference chips can show their names, including ones the agent just made. */
  const refreshRefs = useCallback(async () => {
    const [posts, ideas] = await Promise.all([api.listResearch().catch(() => []), api.listIdeas().catch(() => [])]);
    setRefs({ posts: new Map(posts.map((p) => [p.id, p])), ideas: new Map(ideas.map((i) => [i.id, i])) });
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
  };
  const addTab = (id: string, title: string) => setOpen((list) => (list.some((t) => t.id === id) ? list : [...list, { id, title }]));

  function newChat() {
    setChatId(crypto.randomUUID());
    setMessages([]);
    setCostUsd(0);
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
    const chat = await api.getAgentChat(id);
    if (current.current !== id) return;
    if (chat) {
      show(chat);
      addTab(id, chat.title);
    }
    void refreshRefs();
  }

  async function send(text: string) {
    const said = text.trim();
    const id = chatId;
    if (!said || runningIds.has(id)) return;
    setErrors(({ [id]: _cleared, ...rest }) => rest);
    setMessages((list) => [...list, { role: "user", text: said, at: new Date().toISOString() }]);
    addTab(id, shortTitle(said));
    setRunningIds((ids) => new Set(ids).add(id));
    try {
      const reply = await api.sendToAgent(id, said);
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
    }
  }

  /** Takes a chat off the footer. It stays in the history. */
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
    send,
    newChat,
    openChat,
    closeTab,
    deleteChat,
  };
}

export type AgentChatState = ReturnType<typeof useAgentChat>;
