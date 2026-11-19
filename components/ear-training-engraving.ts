import {
  keySignature,
  spellPitch,
  type KeyScale,
  type PitchView,
} from "./ear-training-model";
import type { Exercise, ExerciseEvent } from "./ear-training-model";
export interface StaffFragment {
  event: ExerciseEvent;
  onsetTicks: number;
  ticks: number;
  duration: string;
  dotted: boolean;
  bar: number;
}
const VALUES = [
  [1920, "w"],
  [1440, "h"],
  [960, "h"],
  [720, "q"],
  [480, "q"],
  [360, "8"],
  [240, "8"],
  [180, "16"],
  [120, "16"],
  [60, "32"],
] as const;
export function engravingFragments(
  events: readonly ExerciseEvent[],
): StaffFragment[] {
  const fragments: StaffFragment[] = [];
  for (const event of events) {
    let remaining = event.durationTicks,
      onset = event.onsetTicks;
    while (remaining > 0) {
      const available = Math.min(remaining, 1920 - (onset % 1920));
      const value = VALUES.find(([ticks]) => ticks <= available);
      if (!value) throw new Error("Unsupported staff duration");
      const [ticks, duration] = value;
      fragments.push({
        event,
        onsetTicks: onset,
        ticks,
        duration,
        dotted: [1440, 720, 360, 180].includes(ticks),
        bar: Math.floor(onset / 1920),
      });
      remaining -= ticks;
      onset += ticks;
    }
  }
  return fragments;
}

/** Never pass hidden pitches or later hinted rhythms to SVG or accessible text. */
export function projectStaffEvents(
  exercise: Exercise,
  revealed: boolean,
  firstNoteHint: boolean,
  targetNoteIndex: number | null = null,
): readonly ExerciseEvent[] {
  if (!revealed && !firstNoteHint) return [];
  const first = exercise.events.find((e) => e.kind === "note");
  if (exercise.source === "long-tone") {
    const target =
      exercise.events.find(
        (e) => e.kind === "note" && e.noteIndex === targetNoteIndex,
      ) ?? first;
    return target ? [{ ...target, onsetTicks: 0 }] : [];
  }
  return revealed
    ? exercise.events
    : first
      ? [{ ...first, onsetTicks: 0 }]
      : [];
}

export function vexDuration(fragment: StaffFragment) {
  return {
    duration: fragment.duration + (fragment.event.kind === "rest" ? "r" : ""),
    dots: fragment.dotted ? 1 : 0,
  };
}

/** Engrave only accidentals that differ from the signature or earlier bar state. */
export function planAccidentals(
  fragments: readonly StaffFragment[],
  key: KeyScale,
  view: PitchView,
): (string | null)[] {
  const signature = keySignature(key, view);
  const major = [
    "Cb",
    "Gb",
    "Db",
    "Ab",
    "Eb",
    "Bb",
    "F",
    "C",
    "G",
    "D",
    "A",
    "E",
    "B",
    "F#",
    "C#",
  ];
  const minor = [
    "Abm",
    "Ebm",
    "Bbm",
    "Fm",
    "Cm",
    "Gm",
    "Dm",
    "Am",
    "Em",
    "Bm",
    "F#m",
    "C#m",
    "G#m",
    "D#m",
    "A#m",
  ];
  const index = (signature.endsWith("m") ? minor : major).indexOf(signature);
  if (index < 0) throw new Error(`Unsupported key signature: ${signature}`);
  const fifths = index - 7;
  const defaults = new Map<string, string>();
  for (const letter of (fifths < 0
    ? ["B", "E", "A", "D", "G", "C", "F"]
    : ["F", "C", "G", "D", "A", "E", "B"]
  ).slice(0, Math.abs(fifths)))
    defaults.set(letter, fifths < 0 ? "b" : "#");
  const state = new Map<string, string>();
  let bar = -1;
  return fragments.map((fragment, i) => {
    if (fragment.bar !== bar) {
      state.clear();
      bar = fragment.bar;
    }
    const event = fragment.event;
    if (event.kind !== "note") return null;
    const previous = fragments[i - 1]?.event;
    if (previous?.kind === "note" && previous.noteIndex === event.noteIndex)
      return null;
    const pitch = spellPitch(event.midi, key, view);
    const position = `${pitch.letter}/${pitch.octave}`;
    const current = state.get(position) ?? defaults.get(pitch.letter) ?? "";
    state.set(position, pitch.accidental);
    return current === pitch.accidental ? null : pitch.accidental || "n";
  });
}
