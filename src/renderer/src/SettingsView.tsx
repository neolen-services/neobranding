import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AGENT_TOOL_GROUPS, AGENT_TOOLS, type AgentPermissions, type AgentToolGroup, type ToolPermission } from "@shared/agent";
import type { DataFolderInfo } from "@shared/data";
import { MEDIA_PROVIDERS, MEDIA_TASKS, type MediaChoice, type MediaSettings, type MediaTask } from "@shared/media";
import { ServicePicker, useMediaKeys } from "./ServicePicker";
import { Icon, ICONS } from "./studioUi";
import type { ApiProvider } from "@shared/settings";
import type { TelegramStatus } from "@shared/telegram";
import { api } from "./api";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton =
  "rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium hover:border-[var(--ink)] disabled:opacity-50";

export type SettingsTab = "brand" | "connections" | "media" | "agent" | "data";

const TABS: { id: SettingsTab; label: string; hint: string; icon: string }[] = [
  { id: "brand", label: "Brand kit", hint: "Who you are and how you sound", icon: "M12 3l2.5 5.5L20 9.3l-4 4 1 5.7-5-2.8-5 2.8 1-5.7-4-4 5.5-.8z" },
  { id: "connections", label: "Connections", hint: "Your keys for the services the app uses", icon: "M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3" },
  { id: "media", label: "Pictures and video", hint: "Which service makes what", icon: ICONS.film },
  { id: "agent", label: "Agent", hint: "What it may do without asking", icon: "M5 4l14 8-6 2-2 6z" },
  { id: "data", label: "Your data", hint: "Where everything is kept", icon: "M3 6h6l2 2h10v11H3z" },
];
const SERVICES: ApiProvider[] = ["anthropic", "deepgram", "elevenlabs", "fal", "google", "telegram"];
/** The tab Settings was last on, so coming back returns to it. */
let lastTab: SettingsTab = "brand";

/**
 * Settings, a tab at a time. The brand kit is the first tab; it is drawn by the
 * app shell, which owns the brand, and handed in.
 */
