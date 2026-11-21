# Personal Brand

A desktop app that helps one creator build a personal brand with short videos (Reels, Shorts, TikTok). You define your brand, save posts that worked for other creators, let Claude break down why they worked, and turn that into your own ideas and shooting scripts. An in-app agent can do all of it for you from a chat.

Everything runs on your own computer with your own API keys. There are no accounts and no server.

![The Research library with the agent open in its floating window](docs/screenshots/agent.png)

*All screenshots use invented demo data.*

## What it does

| | |
|---|---|
| **Brand kit** | Your name, topics, audience, positioning, content pillars, voice and platform bios in one place. |
| **Research** | Paste an Instagram or YouTube Shorts link and the app saves the video or pictures, the caption, the numbers, the sound used and a transcript. Rate posts and add notes. |
| **Analysis** | Claude looks at frames, transcript and caption and records the hook, the structure and why the post works. Each post is analysed once and the result is saved. |
| **Ideas** | Claude writes many ideas, each modelled on one analysed post, then a separate pass judges them and keeps the best. |
| **Scripts** | Any saved idea can get a timed shooting script: three opening lines, second-by-second beats, on-screen text, sound and caption. |
| **Agent** | A chat, available on every screen, that can read your brand, research and ideas and carry out the actions above. |
| **Telegram** | Send links to your own Telegram bot from your phone and they are saved to Research. |

## Screenshots

**Dashboard**

![Dashboard](docs/screenshots/dashboard.png)

**Brand kit**

![Brand kit](docs/screenshots/brand.png)

**Research: saved posts with rating and notes**

![Research table](docs/screenshots/research.png)

**Analysis of one post**

![Post analysis](docs/screenshots/analysis.png)

**An idea with its script**

![Idea with a timed script](docs/screenshots/ideas-script.png)

## What you need

- **Node.js 22.13 or newer**, and Git.
- **An Anthropic API key** for analysis, ideas, scripts and the agent. Create one at [console.anthropic.com](https://console.anthropic.com).
- Optional: **a Deepgram API key** to transcribe what is said in videos ([deepgram.com](https://deepgram.com)).
- Optional: **a Telegram bot token** to save links from your phone (create a bot with [@BotFather](https://t.me/BotFather)).

The app is developed on Windows. It downloads the tools it needs (yt-dlp, and FFmpeg on Windows and Linux) the first time you save a post. On macOS there is no automatic FFmpeg download, so videos are saved at lower quality.

## Install and run

```bash
git clone https://github.com/neolen-services/neobranding.git
cd neobranding
npm install
npm run dev
```

`npm run dev` opens the desktop app. There is no packaged installer yet; you run it from source.

## First steps

1. **Create your brand.** The app opens on a short set of questions: who you are, what you cover, who it is for and what you want to achieve.
2. **Add your Claude key.** Open **Settings** (bottom of the menu) and paste your Anthropic API key. Add the Deepgram key and Telegram token there too if you want them.
3. **Save posts you like.** In **Research**, paste a link to a public Instagram post (reel, video, photo or carousel) or a YouTube Short. Give the good ones a star rating and a note.
4. **Analyse them.** Press **Analyse posts**. You need at least five analysed posts before ideas can be written.
5. **Write ideas.** In **Ideas**, press **Write new ideas**, choose how many to keep, and save the ones you like.
6. **Write a script.** Open a saved idea, go to the **Script** tab and press **Write script**.

Or ask the agent: press **Agent** in the bottom-right corner on any screen and type what you want, for example "Analyse my saved posts and give me five ideas".

### Saving links from your phone

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot` and follow the steps. Copy the token it gives you.
2. Paste the token in **Settings → Telegram bot**.
3. Send any message to your new bot. The first chat to message it becomes the linked chat.
4. From then on, send the bot an Instagram or YouTube Shorts link and it is saved to Research while the app is open.

## What it costs

The app is free. The AI features use your own Anthropic account, so you pay Anthropic directly. Typical amounts:

| Action | Rough cost |
|---|---|
| Analyse one post | $0.05 |
| One round of ideas (writes many, keeps the best) | $0.25 |
| One script | $0.06 |
| A question to the agent | $0.05 to $0.15, plus whatever actions it runs |

The app shows the estimated cost on each button before you press it. Saving posts and rating them is free. Transcription uses your Deepgram account.

## Your data

Everything you create is kept in **one folder** on your computer, by default `Documents/Personal Brand`:

- `personal-brand.db`: your brand, ideas, scripts, agent chats and saved keys
- `research/`: saved posts with their videos, pictures, captions, transcripts, analyses, ratings and notes
- `telegram.json`: which Telegram chat is linked

**Settings → Your data** shows where the folder is, opens it, and lets you move it.

### Moving to another computer

1. Copy the whole folder to the other computer (a USB drive or a synced folder both work).
2. Install and run the app there.
3. In **Settings → Your data**, choose the copied folder.
4. Enter your API keys again. On the desktop app, keys are encrypted by the operating system, so they cannot be read on a different computer.

Nothing is sent anywhere except to the services you connect: your brand details and post content go to Anthropic when you use an AI feature, audio goes to Deepgram when a video is transcribed, and links arrive through Telegram if you set up a bot.

## For developers

- `npm run dev`: the desktop app.
- `npm run dev:web`: the interface in a browser at `http://localhost:5173`, using the same data folder. Run one or the other, not both, or two copies will read the same Telegram bot.
- `npm run typecheck`: type-check everything.
- `npm run build`: type-check and build.

To try the app without touching your real data, point it at another folder:

```bash
PERSONAL_BRAND_DATA_DIR=/path/to/a/test/folder npm run dev:web
```

Built with Electron, React, TypeScript, Tailwind CSS and SQLite (Node's built-in `node:sqlite`). `CLAUDE.md` describes the project's rules and how the code is laid out.

## Known limits

- Instagram does not show view counts or video length without a login, so those are often missing.
- Only Instagram posts and YouTube Shorts links are accepted.
- Links sent to Telegram are saved only while the app is open.
- The agent's rules about spending and deleting are instructions it follows, not hard locks.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE). You may use, change and share this software for personal and other non-commercial purposes. Commercial use needs permission from the copyright owner, Neolen Services Private Limited.

The code is public but, because commercial use is restricted, this is "source-available" software rather than open source in the strict sense.
