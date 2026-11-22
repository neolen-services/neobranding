import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { REFERENCE_PATTERN, type AgentApproval, type AgentMessage, type ReferenceKind } from "@shared/agent";
import { formatUsd } from "@shared/analysis";
import { AUDIO_KIND_LABELS } from "@shared/audio";
import { NO_REFS, type AgentChatState, type AgentRefs } from "./agentChat";
import { api } from "./api";

const EXAMPLES: [string, string][] = [
  ["Analyse my research", "Analyse the saved posts that are not analysed yet and tell me what they have in common."],
  ["Find what works", "Look at my analysed posts. Which hooks and formats show up most, and which should I copy first?"],
  ["Create ideas", "Give me 5 new video ideas based on my research, and tell me which one you would film first."],
];

/** Where a reference chip leads when clicked. */
export type OpenReference = (kind: Exclude<ReferenceKind, "audio">, id: string) => void;

/** Something that can be pointed at. */
export type ReferenceTarget = { kind: ReferenceKind; id: string };

const RefContext = createContext<{ refs: AgentRefs; open: OpenReference; /** What the screen behind the chat is showing. */ onScreen: ReferenceTarget[] }>({
  onScreen: [],
  refs: NO_REFS,
  open: () => undefined,
});

const refName = (refs: AgentRefs, kind: string, id: string) =>
  kind === "video"
    ? (refs.videos.get(id)?.title ?? "a video that no longer exists")
    : kind === "series"
      ? (refs.series.get(id)?.title ?? "a series that no longer exists")
      : kind === "character"
        ? (refs.characters.get(id)?.name ?? "a character that no longer exists")
        : otherName(refs, kind, id);

const otherName = (refs: AgentRefs, kind: string, id: string) =>
  kind === "post"
    ? (() => {
        const p = refs.posts.get(id);
        return p ? p.author || p.authorHandle || "Saved post" : "a post that is no longer saved";
      })()
    : kind === "brand"
      ? "Brand kit"
      : kind === "research"
        ? "Research"
        : kind === "ideas"
          ? "Ideas"
      : kind === "audio"
        ? `[audio: ${refs.audio.get(id)?.title ?? "no longer saved"}]`
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

