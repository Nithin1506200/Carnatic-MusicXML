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
