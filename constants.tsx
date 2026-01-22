
import { MusicProject, FolkTechTag } from './types';

export const FEATURED_PROJECTS: MusicProject[] = [
  {
    id: '1',
    title: 'Neon Nomad',
    artist: 'Cyber Folk Collective',
    genre: 'Cyber-Folk',
    bpm: 124,
    duration: '3:45',
    coverUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=400&h=400&auto=format&fit=crop',
    tags: ['Ethereal', 'Hurdy-Gurdy', '808']
  },
  {
    id: '2',
    title: 'Steel Sanctum',
    artist: 'Iron Priest',
    genre: 'Industrial Doom',
    bpm: 88,
    duration: '5:12',
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=400&h=400&auto=format&fit=crop',
    tags: ['Heavy', 'Dystopian', 'Choir']
  },
  {
    id: '3',
    title: 'Solar Noir',
    artist: 'Slavic Synth',
    genre: 'Ambient Slavic',
    bpm: 110,
    duration: '4:20',
    coverUrl: 'https://images.unsplash.com/photo-1493225255756-d9584f8606e9?q=80&w=400&h=400&auto=format&fit=crop',
    tags: ['Warm', 'Gusli', 'Analog']
  }
];

export const STYLE_PRESETS = [
  { id: 'cine', label: 'Cinematic Orchestral', style: 'Hans Zimmer style, epic strings, hybrid percussion, sweeping brass' },
  { id: 'lofi', label: 'Lo-Fi Study', style: 'Chilled beats, vinyl crackle, jazzy piano, 90 bpm, nostalgic' },
  { id: 'viral', label: 'TikTok Hyperpop', style: 'High energy, pitched vocals, glitchy, distorted bass, fast tempo' },
  { id: 'folk', label: 'Modern Folk', style: 'Acoustic guitar, warm vocals, earthy percussion, storytelling lyrics' }
];

export const FOLK_TECH_INSTRUMENTS: FolkTechTag[] = [
  {
    id: 'dist-hurdy',
    label: 'Distorted Hurdy-Gurdy',
    instrument: 'Lira Korbowa',
    description: 'A gritty, droning soundscape with mechanical textures.',
    promptSnippet: '(Instrument: Distorted Hurdy-Gurdy drone, heavy feedback, mechanical clicking)'
  },
  {
    id: 'gran-gusli',
    label: 'Granular Gusli',
    instrument: 'Gęśle',
    description: 'Crystalline pluck textures layered with digital artifacts.',
    promptSnippet: '(Instrument: Granular synthesis Gusli, crystalline texture, shimmering reverb)'
  },
  {
    id: 'throat-tuba',
    label: 'Throat-Tuba Drone',
    instrument: 'Tuba + Vocals',
    description: 'Deep, ritualistic frequencies blending brass and vocal harmonics.',
    promptSnippet: '(Instrument: Low Tuba & Throat Singing Drone, ritualistic resonance)'
  }
];
