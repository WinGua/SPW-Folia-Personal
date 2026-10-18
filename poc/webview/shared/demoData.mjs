// Shared demo data for the webview spike: Folia OBS config payload + synthetic audio.
// The config shape matches types/obsBrowserSource.ts (ObsBrowserSourceConfig) as consumed by
// src/components/obs/ObsBrowserSourceApp.tsx in Folia 0.7.21.
export const LOOP_SECONDS = 16.0;

const mkLine = (text, translation, start, end) => {
  const chars = Array.from(text);
  const seg = (end - start) / chars.length;
  const words = chars.map((ch, i) => ({
    text: ch,
    startTime: +(start + i * seg).toFixed(3),
    endTime: +(start + (i + 1) * seg).toFixed(3),
  }));
  return { words, startTime: start, endTime: end, fullText: text, translation, id: `line-${start}`, isWordByWord: true };
};

export const LINES = [
  mkLine('静かな夜に', '在寂静的夜里', 0.0, 3.6),
  mkLine('光が満ちて', '光芒盈满', 4.0, 7.8),
  mkLine('君の声が', '你的声音', 8.2, 11.6),
  mkLine('遠くへ響く', '向远方回响', 12.0, 15.6),
];

export const THEME = {
  name: 'Midnight Default',
  backgroundColor: '#09090b',
  primaryColor: '#f4f4f5',
  accentColor: '#f4f4f5',
  secondaryColor: '#71717a',
  fontStyle: 'sans',
  animationIntensity: 'normal',
};

export const CONFIG = {
  activePlaybackContext: 'main',
  stageSource: null,
  hasTrack: true,
  song: { id: 'spike-song', name: 'Spike Track' },
  songArtist: 'webview-spike',
  songAlbum: 'Spike',
  coverUrl: null,
  lyrics: { lines: LINES, isWordByWord: true, title: 'Spike Track', artist: 'webview-spike' },
  theme: THEME,
  subtitleTheme: THEME,
  isDaylight: false,
  visualizerMode: 'sonnet',
  visualizerTunings: {},
  lyricsFontScale: 1,
  visualizerOpacity: 1,
  subtitleOverlayOpacity: 1,
  staticMode: false,
  hideTranslationSubtitle: false,
  showSubtitleTranslation: true,
  subtitleContentMode: 'translation',
  seed: 'sonnet',
  updatedAt: Date.now(),
};

export const SPECTRUM_BINS = 64;

// Synthetic 60 Hz state frame: what the JVM plugin will stream to the helper over stdin.
export function stateFrame(t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.9);
  const bands = [
    0.30 + 0.55 * pulse,                              // bass
    0.25 + 0.35 * Math.max(0, Math.sin(t * 2.3)),     // lowMid
    0.20 + 0.40 * Math.max(0, Math.sin(t * 3.1 + 1)), // mid
    0.35 + 0.40 * pulse,                              // vocal
    0.15 + 0.30 * Math.abs(Math.sin(t * 5.0)),        // treble
  ];
  const spectrum = [];
  for (let i = 0; i < SPECTRUM_BINS; i++) {
    const lowWeight = Math.pow(1 - i / SPECTRUM_BINS, 1.6);
    const v = 40 + 175 * lowWeight * (0.45 + 0.55 * pulse) * (0.6 + 0.4 * Math.random());
    spectrum.push(Math.max(0, Math.min(255, Math.round(v))));
  }
  return {
    type: 'state',
    posMs: Math.round((t % LOOP_SECONDS) * 1000),
    durationMs: Math.round(LOOP_SECONDS * 1000),
    playing: true,
    rate: 1,
    power: +(0.35 + 0.45 * pulse + 0.05 * Math.random()).toFixed(3),
    bands,
    spectrum,
  };
}
