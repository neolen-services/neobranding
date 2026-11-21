import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { REFERENCE_PATTERN, type AgentMessage } from "@shared/agent";
import { formatUsd } from "@shared/analysis";
import type { AgentChatState, AgentRefs } from "./agentChat";

const EXAMPLES: [string, string][] = [
  ["Analyse my research", "Analyse the saved posts that are not analysed yet and tell me what they have in common."],
  ["Find what works", "Look at my analysed posts. Which hooks and formats show up most, and which should I copy first?"],
  ["Create ideas", "Give me 5 new video ideas based on my research, and tell me which one you would film first."],
];

/** Where a reference chip leads when clicked. */
export type OpenReference = (kind: "post" | "idea", id: string) => void;

const RefContext = createContext<{ refs: AgentRefs; open: OpenReference }>({
  refs: { posts: new Map(), ideas: new Map() },
  open: () => undefined,
});

const refName = (refs: AgentRefs, kind: string, id: string) =>
  kind === "post"
    ? (() => {
        const p = refs.posts.get(id);
        return p ? p.author || p.authorHandle || "Saved post" : "a post that is no longer saved";
      })()
    : (refs.ideas.get(id)?.title ?? "an idea that is no longer saved");

/** The agent's text with reference tags replaced by names, for copying. */
const plainText = (text: string, refs: AgentRefs) =>
  text.replace(REFERENCE_PATTERN, (_tag, kind: string, id: string) => refName(refs, kind, id));

