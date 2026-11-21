# Personal Brand

A desktop app (Electron, React, TypeScript) that helps one creator build a personal brand with short videos: a brand kit, a research library of saved posts, analysis of those posts, ideas, scripts, and an in-app agent.

## This is a public, source-available project

The repository is public. Treat everything committed here as something anyone can read.

It is licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`): anyone may use, change and share it for personal and other non-commercial purposes; commercial use needs the owner's permission. Because of that limit it is "source-available", not "open source" in the strict sense, so describe it that way in docs and in the app.

- Do not change the licence, or add a file under a different licence, without the owner asking for it.
- The `Required Notice:` line at the top of `LICENSE` names the copyright owner, the company that owns this project. Keep it exactly as it is; no individual's name belongs anywhere in the repository.
- Only add dependencies whose licences allow them to be used in a non-commercial, source-available project (MIT, Apache 2.0, BSD, ISC and similar are fine). Do not copy GPL-licensed code into the repository. Tools the app downloads onto the user's computer at run time (yt-dlp, FFmpeg) are separate programs and are not part of this code.

- Never commit personal or private data: real names, email addresses, phone numbers, API keys, bot tokens, account names, saved posts, chats, or anyone's brand details.
- Never hard-code one person's brand, niche, product or accounts into the app. Every user starts empty and enters their own. Examples and placeholders in the interface must be generic.
- Never commit a data folder, a database file, downloaded media, or `.env` files. If a new kind of local file appears, add it to `.gitignore` in the same change.
- Tests, fixtures and screenshots must use invented data, not a real user's.
- Do not put machine-specific paths (`C:\Users\…`, `/Users/…`, a real home folder) in code, comments or docs.
- Before committing, check the diff for the items above.

## All user data lives in one folder

Everything a user creates or connects is kept in a single data folder. The folder's location is shown in **Settings → Your data**, where the user can open it or move it. Copying that folder to another computer and pointing the app at it must bring everything across. This is how people export, import and work on several devices, so it is a hard rule:

- Any new user data goes inside the data folder: database rows in `personal-brand.db`, or files in a sub-folder of the data folder. This includes settings the user chose, saved content, chats, generated results and connection state.
- Do not store user data anywhere else: not in the browser's `localStorage`, `sessionStorage` or IndexedDB, not in Electron's `userData` folder, not in the home folder, not in the repository, and not on any server run by this project.
- Reach the folder only through `dataDir` (see `src/main/handlers.ts` and `src/main/location.ts`). Never build a path to user data from `homedir()`, `app.getPath(...)` or a fixed string.
- Store paths inside the data as relative to the data folder, never absolute, so the folder still works after it is moved.
- When you add a new file or sub-folder to the data folder, add its name to `DATA_ENTRIES` in `src/main/location.ts` so it is copied when the user moves the folder.
- The folder must keep working when opened by a newer version of the app: read old records without failing, and fill in missing fields with defaults.

The only things allowed outside the data folder:

- `~/.personal-brand.json`, which holds nothing but the location of the data folder.
- Downloaded tools (yt-dlp, FFmpeg), which are not user data and are fetched again on a new computer (`toolsDir`).
- Temporary files, which must be deleted when the work that made them ends.

Known limit, keep it documented: API keys are saved in the data folder but encrypted by the operating system on the desktop app, so they cannot be read on another computer. After moving the folder, the user enters their keys again. Do not weaken this to make keys portable.

## No accounts, no server

Each install is for one person. There is no sign-in and no backend. The app talks only to the services the user connects with their own keys (Anthropic, Deepgram, Telegram) and to the sites it downloads posts from. Do not add analytics, telemetry, or any call that sends user data somewhere the user did not set up.

## How the code is laid out

- `src/shared/` — types and small helpers used by both sides.
- `src/main/` — everything that touches disk or the network. `handlers.ts` is the one table of actions the interface can call; the desktop app exposes it over IPC and the browser dev server exposes the same table over HTTP. Add new actions there, then in `src/preload/index.ts` and `src/renderer/src/api.ts`.
- `src/renderer/` — the interface.
- Secrets never go back to the interface: it may only learn whether a key is saved.

## Commands

- `npm run dev` — the desktop app.
- `npm run dev:web` — the interface in a browser, using the same data folder. Run one at a time, or two copies will both read the Telegram bot.
- `npm run typecheck` — must pass before committing.
- Set `PERSONAL_BRAND_DATA_DIR` to run on another data folder (demos, screenshots, tests) without touching the real one.

## README screenshots

The pictures in `docs/screenshots/` are taken from a demo data folder of invented content (a fictional creator and fictional posts). When the interface changes, retake them the same way; never use a real user's data folder for a screenshot.
