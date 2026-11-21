import { useState } from "react";
import { formatUsd } from "@shared/analysis";
import { countWords, WORDS_PER_SECOND, type IdeaScript } from "@shared/ideas";

/** What writing one script costs, shown on the button before spending. */
export const SCRIPT_COST = "about $0.06";

const label = "font-mono text-xs uppercase tracking-widest opacity-60";

/** The script as plain text, for pasting into notes or a teleprompter. */
function scriptAsText(title: string, script: IdeaScript): string {
  return [
    title,
    "",
    "OPENING LINES",
    ...script.hooks.map((h, i) => `${i + 1}. ${h}`),
    "",
    "SCRIPT",
    ...script.beats.flatMap((b) => [
      `[${b.start}–${b.end}s]`,
      b.say ? `Say: ${b.say}` : null,
      `Show: ${b.show}`,
      b.text ? `On screen: ${b.text}` : null,
      "",
    ]),
    `SOUND\n${script.sound}`,
    "",
    `CAPTION\n${script.caption}\n${script.hashtags.join(" ")}`,
  ]
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** A saved script: opening lines, timed beats, sound and caption. */
export function ScriptBlock({ title, script }: { title: string; script: IdeaScript }) {
  const [copied, setCopied] = useState("");
  const copy = async (what: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };

  const length = script.beats.at(-1)?.end ?? 0;
  const words = script.beats.reduce((n, b) => n + countWords(b.say), 0);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="opacity-70">
          {length} seconds · {script.beats.length} beats · {words} spoken words
        </p>
        <button
          type="button"
          className="text-xs underline opacity-60 hover:opacity-100"
          onClick={() => copy("script", scriptAsText(title, script))}
        >
          {copied === "script" ? "Copied" : "Copy script"}
        </button>
      </div>

      <div>
        <p className={label}>Opening lines to choose from</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 leading-relaxed">
          {script.hooks.map((h, i) => (
            <li key={i}>
              “{h}”{i === 0 && <span className="ml-2 text-xs opacity-60">used in the script</span>}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <p className={label}>Script</p>
        <ol className="mt-2 space-y-2">
          {script.beats.map((b, i) => {
            const seconds = Math.max(b.end - b.start, 1);
            const spoken = countWords(b.say);
            // One spare word of slack, so a beat is only flagged when it really will not fit.
            const tooLong = spoken > seconds * WORDS_PER_SECOND + 1;
            return (
              <li key={i} className="rounded-xl bg-[var(--tint)] p-3">
                <p className="flex flex-wrap items-center gap-2 font-mono text-xs opacity-70">
                  <span className="tabular-nums">
                    {b.start}–{b.end}s
                  </span>
                  {b.text && (
                    <span className="rounded bg-[var(--ink)] px-1.5 py-0.5 font-sans font-semibold text-[var(--frame)]">
                      {b.text}
                    </span>
                  )}
                  {tooLong && (
                    <span className="font-sans text-amber-400">
                      Tight: {spoken} words in {seconds}s
                    </span>
                  )}
                </p>
                {b.say && <p className="mt-2 text-base leading-snug">{b.say}</p>}
                <p className="mt-1.5 leading-relaxed opacity-70">Show: {b.show}</p>
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <p className={label}>Sound</p>
        <p className="mt-1 leading-relaxed">{script.sound}</p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className={label}>Caption</p>
          <button
            type="button"
            className="text-xs underline opacity-60 hover:opacity-100"
            onClick={() => copy("caption", `${script.caption}\n\n${script.hashtags.join(" ")}`)}
          >
            {copied === "caption" ? "Copied" : "Copy caption"}
          </button>
        </div>
        <p className="mt-1 whitespace-pre-line rounded-xl bg-[var(--tint)] p-3 leading-relaxed">
          {script.caption}
          <span className="mt-2 block text-[var(--secondary-text)]">{script.hashtags.join(" ")}</span>
        </p>
      </div>

      <p className="text-xs opacity-50">
        Written {new Date(script.writtenAt).toLocaleDateString()} for {formatUsd(script.costUsd)}. Saved with the idea.
      </p>
    </div>
  );
}
