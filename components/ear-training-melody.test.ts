import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SCALES,
  generateExercise,
  validateSettings,
  type Exercise,
  type Settings,
} from "./ear-training-model";

import { presetRegistry } from "./ear-training-presets";
import { parseHarmonyPresets } from "./ear-training-melody";
import harmonyText from "../data/ear_training_harmony.toml?raw";

const settings = (
  melody: Partial<Settings["melody"]> = {},
  patch: Partial<Settings> = {},
): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  // Musical fixtures below are explicitly in concert C major, independent of
  // the UI defaults or automatic key/scale selection.
  sound: "piano",
  pitchView: "concert",
  lowMidi: 60,
  highMidi: 72,
  keyScales: [{ tonicPc: 0, scaleId: "major" }],
  ...patch,
  melody: { ...DEFAULT_SETTINGS.melody, ...melody },
});
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const notes = (exercise: Exercise) =>
  exercise.events.filter((event) => event.kind === "note");
const pitches = (exercise: Exercise) =>
  notes(exercise).map((event) => event.midi);
const intervals = (values: number[]) =>
  values.slice(1).map((value, i) => Math.abs(value - values[i]));
const pc = (pitch: number) => ((pitch % 12) + 12) % 12;

describe("constrained melodic phrases", () => {
  it("defaults to smooth motion and respects range, scale and hard interval caps", () => {
    expect(DEFAULT_SETTINGS.melody).toMatchObject({
      style: "melodic",
      variation: 25,
      maxLeap: 7,
      chromaticism: "off",
    });
    for (const scaleId of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      for (let seed = 1; seed <= 8; seed++) {
        const exercise = generateExercise(
          settings(
            { maxLeap: 3 },
            {
              lowMidi: 48,
              highMidi: 84,
              noteCount: 16,
              keyScales: [{ tonicPc: 7, scaleId }],
            },
          ),
          [],
          seeded(seed),
        );
        const values = pitches(exercise);
        expect(values).toHaveLength(16);
        expect(values.every((midi) => midi >= 48 && midi <= 84)).toBe(true);
        expect(
          values.every((midi) =>
            (SCALES[scaleId] as readonly number[]).includes(pc(midi - 7)),
          ),
        ).toBe(true);
        expect(intervals(values).every((distance) => distance <= 3)).toBe(true);
      }
    }
  });

  it("makes higher variation explore larger intervals with a reproducible random source", () => {
    const meanStep = (variation: number) => {
      const differences: number[] = [];
      for (let seed = 1; seed <= 96; seed++) {
        differences.push(
          ...intervals(
            pitches(
              generateExercise(
                settings(
                  { variation, maxLeap: 12 },
                  {
                    lowMidi: 48,
                    highMidi: 84,
                    noteCount: 16,
                    rhythmMode: "even",
                  },
                ),
                [],
                seeded(seed),
              ),
            ),
          ),
        );
      }
      return differences.reduce((sum, n) => sum + n, 0) / differences.length;
    };
    expect(meanStep(100)).toBeGreaterThan(meanStep(0) * 1.2);
    const s = settings({}, { noteCount: 16 });
    expect(generateExercise(s, [], seeded(123), 77)).toEqual(
      generateExercise(s, [], seeded(123), 77),
    );
  });

  it("plans a smooth three-note route instead of forcing a last-slot tonic leap", () => {
    const exercise = generateExercise(
      settings(
        { variation: 0 },
        {
          noteCount: 3,
          rhythmMode: "even",
          lowMidi: 60,
          highMidi: 72,
        },
      ),
      [],
      () => 0.5,
    );
    const values = pitches(exercise);
    expect(values).toHaveLength(3);
    expect(pc(values.at(-1)!)).toBe(0);
    expect(intervals(values).every((distance) => distance <= 4)).toBe(true);
  });

  it("gives zero, default and adventurous variation distinct interval distributions", () => {
    const metrics = (variation: number) => {
      const steps: number[] = [];
      for (let seed = 1; seed <= 192; seed++) {
        const exercise = generateExercise(
          settings(
            { variation, maxLeap: 7 },
            {
              noteCount: 3,
              rhythmMode: "even",
              lowMidi: 60,
              highMidi: 72,
            },
          ),
          [],
          seeded(seed * 2654435761),
        );
        steps.push(...intervals(pitches(exercise)));
      }
      return {
        mean: steps.reduce((sum, step) => sum + step, 0) / steps.length,
        leapRate: steps.filter((step) => step >= 5).length / steps.length,
      };
    };
    const low = metrics(0),
      normal = metrics(25),
      high = metrics(96);
    expect(normal.mean).toBeGreaterThan(low.mean * 1.15);
    expect(high.mean).toBeGreaterThan(normal.mean * 1.15);
    expect(high.leapRate).toBeGreaterThan(normal.leapRate);
    expect(normal.leapRate).toBeGreaterThan(low.leapRate);
  });

  it("keeps one- and two-note phrases valid when conditioning on their ending", () => {
    for (const noteCount of [1, 2])
      for (const variation of [0, 25, 96]) {
        const s = settings(
          { variation, harmony: "tonic" },
          { noteCount, rhythmMode: "even" },
        );
        for (let seed = 1; seed <= 12; seed++) {
          const exercise = generateExercise(s, [], seeded(seed * 2654435761));
          const values = pitches(exercise);
          expect(values).toHaveLength(noteCount);
          expect(exercise.melody!.chords.at(-1)!.pitchClasses).toContain(
            pc(values.at(-1)!),
          );
          expect(intervals(values).every((distance) => distance <= 7)).toBe(
            true,
          );
          expect(exercise.totalTicks).toBe(noteCount * 480);
          expect(
            generateExercise(s, [], seeded(seed * 2654435761), exercise.id),
          ).toEqual(exercise);
        }
      }
  });

  it("keeps log-space path sampling finite at RNG endpoints and isolated pitches", () => {
    for (const random of [0, 1 - Number.EPSILON]) {
      for (const variation of [0, 96]) {
        for (const contour of [
          "free",
          "rising",
          "falling",
          "arch",
          "returning",
        ] as const) {
          for (const noteCount of [1, 2, 16]) {
            for (const [lowMidi, highMidi] of [
              [60, 60],
              [48, 84],
            ]) {
              const exercise = generateExercise(
                settings(
                  { variation, contour, maxLeap: 1 },
                  {
                    lowMidi,
                    highMidi,
                    noteCount,
                    rhythmMode: "even",
                  },
                ),
                [],
                () => random,
              );
              const values = pitches(exercise);
              expect(values).toHaveLength(noteCount);
              expect(
                values.every(
                  (p) => Number.isInteger(p) && p >= lowMidi && p <= highMidi,
                ),
              ).toBe(true);
              expect(intervals(values).every((distance) => distance <= 1)).toBe(
                true,
              );
              expect(pc(values.at(-1)!)).toBe(0);
            }
          }
        }
      }
    }
  });

  it("samples variation once per phrase and retains its resolved value and snapshot", () => {
    const s = settings(
      { randomizeVariation: true, variationMin: 20, variationMax: 50 },
      { noteCount: 16 },
    );
    const variations = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const exercise = generateExercise(s, [], seeded(seed));
      expect(exercise.melody?.variation).toBeGreaterThanOrEqual(20);
      expect(exercise.melody?.variation).toBeLessThanOrEqual(50);
      variations.add(exercise.melody!.variation);
    }
    expect(variations.size).toBeGreaterThan(1);
    const exercise = generateExercise(s, [], seeded(600));
    const before = JSON.stringify(exercise);
    s.melody.variationMin = 90;
    s.melody.variationMax = 100;
    expect(JSON.stringify(exercise)).toBe(before);
    expect(Object.isFrozen(exercise.snapshot.melody)).toBe(true);
    expect(exercise.snapshot.melody.variationMin).toBe(20);
  });

  it("does not change rhythm events or duration when melodic weighting changes", () => {
    const rhythm = presetRegistry.rhythms.find(
      (r) => r.id === "rest_response",
    )!;
    const registry = { ...presetRegistry, rhythms: [rhythm] };
    const s = settings({}, { noteCount: 16, enabledRhythmIds: [rhythm.id] });
    const melodic = generateExercise(s, [], () => 0.4, 1, registry);
    const uniform = generateExercise(
      { ...s, melody: { ...s.melody, style: "uniform" } },
      [],
      () => 0.4,
      1,
      registry,
    );
    const timing = (e: Exercise) =>
      e.events.map((event) => ({
        kind: event.kind,
        onset: event.onsetTicks,
        duration: event.durationTicks,
      }));
    expect(timing(melodic)).toEqual(timing(uniform));
    expect(melodic.totalTicks).toBe(uniform.totalTicks);
    expect(melodic.events.some((event) => event.kind === "rest")).toBe(true);
  });

  it("retains independent uniform sampling and exact user patterns", () => {
    const random = [0, 0, 0.999, 0, 0.999];
    const uniform = generateExercise(
      settings({ style: "uniform" }, { noteCount: 4, rhythmMode: "even" }),
      [],
      () => random.shift() ?? 0,
    );
    expect(pitches(uniform)).toEqual([60, 72, 60, 72]);
    expect(intervals(pitches(uniform)).some((distance) => distance > 7)).toBe(
      true,
    );
    const pattern = generateExercise(
      settings(
        { maxLeap: 1, chromaticism: "adventurous", contour: "falling" },
        {
          generationMode: "patterns",
          noteCount: 5,
          enabledPatternIds: ["return_five"],
        },
      ),
      [],
      () => 0,
    );
    expect(pitches(pattern)).toEqual([60, 62, 64, 62, 60]);
    expect(pattern.source).toBe("preset");
    expect(pattern.melody).toBeUndefined();
  });

  it("rejects invalid constraints rather than silently replacing them", () => {
    for (const melody of [
      { maxLeap: 0 },
      { maxLeap: 13 },
      { variation: -1 },
      { randomizeVariation: true, variationMin: 70, variationMax: 30 },
    ]) {
      expect(validateSettings(settings(melody))).not.toEqual([]);
      expect(() => generateExercise(settings(melody), [], seeded(1))).toThrow();
    }
  });
});

