import { useEffect, useState, type ReactNode } from "react";
import { formatUsd } from "@shared/analysis";
import {
  USAGE_FEATURES,
  USAGE_PERIODS,
  USAGE_SERVICES,
  type UsageEvent,
  type UsagePeriod,
  type UsageReport,
  type UsageRow,
  type UsageService,
} from "@shared/usage";
import { api } from "./api";

const DAY = 86_400_000;

/** The ISO time a period starts at, or "" for all time. */
function startOf(period: UsagePeriod): string {
  if (period === "all") return "";
  if (period === "today") return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  return new Date(Date.now() - (period === "week" ? 7 : 30) * DAY).toISOString();
}

const count = (n: number) => Math.round(n).toLocaleString();
const usd = (amount: number) => (amount === 0 ? "$0.00" : formatUsd(amount));
const minutes = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)} sec` : `${(seconds / 60).toFixed(1)} min`);

/** What one row or request amounted to, in the unit its service bills in. */
function amount(service: UsageService, use: { costUsd?: number; seconds?: number; characters?: number; credits?: number }): string {
  if (service === "claude") return usd(use.costUsd ?? 0);
  if (service === "deepgram") return use.seconds ? minutes(use.seconds) : "–";
  // Pictures, clips and lip-sync are billed by whichever service made them; only clip length is known here.
  if (service === "media") return use.seconds ? `${count(use.seconds)} sec of video` : "–";
  if (use.credits) return `${count(use.credits)} credits`;
  if (use.characters) return `${count(use.characters)} characters`;
  return "–";
}

function when(iso: string): string {
  const at = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${at.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

/** What the app has used on the services you connected: tokens, cost, minutes and characters, by what it was for. */
export function UsageView() {
  const [period, setPeriod] = useState<UsagePeriod>("month");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setError("");
    api
      .usage(startOf(period))
      .then((r) => current && setReport(r))
      .catch(() => current && setError("Your usage could not be read."));
    return () => {
      current = false;
    };
  }, [period]);

  const rows = report?.rows ?? [];
  const of = (service: UsageService) => rows.filter((r) => USAGE_FEATURES[r.feature].service === service);
  const sum = (list: UsageRow[], field: "requests" | "inputTokens" | "outputTokens" | "costUsd" | "seconds" | "characters" | "credits") =>
    list.reduce((total, r) => total + r[field], 0);
  const claude = of("claude");
  const eleven = of("elevenlabs");

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm opacity-70">What the app has used on the services you connected, and what for.</p>
        <div role="group" aria-label="Period" className="flex rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5">
          {(Object.keys(USAGE_PERIODS) as UsagePeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === period}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${p === period ? "bg-[var(--tint)]" : "opacity-60 hover:opacity-100"}`}
              onClick={() => setPeriod(p)}
            >
              {USAGE_PERIODS[p]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}

      {report && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Claude cost (estimate)" value={usd(sum(claude, "costUsd"))} note={`${count(sum(claude, "requests"))} requests`} />
            <Card
              label="Claude tokens"
              value={count(sum(claude, "inputTokens") + sum(claude, "outputTokens"))}
              note={`${count(sum(claude, "inputTokens"))} in · ${count(sum(claude, "outputTokens"))} out`}
            />
            <Card label="Deepgram transcription" value={minutes(sum(of("deepgram"), "seconds"))} note={`${count(sum(of("deepgram"), "requests"))} videos`} />
            <Card
              label="ElevenLabs audio"
              value={`${count(sum(eleven, "requests"))} made`}
              note={sum(eleven, "credits") ? `${count(sum(eleven, "credits"))} credits` : `${count(sum(eleven, "characters"))} characters spoken`}
            />
          </div>

          <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
            <h2 className="px-6 pt-5 font-display text-lg font-semibold">By what it was used for</h2>
            {rows.length === 0 ? (
              <p className="px-6 pb-6 pt-2 text-sm opacity-60">Nothing was used in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide opacity-55">
                      <th className="px-6 py-2 font-medium">Used for</th>
                      <Th>Requests</Th>
                      <Th>Tokens in</Th>
                      <Th>Tokens out</Th>
                      <Th last>Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(USAGE_SERVICES) as UsageService[]).flatMap((service) => {
                      const list = of(service);
                      if (list.length === 0) return [];
                      return [
                        <tr key={service} className="border-b border-[var(--line)] bg-[var(--bg)]">
                          <td colSpan={5} className="px-6 py-1.5 text-xs font-medium uppercase tracking-wide opacity-60">
                            {USAGE_SERVICES[service]}
                          </td>
                        </tr>,
                        ...list.map((r) => (
                          <tr key={r.feature} className="border-b border-[var(--line)] last:border-0">
                            <td className="px-6 py-3 font-medium">{USAGE_FEATURES[r.feature].label}</td>
                            <Td>{count(r.requests)}</Td>
                            <Td>{service === "claude" && r.inputTokens ? count(r.inputTokens) : "–"}</Td>
                            <Td>{service === "claude" && r.outputTokens ? count(r.outputTokens) : "–"}</Td>
                            <Td last>{amount(service, r)}</Td>
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {report.recent.length > 0 && (
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm">
              <h2 className="font-display text-lg font-semibold">Latest requests</h2>
              <ul className="mt-3 divide-y divide-[var(--line)] text-sm">
                {report.recent.map((e, i) => (
                  <Request key={i} event={e} />
                ))}
              </ul>
            </section>
          )}

          <p className="text-sm leading-relaxed opacity-60">
            The Claude cost is an estimate worked out from the tokens in each reply at list prices; your Anthropic invoice is the
            real figure. Deepgram, ElevenLabs, fal.ai and Google bill on their own accounts, so only minutes, characters,
            credits and counts are shown for them.{" "}
            {report.trackedSince
              ? `Every request has been logged since ${new Date(report.trackedSince).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}. Analyses made before that are included from the cost saved with them, without token counts; agent chats and idea rounds from before that are not included.`
              : "Requests are logged from now on. Analyses made before today are included from the cost saved with them, without token counts; earlier agent chats and idea rounds are not included."}
          </p>
        </>
      )}
    </div>
  );
}

function Card({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <p className="text-sm opacity-60">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm opacity-60">{note}</p>
    </div>
  );
}

const Th = ({ children, last }: { children: ReactNode; last?: boolean }) => (
  <th className={`py-2 text-right font-medium ${last ? "px-6" : "px-3"}`}>{children}</th>
);
const Td = ({ children, last }: { children: ReactNode; last?: boolean }) => (
  <td className={`py-3 text-right tabular-nums ${last ? "px-6 font-medium" : "px-3 opacity-80"}`}>{children}</td>
);

function Request({ event }: { event: UsageEvent }) {
  const { label, service } = USAGE_FEATURES[event.feature];
  const tokens = event.inputTokens || event.outputTokens ? `${count(event.inputTokens ?? 0)} in · ${count(event.outputTokens ?? 0)} out` : "";
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5">
      <span className="w-32 shrink-0 text-xs opacity-55">{when(event.at)}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        {event.detail && <span className="ml-2 opacity-60">{event.detail}</span>}
      </span>
      {tokens && <span className="text-xs tabular-nums opacity-55">{tokens}</span>}
      <span className="w-28 shrink-0 text-right font-medium tabular-nums">{amount(service, event)}</span>
    </li>
  );
}
