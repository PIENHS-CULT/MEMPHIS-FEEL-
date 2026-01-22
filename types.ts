
export type AppView = 'landing' | 'catalog' | 'studio' | 'mastering' | 'suno' | 'medialab' | 'market';

export interface FXState {
  reverb: { active: boolean; mix: number; decay: number };
  delay: { active: boolean; mix: number; time: number; feedback: number };
  distortion: { active: boolean; drive: number; mix: number };
}

export interface FXPreset {
  id: string;
  name: string;
  type: 'reverb' | 'delay' | 'distortion';
  params: any;
  timestamp: number;
}

export interface MusicProject {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  duration: string;
  coverUrl: string;
  tags: string[];
}

export interface SavedStudioProject {
  id: string;
  title: string;
  transcription: string | null;
  chords: string[];
  timestamp: number;
}

export interface StudioTemplate {
  id: string;
  name: string;
  trackTitle: string;
  analysisMode: 'transcribe' | 'chords';
  fx: FXState;
  chainOrder: string[];
  timestamp: number;
}

export interface FolkTechTag {
  id: string;
  label: string;
  instrument: string;
  description: string;
  promptSnippet: string;
}

export interface VisualGenerationResult {
  id: string;
  type: 'image' | 'video';
  url: string;
  prompt: string;
  timestamp: number;
}

export interface GroundingSource {
  web?: { uri: string; title: string };
  maps?: { uri: string; title: string };
}
