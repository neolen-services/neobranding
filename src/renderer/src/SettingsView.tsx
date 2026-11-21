import { useEffect, useState, type FormEvent } from "react";
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
      <ClaudeKeySection />
    </div>
  );
}

function ClaudeKeySection() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.hasApiKey().then(setHasKey);
  }, []);

  async function store(value: string, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await api.setApiKey(value);
    setBusy(false);
    if (result.ok) {
      setHasKey(value !== "");
      setKey("");
      setMessage({ kind: "ok", text: done });
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
        <h2 className="font-display text-lg font-semibold">Claude API key</h2>
        {hasKey !== null && (
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs font-medium">
            <span className={`h-2 w-2 rounded-full ${hasKey ? "bg-emerald-400" : "bg-[var(--accent)]"}`} />
            {hasKey ? "Key saved" : "No key"}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed opacity-70">
        Video ideas are written by Anthropic's Claude, using your own API key. Your brand details are sent to Anthropic
        each time you ask for ideas, and each batch costs a few cents on your Anthropic account. Create a key at
        console.anthropic.com. It is stored only on this computer, and is never shown again after you save it.
      </p>

      <form onSubmit={submit} className="mt-5 flex flex-wrap gap-3">
        <input
          type="password"
          autoComplete="off"
          aria-label="Anthropic API key"
          className={`${fieldClass} min-w-0 flex-1`}
          placeholder={hasKey ? "Paste a new key to replace the saved one" : "sk-ant-…"}
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
    </section>
  );
}
