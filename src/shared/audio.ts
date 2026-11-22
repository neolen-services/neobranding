// Generated audio types, shared by the main process and the UI.

export type AudioKind = "voiceover" | "sound_effect" | "music";

export const AUDIO_KIND_LABELS: Record<AudioKind, string> = {
  voiceover: "Voiceover",
  sound_effect: "Sound effect",
  music: "Music",
};

/** One piece of audio made with ElevenLabs and kept in the data folder. */
export type GeneratedAudio = {
  id: string;
  kind: AudioKind;
  /** A short name for lists and the player. */
  title: string;
  /** The words spoken, or the description the sound or music was made from. */
  prompt: string;
  /** File name inside the data folder's `audio` folder. */
  file: string;
  /** For a voiceover: the voice used. */
  voiceId?: string;
  voiceName?: string;
  /** The ElevenLabs model that made it. */
  model: string;
  bytes: number;
  createdAt: string;
};

/** A voice available to the user's ElevenLabs account. */
export type Voice = {
  id: string;
  name: string;
  /** e.g. "premade", "cloned", "professional", "generated". */
  category: string;
  description: string;
  /** e.g. accent, gender, age, use case. */
  labels: Record<string, string>;
  /** Whether ElevenLabs offers a short sample of it. */
  hasPreview: boolean;
};

/** A voice's sample, as data the page can play without loading a remote address. */
export type VoicePreviewResult = { ok: true; mimeType: string; base64: string } | { ok: false; error: string };

export type AudioResult = { ok: true; audio: GeneratedAudio } | { ok: false; error: string };
export type VoicesResult = { ok: true; voices: Voice[] } | { ok: false; error: string };