describe("harmonic and chromatic guidance", () => {
  it("plans chord spans and ends on a tone of the final chord", () => {
    for (const harmony of ["tonic", "I-IV-V-I", "ii7-V7-Imaj7"] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const exercise = generateExercise(
          settings(
            { harmony, chordEmphasis: "high" },
            {
              lowMidi: 55,
              highMidi: 79,
              noteCount: 16,
              rhythmMode: "even",
              keyScales: [{ tonicPc: 7, scaleId: "major" }],
            },
          ),
          [],
          seeded(seed),
        );
        const chords = exercise.melody!.chords;
        expect(chords.length).toBe(
          harmony === "tonic" ? 1 : harmony === "I-IV-V-I" ? 4 : 3,
        );
        expect(chords[0].startTicks).toBe(0);
        expect(chords.at(-1)!.endTicks).toBe(exercise.totalTicks);
        expect(chords.at(-1)!.pitchClasses).toContain(
          pc(pitches(exercise).at(-1)!),
        );
        expect(
          intervals(pitches(exercise)).every((distance) => distance <= 7),
        ).toBe(true);
      }
    }
  });

  it("increases harmonic anchoring when chord emphasis is raised", () => {
    const chordToneRate = (chordEmphasis: "low" | "high") => {
      let chordTones = 0,
        tested = 0;
      for (let seed = 1; seed <= 96; seed++) {
        const exercise = generateExercise(
          settings(
            { harmony: "tonic", chordEmphasis, variation: 60 },
            { noteCount: 16, rhythmMode: "even" },
          ),
          [],
          seeded(seed),
        );
        for (const event of notes(exercise)) {
          if (event.onsetTicks % 960 !== 0) continue;
          const chord = exercise.melody!.chords.find(
            (c) =>
              event.onsetTicks >= c.startTicks && event.onsetTicks < c.endTicks,
          )!;
          tested++;
          if (chord.pitchClasses.includes(pc(event.midi))) chordTones++;
        }
      }
      return chordTones / tested;
    };
    expect(chordToneRate("high")).toBeGreaterThan(chordToneRate("low") + 0.05);
  });

  it("makes rising and falling contour preferences audibly distinct in aggregate", () => {
    const movement = (contour: "rising" | "falling") => {
      let sum = 0;
      for (let seed = 1; seed <= 64; seed++) {
        const values = pitches(
          generateExercise(
            settings(
              { contour },
              { noteCount: 16, lowMidi: 48, highMidi: 84, rhythmMode: "even" },
            ),
            [],
            seeded(seed),
          ),
        );
        sum += values.at(-1)! - values[0];
      }
      return sum / 64;
    };
    expect(movement("rising")).toBeGreaterThan(movement("falling") + 3);
  });

  it("uses resolved chromatic approaches without adding attacks or crossing rests", () => {
    let chromaticCount = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const exercise = generateExercise(
        settings(
          { chromaticism: "adventurous", harmony: "tonic" },
          {
            noteCount: 16,
            lowMidi: 60,
            highMidi: 79,
          },
        ),
        [],
        seeded(seed),
      );
      const allNotes = notes(exercise);
      expect(allNotes).toHaveLength(16);
      expect(
        intervals(pitches(exercise)).every((distance) => distance <= 7),
      ).toBe(true);
      const inScale = (midi: number) =>
        (SCALES.major as readonly number[]).includes(pc(midi));
      expect(inScale(allNotes.at(-1)!.midi)).toBe(true);
      allNotes.forEach((event, i) => {
        if (inScale(event.midi)) return;
        chromaticCount++;
        const next = allNotes[i + 1];
        expect(next).toBeDefined();
        expect(Math.abs(next.midi - event.midi)).toBe(1);
        expect(inScale(next.midi)).toBe(true);
        expect(event.onsetTicks + event.durationTicks).toBe(next.onsetTicks);
        expect(event.durationTicks).toBeLessThanOrEqual(480);
      });
    }
    expect(chromaticCount).toBeGreaterThan(0);
  });

  it("fails an impossible harmonic ending without changing the range", () => {
    const s = settings(
      { harmony: "tonic" },
      { lowMidi: 62, highMidi: 62, noteCount: 4, rhythmMode: "even" },
    );
    expect(() => generateExercise(s, [], seeded(1))).toThrow();
  });

  it("supports every contour while preserving scale, range and maximum leap", () => {
    for (const contour of [
      "free",
      "rising",
      "falling",
      "arch",
      "returning",
    ] as const) {
      const s = settings(
        { contour, maxLeap: 4 },
        { noteCount: 16, lowMidi: 48, highMidi: 84, rhythmMode: "even" },
      );
      for (let seed = 1; seed <= 8; seed++) {
        const values = pitches(generateExercise(s, [], seeded(seed)));
        expect(values).toHaveLength(16);
        expect(
          values.every(
            (m) =>
              m >= 48 &&
              m <= 84 &&
              (SCALES.major as readonly number[]).includes(pc(m)),
          ),
        ).toBe(true);
        expect(intervals(values).every((d) => d <= 4)).toBe(true);
      }
    }
  });

  it("leaves single-note and long-tone exercises independent of melodic rules", () => {
    for (const exerciseMode of ["single", "timed", "long-tone"] as const) {
      const exercise = generateExercise(
        settings(
          { maxLeap: 1, harmony: "ii7-V7-Imaj7", chromaticism: "adventurous" },
          {
            exerciseMode,
          },
        ),
        [],
        seeded(7),
      );
      expect(notes(exercise)).toHaveLength(1);
      expect(exercise.melody).toBeUndefined();
    }
  });
});

