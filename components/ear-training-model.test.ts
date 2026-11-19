import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  SCALES,
  automaticRhythm,
  degreeMidi,
  fittingTonics,
  generateExercise,
  generateRoutine,
  keySignature,
  parseDegrees,
  parseNoteName,
  scalePool,
  spellPitch,
  tickSeconds,
  validateSettings,
  type Settings,
} from "./ear-training-model";
import {
  parsePresets,
  presetRegistry,
  presetError,
} from "./ear-training-presets";
import patternText from "../data/ear_training_patterns.toml?raw";
import rhythmText from "../data/ear_training_rhythms.toml?raw";
import routineText from "../data/ear_training_long_tones.toml?raw";
const settings = (patch: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  sound: "piano",
  pitchView: "concert",
  lowMidi: 60,
  highMidi: 72,
  keyScales: [{ tonicPc: 0, scaleId: "major" }],
  ...patch,
  longTone: { ...DEFAULT_SETTINGS.longTone, ...patch.longTone },
});
describe("ear training preset schema", () => {
  it("parses shipped data and rejects malformed contracts", () => {
    expect(presetError).toBeNull();
    expect(presetRegistry.routines).toHaveLength(8);
    expect(
      parsePresets(patternText, rhythmText, routineText).patterns,
    ).toHaveLength(3);
    for (const [p, r, l] of [
      [
        patternText.replace("schema_version = 1", "schema_version = 2"),
        rhythmText,
        routineText,
      ],
      [patternText + "\nunknown = 5\n", rhythmText, routineText],
      [
        patternText.replace(
          'rhythm_id = "three_note"',
          'rhythm_id = "missing"',
        ),
        rhythmText,
        routineText,
      ],
      [patternText.replace("[1, 2, 3]", "[1, 2]"), rhythmText, routineText],
      [
        patternText,
        rhythmText.replace("ticks = 480", "ticks = 0"),
        routineText,
      ],
      [
        patternText,
        rhythmText.replace('id = "long_short"', 'id = "quarter"'),
        routineText,
      ],
      [
        patternText,
        rhythmText,
        routineText.replace("hold_ms = 5000", "hold_ms = 5123"),
      ],
      [
        patternText,
        rhythmText,
        routineText.replace("tonic_midi = 67", "tonic_midi = 127"),
      ],
    ])
      expect(() => parsePresets(p, r, l)).toThrow();
  });
});
describe("pitch and rhythmic generation", () => {
  it("expands every scale through upper octaves and includes range edges", () => {
    for (const scaleId of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      const offsets = SCALES[scaleId];
      expect(scalePool({ tonicPc: 0, scaleId }, 60, 72)).toEqual([
        ...offsets.map((d) => 60 + d),
        72,
      ]);
      expect(degreeMidi(60, scaleId, offsets.length + 1)).toBe(72);
    }
    expect(
      fittingTonics(
        { degrees: [1, 8] },
        { tonicPc: 0, scaleId: "major" },
        60,
        72,
      ),
    ).toEqual([60]);
    expect(
      fittingTonics(
        { degrees: [1, 8] },
        { tonicPc: 0, scaleId: "major" },
        61,
        72,
      ),
    ).toEqual([]);
  });
  it("produces varied complete rhythms for lengths 2–16 and rejects unreachable counts", () => {
    for (let n = 2; n <= 16; n++) {
      const result = automaticRhythm(n, presetRegistry.rhythms, () => 0);
      const notes = result.events.filter((e) => e.kind === "note");
      expect(notes).toHaveLength(n);
      expect(new Set(notes.map((e) => e.ticks)).size).toBeGreaterThan(1);
    }
    expect(() =>
      automaticRhythm(3, [presetRegistry.rhythms[0]], () => 0),
    ).toThrow(/No varied rhythm/);
    expect(
      automaticRhythm(1, [presetRegistry.rhythms[0]], () => 0).events,
    ).toHaveLength(1);
  });
  it("matches the return fixture and snapshots nested settings", () => {
    const s = settings({
      generationMode: "patterns",
      noteCount: 5,
      bpm: 120,
      enabledPatternIds: ["return_five"],
    });
    const e = generateExercise(s, [], () => 0, 12);
    expect(e.events).toEqual([
      {
        kind: "note",
        midi: 60,
        noteIndex: 0,
        onsetTicks: 0,
        durationTicks: 480,
      },
      {
        kind: "note",
        midi: 62,
        noteIndex: 1,
        onsetTicks: 480,
        durationTicks: 240,
      },
      {
        kind: "note",
        midi: 64,
        noteIndex: 2,
        onsetTicks: 720,
        durationTicks: 240,
      },
      { kind: "rest", onsetTicks: 960, durationTicks: 240 },
      {
        kind: "note",
        midi: 62,
        noteIndex: 3,
        onsetTicks: 1200,
        durationTicks: 240,
      },
      {
        kind: "note",
        midi: 60,
        noteIndex: 4,
        onsetTicks: 1440,
        durationTicks: 480,
      },
    ]);
    expect(tickSeconds(e.totalTicks, e.snapshot.bpm)).toBe(2);
    s.longTone.targetMidi = 70;
    expect(e.snapshot.longTone.targetMidi).toBe(60);
    expect(Object.isFrozen(e.snapshot.keyScales)).toBe(true);
  });
  it("uses one selected key and source, rejects ineligible mixed practice", () => {
    const s = settings({
      keyScales: [
        { tonicPc: 0, scaleId: "major" },
        { tonicPc: 7, scaleId: "major" },
      ],
      generationMode: "mixed",
      rhythmMode: "even",
    });
    const e = generateExercise(s, [], () => 0.99);
    expect(e.keyScale.tonicPc).toBe(7);
    expect(e.source).toBe("preset");
    expect(e.events.filter((e) => e.kind === "note")).toHaveLength(3);
    expect(generateExercise(s, [], () => 0).source).toBe("random");
    expect(validateSettings({ ...s, noteCount: 16 })).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no enabled fitting pattern/),
      ]),
    );
    expect(validateSettings(settings({ lowMidi: 61, highMidi: 61 }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/no notes/)]),
    );
  });
  it("single and timed bypass phrase options; custom patterns validate", () => {
    const e = generateExercise(
      settings({
        exerciseMode: "timed",
        generationMode: "patterns",
        enabledPatternIds: [],
        enabledRhythmIds: [],
        noteCount: 16,
      }),
      [],
      () => 0,
    );
    expect(e.events).toHaveLength(1);
    expect(e.totalTicks).toBe(480);
    expect(parseDegrees("1-2, 3 2 1")).toEqual([1, 2, 3, 2, 1]);
    expect(() => parseDegrees("1,0")).toThrow();
  });
});
describe("pitch display", () => {
  it("transposes display without changing sound and spells key-specific accidentals", () => {
    const k = { tonicPc: 0, scaleId: "major" } as const;
    expect(
      [60, 62, 64, 62, 60].map((m) => spellPitch(m, k, "alto-eb").name),
    ).toEqual(["A4", "B4", "C#5", "B4", "A4"]);
    expect(keySignature(k, "alto-eb")).toBe("A");
    expect(spellPitch(66, { tonicPc: 1, scaleId: "major" }).name).toBe("Gb4");
    expect(spellPitch(68, { tonicPc: 9, scaleId: "harmonic-minor" }).name).toBe(
      "G#4",
    );
    expect(spellPitch(66, { tonicPc: 0, scaleId: "minor-blues" }).name).toBe(
      "Gb4",
    );
    expect(spellPitch(60, { tonicPc: 1, scaleId: "harmonic-minor" }).name).toBe(
      "B#3",
    );
    expect(parseNoteName("B#3")).toBe(60);
    expect(parseNoteName("Cb4")).toBe(59);
    expect(parseNoteName("Bb3", "alto-eb")).toBe(49);
  });
});
describe("written G major on E-flat alto saxophone", () => {
  const concertKey = { tonicPc: 10, scaleId: "major" } as const;
  const concertPitches = [58, 60, 62, 63, 65, 67, 69, 70];
  const writtenNames = ["G4", "A4", "B4", "C5", "D5", "E5", "F#5", "G5"];

  it("spells concert Bb major as written G major and exactly inverts every note", () => {
    expect(keySignature(concertKey, "alto-eb")).toBe("G");
    expect(keySignature(concertKey, "concert")).toBe("Bb");
    expect(
      concertPitches.map((p) => spellPitch(p, concertKey, "alto-eb").name),
    ).toEqual(writtenNames);
    expect(writtenNames.map((name) => parseNoteName(name, "alto-eb"))).toEqual(
      concertPitches,
    );
    expect(parseNoteName("G4", "alto-eb")).toBe(58);
    expect(concertPitches).toEqual([58, 60, 62, 63, 65, 67, 69, 70]);
  });

  it("keeps generated audio in concert Bb when either display or sound changes", () => {
    const scalePattern = {
      id: "custom_alto_g_scale",
      name: "Written G scale",
      degrees: [1, 2, 3, 4, 5, 6, 7, 8],
      rhythmId: "automatic",
    };
    const s = settings({
      sound: "saxophone",
      pitchView: "alto-eb",
      keyScales: [concertKey],
      lowMidi: 58,
      highMidi: 70,
      noteCount: 8,
      generationMode: "patterns",
      rhythmMode: "even",
      enabledPatternIds: [scalePattern.id],
    });
    const sax = generateExercise(s, [scalePattern], () => 0, 801);
    const originalEvents = JSON.stringify(sax.events);
    expect(sax.keyScale).toEqual(concertKey);
    expect(
      sax.events.filter((e) => e.kind === "note").map((e) => e.midi),
    ).toEqual(concertPitches);
    expect(
      sax.events
        .filter((e) => e.kind === "note")
        .map((e) => spellPitch(e.midi, sax.keyScale, "alto-eb").name),
    ).toEqual(writtenNames);
    for (const sound of ["piano", "saxophone"] as const) {
      for (const pitchView of ["concert", "alto-eb"] as const) {
        const exercise = generateExercise(
          { ...s, sound, pitchView },
          [scalePattern],
          () => 0,
          802,
        );
        expect(exercise.events).toEqual(sax.events);
        expect(exercise.keyScale).toEqual(concertKey);
      }
    }
    expect(JSON.stringify(sax.events)).toBe(originalEvents);
    expect(sax.snapshot.pitchView).toBe("alto-eb");
    expect(sax.snapshot.lowMidi).toBe(58);
    expect(sax.snapshot.highMidi).toBe(70);
  });
});

