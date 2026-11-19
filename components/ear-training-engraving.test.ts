import { Note } from "vexflow";
import { describe, expect, it } from "vitest";
import {
  engravingFragments,
  projectStaffEvents,
  vexDuration,
  planAccidentals,
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

describe("key-signature-aware accidental engraving", () => {
  const key = { tonicPc: 10, scaleId: "major" } as const;
  const events = (midis: number[], spacing = 240) =>
    midis.map((midi, noteIndex) => ({
      kind: "note" as const,
      midi,
      noteIndex,
      onsetTicks: noteIndex * spacing,
      durationTicks: spacing,
    }));

  it("engraves written G major without redundant sharps or naturals", () => {
    const source = events([58, 60, 62, 63, 65, 67, 69, 70]);
    const before = JSON.stringify(source);
    expect(planAccidentals(engravingFragments(source), key, "alto-eb")).toEqual(
      Array(8).fill(null),
    );
    expect(JSON.stringify(source)).toBe(before);
  });

  it("cancels and restores F sharp only when the written pitch changes", () => {
    const fragments = engravingFragments(events([69, 68, 68, 69, 69]));
    expect(planAccidentals(fragments, key, "alto-eb")).toEqual([
      null,
      "n",
      null,
      "#",
      null,
    ]);
  });

  it("resets accidental carry at barlines and treats octaves independently", () => {
    expect(
      planAccidentals(
        engravingFragments(events([69, 68, 69, 68, 69, 68], 480)),
        key,
        "alto-eb",
      ),
    ).toEqual([null, "n", "#", "n", null, "n"]);
    expect(
      planAccidentals(
        engravingFragments(events([68, 56, 69, 57], 480)),
        key,
        "alto-eb",
      ),
    ).toEqual(["n", "n", "#", "#"]);
  });

  it("suppresses accidental glyphs on ties but restores them on a new attack", () => {
    const fragments = engravingFragments([
      {
        kind: "note",
        midi: 68,
        noteIndex: 0,
        onsetTicks: 1440,
        durationTicks: 960,
      },
      {
        kind: "note",
        midi: 68,
        noteIndex: 1,
        onsetTicks: 2400,
        durationTicks: 240,
      },
    ]);
    expect(fragments.map((f) => f.bar)).toEqual([0, 1, 1]);
    expect(planAccidentals(fragments, key, "alto-eb")).toEqual([
      "n",
      null,
      "n",
    ]);
  });

  it("matches every canonical major and minor key signature in both pitch views", () => {
    for (const scaleId of ["major", "natural-minor"] as const) {
      const offsets =
        scaleId === "major"
          ? [0, 2, 4, 5, 7, 9, 11, 12]
          : [0, 2, 3, 5, 7, 8, 10, 12];
      for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
        for (const view of ["concert", "alto-eb"] as const) {
          const source = events(offsets.map((offset) => 48 + tonicPc + offset));
          expect(
            planAccidentals(
              engravingFragments(source),
              { tonicPc, scaleId },
              view,
            ),
          ).toEqual(Array(8).fill(null));
        }
      }
    }
  });

  it("engraves a double sharp and then restores the signature sharp", () => {
    const source = events([67, 66, 66]);
    expect(
      planAccidentals(
        engravingFragments(source),
        { tonicPc: 8, scaleId: "harmonic-minor" },
        "concert",
      ),
    ).toEqual(["##", "#", null]);
  });

  it("uses flats and natural cancellations in concert Bb major", () => {
    expect(
      planAccidentals(
        engravingFragments(events([70, 71, 70, 70])),
        key,
        "concert",
      ),
    ).toEqual([null, "n", "b", null]);
  });
});