describe("harmonic preset data", () => {
  it("parses shipped progressions and rejects malformed harmonic contracts", () => {
    expect(parseHarmonyPresets(harmonyText).map((p) => p.id)).toEqual(
      expect.arrayContaining(["I-IV-V-I", "ii7-V7-Imaj7"]),
    );
    for (const text of [
      harmonyText.replace("schema_version = 1", "schema_version = 2"),
      harmonyText.replace(
        "root_offsets = [0, 5, 7, 0]",
        "root_offsets = [0, 5, 12, 0]",
      ),
      harmonyText.replace(
        '"major", "major", "major", "major"',
        '"major", "unknown", "major", "major"',
      ),
      harmonyText + "\nunknown_field = 1\n",
    ])
      expect(() => parseHarmonyPresets(text)).toThrow();
  });
});

describe("automatic key and scale selection", () => {
  it("starts with saxophone and alto notation while retaining the generated key separately", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      sound: "saxophone",
      pitchView: "alto-eb",
      keyScales: [],
    });
    const selected = new Set<string>();
    const scales = new Set<string>();
    for (let seed = 1; seed <= 48; seed++) {
      const exercise = generateExercise(
        structuredClone(DEFAULT_SETTINGS),
        [],
        seeded(seed * 2654435761),
      );
      expect(exercise.snapshot.keyScales).toEqual([]);
      expect(exercise.keyScale.tonicPc).toBeGreaterThanOrEqual(0);
      expect(exercise.keyScale.tonicPc).toBeLessThanOrEqual(11);
      const offsets = SCALES[exercise.keyScale.scaleId] as readonly number[];
      expect(
        pitches(exercise).every((p) =>
          offsets.includes(pc(p - exercise.keyScale.tonicPc)),
        ),
      ).toBe(true);
      selected.add(`${exercise.keyScale.tonicPc}/${exercise.keyScale.scaleId}`);
      scales.add(exercise.keyScale.scaleId);
    }
    expect(selected.size).toBeGreaterThan(1);
    expect(scales.size).toBeGreaterThan(1);
    expect(DEFAULT_SETTINGS.keyScales).toEqual([]);
  });

  it("filters automatic progression choices but reports invalid explicit selections", () => {
    const automatic = settings(
      { harmony: "ii7-V7-Imaj7" },
      { keyScales: [], noteCount: 16 },
    );
    expect(validateSettings(automatic)).toEqual([]);
    for (let seed = 1; seed <= 24; seed++) {
      const exercise = generateExercise(
        automatic,
        [],
        seeded(seed * 2654435761),
      );
      expect(exercise.keyScale.scaleId).toBe("major");
      expect(exercise.melody!.chords.at(-1)!.pitchClasses).toContain(
        pc(pitches(exercise).at(-1)!),
      );
    }
    const explicit = {
      ...automatic,
      keyScales: [
        { tonicPc: 0, scaleId: "major" },
        { tonicPc: 9, scaleId: "natural-minor" },
      ],
    } as Settings;
    expect(validateSettings(explicit)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Major/)]),
    );
    expect(() => generateExercise(explicit, [], seeded(1))).toThrow(/Major/);
    expect(explicit.keyScales).toHaveLength(2);
  });

  it("chooses only fitting automatic pattern keys and fails when none can fit", () => {
    const s = settings(
      {},
      {
        keyScales: [],
        generationMode: "patterns",
        noteCount: 3,
        lowMidi: 60,
        highMidi: 64,
        enabledPatternIds: ["ascending_three"],
      },
    );
    for (let seed = 1; seed <= 24; seed++) {
      const exercise = generateExercise(s, [], seeded(seed * 2654435761));
      expect(exercise.source).toBe("preset");
      expect(pitches(exercise)).toHaveLength(3);
      expect(pitches(exercise).every((p) => p >= 60 && p <= 64)).toBe(true);
    }
    expect(() =>
      generateExercise({ ...s, lowMidi: 60, highMidi: 60 }, [], seeded(1)),
    ).toThrow();
  });

  it("selects a scale containing a fixed manual long-tone target", () => {
    const s = settings({}, { exerciseMode: "long-tone", keyScales: [] });
    for (let seed = 1; seed <= 12; seed++) {
      const exercise = generateExercise(s, [], seeded(seed * 2654435761));
      expect(pitches(exercise)).toEqual([60]);
      expect(
        (SCALES[exercise.keyScale.scaleId] as readonly number[]).includes(
          pc(60 - exercise.keyScale.tonicPc),
        ),
      ).toBe(true);
    }
  });
});
