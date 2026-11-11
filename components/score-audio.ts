/** The sound engine methods supplied by the installed webmscore runtime. */
export interface AudioScore {
  setSoundFont(data: Uint8Array): Promise<void>;
  saveAudio(format: "mp3"): Promise<Uint8Array>;
}

// The GM soundfont recommended by webmscore, pinned to a MuseScore release.
// Download only when playback is requested; share it across score viewers.
const soundFontUrl =
  "https://raw.githubusercontent.com/musescore/MuseScore/v2.1.0/share/sound/FluidR3Mono_GM.sf3";
let soundFontPromise: Promise<Uint8Array> | null = null;

const loadSoundFont = () => {
  soundFontPromise ??= fetch(soundFontUrl)
    .then(async (response) => {
      if (!response.ok)
        throw new Error(
          "The instrument sounds could not be loaded. Check your connection and retry.",
        );
      return new Uint8Array(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      soundFontPromise = null;
      throw error;
    });
  return soundFontPromise;
};

/** Render the loaded score, preserving its pitches, rhythm, tempo, and repeats. */
export async function renderScoreAudio(
  score: AudioScore,
  signal: AbortSignal,
): Promise<Blob> {
  const soundFont = await loadSoundFont();
  signal.throwIfAborted();
  // webmscore transfers (and detaches) the buffer to its worker. Keep the cache intact.
  await score.setSoundFont(new Uint8Array(soundFont));
  signal.throwIfAborted();
  const audio = await score.saveAudio("mp3");
  signal.throwIfAborted();
  if (!audio.byteLength)
    throw new Error("This score did not produce any audio.");
  return new Blob([new Uint8Array(audio).buffer], { type: "audio/mpeg" });
}