function timeLabel(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${at.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

function workedLabel(ms: number): string {
  const seconds = Math.max(Math.round(ms / 1000), 1);
  if (seconds < 60) return `Worked for ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.round(seconds / 60);
  return `Worked for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * The agent chat. `variant` is "page" for the full Agent screen and "dock"
 * for the small floating window; `actions` are the window buttons shown at
 * the right of the title bar.
 */
export function AgentChatPanel({
  chat,
  variant,
  actions,
  onOpenReference,
  onOpenSettings,
}: {
  chat: AgentChatState;
  variant: "page" | "dock";
  actions?: ReactNode;
  onOpenReference: OpenReference;
  onOpenSettings: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const { messages, running, status, error } = chat;
  const dock = variant === "dock";
  const width = dock ? "" : "mx-auto max-w-3xl";

  const toBottom = (smooth = false) =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });

  // Follow the conversation while the reader is at the bottom; leave them alone if they scrolled up.
  useEffect(() => {
    if (atBottom) toBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, running, status, error]);
  useEffect(() => {
    toBottom();
    setAtBottom(true);
  }, [chat.chatId]);

  const send = (text: string) => {
    if (!text.trim() || running) return;
    setDraft("");
    setAtBottom(true);
    void chat.send(text);
  };

  const empty = messages.length === 0;
  const lastIndex = messages.length - 1;

  const titleBar = (
    <div className={`flex shrink-0 items-center gap-2 border-b border-[var(--line)] ${dock ? "px-3 py-2" : "px-6 py-2.5"}`}>
      <select
        aria-label="Chat"
        title="Switch chat"
        className="min-w-0 max-w-[55%] truncate rounded-lg bg-transparent py-1 pr-1 text-sm font-semibold hover:bg-[var(--tint)] focus:outline-none disabled:opacity-60"
        value={chat.saved ? chat.chatId : ""}
        onChange={(e) => void chat.openChat(e.target.value)}
      >
        <option value="">New chat</option>
        {chat.chats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      {!empty && (
        <IconButton label="New chat" onClick={chat.newChat}>
          <path d="M12 5v14M5 12h14" />
        </IconButton>
      )}
      {chat.saved && (
        <IconButton label="Delete this chat" disabled={running} danger onClick={() => void chat.deleteChat()}>
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </IconButton>
      )}
      <span className="ml-auto shrink-0 text-xs opacity-50">{!dock && chat.costUsd > 0 && `This chat: about ${formatUsd(chat.costUsd)}`}</span>
      {actions}
    </div>
  );

  if (chat.hasKey === false) {
    return (
      <div className="flex h-full flex-col text-[var(--ink)]">
        {titleBar}
        <div className={`p-6 ${width}`}>
          <h2 className="font-display text-xl font-semibold">Connect Claude first</h2>
          <p className="mt-2 text-sm leading-relaxed opacity-75">
            The agent is Anthropic's Claude, using your own API key. Add your key in Settings to start.
          </p>
          <button
            type="button"
            className="mt-4 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            onClick={onOpenSettings}
          >
            Open settings
          </button>
        </div>
      </div>
    );
  }

  const composer = (
    <Composer
      draft={draft}
      onChange={setDraft}
      onSend={() => send(draft)}
      running={running}
      compact={dock}
      placeholder={empty ? "Ask anything, or tell the agent what you need" : "Something else…"}
    />
  );

  return (
    <RefContext.Provider value={{ refs: chat.refs, open: onOpenReference }}>
      <div className="flex h-full flex-col text-[var(--ink)]">
        {titleBar}

        {empty ? (
          <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${dock ? "p-3" : "justify-center px-6 py-8"}`}>
            <div className={`flex w-full flex-1 flex-col ${dock ? "" : "max-h-[28rem]"} ${width}`}>
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden className="opacity-70">
                  <path d="M5 4l14 8-6 2-2 6z" />
                </svg>
                <h2 className="mt-3 font-display text-lg font-semibold">Your brand agent</h2>
                <p className="mt-1 text-sm opacity-60">Ask anything or tell it what you need</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map(([title, prompt]) => (
                    <button
                      key={title}
                      type="button"
                      title={prompt}
                      className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 py-1.5 text-sm font-medium hover:border-[var(--primary)]"
                      onClick={() => send(prompt)}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-5">{composer}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <div
                ref={scroller}
                className={`h-full overflow-y-auto ${dock ? "px-3 py-4" : "px-6 py-6"}`}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
                }}
              >
                <div className={`space-y-5 ${width}`}>
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i}>
                        {m.at && <p className="mb-3 text-center text-xs opacity-45">{timeLabel(m.at)}</p>}
                        <div className="flex justify-end">
                          <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[var(--tint)] px-4 py-2.5">{m.text}</p>
                        </div>
                      </div>
                    ) : (
                      <Answer
                        key={i}
                        message={m}
                        // Buttons only make sense on the latest answer, once it is finished.
                        onReply={i === lastIndex && !running ? send : undefined}
                      />
                    ),
                  )}
                  {running && (
                    <p className="flex items-center gap-2 text-sm opacity-60">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                      {status || "Thinking"}…
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="text-sm font-medium text-red-400">
                      {error}
                    </p>
                  )}
                </div>
              </div>
              {!atBottom && (
                <button
                  type="button"
                  className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-sm font-medium shadow-lg hover:border-[var(--primary)]"
                  onClick={() => {
                    toBottom(true);
                    setAtBottom(true);
                  }}
                >
                  <span aria-hidden>↓</span> Latest
                </button>
              )}
            </div>
            <div className={`shrink-0 ${dock ? "p-3 pt-1" : "px-6 pb-5"}`}>
              <div className={width}>{composer}</div>
            </div>
          </>
        )}
      </div>
    </RefContext.Provider>
  );
}

/** One answer from the agent: what it did (folded away), what it said, and any reply buttons. */
function Answer({ message, onReply }: { message: Extract<AgentMessage, { role: "assistant" }>; onReply?: (text: string) => void }) {
  const { refs } = useContext(RefContext);
  const [showSteps, setShowSteps] = useState(false);
  const [copied, setCopied] = useState(false);
  const steps = message.parts.filter((p) => p.type === "step");
  const texts = message.parts.filter((p) => p.type === "text");
  const failed = steps.filter((s) => !s.ok).length;
  if (steps.length === 0 && texts.length === 0) return null;

  const summary = message.workedMs
    ? workedLabel(message.workedMs)
    : steps.length > 0
      ? `${steps.length} ${steps.length === 1 ? "step" : "steps"}`
      : "";

  const copy = async () => {
    await navigator.clipboard.writeText(texts.map((t) => plainText(t.text, refs)).join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3">
      {summary &&
        (steps.length > 0 ? (
          <div>
            <button
              type="button"
              aria-expanded={showSteps}
              className="flex items-center gap-2 text-sm opacity-55 hover:opacity-100"
              onClick={() => setShowSteps(!showSteps)}
            >
              {summary}
              {failed > 0 && <span className="text-red-400">· {failed} did not work</span>}
              <span aria-hidden className={`text-[0.6rem] transition-transform ${showSteps ? "rotate-90" : ""}`}>
                ▶
              </span>
            </button>
            {showSteps && (
              <ul className="mt-2 space-y-1 border-l border-[var(--line)] pl-3 text-sm">
                {steps.map((s, i) => (
                  <li key={i} className={s.ok ? "opacity-60" : "text-red-400"}>
                    {s.label}
                    {!s.ok && " (did not work)"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm opacity-55">{summary}</p>
        ))}

      {texts.map((t, i) => (
        <Markdown key={i} text={t.text} />
      ))}

      {onReply && message.replies && message.replies.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {message.replies.map((reply) => (
            <button
              key={reply}
              type="button"
              className="rounded-full bg-[var(--tint)] px-3.5 py-1.5 text-sm font-medium hover:bg-[var(--line)]"
              onClick={() => onReply(reply)}
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {texts.length > 0 && (
        <IconButton label={copied ? "Copied" : "Copy answer"} onClick={copy}>
          {copied ? <path d="M5 12l5 5 9-10" /> : <path d="M9 9h10v11H9zM5 15V4h10" />}
        </IconButton>
      )}
    </div>
  );
}

function Composer({
  draft,
  onChange,
  onSend,
  running,
  compact,
  placeholder,
}: {
  draft: string;
  onChange: (text: string) => void;
  onSend: () => void;
  running: boolean;
  compact: boolean;
  placeholder: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter starts a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <form
      className="flex items-end gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 focus-within:border-[var(--primary)]"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSend();
      }}
    >
      <textarea
        rows={compact ? 2 : 3}
        autoFocus
        aria-label="Message to the agent"
        className="max-h-48 flex-1 resize-none bg-transparent px-1 text-sm placeholder:opacity-50 focus:outline-none"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="submit"
        aria-label="Send"
        title="Send"
        disabled={running || !draft.trim()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </form>
  );
}

/** A small square button holding one line icon. */
export function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-60 hover:bg-[var(--tint)] hover:opacity-100 disabled:opacity-25 ${
        danger ? "hover:text-red-400" : ""
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** A saved post or idea named in the agent's text; opens it when clicked. */
function Chip({ kind, id }: { kind: "post" | "idea"; id: string }) {
  const { refs, open } = useContext(RefContext);
  const exists = kind === "post" ? refs.posts.has(id) : refs.ideas.has(id);
  const name = refName(refs, kind, id);
  if (!exists) return <span className="opacity-60">{name}</span>;
  const post = kind === "post" ? refs.posts.get(id) : undefined;
  return (
    <button
      type="button"
      title={kind === "post" ? `Open this post in Research${post?.analysis ? `: ${post.analysis.topic}` : ""}` : "Open this idea"}
      onClick={() => open(kind, id)}
      className="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 align-baseline text-[0.95em] font-medium leading-snug hover:border-[var(--primary)]"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 opacity-60">
        {kind === "post" ? <path d="M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4zM17 10l4-2.5v9L17 14" /> : <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.800 1-2.5A6 6 0 0 0 12 3z" />}
      </svg>
      <span className="truncate">{name}</span>
    </button>
  );
}

/** Bold, inline code and reference chips inside one stretch of text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[(?:post|idea):[\w-]+\]\])/g).map((piece, i) => {
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={i}>{inline(piece.slice(2, -2))}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-[var(--tint)] px-1 text-[0.9em]">
          {piece.slice(1, -1)}
        </code>
      );
    }
    const ref = /^\[\[(post|idea):([\w-]+)\]\]$/.exec(piece);
    if (ref) return <Chip key={i} kind={ref[1] as "post" | "idea"} id={ref[2]} />;
    return piece;
  });
}

/** The small part of Markdown the agent writes: paragraphs, headings, and bulleted or numbered lists. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: { ordered: boolean; lines: string[] } | null = null;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push(
        <p key={blocks.length} className="whitespace-pre-wrap leading-relaxed">
          {inline(paragraph.join("\n"))}
        </p>,
      );
      paragraph = [];
    }
    if (items) {
      const List = items.ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={`space-y-2 pl-5 leading-relaxed ${items.ordered ? "list-decimal" : "list-disc"}`}>
          {items.lines.map((line, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {inline(line)}
            </li>
          ))}
        </List>,
      );
      items = null;
    }
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length || (items && items.ordered !== ordered)) flush();
      items ??= { ordered, lines: [] };
      items.lines.push((bullet ?? numbered)![1]);
    } else if (items && /^\s{2,}\S/.test(raw)) {
      // An indented line continues the item above it.
      items.lines[items.lines.length - 1] += `\n${line.trim()}`;
    } else if (heading) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="font-display text-base font-semibold">
          {inline(heading[1])}
        </h3>,
      );
    } else if (!line.trim()) {
      // A blank line ends a paragraph, but a list may carry on after it ("1. … ⏎ ⏎ 2. …").
      if (!items) flush();
    } else {
      if (items) flush();
      paragraph.push(line);
    }
  }
  flush();
  return <div className="space-y-3">{blocks}</div>;
}
