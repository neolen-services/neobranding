// How a character looks, in one place: their portrait and their character sheet, with one
// button that makes whatever is still missing. Used on a character's own page and on a
// video's Cast tab, so both work the same way.
import { useState } from "react";
import type { MediaChoice } from "@shared/media";
import type { Character, StudioResult } from "@shared/studio";
import { api } from "./api";
import { readUpload } from "./ServicePicker";
import { Icon, ICONS, primaryButton, smallButton } from "./studioUi";

/** The pictures a character still needs before a storyboard can keep them looking the same. */
export function picturesMissing(character: Character): string[] {
  if (character.pictures.length === 0) return ["a portrait"];
  return character.sheet ? [] : ["a character sheet"];
}

export function CharacterLooks({
  character,
  choice,
  onChange,
  onError,
}: {
  character: Character;
  /** The service that makes pictures here; undefined until it is known. */
  choice: MediaChoice | undefined;
  onChange: (character: Character) => void;
  onError: (message: string) => void;
}) {
  const [working, setWorking] = useState("");
  const busy = working !== "";
  const portrait = character.pictures[0];
  const { sheet } = character;
  // A sheet drawn from a portrait that is no longer the main one shows somebody else.
  const outdated = Boolean(sheet && portrait && sheet.from && sheet.from !== portrait.id);
  const canDraw = character.look.trim() !== "";

  /** Runs steps one after another, stopping at the first that fails. Each step gets the character as the step before left it. */
  async function run(what: string, ...steps: ((now: Character) => Promise<StudioResult<Character>>)[]) {
    setWorking(what);
    onError("");
    let now = character;
    try {
      for (const step of steps) {
        const result = await step(now);
        if (!result.ok) return onError(result.error);
        now = result.value;
        onChange(now);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setWorking("");
    }
  }
  const drawPortrait = (now: Character) => api.makeCharacterPicture(now.id, choice);
  const drawSheet = (now: Character) => api.makeCharacterSheet(now.id, choice);

  // The one thing to do next.
  const next = !portrait
    ? { text: "Make portrait and sheet", doing: "Drawing them…", act: () => run("Both", drawPortrait, drawSheet), able: canDraw, why: "Write their look first: the portrait is drawn from it. Or add a picture of your own." }
    : !sheet
      ? { text: "Make character sheet", doing: "Drawing the sheet…", act: () => run("Sheet", drawSheet), able: true, why: "" }
      : outdated
        ? { text: "Update the sheet", doing: "Drawing the sheet…", act: () => run("Sheet", drawSheet), able: true, why: "" }
        : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[5fr_8fr] gap-2">
        <figure>
          {portrait ? (
            <img src={api.studioFileUrl(portrait.file)} alt={`${character.name}'s portrait`} className="aspect-[9/16] w-full rounded-xl bg-black object-cover object-top" />
          ) : (
            <span aria-hidden className="flex aspect-[9/16] w-full items-center justify-center rounded-xl bg-[var(--tint)] font-display text-4xl font-semibold opacity-60">
              {character.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <figcaption className="mt-1 flex items-center gap-1 text-xs opacity-60">
            {portrait && <Icon d={ICONS.check} className="h-3 w-3 text-emerald-400" />}
            Portrait
          </figcaption>
        </figure>
        <figure className="flex flex-col">
          {sheet ? (
            <img src={api.studioFileUrl(sheet.file)} alt={`${character.name} from the front, from the back, and their face`} className={`w-full flex-1 rounded-xl bg-black object-contain ${outdated ? "opacity-50" : ""}`} />
          ) : (
            <span className="flex w-full flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--line)] px-3 text-center text-xs leading-snug opacity-60">Front, back and face in one picture</span>
          )}
          <figcaption className="mt-1 flex items-center gap-1 text-xs opacity-60">
            {sheet && !outdated && <Icon d={ICONS.check} className="h-3 w-3 text-emerald-400" />}
            {outdated ? "Sheet · drawn from an earlier portrait" : "Character sheet"}
          </figcaption>
        </figure>
      </div>

      <p className="text-xs leading-relaxed opacity-60">
        {!portrait
          ? `The portrait says who ${character.name} is; the sheet shows them from every side. Storyboards and clips are given the sheet, so they look the same in every scene.`
          : !sheet
            ? `Without a sheet, storyboards only see ${character.name} from the front and guess the rest.`
            : `Storyboards and clips are given the sheet. Lip-sync makes the portrait speak.`}
      </p>

      {next && (
        <button type="button" className={`${primaryButton} w-full !py-1.5`} disabled={busy || !choice || !next.able} title={next.able ? undefined : next.why} onClick={() => void next.act()}>
          {busy ? next.doing : next.text}
        </button>
      )}
      {next && !next.able && <p className="text-xs text-[var(--accent)]">{next.why}</p>}

      <details className="text-xs" open={!portrait && !canDraw}>
        <summary className="cursor-pointer opacity-60 hover:opacity-100">{portrait ? "Change the pictures" : "Use a picture of your own"}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className={`${smallButton} cursor-pointer ${busy ? "pointer-events-none opacity-40" : ""}`}>
            {working === "Adding" ? "Adding…" : "Add your own portrait"}
            <input
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) await run("Adding", async (now) => api.addCharacterPicture(now.id, await readUpload(file)));
              }}
            />
          </label>
          {portrait && (
            <button type="button" className={smallButton} disabled={busy || !choice || !canDraw} title={canDraw ? "Draws another portrait from their look. Pick it below to make it the main one." : "Write their look first."} onClick={() => void run("Portrait", drawPortrait)}>
              {working === "Portrait" ? "Drawing…" : "Draw another portrait"}
            </button>
          )}
          {sheet && !outdated && (
            <button type="button" className={smallButton} disabled={busy || !choice} onClick={() => void run("Sheet", drawSheet)}>
              {working === "Sheet" ? "Drawing…" : "Draw the sheet again"}
            </button>
          )}
          {sheet && (
            <button type="button" className={smallButton} disabled={busy} onClick={() => void run("Removing", (now) => api.removeCharacterSheet(now.id))}>
              Remove the sheet
            </button>
          )}
        </div>
        {character.pictures.length > 0 && (
          <>
            <p className="mb-1.5 mt-3 opacity-55">{character.pictures.length > 1 ? "Portraits · click one to make it the main one" : "Portrait"}</p>
            <ul className="flex flex-wrap gap-2">
              {character.pictures.map((picture, i) => (
                <li key={picture.id} className="group relative">
                  <button
                    type="button"
                    aria-pressed={i === 0}
                    aria-label={`Portrait ${i + 1}${i === 0 ? " (the main one)" : ""}`}
                    title={i === 0 ? "The main portrait" : "Make this the main portrait"}
                    disabled={busy}
                    onClick={() => i !== 0 && void run("Choosing", (now) => api.changeCharacterPicture(now.id, picture.id, "first"))}
                    className={`block aspect-[9/16] w-10 overflow-hidden rounded-md border-2 bg-black ${i === 0 ? "border-[var(--primary)]" : "border-transparent opacity-60 hover:opacity-100"}`}
                  >
                    <img src={api.studioFileUrl(picture.file)} alt="" className="h-full w-full object-cover object-top" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove portrait ${i + 1}`}
                    title="Remove"
                    disabled={busy}
                    onClick={() => void run("Removing", (now) => api.changeCharacterPicture(now.id, picture.id, "remove"))}
                    className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] hover:border-red-400 hover:text-red-400 group-focus-within:flex group-hover:flex"
                  >
                    <Icon d={ICONS.close} className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </div>
  );
}
