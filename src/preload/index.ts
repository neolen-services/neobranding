import { contextBridge, ipcRenderer } from "electron";
import type { AgentChat, AgentChatSummary, AgentPermissions, AgentProgress, AgentReply } from "@shared/agent";
import type { GeneratedAudio, VoicePreviewResult, VoicesResult } from "@shared/audio";
import type { BrandKit, SaveResult } from "@shared/brand";
import type { DataFolderInfo, DataFolderResult } from "@shared/data";
import type { GenerateOptions, GenerateResult, Idea, IdeaSuggestion } from "@shared/ideas";
import type { GroupingResult, ResearchEdit, ResearchItem, ResearchResult } from "@shared/research";
import type { UsageReport } from "@shared/usage";
import type { MediaChoice, MediaSettings, UploadedFile } from "@shared/media";
import type { TakeResult } from "@shared/studio";
import type { Character, NewVideo, Series, SeriesStart, StudioResult, Video, VideoResults, VideoVoicesResult } from "@shared/studio";
import type { ApiProvider } from "@shared/settings";
import type { TelegramStatus } from "@shared/telegram";

// The only bridge between the UI and the main process. Channel names match
// the handler table in src/main/handlers.ts.
const api = {
  getBrand: (): Promise<BrandKit | null> => ipcRenderer.invoke("brand:get"),
  saveBrand: (brand: BrandKit): Promise<SaveResult> => ipcRenderer.invoke("brand:save", brand),

  listIdeas: (): Promise<Idea[]> => ipcRenderer.invoke("ideas:list"),
  /** Inserts or replaces an idea. */
  saveIdea: (idea: Idea): Promise<Idea> => ipcRenderer.invoke("ideas:save", idea),
  deleteIdea: (id: string): Promise<void> => ipcRenderer.invoke("ideas:delete", id),
  /** Suggested ideas waiting to be saved or dismissed. */
  listSuggestions: (): Promise<IdeaSuggestion[]> => ipcRenderer.invoke("ideas:suggestions"),
  /** Takes suggestions off the waiting list; returns what is left. */
  dismissSuggestions: (keys: string[]): Promise<IdeaSuggestion[]> => ipcRenderer.invoke("ideas:dismiss", keys),
  generateIdeas: (options: GenerateOptions): Promise<GenerateResult> =>
    ipcRenderer.invoke("ideas:generate", options),

  listAgentChats: (): Promise<AgentChatSummary[]> => ipcRenderer.invoke("agent:list"),
  getAgentChat: (id: string): Promise<AgentChat | null> => ipcRenderer.invoke("agent:get", id),
  /** Sends a message to the agent (a new chat id starts a new chat) and resolves when it has answered. */
  sendToAgent: (chatId: string, text: string): Promise<AgentReply> => ipcRenderer.invoke("agent:send", chatId, text),
  /** Allows or declines the actions a chat is waiting on (approval id to true or false), then carries on. */
  decideAgent: (chatId: string, decisions: Record<string, boolean>): Promise<AgentReply> =>
    ipcRenderer.invoke("agent:decide", chatId, decisions),
  /** Which agent actions run without asking and which ask first. */
  agentPermissions: (): Promise<AgentPermissions> => ipcRenderer.invoke("agent:permissions"),
  /** Changes the named actions' permission and returns the full set. */
  setAgentPermissions: (changes: AgentPermissions): Promise<AgentPermissions> =>
    ipcRenderer.invoke("agent:setPermissions", changes),
  /** What the agent is doing in a chat right now. */
  agentProgress: (chatId: string): Promise<AgentProgress> => ipcRenderer.invoke("agent:progress", chatId),
  deleteAgentChat: (id: string): Promise<void> => ipcRenderer.invoke("agent:delete", id),

  /** Audio made with ElevenLabs, newest first. */
  listAudio: (): Promise<GeneratedAudio[]> => ipcRenderer.invoke("audio:list"),
  /** The ElevenLabs voices this account can use. */
  listVoices: (): Promise<VoicesResult> => ipcRenderer.invoke("audio:voices"),
  /** A short sample of one voice. */
  voicePreview: (voiceId: string): Promise<VoicePreviewResult> => ipcRenderer.invoke("audio:voicePreview", voiceId),
  /** Address the UI can play a generated audio file from. */
  audioFileUrl: (file: string): string => `media://audio/${file}`,

  // Studio: the cast, series and the videos being made.
  listCast: (): Promise<Character[]> => ipcRenderer.invoke("cast:list"),
  saveCharacter: (character: Partial<Character>): Promise<StudioResult<Character>> => ipcRenderer.invoke("cast:save", character),
  deleteCharacter: (id: string): Promise<void> => ipcRenderer.invoke("cast:delete", id),
  listSeries: (): Promise<Series[]> => ipcRenderer.invoke("series:list"),
  saveSeries: (series: Series): Promise<StudioResult<Series>> => ipcRenderer.invoke("series:save", series),
  deleteSeries: (id: string): Promise<void> => ipcRenderer.invoke("series:delete", id),
  /** Has Claude plan a season. Costs a few cents. */
  /** Starts a series from an idea, without a season plan yet. Free. */
  createSeries: (from: SeriesStart): Promise<StudioResult<Series>> => ipcRenderer.invoke("series:create", from),
  /** Has Claude plan the season of a series. Costs a few cents. */
  planSeason: (id: string): Promise<StudioResult<Series>> => ipcRenderer.invoke("series:planSeason", id),
  listVideos: (): Promise<Video[]> => ipcRenderer.invoke("videos:list"),
  createVideo: (from: NewVideo): Promise<StudioResult<Video>> => ipcRenderer.invoke("videos:create", from),
  saveVideo: (video: Video): Promise<StudioResult<Video>> => ipcRenderer.invoke("videos:save", video),
  /** Gives a role in a video to another character (its id), or to a new one made for the role ("new"). */
  recastVideo: (videoId: string, fromId: string, toId: string): Promise<StudioResult<{ video: Video; removed: boolean }>> => ipcRenderer.invoke("videos:recast", videoId, fromId, toId),
  deleteVideo: (id: string): Promise<void> => ipcRenderer.invoke("videos:delete", id),
  /** Has Claude write the script, or rewrite it as the note asks. Costs a few cents. */
  writeVideo: (id: string, note: string): Promise<StudioResult<Video>> => ipcRenderer.invoke("videos:write", id, note),
  approveVideo: (id: string): Promise<StudioResult<Video>> => ipcRenderer.invoke("videos:approve", id),
  checkScript: (id: string): Promise<StudioResult<Video>> => ipcRenderer.invoke("videos:checkScript", id),
  /** Speaks the AI lines that have no audio yet. Uses ElevenLabs credits. */
  voiceVideo: (id: string): Promise<VideoVoicesResult> => ipcRenderer.invoke("videos:voices", id),

  // Pictures, clips and lip-sync. `choice` picks the service for this one request; without it the default in Settings is used.
  mediaSettings: (): Promise<MediaSettings> => ipcRenderer.invoke("media:settings"),
  setMediaSettings: (changes: Partial<MediaSettings>): Promise<MediaSettings> => ipcRenderer.invoke("media:setSettings", changes),
  makeCharacterPicture: (id: string, choice?: MediaChoice): Promise<StudioResult<Character>> => ipcRenderer.invoke("cast:picture", id, choice),
  /** Makes a character's sheet: front, back and face in one picture, drawn from their portrait. Billed by the picture service. */
  makeCharacterSheet: (id: string, choice?: MediaChoice): Promise<StudioResult<Character>> => ipcRenderer.invoke("cast:sheet", id, choice),
  removeCharacterSheet: (id: string): Promise<StudioResult<Character>> => ipcRenderer.invoke("cast:sheet", id, undefined, true),
  addCharacterPicture: (id: string, file: UploadedFile): Promise<StudioResult<Character>> => ipcRenderer.invoke("cast:addPicture", id, file),
  /** "first" makes it the main reference; "remove" deletes it. */
  changeCharacterPicture: (id: string, takeId: string, action: "first" | "remove"): Promise<StudioResult<Character>> =>
    ipcRenderer.invoke("cast:changePicture", id, takeId, action),
  makeScenePicture: (videoId: string, sceneId: string, choice?: MediaChoice, note?: string): Promise<TakeResult> =>
    ipcRenderer.invoke("scene:picture", videoId, sceneId, choice, note),
  makeSceneClip: (videoId: string, sceneId: string, choice?: MediaChoice): Promise<TakeResult> => ipcRenderer.invoke("scene:clip", videoId, sceneId, choice),
  makeSceneLipSync: (videoId: string, sceneId: string, choice?: MediaChoice): Promise<TakeResult> => ipcRenderer.invoke("scene:lipsync", videoId, sceneId, choice),
  /** Says whether a scene carries straight on from the one before it, starting on its last frame, or is a new shot. Free. */
  /** Has Claude look at a video's storyboards and say what is wrong with each: one scene's, only those not checked yet ("new"), or all. Uses Claude credits. */
  reviewStoryboard: (videoId: string, sceneId?: string | "new"): Promise<TakeResult> => ipcRenderer.invoke("storyboard:review", videoId, sceneId),
  /** Has Claude animate one scene of a motion graphics video; with a note, its current animation is changed. Uses Claude credits. */
  animateScene: (videoId: string, sceneId: string, note?: string): Promise<TakeResult> => ipcRenderer.invoke("scene:animate", videoId, sceneId, note),
  /** Approves the storyboard a scene has in use, or takes the approval back. */
  approveStoryboard: (videoId: string, sceneId: string, approved: boolean): Promise<TakeResult> => ipcRenderer.invoke("scene:approve", videoId, sceneId, approved),
  setSceneFlow: (videoId: string, sceneId: string, continues: boolean): Promise<TakeResult> => ipcRenderer.invoke("scene:flow", videoId, sceneId, continues),
  /** Adds a clip you filmed, or a picture you chose, to a scene. */
  addSceneFile: (videoId: string, sceneId: string, file: UploadedFile): Promise<TakeResult> => ipcRenderer.invoke("scene:addFile", videoId, sceneId, file),
  /** "use" makes it the one the scene uses; "remove" deletes it. */
  changeTake: (videoId: string, sceneId: string, takeId: string, action: "use" | "remove"): Promise<TakeResult> =>
    ipcRenderer.invoke("scene:changeTake", videoId, sceneId, takeId, action),
  /** Address the UI can show a stored picture or clip from. */
  studioFileUrl: (file: string): string => `media://studio/${file}`,

  /** Saves how a posted video did. */
  recordVideoResults: (id: string, results: VideoResults): Promise<StudioResult<Video>> => ipcRenderer.invoke("videos:results", id, results),

  /** What the app has used on your services since `since` (an ISO time, or "" for everything). */
  usage: (since: string): Promise<UsageReport> => ipcRenderer.invoke("usage:get", since),

  listResearch: (): Promise<ResearchItem[]> => ipcRenderer.invoke("research:list"),
  /** Downloads the post at the link and, if a Deepgram key is saved, transcribes its videos. */
  addResearch: (url: string): Promise<ResearchResult> => ipcRenderer.invoke("research:add", url),
  transcribeResearch: (id: string): Promise<ResearchResult> => ipcRenderer.invoke("research:transcribe", id),
  /** Has Claude break the post down (frames, transcript, caption). Costs money once per post. */
  analyzeResearch: (id: string): Promise<ResearchResult> => ipcRenderer.invoke("research:analyze", id),
  /** Whether new posts are analysed on their own, and the ids being analysed or waiting now. */
  researchAuto: (): Promise<{ on: boolean; analysing: string[] }> => ipcRenderer.invoke("research:auto"),
  /** Turns automatic analysis of new posts on or off. */
  setResearchAuto: (on: boolean): Promise<boolean> => ipcRenderer.invoke("research:setAuto", on),
  /** Has Claude sort analysed posts into groups of similar videos: those without a group, or (with all) every one afresh. Costs a few cents. */
  /** Adds the visual style to a post analysed before styles were recorded. Uses a little Claude credit. */
  styleResearch: (id: string): Promise<ResearchResult> => ipcRenderer.invoke("research:style", id),
  groupResearch: (all?: boolean): Promise<GroupingResult> => ipcRenderer.invoke("research:group", all === true),
  /** Looks up which sound a saved post uses. */
  refreshResearchAudio: (id: string): Promise<ResearchResult> => ipcRenderer.invoke("research:audio", id),
  /** Saves the user's rating and note for a post. */
  updateResearch: (id: string, edit: ResearchEdit): Promise<ResearchResult> =>
    ipcRenderer.invoke("research:update", id, edit),
  deleteResearch: (id: string): Promise<void> => ipcRenderer.invoke("research:delete", id),
  /** Address the UI can load a saved file from. */
  researchFileUrl: (id: string, file: string): string => `media://research/${id}/${file}`,

  telegramStatus: (): Promise<TelegramStatus> => ipcRenderer.invoke("telegram:status"),
  /** (Re)connects with the saved bot token. Call after the token changes and when the app opens. */
  syncTelegram: (): Promise<TelegramStatus> => ipcRenderer.invoke("telegram:sync"),
  unlinkTelegram: (): Promise<TelegramStatus> => ipcRenderer.invoke("telegram:unlink"),

  hasApiKey: (provider: ApiProvider): Promise<boolean> => ipcRenderer.invoke("settings:hasApiKey", provider),
  /** Pass an empty string to remove the saved key. */
  setApiKey: (provider: ApiProvider, key: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("settings:setApiKey", provider, key),

  /** Where all of the user's data is kept. */
  dataFolder: (): Promise<DataFolderInfo> => ipcRenderer.invoke("data:info"),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke("data:open"),
  /** Shows the folder of one video's or character's files, or of the voice lines, in the file manager. */
  openAssetsFolder: (folder: "videos" | "cast" | "audio", id: string): Promise<void> => ipcRenderer.invoke("assets:open", folder, id),
  /** Switches to another folder, using data already there or copying the current data into it. */
  changeDataFolder: (path: string): Promise<DataFolderResult> => ipcRenderer.invoke("data:change", path),
  /** Opens the system's folder chooser and returns the chosen path, or "" if cancelled. */
  browseForFolder: (): Promise<string> => ipcRenderer.invoke("data:browse"),
  /** Whether browseForFolder is available (it is not in a plain browser). */
  canBrowseForFolder: true,
};

export type Api = typeof api;

contextBridge.exposeInMainWorld("api", api);