const NOTHING_ON_SCREEN: ReferenceTarget[] = [];

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
  onScreen = NOTHING_ON_SCREEN,
}: {
  chat: AgentChatState;
  variant: "page" | "dock";
  actions?: ReactNode;
  onOpenReference: OpenReference;
  onOpenSettings: () => void;
  /** What the screen behind the chat is showing, most specific first; offered first when the user types @. */
  onScreen?: ReferenceTarget[];
}) {
  const [draft, setDraft] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const { messages, running, status, error, approvals } = chat;
  const waiting = approvals.length > 0 && !running;
  const dock = variant === "dock";
  const width = dock ? "" : "mx-auto max-w-3xl";

  const toBottom = (smooth = false) =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });

  // Follow the conversation while the reader is at the bottom; leave them alone if they scrolled up.
  useEffect(() => {
    if (atBottom) toBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, running, status, error, approvals]);
  useEffect(() => {
    toBottom();
    setAtBottom(true);
  }, [chat.chatId]);

  const send = (text: string, plain = text) => {
    if (!text.trim() || running || waiting) return;
    setDraft("");
    setAtBottom(true);
    void chat.send(text, plain);
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
      onSend={send}
      running={running}
      blocked={waiting}
      compact={dock}
      placeholder={empty ? "Ask anything, or tell the agent what you need" : "Something else…"}
    />
  );

  return (
    <RefContext.Provider value={{ refs: chat.refs, open: onOpenReference, onScreen }}>
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
                          <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[var(--tint)] px-4 py-2.5">
                            <Tagged text={m.text} />
                          </p>
                        </div>
                      </div>
                    ) : (
                      <Answer
                        key={i}
                        message={m}
                        // Buttons only make sense on the latest answer, once it is finished.
                        onReply={i === lastIndex && !running && !waiting ? send : undefined}
                      />
                    ),
                  )}
                  {running && (
                    <p className="flex items-center gap-2 text-sm opacity-60">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                      {status || "Thinking"}…
                    </p>
                  )}
                  {waiting && <Approvals key={approvals.map((a) => a.id).join()} approvals={approvals} onDecide={(d) => void chat.decide(d)} />}
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
  const failed = steps.filter((s) => !s.ok && !s.declined).length;
  const declined = steps.filter((s) => s.declined).length;
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
              {declined > 0 && <span>· {declined} declined</span>}
              <span aria-hidden className={`text-[0.6rem] transition-transform ${showSteps ? "rotate-90" : ""}`}>
                ▶
              </span>
            </button>
            {showSteps && (
              <ul className="mt-2 space-y-1 border-l border-[var(--line)] pl-3 text-sm">
                {steps.map((s, i) => (
                  <li key={i} className={s.ok || s.declined ? "opacity-60" : "text-red-400"}>
                    {s.declined && "You declined: "}
                    {s.label}
                    {!s.ok && !s.declined && " (did not work)"}
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

/** The actions the agent is waiting to take, each with Allow, Always allow and Decline. */
function Approvals({ approvals, onDecide }: { approvals: AgentApproval[]; onDecide: (decisions: Record<string, boolean>) => void }) {
  const [choices, setChoices] = useState<Record<string, boolean>>({});

  const choose = async (approval: AgentApproval, allow: boolean, always = false) => {
    const next = { ...choices, [approval.id]: allow };
    if (always) {
      // From now on this action runs without asking; it can be turned back in Settings.
      await api.setAgentPermissions({ [approval.tool]: "allow" }).catch(() => undefined);
      for (const other of approvals) if (other.tool === approval.tool) next[other.id] = true;
    }
    setChoices(next);
    // The agent carries on once every action has an answer.
    if (approvals.every((a) => a.id in next)) onDecide(next);
  };

  const quiet = "rounded-full border border-[var(--line)] px-3.5 py-1.5 text-sm font-medium hover:border-[var(--ink)]";
  return (
    <div role="group" aria-label="Approval needed" className="space-y-3">
      {approvals.map((a) => (
        <div key={a.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-xs font-medium uppercase tracking-wide opacity-55">The agent wants to</p>
          <p className="mt-1 font-semibold">{a.title}</p>
          {a.detail && (
            <div className="mt-2 text-sm">
              <Markdown text={a.detail} />
            </div>
          )}
          {a.id in choices ? (
            <p className="mt-3 text-sm opacity-60">{choices[a.id] ? "Allowed" : "Declined"}. Answer the others to continue.</p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                onClick={() => void choose(a, true)}
              >
                Allow
              </button>
              <button
                type="button"
                className={quiet}
                title="Do this without asking from now on. You can change it back in Settings."
                onClick={() => void choose(a, true, true)}
              >
                Always allow
              </button>
              <button type="button" className={quiet} onClick={() => void choose(a, false)}>
                Decline
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Something the user can point the agent at by typing @. */
type MentionItem = { kind: ReferenceKind; id: string; label: string; hint: string; group: string };

const oneLine = (text: string, max: number) => {
  const line = text.replace(/[\s@]+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max).trim()}…` : line;
};

const SECTIONS = "Sections";
const counted = (n: number, one: string, many: string) => (n === 0 ? `No ${many} yet` : n === 1 ? `Your 1 ${one}` : `All ${n} ${many}`);

/** Everything in the app that can be referred to: whole sections first, then each idea, saved post and generated audio file. */
function mentionItems(refs: AgentRefs): MentionItem[] {
  return [
    { kind: "brand", id: "kit", label: "Brand kit", hint: "Your name, audience, pillars, voice and platforms", group: SECTIONS },
    { kind: "ideas", id: "all", label: "Ideas", hint: counted(refs.ideas.size, "saved idea", "saved ideas"), group: SECTIONS },
    { kind: "research", id: "all", label: "Research", hint: counted(refs.posts.size, "saved post", "saved posts"), group: SECTIONS },
    ...[...refs.ideas.values()].map(
      (i): MentionItem => ({ kind: "idea", id: i.id, label: oneLine(i.title, 60), hint: [i.series, i.pillar].filter(Boolean).join(" · "), group: "Ideas" }),
    ),
    ...[...refs.posts.values()].map(
      (p): MentionItem => ({
        kind: "post",
        id: p.id,
        label: oneLine(p.author || p.authorHandle || "Saved post", 40),
        hint: oneLine(p.analysis?.topic || p.caption, 70),
        group: "Research",
      }),
    ),
    ...[...refs.videos.values()].map(
      (v): MentionItem => ({
        kind: "video",
        id: v.id,
        label: oneLine(v.title, 60),
        hint: v.scenes.length === 0 ? "Script not written" : v.approvedAt ? "Script approved" : "Script waiting for you",
        group: "Studio videos",
      }),
    ),
    ...[...refs.series.values()].map(
      (s): MentionItem => ({ kind: "series", id: s.id, label: oneLine(s.title, 60), hint: `${s.episodes.length} episodes`, group: "Series" }),
    ),
    ...[...refs.characters.values()].map(
      (c): MentionItem => ({ kind: "character", id: c.id, label: oneLine(c.name, 40), hint: oneLine(c.role, 60), group: "Characters" }),
    ),
    ...[...refs.audio.values()].map(
      (a): MentionItem => ({ kind: "audio", id: a.id, label: oneLine(a.title, 60), hint: AUDIO_KIND_LABELS[a.kind], group: "Generated audio" }),
    ),
  ];
}

/**
 * What is offered as soon as @ is typed, before any search: what the screen
 * is showing, the whole sections, and the few newest items. Everything else
 * is found by typing.
 */
function firstSuggestions(items: MentionItem[], refs: AgentRefs, onScreen: ReferenceTarget[]): MentionItem[] {
  const find = (target: ReferenceTarget) => items.find((i) => i.kind === target.kind && i.id === target.id);
  const same = (a: ReferenceTarget, b: ReferenceTarget) => a.kind === b.kind && a.id === b.id;
  const here = onScreen.flatMap((target) => {
    const item = find(target);
    return item ? [{ ...item, group: "On this screen" }] : [];
  });
  const sections = items.filter((i) => i.group === SECTIONS && !here.some((h) => same(h, i)));
  const newest: [string, ReferenceTarget][] = [
    ...[...refs.ideas.values()].map((i): [string, ReferenceTarget] => [i.createdAt, { kind: "idea", id: i.id }]),
    ...[...refs.posts.values()].map((p): [string, ReferenceTarget] => [p.savedAt, { kind: "post", id: p.id }]),
  ];
  const recent = newest
    .sort(([a], [b]) => b.localeCompare(a))
    .filter(([, target]) => !here.some((h) => same(h, target)))
    .slice(0, 3)
    .flatMap(([, target]) => {
      const item = find(target);
      return item ? [{ ...item, group: "Recent" }] : [];
    });
  return [...here, ...sections, ...recent];
}

/**
 * The message box. Typing @ opens a short list (see firstSuggestions) and typing on searches everything in the app; picking an
 * item writes "@Its name" in the box, and when the message is sent that text
 * becomes the item's reference tag, so the agent knows exactly which item is meant.
 */
function Composer({
  draft,
  onChange,
  onSend,
  running,
  blocked,
  compact,
  placeholder,
}: {
  draft: string;
  onChange: (text: string) => void;
  /** `tagged` holds reference tags where items were picked; `plain` is the text as typed. */
  onSend: (tagged: string, plain: string) => void;
  running: boolean;
  /** The agent is waiting for an approval, so nothing can be sent. */
  blocked: boolean;
  compact: boolean;
  placeholder: string;
}) {
  const { refs, onScreen } = useContext(RefContext);
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  /** Items picked into this draft: the name written in the box and the tag it stands for. */
  const [picked, setPicked] = useState<{ label: string; tag: string }[]>([]);
  /** Where the @ is that the list was closed for (picked from, or dismissed with Esc). */
  const [closedAt, setClosedAt] = useState(-1);
  const items = useMemo(() => mentionItems(refs), [refs]);

  // The list is open while the caret sits in "@some words" that still match something.
  const typed = /(?:^|\s)@([^@\n]{0,40})$/.exec(draft.slice(0, caret));
  const start = typed ? caret - typed[1].length - 1 : -1;
  const words = typed ? typed[1].toLowerCase().split(/\s+/).filter(Boolean) : [];
  const searching = words.length > 0;
  const matches =
    !typed || start === closedAt
      ? []
      : searching
        ? items.filter((it) => words.every((w) => `${it.label} ${it.hint} ${it.group}`.toLowerCase().includes(w))).slice(0, 40)
        : firstSuggestions(items, refs, onScreen);
  const current = Math.min(active, matches.length - 1);

  const moveCaret = (to: number) =>
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(to, to);
      setCaret(to);
    });

  const pick = (item: MentionItem) => {
    const tag = `[[${item.kind}:${item.id}]]`;
    // Two items can share a name (two posts by one creator); the second gets "(2)" so each still maps to its own tag.
    let label = item.label;
    for (let n = 2; picked.some((p) => p.label === label && p.tag !== tag); n++) label = `${item.label} (${n})`;
    const inserted = `@${label} `;
    onChange(draft.slice(0, start) + inserted + draft.slice(caret).replace(/^ /, ""));
    setPicked((list) => [...list.filter((p) => p.label !== label), { label, tag }]);
    setClosedAt(start);
    moveCaret(start + inserted.length);
  };

  const submit = () => {
    if (!draft.trim() || running || blocked) return;
    let tagged = draft;
    // Longest names first, so "@Name (2)" is not cut short by "@Name".
    for (const p of [...picked].sort((a, b) => b.label.length - a.label.length)) tagged = tagged.split(`@${p.label}`).join(p.tag);
    setPicked([]);
    setClosedAt(-1);
    onSend(tagged, draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((current + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        pick(matches[current]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setClosedAt(start);
        return;
      }
    }
    // Enter sends; Shift+Enter starts a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  /** The @ button: starts a reference where the caret is. */
  const startMention = () => {
    const at = area.current?.selectionStart ?? draft.length;
    const lead = at > 0 && !/\s/.test(draft[at - 1]) ? " @" : "@";
    onChange(draft.slice(0, at) + lead + draft.slice(at));
    setClosedAt(-1);
    setActive(0);
    moveCaret(at + lead.length);
  };

  return (
    <form
      className="relative flex items-end gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 focus-within:border-[var(--primary)]"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
    >
      {matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Refer to"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-md overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-xl"
        >
          {matches.map((item, i) => (
            <li key={`${item.kind}:${item.id}`} role="presentation">
              {(i === 0 || matches[i - 1].group !== item.group) && (
                <p className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide opacity-50">{item.group}</p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={i === current}
                ref={i === current ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm ${i === current ? "bg-[var(--tint)]" : ""}`}
                // Keep the caret in the message box while clicking.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(item)}
              >
                <KindIcon kind={item.kind} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.label}</span>
                  {item.hint && <span className="ml-2 opacity-55">{item.hint}</span>}
                </span>
              </button>
            </li>
          ))}
          {!searching && (
            <li role="presentation" className="px-2.5 pb-1 pt-2 text-xs opacity-50">
              Keep typing to search every post, idea, video, series, character and audio file.
            </li>
          )}
        </ul>
      )}
      <textarea
        ref={area}
        rows={compact ? 2 : 3}
        autoFocus
        disabled={blocked}
        aria-label="Message to the agent"
        className="max-h-48 flex-1 resize-none bg-transparent px-1 text-sm placeholder:opacity-50 focus:outline-none disabled:opacity-60"
        placeholder={blocked ? "Allow or decline the action above to continue" : placeholder}
        value={draft}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        aria-label="Refer to something in the app"
        title="Refer to a post, an idea, your brand kit or an audio file (or type @)"
        disabled={blocked}
        onClick={startMention}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-medium opacity-60 hover:bg-[var(--tint)] hover:opacity-100 disabled:opacity-30"
      >
        @
      </button>
      <button
        type="submit"
        aria-label="Send"
        title="Send"
        disabled={running || blocked || !draft.trim()}
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

const KIND_ICONS: Record<ReferenceKind, string> = {
  post: "M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4zM17 10l4-2.5v9L17 14",
  idea: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.800 1-2.5A6 6 0 0 0 12 3z",
  audio: "M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  brand: "M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.5l6.1-.8z",
  research: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  video: "M4 9h16v10H4zM4 9l1.500-4 3 4 2-4 3 4 2-4 3 4",
  series: "M4 6h16M4 12h16M4 18h10",
  character: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.500-6 8-6s8 2 8 6",
  ideas: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.800 1-2.5A6 6 0 0 0 12 3z",
};

function KindIcon({ kind }: { kind: ReferenceKind }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 opacity-60">
      <path d={KIND_ICONS[kind]} />
    </svg>
  );
}

/** An item named in a message: a saved post, an idea, the brand kit or an audio file. Opens it when clicked, where it has a page. */
function Chip({ kind, id }: { kind: ReferenceKind; id: string }) {
  const { refs, open } = useContext(RefContext);
  const exists =
    kind === "post"
      ? refs.posts.has(id)
      : kind === "idea"
        ? refs.ideas.has(id)
        : kind === "audio"
          ? refs.audio.has(id)
          : kind === "video"
            ? refs.videos.has(id)
            : kind === "series"
              ? refs.series.has(id)
              : kind === "character"
                ? refs.characters.has(id)
                : true;
  const name = kind === "audio" ? (refs.audio.get(id)?.title ?? "audio that is no longer saved") : refName(refs, kind, id);
  if (!exists) return <span className="opacity-60">{name}</span>;
  const post = kind === "post" ? refs.posts.get(id) : undefined;
  const look =
    "mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] px-1.5 align-baseline text-[0.95em] font-medium leading-snug";
  const inside = (
    <>
      <KindIcon kind={kind} />
      <span className="truncate">{name}</span>
    </>
  );
  // Generated audio has no page of its own yet.
  if (kind === "audio") return <span className={look}>{inside}</span>;
  return (
    <button
      type="button"
      title={
        kind === "post"
          ? `Open this post in Research${post?.analysis ? `: ${post.analysis.topic}` : ""}`
          : kind === "idea"
            ? "Open this idea"
            : kind === "video" || kind === "series"
              ? "Open in Studio"
              : kind === "character"
                ? "Open the character"
                : kind === "research"
              ? "Open Research"
              : kind === "ideas"
                ? "Open Ideas"
                : "Open your brand kit"
      }
      onClick={() => open(kind, id)}
      className={`${look} hover:border-[var(--primary)]`}
    >
      {inside}
    </button>
  );
}

const TAG_SPLIT = /(\[\[(?:post|idea|audio|brand|research|ideas|video|series|character):[\w-]+\]\])/g;
const TAG = /^\[\[(post|idea|audio|brand|research|ideas|video|series|character):([\w-]+)\]\]$/;

/** The user's own message, with the items they pointed at shown as chips. */
function Tagged({ text }: { text: string }) {
  return (
    <>
      {text.split(TAG_SPLIT).map((piece, i) => {
        const ref = TAG.exec(piece);
        return ref ? <Chip key={i} kind={ref[1] as ReferenceKind} id={ref[2]} /> : piece;
      })}
    </>
  );
}

/** Generated audio named in the agent's text, shown as a player. */
function AudioPlayer({ id }: { id: string }) {
  const { refs } = useContext(RefContext);
  const audio = refs.audio.get(id);
  if (!audio) return <span className="opacity-60">(audio that is no longer saved)</span>;
  return (
    <span className="my-1 block rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{audio.title}</span>
        <span className="text-xs opacity-55">
          {AUDIO_KIND_LABELS[audio.kind]}
          {audio.voiceName && ` · ${audio.voiceName}`}
        </span>
      </span>
      <audio controls preload="metadata" src={api.audioFileUrl(audio.file)} className="mt-2 block h-9 w-full" />
    </span>
  );
}

/** Bold, inline code and reference chips inside one stretch of text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[(?:post|idea|audio|brand|research|ideas|video|series|character):[\w-]+\]\])/g).map((piece, i) => {
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={i}>{inline(piece.slice(2, -2))}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-[var(--tint)] px-1 text-[0.9em]">
          {piece.slice(1, -1)}
        </code>
      );
    }
    const ref = TAG.exec(piece);
    if (ref?.[1] === "audio") return <AudioPlayer key={i} id={ref[2]} />;
    if (ref) return <Chip key={i} kind={ref[1] as ReferenceKind} id={ref[2]} />;
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