describe("manual long tones", () => {
  it("has preparation, one continuous attack, and recovery at the defaults", () => {
    const e = generateExercise(
      settings({ exerciseMode: "long-tone" }),
      [],
      () => 0,
    );
    expect(e.source).toBe("long-tone");
    expect(e.events).toEqual([
      { kind: "rest", onsetTicks: 0, durationTicks: 960 },
      {
        kind: "note",
        midi: 60,
        noteIndex: 0,
        onsetTicks: 960,
        durationTicks: 3840,
      },
      { kind: "rest", onsetTicks: 4800, durationTicks: 1920 },
    ]);
    expect(tickSeconds(e.totalTicks, 80)).toBe(10.5);
  });
  it("supports 24-second holds, zero recovery, and fixed/random validation", () => {
    const e = generateExercise(
      settings({
        exerciseMode: "long-tone",
        bpm: 40,
        longTone: {
          ...DEFAULT_SETTINGS.longTone,
          holdBeats: 16,
          recoveryBeats: 0,
          target: "random",
        },
      }),
      [],
      () => 0.99,
    );
    expect(e.events).toHaveLength(2);
    expect(tickSeconds(e.events[1].durationTicks, 40)).toBe(24);
    expect(e.events[1]).toMatchObject({ midi: 72 });
    expect(
      validateSettings(
        settings({
          exerciseMode: "long-tone",
          longTone: { ...DEFAULT_SETTINGS.longTone, targetMidi: 61 },
        }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/Fixed target/)]));
  });
});
describe("timed routine plans", () => {
  const routineSettings = (routineId: string) =>
    settings({
      exerciseMode: "long-tone",
      longTone: {
        ...DEFAULT_SETTINGS.longTone,
        practice: "routine",
        routineId,
      },
    });
  it("matches all eight totals and counts without losing complete final rests", () => {
    const counts = [42, 30, 30, 24, 30, 25, 24, 20];
    presetRegistry.routines.forEach((r, i) => {
      const plan = generateRoutine(routineSettings(r.id), 1);
      expect(plan.holdCount).toBe(counts[i]);
      expect(plan.totalTicks).toBe(r.totalMs * 0.48);
      expect(plan.cooldownMs).toBe(i === 0 ? 6000 : 0);
      expect(plan.holds.every((h) => h.endMs - h.onsetMs === r.holdMs)).toBe(
        true,
      );
    });
  });
  it("matches the five-minute fixture exactly and ignores shared tempo", () => {
    const s = routineSettings("g_major_five_minutes"),
      p = generateRoutine(s);
    expect(p.holds.slice(0, 14).map((h) => h.midi)).toEqual([
      67, 69, 71, 72, 74, 76, 78, 79, 78, 76, 74, 72, 71, 69,
    ]);
    expect(p.holds).toHaveLength(42);
    expect(p.holds.at(-1)).toMatchObject({ onsetMs: 287000, endMs: 292000 });
    expect(
      p.events
        .filter((e) => e.kind === "note")
        .reduce((n, e) => n + e.durationTicks, 0) / 480,
    ).toBe(210);
    expect(p.totalTicks).toBe(144000);
    expect(p.transportBpm).toBe(60);
    expect(generateRoutine({ ...s, bpm: 200 }).events).toEqual(p.events);
  });
  it("converts alto basis, uses minor degrees and triads, and includes preparation", () => {
    expect(
      new Set(
        generateRoutine(routineSettings("alto_g_repeated_tonic")).holds.map(
          (h) => h.midi,
        ),
      ),
    ).toEqual(new Set([58]));
    expect(
      generateRoutine(routineSettings("alto_g_octave_alternation"))
        .holds.slice(0, 2)
        .map((h) => h.midi),
    ).toEqual([58, 70]);
    expect(
      generateRoutine(routineSettings("d_major_triad_tones"))
        .holds.slice(0, 4)
        .map((h) => h.midi),
    ).toEqual([62, 66, 69, 66]);
    expect(
      generateRoutine(routineSettings("a_minor_scale_loop"))
        .holds.slice(0, 8)
        .map((h) => h.midi),
    ).toEqual([57, 59, 60, 62, 64, 65, 67, 69]);
    const r = { ...presetRegistry.routines[0], preparationMs: 1000 };
    const registry = { ...presetRegistry, routines: [r] };
    const p = generateRoutine(routineSettings(r.id), 1, registry);
    expect(p.holds[0].onsetMs).toBe(1000);
    expect(p.totalMs).toBe(300000);
    expect(p.cooldownMs).toBe(5000);
  });
});

