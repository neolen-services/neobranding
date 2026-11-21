import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { DataFolderInfo } from "@shared/data";
import type { ApiProvider } from "@shared/settings";
import type { TelegramStatus } from "@shared/telegram";
import { api } from "./api";

const fieldClass =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm placeholder:opacity-50 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const primaryButton =
  "rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
const quietButton =
  "rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium hover:border-[var(--ink)] disabled:opacity-50";

export function SettingsView() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <ApiKeySection
        provider="anthropic"
        title="Claude API key"
        placeholder="sk-ant-…"
        description="Video ideas are written by Anthropic's Claude, using your own API key. Your brand details are sent to Anthropic each time you ask for ideas, and each batch costs a few cents on your Anthropic account. Create a key at console.anthropic.com."
      />
      <ApiKeySection
        provider="deepgram"
        title="Deepgram API key"
        placeholder="Deepgram API key"
        description="Deepgram turns the speech in videos you save for research into text. Each video you transcribe is uploaded to Deepgram and billed to your Deepgram account by the minute. Create a key at console.deepgram.com."
      />
      <TelegramSection />
      <DataFolderSection />
    </div>
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
        Everything you create is kept in this one folder: your brand, video ideas, saved posts with their videos,
        pictures, transcripts, ratings and notes, and your Telegram link. To move to another computer, copy the whole
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
