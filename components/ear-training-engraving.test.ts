import { Note } from "vexflow";
import { describe, expect, it } from "vitest";
import {
  engravingFragments,
  projectStaffEvents,
  vexDuration,
} from "./ear-training-engraving";
import {
  DEFAULT_SETTINGS,
  generateExercise,
  generateRoutine,
} from "./ear-training-model";
class DurationNote extends Note {
  static parsedTicks(fragment: Parameters<typeof vexDuration>[0]) {
    return Note.parseNoteStruct(vexDuration(fragment))!.ticks;
  }
}
describe("Western staff engraving fragments", () => {
  it("splits across bars without adding attacks or padding the final bar", () => {
    const event = {
      kind: "note" as const,
      midi: 60,
      onsetTicks: 960,
      durationTicks: 3840,
      noteIndex: 0,
    };
    const fragments = engravingFragments([event]);
    expect(fragments.map((f) => [f.onsetTicks, f.ticks, f.bar])).toEqual([
      [960, 960, 0],
      [1920, 1920, 1],
      [3840, 960, 2],
    ]);
    expect(new Set(fragments.map((f) => f.event))).toEqual(new Set([event]));
    expect(fragments.at(-1)!.onsetTicks + fragments.at(-1)!.ticks).toBe(4800);
  });
  it("decomposes dotted values and keeps rest events separate from note attacks", () => {
    const fragments = engravingFragments([
      {
        kind: "note",
        midi: 60,
        onsetTicks: 0,
        durationTicks: 720,
        noteIndex: 0,
      },
      { kind: "rest", onsetTicks: 720, durationTicks: 240 },
      {
        kind: "note",
        midi: 62,
        onsetTicks: 960,
        durationTicks: 240,
        noteIndex: 1,
      },
    ]);
    expect(fragments.map((f) => [f.duration, f.dotted])).toEqual([
      ["q", true],
      ["8", false],
      ["8", false],
    ]);
    expect(fragments[1].event.kind).toBe("rest");
    expect(fragments.reduce((n, f) => n + f.ticks, 0)).toBe(1200);
  });
});

describe("staff visibility projection", () => {
  const phrase = generateExercise(DEFAULT_SETTINGS, [], () => 0, 8);
  it("hidden exercises expose no events and hints expose exactly one attack", () => {
    expect(projectStaffEvents(phrase, false, false)).toEqual([]);
    const hint = projectStaffEvents(phrase, false, true);
    expect(hint).toHaveLength(1);
    expect(hint[0].kind).toBe("note");
    expect(hint[0].onsetTicks).toBe(0);
    expect(projectStaffEvents(phrase, true, false)).toEqual(phrase.events);
  });
  it("routine rests show the next target without exposing the full routine staff", () => {
    const routine = generateRoutine({
      ...DEFAULT_SETTINGS,
      exerciseMode: "long-tone",
      longTone: {
        ...DEFAULT_SETTINGS.longTone,
        practice: "routine",
        routineId: "g_major_five_minutes",
      },
    });
    const target = projectStaffEvents(routine.exercise, true, false, 3);
    expect(target).toHaveLength(1);
    expect(target[0]).toMatchObject({
      kind: "note",
      noteIndex: 3,
      midi: 72,
      onsetTicks: 0,
    });
  });
});

it("VexFlow receives dotted duration ticks as well as the visible dot", () => {
  for (const durationTicks of [
    120, 240, 360, 480, 720, 960, 1440, 1920, 2400, 3840,
  ]) {
    for (const kind of ["note", "rest"] as const) {
      const fragments = engravingFragments([
        { kind, midi: 60, noteIndex: 0, onsetTicks: 0, durationTicks },
      ]);
      expect(
        fragments.reduce(
          (ticks, fragment) =>
            ticks + (DurationNote.parsedTicks(fragment) * 480) / 4096,
          0,
        ),
      ).toBe(durationTicks);
    }
  }
});