export function SettingsView({ initialTab, brandKit }: { /** The tab to open on; left out, the one last used. */ initialTab?: SettingsTab; brandKit: ReactNode }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? lastTab);
  const [connected, setConnected] = useState<number | null>(null);
  useEffect(() => {
    lastTab = tab;
    // Counted again on each visit to a tab, so a key just saved is reflected.
    void Promise.all(SERVICES.map((p) => api.hasApiKey(p))).then((has) => setConnected(has.filter(Boolean).length));
  }, [tab]);

  const group = (title: string, note: string) => (
    <div className="pt-2">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="mt-0.5 text-sm opacity-60">{note}</p>
    </div>
  );
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="mx-auto max-w-6xl gap-8 p-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav role="tablist" aria-label="Settings" aria-orientation="vertical" className="mb-5 flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:mb-0 lg:block lg:space-y-1 lg:self-start lg:overflow-visible">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-start gap-3 rounded-xl px-3 py-2.5 text-left lg:w-full ${tab === t.id ? "bg-[var(--tint)]" : "opacity-70 hover:bg-[var(--tint)] hover:opacity-100"}`}
          >
            <Icon d={t.icon} className={`mt-0.5 h-4 w-4 ${tab === t.id ? "text-[var(--accent)]" : ""}`} />
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-sm font-medium">{t.label}</span>
              <span className="hidden text-xs leading-snug opacity-60 lg:block">
                {t.id === "connections" && connected !== null ? `${connected} of ${SERVICES.length} connected` : t.hint}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <div role="tabpanel" aria-label={current.label} className="min-w-0">
        {tab === "brand" && <div className="[&>div]:!mx-0 [&>div]:!max-w-none [&>div]:!p-0">{brandKit}</div>}

        {tab === "connections" && (
          <div className="max-w-3xl space-y-5">
            <p className="text-sm leading-relaxed opacity-70">
              The app talks only to the services you connect here, with your own keys. A key is stored on this computer and is never shown again after you save it.
            </p>
            {group("Writing and analysis", "Ideas, post analyses, scripts and the agent.")}
            <ApiKeySection
              provider="anthropic"
              title="Claude API key"
              placeholder="sk-ant-…"
              description="Ideas, analyses and scripts are written by Anthropic's Claude, using your own API key. Your brand details are sent to Anthropic each time you ask for ideas, and each batch costs a few cents on your Anthropic account. Create a key at console.anthropic.com."
            />
            {group("Speech and sound", "Transcripts of saved videos, and voices for your characters.")}
            <ApiKeySection
              provider="deepgram"
              title="Deepgram API key"
              placeholder="Deepgram API key"
              description="Deepgram turns the speech in videos you save for research into text. Each video you transcribe is uploaded to Deepgram and billed to your Deepgram account by the minute. Create a key at console.deepgram.com."
            />
            <ApiKeySection
              provider="elevenlabs"
              title="ElevenLabs API key"
              placeholder="ElevenLabs API key"
              description="ElevenLabs makes audio: voiceovers in a voice from your account (including your own cloned voice), sound effects and music. It speaks your characters' and narrator's lines in Studio, and the agent can make a voiceover, a sound effect or a music track when you ask. The text or description is sent to ElevenLabs and uses your ElevenLabs credits. Create a key at elevenlabs.io under Developers, API keys."
            />
            {group("Pictures and video", "Stills, clips and lip-sync for scenes in Studio. One of these is enough.")}
            <ApiKeySection
              provider="fal"
              title="fal.ai API key"
              placeholder="fal.ai key"
              description="fal.ai makes pictures, clips and lip-synced clips for scenes in Studio, with many models on one key. The pictures, descriptions and voice recordings a scene needs are sent to fal.ai, where each file is kept at a web address anyone with the link can open. Billed to your fal.ai account. Create a key at fal.ai under API keys."
            />
            <ApiKeySection
              provider="google"
              title="Google Gemini API key"
              placeholder="Gemini API key"
              description="Google's own picture and video models for scenes in Studio. The pictures and descriptions a scene needs are sent to Google and billed to your Google account. Google cannot lip-sync to a recorded voice. Create a key at aistudio.google.com."
            />
            {group("From your phone", "Send links to your own bot and they are saved to Research.")}
            <TelegramSection />
          </div>
        )}

        {tab === "media" && (
          <div className="max-w-3xl">
            <MediaSection />
          </div>
        )}
        {tab === "agent" && (
          <div className="max-w-3xl">
            <AgentPermissionsSection />
          </div>
        )}
        {tab === "data" && (
          <div className="max-w-3xl">
            <DataFolderSection />
          </div>
        )}
      </div>
    </div>
  );
}

