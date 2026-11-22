import { useEffect, useState } from "react";
import { MEDIA_MODELS, MEDIA_PROVIDERS, MEDIA_TASKS, type MediaChoice, type MediaProvider, type MediaSettings, type MediaTask, type UploadedFile } from "@shared/media";
import { api } from "./api";

const selectClass = "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-sm focus:border-[var(--primary)] focus:outline-none";
const encode = (c: MediaChoice) => `${c.provider}|${c.model}`;
const decode = (v: string): MediaChoice => ({ provider: v.slice(0, v.indexOf("|")) as MediaProvider, model: v.slice(v.indexOf("|") + 1) });

/** Which of the picture and video services have a key saved. */
export function useMediaKeys() {
  const [keys, setKeys] = useState<Partial<Record<MediaProvider, boolean>>>({});
  useEffect(() => {
    for (const provider of Object.keys(MEDIA_PROVIDERS) as MediaProvider[]) {
      void api.hasApiKey(MEDIA_PROVIDERS[provider].key).then((has) => setKeys((all) => ({ ...all, [provider]: has })));
    }
  }, []);
  return keys;
}

/** The service and model used for one job, with the saved default to start from. Changing it here lasts until you leave the page. */
export function useMediaChoices() {
  const [choices, setChoices] = useState<MediaSettings | null>(null);
  useEffect(() => {
    void api.mediaSettings().then(setChoices);
  }, []);
  return [choices, (task: MediaTask, choice: MediaChoice) => setChoices((all) => (all ? { ...all, [task]: choice } : all))] as const;
}

/** Chooses the service and model for one job. Services without a saved key are marked. */
export function ServicePicker({
  task,
  value,
  onChange,
  keys,
  label,
  stacked,
}: {
  task: MediaTask;
  value: MediaChoice;
  onChange: (choice: MediaChoice) => void;
  keys: Partial<Record<MediaProvider, boolean>>;
  /** Shown before the list; the job's own name when left out. */
  label?: string;
  /** Puts the label above a full-width list, and says so when the chosen service has no key. */
  stacked?: boolean;
}) {
  const known = MEDIA_MODELS[task];
  const custom = !known.some((m) => encode(m) === encode(value));
  return (
    <label className={stacked ? "block text-sm" : "inline-flex flex-wrap items-center gap-2 text-sm"}>
      <span className={stacked ? "text-xs font-medium uppercase tracking-wide opacity-55" : "opacity-70"}>{label ?? `${MEDIA_TASKS[task].label} made with`}</span>
      {stacked && keys[value.provider] === false && <span className="ml-2 text-xs text-[var(--accent)]">no key saved</span>}
      <select className={`${selectClass} ${stacked ? "mt-1.5 block w-full" : ""}`} value={encode(value)} onChange={(e) => onChange(decode(e.target.value))}>
        {custom && (
          <option value={encode(value)}>
            {MEDIA_PROVIDERS[value.provider].label} · {value.model}
          </option>
        )}
        {(Object.keys(MEDIA_PROVIDERS) as MediaProvider[]).map((provider) => {
          const models = known.filter((m) => m.provider === provider);
          if (models.length === 0) return null;
          return (
            <optgroup key={provider} label={`${MEDIA_PROVIDERS[provider].label}${keys[provider] === false ? " (no key saved)" : ""}`}>
              {models.map((m) => (
                <option key={m.model} value={encode(m)}>
                  {MEDIA_PROVIDERS[provider].label} · {m.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}

/** Reads a chosen file so it can be handed to the app. */
export async function readUpload(file: File): Promise<UploadedFile> {
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type };
}
