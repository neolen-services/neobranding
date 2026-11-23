// A log of what the app used on the user's services: Claude tokens and their
// estimated cost, Deepgram seconds, ElevenLabs characters. The Usage page reads it.
// Plain Node code with relative imports only (used by the desktop app and the dev server).
//
// It is one line of JSON per request, in usage.jsonl in the data folder.
// Lines are only ever added, so two copies of the app can write to it safely.
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { estimateCostUsd } from "../shared/analysis";
import { choiceFromLabel, mediaCost } from "../shared/media";
import { USAGE_FEATURES, type MediaSpend, type UsageEvent, type UsageFeature, type UsageReport, type UsageRow } from "../shared/usage";

export const USAGE_FILE = "usage.jsonl";
const RECENT_SHOWN = 40;

// The modules that call the services do not know the data folder, so it is set once at start-up.
let dataDir: () => string = () => "";
export function setUsageDir(get: () => string): void {
  dataDir = get;
}

function append(dir: string, events: UsageEvent[]): void {
  if (!dir || events.length === 0) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, USAGE_FILE), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

/** Adds one request to the log. Never throws: a log that cannot be written must not break the work it describes. */
export function recordUsage(event: Omit<UsageEvent, "at">): void {
  try {
    append(dataDir(), [{ at: new Date().toISOString(), ...event }]);
  } catch {
    // Left unrecorded.
  }
}

/** Adds one Claude request, from the token counts in its reply. */
export function recordClaude(
  feature: UsageFeature,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
  detail?: string,
): void {
  recordUsage({
    feature,
    detail,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    costUsd: estimateCostUsd(usage),
  });
}

/** Totals by kind of use, and the latest requests, for everything at or after `since` (ISO time, or "" for all). */
export async function readUsage(dir: string, since: string): Promise<UsageReport> {
  let lines: string[] = [];
  try {
    lines = (await readFile(join(dir, USAGE_FILE), "utf8")).split("\n");
  } catch {
    // Nothing logged yet.
  }

  const rows = new Map<UsageFeature, UsageRow>();
  const media = new Map<string, MediaSpend>();
  const inPeriod: UsageEvent[] = [];
  let trackedSince = "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let event: UsageEvent;
    try {
      event = JSON.parse(line);
    } catch {
      // A half-written line (the app closed mid-write) is skipped.
      continue;
    }
    if (!event || typeof event.at !== "string" || !(event.feature in USAGE_FEATURES)) continue;
    if (!event.earlier && (!trackedSince || event.at < trackedSince)) trackedSince = event.at;
    if (since && event.at < since) continue;
    if (event.feature === "picture" || event.feature === "clip" || event.feature === "lipsync") {
      // Lines written before the service and cost were logged are worked out from their detail.
      if (!event.provider) {
        const choice = choiceFromLabel(event.feature, event.detail ?? "");
        if (choice) {
          event.provider = choice.provider;
          const cost = choice.model ? mediaCost(choice, event.seconds) : null;
          if (cost !== null) event.costUsd = cost;
        }
      }
      const spend = media.get(event.provider ?? "") ?? { provider: event.provider ?? "", pictures: 0, clips: 0, costUsd: 0, unpriced: 0 };
      if (event.feature === "picture") spend.pictures++;
      else spend.clips++;
      if (event.costUsd === undefined) spend.unpriced++;
      else spend.costUsd += event.costUsd;
      media.set(spend.provider, spend);
    }
    inPeriod.push(event);
    const row = rows.get(event.feature) ?? {
      feature: event.feature,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      seconds: 0,
      characters: 0,
      credits: 0,
    };
    row.requests++;
    row.inputTokens += event.inputTokens ?? 0;
    row.outputTokens += event.outputTokens ?? 0;
    row.costUsd += event.costUsd ?? 0;
    row.seconds += event.seconds ?? 0;
    row.characters += event.characters ?? 0;
    row.credits += event.credits ?? 0;
    rows.set(event.feature, row);
  }

  const order = Object.keys(USAGE_FEATURES);
  return {
    rows: [...rows.values()].sort((a, b) => order.indexOf(a.feature) - order.indexOf(b.feature)),
    media: [...media.values()].sort((a, b) => b.costUsd - a.costUsd),
    recent: inPeriod.sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT_SHOWN),
    trackedSince,
  };
}