describe("automatic key and scale selection", () => {
  it("defaults to saxophone, alto written view, and automatic key/scale", () => {
    expect(DEFAULT_SETTINGS.sound).toBe("saxophone");
    expect(DEFAULT_SETTINGS.pitchView).toBe("alto-eb");
    expect(DEFAULT_SETTINGS.keyScales).toEqual([]);
    expect(DEFAULT_SETTINGS.lowMidi).toBe(49);
    expect(DEFAULT_SETTINGS.highMidi).toBe(81);
    expect(
      spellPitch(49, { tonicPc: 1, scaleId: "major" }, "alto-eb").name,
    ).toBe("Bb3");
    expect(
      spellPitch(81, { tonicPc: 1, scaleId: "major" }, "alto-eb").name,
    ).toBe("F#6");
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
    const first = generateExercise(DEFAULT_SETTINGS, [], () => 0);
    const last = generateExercise(DEFAULT_SETTINGS, [], () => 0.999);
    expect(first.keyScale).not.toEqual(last.keyScale);
    expect(first.snapshot.keyScales).toEqual([]);
  });
  it("automatically selects playable combinations for single notes and narrow ranges", () => {
    for (const exerciseMode of ["single", "timed", "phrase"] as const) {
      const s = settings({
        keyScales: [],
        exerciseMode,
        lowMidi: 61,
        highMidi: 61,
      });
      expect(validateSettings(s)).toEqual([]);
      const exercise = generateExercise(s, [], () => 0.99);
      expect(
        exercise.events
          .filter((e) => e.kind === "note")
          .every((e) => e.midi === 61),
      ).toBe(true);
      expect(scalePool(exercise.keyScale, 61, 61)).toEqual([61]);
    }
  });
  it("filters automatic pattern and mixed choices rather than rejecting unrelated scales", () => {
    const custom = [
      {
        id: "custom_pair",
        name: "Pair",
        degrees: [1, 2],
        rhythmId: "automatic",
      },
    ];
    for (const generationMode of ["patterns", "mixed"] as const) {
      const s = settings({
        keyScales: [],
        generationMode,
        noteCount: 2,
        lowMidi: 60,
        highMidi: 61,
        enabledPatternIds: ["custom_pair"],
      });
      expect(validateSettings(s, custom)).toEqual([]);
      const exercise = generateExercise(s, custom, () => 0.99);
      expect(exercise.source).toBe("custom");
      expect(
        fittingTonics(custom[0], exercise.keyScale, 60, 61).length,
      ).toBeGreaterThan(0);
    }
    expect(
      validateSettings(
        settings({ keyScales: [], generationMode: "patterns", noteCount: 16 }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/No automatic/)]));
  });
  it("finds compatible fixed targets for manual long tones without changing pitch", () => {
    const s = settings({
      keyScales: [],
      exerciseMode: "long-tone",
      longTone: { ...DEFAULT_SETTINGS.longTone, targetMidi: 61 },
    });
    expect(validateSettings(s)).toEqual([]);
    const exercise = generateExercise(s, [], () => 0.95);
    expect(exercise.events.find((e) => e.kind === "note")).toMatchObject({
      midi: 61,
    });
    expect(scalePool(exercise.keyScale, s.lowMidi, s.highMidi)).toContain(61);
  });
  it("restricts automatically chosen harmony to compatible scales and chord targets", () => {
    for (const harmony of ["tonic", "I-IV-V-I", "ii7-V7-Imaj7"] as const) {
      const s = settings({
        keyScales: [],
        lowMidi: 61,
        highMidi: 61,
        melody: { ...DEFAULT_SETTINGS.melody, harmony },
      });
      expect(validateSettings(s)).toEqual([]);
      const exercise = generateExercise(s, [], () => 0.99);
      expect(exercise.melody).toBeDefined();
      expect(exercise.melody!.chords.at(-1)!.pitchClasses).toContain(1);
      expect(
        harmony === "tonic"
          ? exercise.keyScale.scaleId !== "chromatic"
          : exercise.keyScale.scaleId === "major",
      ).toBe(true);
    }
    const explicit = settings({
      keyScales: [{ tonicPc: 0, scaleId: "natural-minor" }],
      melody: { ...DEFAULT_SETTINGS.melody, harmony: "I-IV-V-I" },
    });
    expect(validateSettings(explicit)).toEqual(
      expect.arrayContaining([expect.stringMatching(/require Major/)]),
    );
  });
});