/** Which service makes pictures, clips and lip-synced clips unless you choose another on the spot. */
function MediaSection() {
  const keys = useMediaKeys();
  const [settings, setSettings] = useState<MediaSettings | null>(null);
  const [custom, setCustom] = useState<Partial<Record<MediaTask, string>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    api.mediaSettings().then(setSettings);
  }, []);
  if (!settings) return null;

  const save = async (task: MediaTask, choice: MediaChoice) => {
    setError("");
    try {
      const saved = await api.setMediaSettings({ [task]: choice });
      setSettings(saved);
      // A model id the app could not accept comes back unchanged.
      if (saved[task].model !== choice.model) setError("That model id has characters that cannot be used.");
      else setCustom((all) => ({ ...all, [task]: undefined }));
    } catch {
      setError("The choice could not be saved.");
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Pictures and video</h2>
      <p className="mt-2 text-sm leading-relaxed opacity-70">
        Choose which service does each job by default. You can pick a different one for a single picture or clip in
        Studio and Characters. Services rename and retire models often: if one stops working, type its new id here.
      </p>
      <div className="mt-5 space-y-5">
        {(Object.keys(MEDIA_TASKS) as MediaTask[]).map((task) => (
          <div key={task} className="rounded-xl border border-[var(--line)] p-4">
            <p className="font-medium">{MEDIA_TASKS[task].label}</p>
            <p className="text-sm opacity-60">{MEDIA_TASKS[task].description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ServicePicker task={task} label="Default" value={settings[task]} keys={keys} onChange={(choice) => void save(task, choice)} />
              {keys[settings[task].provider] === false && <span className="text-sm text-[var(--accent)]">No {MEDIA_PROVIDERS[settings[task].provider].label} key saved yet.</span>}
            </div>
            {custom[task] === undefined ? (
              <button type="button" className="mt-3 text-sm underline opacity-60 hover:opacity-100" onClick={() => setCustom({ ...custom, [task]: settings[task].model })}>
                Use another model id
              </button>
            ) : (
              <form
                className="mt-3 flex flex-wrap gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(task, { provider: settings[task].provider, model: (custom[task] ?? "").trim() });
                }}
              >
                <input
                  aria-label={`Model id for ${MEDIA_TASKS[task].label} on ${MEDIA_PROVIDERS[settings[task].provider].label}`}
                  className={`${fieldClass} min-w-0 flex-1 font-mono`}
                  value={custom[task]}
                  onChange={(e) => setCustom({ ...custom, [task]: e.target.value })}
                />
                <button type="submit" className={primaryButton}>
                  Use on {MEDIA_PROVIDERS[settings[task].provider].label}
                </button>
                <button type="button" className={quietButton} onClick={() => setCustom({ ...custom, [task]: undefined })}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
      <ul className="mt-5 space-y-1 text-sm opacity-60">
        {(Object.keys(MEDIA_PROVIDERS) as (keyof typeof MEDIA_PROVIDERS)[]).map((provider) => (
          <li key={provider}>
            <span className="font-medium">{MEDIA_PROVIDERS[provider].label}:</span> {MEDIA_PROVIDERS[provider].note}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

const PERMISSION_LABELS: Record<ToolPermission, string> = { allow: "Always allow", ask: "Ask first" };

/** One "Always allow / Ask first" choice. `value` is "" when a group's tools differ. */
function PermissionSelect({ label, value, onChange }: { label: string; value: ToolPermission | ""; onChange: (value: ToolPermission) => void }) {
  return (
    <select
      aria-label={label}
      className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm font-medium focus:border-[var(--primary)] focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value as ToolPermission)}
    >
      {value === "" && (
        <option value="" disabled>
          Mixed
        </option>
      )}
      <option value="allow">{PERMISSION_LABELS.allow}</option>
      <option value="ask">{PERMISSION_LABELS.ask}</option>
    </select>
  );
}

/** Which of the agent's actions run straight away and which wait for a yes in the chat. */
function AgentPermissionsSection() {
  const [permissions, setPermissions] = useState<AgentPermissions | null>(null);
  const [open, setOpen] = useState<ReadonlySet<AgentToolGroup>>(new Set(["change"]));
  const [error, setError] = useState("");

  useEffect(() => {
    api.agentPermissions().then(setPermissions);
  }, []);

  if (!permissions) return null;

  const change = async (changes: AgentPermissions) => {
    setError("");
    // Show the choice at once; the saved set replaces it when it comes back.
    setPermissions({ ...permissions, ...changes });
    try {
      setPermissions(await api.setAgentPermissions(changes));
    } catch {
      setPermissions(permissions);
      setError("The change could not be saved.");
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Agent tool permissions</h2>
      <p className="mt-2 text-sm leading-relaxed opacity-70">
        Choose what the agent may do on its own. With “Always allow” it just does it. With “Ask first” the chat stops
        and shows you exactly what it wants to do, and nothing happens until you allow it. These choices are kept in
        your data folder.
      </p>

      <div className="mt-5 space-y-3">
        {AGENT_TOOL_GROUPS.map((group) => {
          const tools = AGENT_TOOLS.filter((t) => t.group === group.id);
          const values = new Set(tools.map((t) => permissions[t.name]));
          const expanded = open.has(group.id);
          return (
            <div key={group.id} className="rounded-xl border border-[var(--line)]">
              <div className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  onClick={() =>
                    setOpen((ids) => {
                      const next = new Set(ids);
                      if (!next.delete(group.id)) next.add(group.id);
                      return next;
                    })
                  }
                >
                  <span aria-hidden className={`text-[0.6rem] opacity-60 transition-transform ${expanded ? "rotate-90" : ""}`}>
                    ▶
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{group.title}</span>
                    <span className="ml-2 rounded-full bg-[var(--tint)] px-2 py-0.5 text-xs font-medium">{tools.length}</span>
                    <span className="block text-sm opacity-60">{group.description}</span>
                  </span>
                </button>
                <PermissionSelect
                  label={`${group.title}: all`}
                  value={values.size === 1 ? [...values][0] : ""}
                  onChange={(value) => void change(Object.fromEntries(tools.map((t) => [t.name, value])))}
                />
              </div>
              {expanded && (
                <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
                  {tools.map((tool) => (
                    <li key={tool.name} className="flex items-center gap-3 py-3 pl-9 pr-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{tool.title}</p>
                        <p className="text-sm opacity-60">{tool.description}</p>
                      </div>
                      <PermissionSelect label={tool.title} value={permissions[tool.name]} onChange={(value) => void change({ [tool.name]: value })} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

/** Where the user's data lives, with a way to open it or move to another folder. */
function DataFolderSection() {
  const [info, setInfo] = useState<DataFolderInfo | null>(null);
  const [changing, setChanging] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.dataFolder().then(setInfo);
  }, []);

  if (!info) return null;

  async function apply(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const result = await api.changeDataFolder(path);
    if (result.ok) {
      // Everything on screen came from the old folder, so start again from the new one.
      window.location.reload();
    } else {
      setBusy(false);
      setError(result.error);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
      <h2 className="font-display text-lg font-semibold">Your data folder</h2>
      <p className="mt-2 text-sm leading-relaxed opacity-70">
        Everything you create is kept in this one folder: your brand, ideas, saved posts with their videos,
        pictures, transcripts, ratings and notes, the audio, pictures and clips you generate, your cast and videos, and your Telegram link. To move to another computer, copy the whole
        folder across, then choose it here on that computer.
      </p>

      <p className="mt-4 break-all rounded-xl bg-[var(--bg)] p-3 font-mono text-sm">{info.path}</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className={quietButton} onClick={() => api.openDataFolder()}>
          Open folder
        </button>
        <button
          type="button"
          className={quietButton}
          onClick={async () => {
            await navigator.clipboard.writeText(info.path);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy path"}
        </button>
        {!changing && (
          <button
            type="button"
            className={quietButton}
            onClick={() => {
              setPath(info.path);
              setChanging(true);
            }}
          >
            Change folder
          </button>
        )}
      </div>

      {changing && (
        <form onSubmit={apply} className="mt-5 border-t border-[var(--line)] pt-5">
          <label className="block text-sm font-medium" htmlFor="data-folder-path">
            New folder
          </label>
          <p className="mt-1 text-sm opacity-70">
            If the folder already holds app data, the app switches to it. If it is empty, your current data is copied
            into it. The old folder is left as it is.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              id="data-folder-path"
              className={`${fieldClass} min-w-0 flex-1 font-mono`}
              placeholder={info.defaultPath}
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            {api.canBrowseForFolder && (
              <button
                type="button"
                className={quietButton}
                onClick={async () => {
                  const chosen = await api.browseForFolder();
                  if (chosen) setPath(chosen);
                }}
              >
                Browse
              </button>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" className={primaryButton} disabled={busy || !path.trim()}>
              {busy ? "Switching…" : "Use this folder"}
            </button>
            {!info.isDefault && (
              <button type="button" className={quietButton} disabled={busy} onClick={() => setPath(info.defaultPath)}>
                Use the default
              </button>
            )}
            <button type="button" className={quietButton} disabled={busy} onClick={() => setChanging(false)}>
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-400">
              {error}
            </p>
          )}
        </form>
      )}

      <p className="mt-5 text-sm leading-relaxed opacity-60">
        Two things are not carried over, on purpose. API keys and the Telegram bot token are locked to the computer
        they were saved on, so enter them again on the new one. The download tools are fetched again automatically.
      </p>
    </section>
  );
}

/** The bot token, plus what the bot is doing right now. */
function TelegramSection() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);

  useEffect(() => {
    api.telegramStatus().then(setStatus);
    // The linked chat appears once the first message arrives, so keep checking while this page is open.
    const timer = setInterval(() => api.telegramStatus().then(setStatus), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <ApiKeySection
      provider="telegram"
      title="Telegram bot"
      placeholder="Bot token from @BotFather"
      description="Send links from your phone and the app saves them to Research. In Telegram, message @BotFather, send /newbot and follow the steps, then paste the token it gives you here. After that, share any Instagram or YouTube Shorts link to your bot. The app only picks links up while it is open; Telegram holds them for about a day."
      onChange={() => api.syncTelegram().then(setStatus)}
    >
      {status && status.state !== "off" && (
        <div className="mt-5 space-y-3 rounded-xl bg-[var(--bg)] p-4 text-sm">
          {status.state === "error" ? (
            <p role="alert" className="font-medium text-red-400">
              {status.error}
            </p>
          ) : status.state === "connecting" ? (
            <p className="opacity-70">Connecting to Telegram…</p>
          ) : (
            <>
              <p>
                <span className="opacity-60">Bot: </span>
                <span className="font-medium">@{status.botUsername}</span>
                <span className="ml-2 text-emerald-400">listening</span>
              </p>
              {status.linkedChat ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>
                    <span className="opacity-60">Saving links from: </span>
                    <span className="font-medium">{status.linkedChat}</span>
                  </p>
                  <button type="button" className={quietButton} onClick={() => api.unlinkTelegram().then(setStatus)}>
                    Unlink
                  </button>
                </div>
              ) : (
                <p className="opacity-80">
                  Not linked yet. Open @{status.botUsername} in Telegram and send it any message. The first chat to
                  message the bot becomes the only one it listens to. To use a channel, add the bot to the channel as
                  an admin and post there first.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </ApiKeySection>
  );
}

function ApiKeySection({
  provider,
  title,
  placeholder,
  description,
  onChange,
  children,
}: {
  provider: ApiProvider;
  title: string;
  placeholder: string;
  description: string;
  /** Called after the key is saved or removed. */
  onChange?: () => void;
  children?: ReactNode;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.hasApiKey(provider).then(setHasKey);
  }, [provider]);

  async function store(value: string, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await api.setApiKey(provider, value);
    setBusy(false);
    if (result.ok) {
      setHasKey(value !== "");
      setKey("");
      setMessage({ kind: "ok", text: done });
      onChange?.();
    } else {
      setMessage({ kind: "error", text: result.error });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!key.trim()) return setMessage({ kind: "error", text: "Paste your API key first." });
    store(key.trim(), "Key saved.");
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {hasKey !== null && (
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs font-medium">
            <span className={`h-2 w-2 rounded-full ${hasKey ? "bg-emerald-400" : "bg-[var(--accent)]"}`} />
            {hasKey ? "Key saved" : "No key"}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed opacity-70">
        {description} The key is stored only on this computer, and is never shown again after you save it.
      </p>

      <form onSubmit={submit} className="mt-5 flex flex-wrap gap-3">
        <input
          type="password"
          autoComplete="off"
          aria-label={title}
          className={`${fieldClass} min-w-0 flex-1`}
          placeholder={hasKey ? "Paste a new key to replace the saved one" : placeholder}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="submit" className={primaryButton} disabled={busy}>
          {hasKey ? "Replace key" : "Save key"}
        </button>
        {hasKey && (
          <button type="button" className={quietButton} disabled={busy} onClick={() => store("", "Key removed.")}>
            Remove key
          </button>
        )}
      </form>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-3 text-sm font-medium ${message.kind === "error" ? "text-red-400" : "text-emerald-400"}`}
        >
          {message.text}
        </p>
      )}
      {children}
    </section>
  );
}
