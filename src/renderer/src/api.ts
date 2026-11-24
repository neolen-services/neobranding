
type Api = Window["api"];
import type { UploadedFile } from "@shared/media";

/** Bytes cannot travel in JSON, so a file goes to the dev server as base64. */
function asJson(file: UploadedFile): UploadedFile {
  if (!file.bytes) return file;
  let binary = "";
  for (let i = 0; i < file.bytes.length; i += 0x8000) binary += String.fromCharCode(...file.bytes.subarray(i, i + 0x8000));
  return { mime: file.mime, base64: btoa(binary) };
}

// Stand-in used when the UI is opened in a plain browser (for development and
// preview), where the Electron bridge does not exist. Every call goes to the
// dev server, which runs the same handlers as the desktop app against the same
// data folder (see electron.vite.config.ts and src/main/handlers.ts).
async function rpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, args }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The request failed.");
  return body.result as T;
}

const call = rpc;

const browserApi: Api = {
  getBrand: () => call("brand:get"),
  saveBrand: (brand) => call("brand:save", brand),

  listIdeas: () => call("ideas:list"),
  saveIdea: (idea) => call("ideas:save", idea),
  deleteIdea: (id) => call("ideas:delete", id),
  listSuggestions: () => call("ideas:suggestions"),
  dismissSuggestions: (keys) => call("ideas:dismiss", keys),
  generateIdeas: (options) => call("ideas:generate", options),

  listAgentChats: () => call("agent:list"),
  getAgentChat: (id) => call("agent:get", id),
  sendToAgent: (chatId, text) => call("agent:send", chatId, text),
  decideAgent: (chatId, decisions) => call("agent:decide", chatId, decisions),
  agentPermissions: () => call("agent:permissions"),
  setAgentPermissions: (changes) => call("agent:setPermissions", changes),
  agentProgress: (chatId) => call("agent:progress", chatId),
  deleteAgentChat: (id) => call("agent:delete", id),

  listAudio: () => call("audio:list"),
  listVoices: () => call("audio:voices"),
  voicePreview: (voiceId) => call("audio:voicePreview", voiceId),
  audioFileUrl: (file) => `/media/audio/${file}`,

  listCast: () => call("cast:list"),
  saveCharacter: (character) => call("cast:save", character),
  deleteCharacter: (id) => call("cast:delete", id),
  listSeries: () => call("series:list"),
  saveSeries: (series) => call("series:save", series),
  deleteSeries: (id) => call("series:delete", id),
  createSeries: (from) => call("series:create", from),
  planSeason: (id) => call("series:planSeason", id),
  listVideos: () => call("videos:list"),
  createVideo: (from) => call("videos:create", from),
  saveVideo: (video) => call("videos:save", video),
  recastVideo: (videoId, fromId, toId) => call("videos:recast", videoId, fromId, toId),
  deleteVideo: (id) => call("videos:delete", id),
  writeVideo: (id, note) => call("videos:write", id, note),
  approveVideo: (id) => call("videos:approve", id),
  checkScript: (id) => call("videos:checkScript", id),
  voiceVideo: (id) => call("videos:voices", id),
  recordVideoResults: (id, results) => call("videos:results", id, results),
  mediaSettings: () => call("media:settings"),
  setMediaSettings: (changes) => call("media:setSettings", changes),
  makeCharacterPicture: (id, choice) => call("cast:picture", id, choice),
  makeCharacterSheet: (id, choice) => call("cast:sheet", id, choice),
  removeCharacterSheet: (id) => call("cast:sheet", id, null, true),
  addCharacterPicture: (id, file) => call("cast:addPicture", id, asJson(file)),
  changeCharacterPicture: (id, takeId, action) => call("cast:changePicture", id, takeId, action),
  makeScenePicture: (videoId, sceneId, choice, note) => call("scene:picture", videoId, sceneId, choice, note),
  makeSceneClip: (videoId, sceneId, choice) => call("scene:clip", videoId, sceneId, choice),
  makeSceneLipSync: (videoId, sceneId, choice) => call("scene:lipsync", videoId, sceneId, choice),
  reviewStoryboard: (videoId, sceneId) => call("storyboard:review", videoId, sceneId),
  animateScene: (videoId, sceneId, note) => call("scene:animate", videoId, sceneId, note),
  approveStoryboard: (videoId, sceneId, approved) => call("scene:approve", videoId, sceneId, approved),
  setSceneFlow: (videoId, sceneId, continues) => call("scene:flow", videoId, sceneId, continues),
  addSceneFile: (videoId, sceneId, file) => call("scene:addFile", videoId, sceneId, asJson(file)),
  changeTake: (videoId, sceneId, takeId, action) => call("scene:changeTake", videoId, sceneId, takeId, action),
  studioFileUrl: (file) => `/media/studio/${file}`,
  musicForVideo: (id, feedback) => call("videos:music", id, feedback),
  makeVideoMusic: (id) => call("videos:makeMusic", id),
  approveVideoMusic: (id, approved) => call("videos:approveMusic", id, approved),

  usage: (since) => call("usage:get", since),

  listResearch: () => call("research:list"),
  addResearch: (url) => call("research:add", url),
  transcribeResearch: (id) => call("research:transcribe", id),
  analyzeResearch: (id) => call("research:analyze", id),
  styleResearch: (id) => call("research:style", id),
  groupResearch: (all) => call("research:group", all === true),
  researchAuto: () => call("research:auto"),
  setResearchAuto: (on) => call("research:setAuto", on),
  refreshResearchAudio: (id) => call("research:audio", id),
  updateResearch: (id, edit) => call("research:update", id, edit),
  deleteResearch: (id) => call("research:delete", id),
  researchFileUrl: (id, file) => `/media/research/${id}/${file}`,

  telegramStatus: () => call("telegram:status"),
  syncTelegram: () => call("telegram:sync"),
  unlinkTelegram: () => call("telegram:unlink"),

  hasApiKey: (provider) => call("settings:hasApiKey", provider),
  setApiKey: (provider, key) => call("settings:setApiKey", provider, key),

  dataFolder: () => call("data:info"),
  openDataFolder: () => call("data:open"),
  openAssetsFolder: (folder, id) => call("assets:open", folder, id),

  listEdits: () => call("edits:list"),
  getEdit: (id) => call("edits:get", id),
  createEdit: (title) => call("edits:create", title),
  updateEdit: (project) => call("edits:update", project),
  deleteEdit: (id) => call("edits:delete", id),
  importToEdit: (id, files) => call("edits:import", id, files.map((f) => ({ name: f.name, file: asJson(f.file) }))),
  editFromVideo: (videoId) => call("edits:fromVideo", videoId),
  transcribeEditAsset: (id, assetId) => call("edits:transcribe", id, assetId),
  exportEdit: (id, overlays) => call("edits:export", id, overlays),
  editExportProgress: (id) => call("edits:exportProgress", id),
  editChat: (id) => call("edits:chat", id),
  sendToEditor: (id, text) => call("edits:send", id, text),
  editorProgress: (id) => call("edits:agentProgress", id),
  clearEditChat: (id) => call("edits:clearChat", id),
  undoEditorTurn: (id, checkpoint) => call("edits:undoTurn", id, checkpoint),
  prepareEdit: (id) => call("edits:prepare", id),
  remakeEditCaptions: (id, maxWords) => call("edits:captions", id, maxWords),
  makeEditMusic: (id, description) => call("edits:music", id, description),
  changeDataFolder: (path) => call("data:change", path),
  browseForFolder: async () => "",
  canBrowseForFolder: false,
};

export const api: Api = window.api ?? browserApi;
