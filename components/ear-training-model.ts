import {
  DEFAULT_MELODY_SETTINGS,
  generateMelodicPitches,
  validateMelodySettings,
  type MelodySettings,
  type MelodyMetadata,
} from "./ear-training-melody";
export { DEFAULT_MELODY_SETTINGS, chordLabel } from "./ear-training-melody";
import {
  presetRegistry,
  presetError,
  type PresetRegistry,
} from "./ear-training-presets";
export type PitchView = "concert" | "alto-eb";
export type SoundId = "piano" | "saxophone";
export type GenerationMode = "random" | "patterns" | "mixed";
export type ExerciseMode = "single" | "phrase" | "timed" | "long-tone";
export type VisibilityMode = "request" | "always" | "delayed";
export type RhythmMode = "varied" | "even";
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  "natural-minor": [0, 2, 3, 5, 7, 8, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  "melodic-minor-up": [0, 2, 3, 5, 7, 9, 11],
  "melodic-minor-down": [0, 2, 3, 5, 7, 8, 10],
  "major-pentatonic": [0, 2, 4, 7, 9],
  "minor-pentatonic": [0, 3, 5, 7, 10],
  "minor-blues": [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const;
export type ScaleId = keyof typeof SCALES;
export const SCALE_NAMES: Record<ScaleId, string> = {
  major: "Major",
  "natural-minor": "Natural minor",
  "harmonic-minor": "Harmonic minor",
  "melodic-minor-up": "Melodic minor (ascending)",
  "melodic-minor-down": "Melodic minor (descending)",
  "major-pentatonic": "Major pentatonic",
  "minor-pentatonic": "Minor pentatonic",
  "minor-blues": "Minor blues",
  chromatic: "Chromatic",
};
export interface KeyScale {
  tonicPc: number;
  scaleId: ScaleId;
}
export interface RhythmEvent {
  kind: "note" | "rest";
  ticks: number;
}
export interface RhythmPreset {
  id: string;
  name: string;
  events: readonly RhythmEvent[];
}
export interface MelodicPreset {
  id: string;
  name: string;
  degrees: readonly number[];
  rhythmId: string;
}
export type CustomPattern = MelodicPreset;
export interface LongToneRoutinePreset {
  id: string;
  name: string;
  pitchBasis: PitchView;
  tonicMidi: number;
  scaleId: ScaleId;
  degrees: readonly number[];
  holdMs: number;
  restMs: number;
  totalMs: number;
  preparationMs: number;
}
export interface Settings {
  melody: MelodySettings;
  exerciseMode: ExerciseMode;
  generationMode: GenerationMode;
  sound: SoundId;
  pitchView: PitchView;
  keyScales: readonly KeyScale[];
  lowMidi: number;
  highMidi: number;
  noteCount: number;
  bpm: number;
  rhythmMode: RhythmMode;
  evenTicks: number;
  enabledRhythmIds: readonly string[];
  enabledPatternIds: readonly string[];
  visibility: VisibilityMode;
  firstNoteHint: boolean;
  noteNames: boolean;
  recallSeconds: number;
  longTone: {
    practice: "manual" | "routine";
    routineId: string;
    target: "fixed" | "random";
    targetMidi: number;
    holdBeats: 4 | 8 | 16;
    recoveryBeats: 0 | 4 | 8;
  };
}
export type ExerciseEvent =
  | {
      kind: "note";
      midi: number;
      onsetTicks: number;
      durationTicks: number;
      noteIndex: number;
    }
  | { kind: "rest"; onsetTicks: number; durationTicks: number };
export interface Exercise {
  melody?: MelodyMetadata;
  id: number;
  keyScale: KeyScale;
  source: "random" | "preset" | "custom" | "long-tone";
  patternId?: string;
  rhythmIds: readonly string[];
  events: readonly ExerciseEvent[];
  totalTicks: number;
  snapshot: Readonly<Settings>;
}
export interface RoutineHold {
  midi: number;
  noteIndex: number;
  onsetTicks: number;
  durationTicks: number;
  onsetMs: number;
  endMs: number;
}
export interface RoutinePlan {
  id: number;
  presetId: string;
  sound: SoundId;
  events: readonly ExerciseEvent[];
  totalTicks: number;
  transportBpm: 60;
  repetitions: number;
  cooldownTicks: number;
  exercise: Exercise;
  holds: RoutineHold[];
  routine: LongToneRoutinePreset;
  holdCount: number;
  cooldownMs: number;
  preparationMs: number;
  totalMs: number;
}
export type LongToneRoutinePlan = RoutinePlan;
export const TICKS_PER_BEAT = 480;
export const SOUND_RANGES: Record<
  SoundId,
  { lowMidi: number; highMidi: number }
> = {
  piano: { lowMidi: 48, highMidi: 84 },
  saxophone: { lowMidi: 48, highMidi: 84 },
};
export function createDefaultSettings(
  registry: PresetRegistry = presetRegistry,
): Settings {
  return {
    melody: { ...DEFAULT_MELODY_SETTINGS },
    exerciseMode: "phrase",
    generationMode: "random",
    sound: "saxophone",
    pitchView: "alto-eb",
    keyScales: [],
    lowMidi: 49,
    highMidi: 81,
    noteCount: 3,
    bpm: 80,
    rhythmMode: "varied",
    evenTicks: 480,
    enabledRhythmIds: registry.rhythms.map((r) => r.id),
    enabledPatternIds: registry.patterns.map((p) => p.id),
    visibility: "request",
    firstNoteHint: false,
    noteNames: true,
    recallSeconds: 5,
    longTone: {
      practice: "manual",
      routineId: "c_major_short_warmup",
      target: "fixed",
      targetMidi: 60,
      holdBeats: 8,
      recoveryBeats: 4,
    },
  };
}
export const DEFAULT_SETTINGS = createDefaultSettings();
const mod = (n: number) => ((n % 12) + 12) % 12;
export function tickSeconds(ticks: number, bpm: number) {
  return (ticks * 60) / bpm / 480;
}
export function degreeMidi(tonic: number, scale: ScaleId, degree: number) {
  const offsets = SCALES[scale];
  return (
    tonic +
    12 * Math.floor((degree - 1) / offsets.length) +
    offsets[(degree - 1) % offsets.length]
  );
}
export function scalePool(key: KeyScale, low: number, high: number) {
  const out: number[] = [];
  for (let m = low; m <= high; m++)
    if (
      (SCALES[key.scaleId] as readonly number[]).includes(mod(m - key.tonicPc))
    )
      out.push(m);
  return out;
}
export function fittingTonics(
  pattern: Pick<MelodicPreset, "degrees">,
  key: KeyScale,
  low: number,
  high: number,
) {
  const out: number[] = [];
  for (let t = key.tonicPc - 48; t <= 127; t += 12)
    if (
      pattern.degrees.every((d) => {
        const m = degreeMidi(t, key.scaleId, d);
        return m >= low && m <= high;
      })
    )
      out.push(t);
  return out;
}
function choose<T>(values: readonly T[], rng: () => number): T {
  if (!values.length) throw Error("No eligible choices");
  const v = rng();
  if (!Number.isFinite(v) || v < 0 || v >= 1)
    throw Error("RNG must return a value in [0, 1)");
  return values[Math.floor(v * values.length)];
}
function snapshot(s: Settings): Readonly<Settings> {
  return Object.freeze({
    ...s,
    melody: Object.freeze({ ...s.melody }),
    longTone: Object.freeze({ ...s.longTone }),
    keyScales: Object.freeze(s.keyScales.map((k) => Object.freeze({ ...k }))),
    enabledPatternIds: Object.freeze([...s.enabledPatternIds]),
    enabledRhythmIds: Object.freeze([...s.enabledRhythmIds]),
  });
}
// Diversity state is 0 (no note yet), a note duration, or -1 (varied).
function appendDiversity(state: number, events: readonly RhythmEvent[]) {
  for (const e of events)
    if (e.kind === "note")
      state = state === 0 ? e.ticks : state === e.ticks ? state : -1;
  return state;
}
export function automaticRhythm(
  count: number,
  motifs: readonly RhythmPreset[],
  rng: () => number = Math.random,
): { events: RhythmEvent[]; rhythmIds: string[] } {
  const memo = new Map<string, boolean>();
  const notes = (m: RhythmPreset) =>
    m.events.filter((e) => e.kind === "note").length;
  function reachable(left: number, state: number): boolean {
    if (left === 0) return count === 1 || state === -1;
    const key = `${left}/${state}`;
    if (memo.has(key)) return memo.get(key)!;
    const yes = motifs.some(
      (m) =>
        notes(m) > 0 &&
        notes(m) <= left &&
        reachable(left - notes(m), appendDiversity(state, m.events)),
    );
    memo.set(key, yes);
    return yes;
  }
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 16 ||
    !reachable(count, 0)
  )
    throw Error(
      `No varied rhythm can produce ${count} notes from the selected rhythms`,
    );
  let left = count,
    state = 0;
  const events: RhythmEvent[] = [],
    rhythmIds: string[] = [];
  while (left) {
    const m = choose(
      motifs.filter(
        (m) =>
          notes(m) > 0 &&
          notes(m) <= left &&
          reachable(left - notes(m), appendDiversity(state, m.events)),
      ),
      rng,
    );
    events.push(...m.events.map((e) => ({ ...e })));
    rhythmIds.push(m.id);
    left -= notes(m);
    state = appendDiversity(state, m.events);
  }
  return { events, rhythmIds };
}
export function validateCustomPattern(
  p: CustomPattern,
  registry: PresetRegistry = presetRegistry,
): string[] {
  const errors: string[] = [];
  if (!/^custom_[a-z0-9_]+$/.test(p.id))
    errors.push("Custom pattern ID must begin custom_");
  if (!p.name.trim()) errors.push("Pattern name is required");
  if (
    !p.degrees.length ||
    p.degrees.length > 16 ||
    p.degrees.some((d) => !Number.isInteger(d) || d < 1 || d > 28)
  )
    errors.push("Use 1–16 degrees, each an integer from 1 to 28");
  if (p.rhythmId !== "automatic") {
    const r = registry.rhythms.find((r) => r.id === p.rhythmId);
    if (!r) errors.push("Unknown pattern rhythm");
    else if (
      r.events.filter((e) => e.kind === "note").length !== p.degrees.length
    )
      errors.push("Pattern degrees must match rhythm note count");
  }
  return errors;
}
export function parseDegrees(text: string): number[] {
  if (!/^\s*\d+(?:[\s,–-]+\d+)*\s*$/.test(text))
    throw Error(
      "Enter positive degrees separated by spaces, commas, or hyphens",
    );
  const ds = text
    .trim()
    .split(/[\s,–-]+/)
    .map(Number);
  if (!ds.length || ds.length > 16 || ds.some((d) => d < 1 || d > 28))
    throw Error("Use 1–16 degrees between 1 and 28");
  return ds;
}
/** Explicit selections are validated as entered; an empty selection means automatic. */
function keys(
  s: Settings,
  custom: readonly CustomPattern[] = [],
  registry: PresetRegistry = presetRegistry,
): KeyScale[] {
  if (s.keyScales.length)
    return s.keyScales.filter(
      (k, i, a) =>
        a.findIndex(
          (v) => v.tonicPc === k.tonicPc && v.scaleId === k.scaleId,
        ) === i,
    );
  if (
    !Number.isInteger(s.lowMidi) ||
    !Number.isInteger(s.highMidi) ||
    s.lowMidi < 0 ||
    s.highMidi > 127 ||
    s.lowMidi > s.highMidi
  )
    return [];
  const melodic =
    s.exerciseMode === "phrase" &&
    s.generationMode !== "patterns" &&
    s.melody.style === "melodic";
  const harmony = melodic ? s.melody.harmony : "scale-only";
  const scaleIds = (Object.keys(SCALES) as ScaleId[]).filter((scaleId) =>
    harmony === "I-IV-V-I" || harmony === "ii7-V7-Imaj7"
      ? scaleId === "major"
      : harmony === "tonic"
        ? scaleId !== "chromatic"
        : true,
  );
  const choices: KeyScale[] = [];
  for (let tonicPc = 0; tonicPc < 12; tonicPc++)
    for (const scaleId of scaleIds) {
      const key = { tonicPc, scaleId };
      const pool = scalePool(key, s.lowMidi, s.highMidi);
      if (!pool.length) continue;
      if (
        s.exerciseMode === "long-tone" &&
        s.longTone.target === "fixed" &&
        !pool.includes(s.longTone.targetMidi)
      )
        continue;
      if (
        s.exerciseMode === "phrase" &&
        s.generationMode !== "random" &&
        !eligible(s, key, custom, registry).length
      )
        continue;
      if (harmony !== "scale-only") {
        const major = scaleId === "major" || scaleId === "major-pentatonic";
        const finalOffsets =
          harmony === "ii7-V7-Imaj7" ? [0, 4, 7, 11] : [0, major ? 4 : 3, 7];
        if (!pool.some((p) => finalOffsets.includes(mod(p - tonicPc))))
          continue;
      }
      choices.push(key);
    }
  return choices;
}
function eligible(
  s: Settings,
  key: KeyScale,
  custom: readonly CustomPattern[],
  registry: PresetRegistry,
) {
  return [...registry.patterns, ...custom].filter(
    (p) =>
      s.enabledPatternIds.includes(p.id) &&
      p.degrees.length === s.noteCount &&
      fittingTonics(p, key, s.lowMidi, s.highMidi).length,
  );
}
export function validateSettings(
  s: Settings,
  custom: readonly CustomPattern[] = [],
  registry: PresetRegistry = presetRegistry,
): string[] {
  const errors: string[] = [];
  if (registry === presetRegistry && presetError) errors.push(presetError);
  const range = SOUND_RANGES[s.sound];
  if (!range) errors.push("Choose a supported sound");
  if (!Number.isInteger(s.bpm) || s.bpm < 40 || s.bpm > 200)
    errors.push("Tempo must be 40–200 BPM");
  if (
    !Number.isInteger(s.recallSeconds) ||
    s.recallSeconds < 1 ||
    s.recallSeconds > 60
  )
    errors.push("Recall must be 1–60 seconds");
  if (s.exerciseMode === "long-tone" && s.longTone.practice === "routine") {
    const r = registry.routines.find((r) => r.id === s.longTone.routineId);
    if (!r) errors.push("Choose a routine");
    else {
      const pitches = r.degrees.map(
        (d) =>
          degreeMidi(r.tonicMidi, r.scaleId, d) -
          (r.pitchBasis === "alto-eb" ? 9 : 0),
      );
      if (range && pitches.some((m) => m < range.lowMidi || m > range.highMidi))
        errors.push("Routine pitches are outside the sound supported range");
      if (s.pitchView === "alto-eb" && pitches.some((m) => m + 9 > 127))
        errors.push("Alto display exceeds MIDI 127");
    }
    return errors;
  }
  if (
    !Number.isInteger(s.lowMidi) ||
    !Number.isInteger(s.highMidi) ||
    s.lowMidi < 0 ||
    s.highMidi > 127 ||
    s.lowMidi > s.highMidi
  )
    errors.push("Range must be ordered integer MIDI pitches 0–127");
  if (range && (s.lowMidi < range.lowMidi || s.highMidi > range.highMidi))
    errors.push(
      `Sound supports concert MIDI ${range.lowMidi}–${range.highMidi}`,
    );
  if (s.pitchView === "alto-eb" && s.highMidi + 9 > 127)
    errors.push("Alto display exceeds MIDI 127");
  const ks = keys(s, custom, registry);
  if (!ks.length)
    errors.push(
      "No automatic key and scale fits the current range, harmony, and patterns; widen the range or adjust practice settings",
    );
  if (
    ks.some(
      (k) =>
        !Number.isInteger(k.tonicPc) ||
        k.tonicPc < 0 ||
        k.tonicPc > 11 ||
        !(k.scaleId in SCALES),
    )
  )
    return [...errors, "Invalid key or scale"];
  if (errors.length) return errors;
  const fixed = s.exerciseMode === "long-tone" && s.longTone.target === "fixed";
  if (!fixed)
    for (const k of ks)
      if (!scalePool(k, s.lowMidi, s.highMidi).length)
        errors.push(`${keyLabel(k)} has no notes in range`);
  if (s.exerciseMode === "long-tone") {
    if (
      ![4, 8, 16].includes(s.longTone.holdBeats) ||
      ![0, 4, 8].includes(s.longTone.recoveryBeats)
    )
      errors.push("Invalid hold or recovery beats");
    if (
      fixed &&
      (!Number.isInteger(s.longTone.targetMidi) ||
        s.longTone.targetMidi < s.lowMidi ||
        s.longTone.targetMidi > s.highMidi ||
        !ks.some((k) =>
          scalePool(k, s.lowMidi, s.highMidi).includes(s.longTone.targetMidi),
        ))
    )
      errors.push("Fixed target must be in range and a selected scale");
    return errors;
  }
  if (s.exerciseMode !== "phrase") return errors;
  if (!Number.isInteger(s.noteCount) || s.noteCount < 1 || s.noteCount > 16)
    return [...errors, "Phrase length must be 1–16"];
  if (s.generationMode !== "patterns")
    errors.push(...validateMelodySettings(s.melody, ks));
  for (const p of custom) errors.push(...validateCustomPattern(p, registry));
  if (new Set(custom.map((p) => p.id)).size !== custom.length)
    errors.push("Custom pattern IDs must be unique");
  if (
    s.enabledRhythmIds.some((id) => !registry.rhythms.some((r) => r.id === id))
  )
    errors.push("Unknown enabled rhythm");
  if (
    s.enabledPatternIds.some(
      (id) => ![...registry.patterns, ...custom].some((p) => p.id === id),
    )
  )
    errors.push("Unknown enabled pattern");
  if (s.generationMode !== "random")
    for (const k of ks)
      if (!eligible(s, k, custom, registry).length)
        errors.push(
          `${keyLabel(k)} has no enabled fitting pattern of ${s.noteCount} notes`,
        );
  if (s.rhythmMode === "even") {
    if (![240, 480, 960].includes(s.evenTicks))
      errors.push("Even duration must be an eighth, quarter, or half note");
  } else {
    const needsAutomatic =
      s.generationMode !== "patterns" ||
      ks.some((k) =>
        eligible(s, k, custom, registry).some(
          (p) => p.rhythmId === "automatic",
        ),
      );
    if (needsAutomatic)
      try {
        automaticRhythm(
          s.noteCount,
          registry.rhythms.filter((r) => s.enabledRhythmIds.includes(r.id)),
          () => 0,
        );
      } catch (e) {
        errors.push(String(e));
      }
  }
  return errors;
}
function zip(pitches: readonly number[], rhythm: readonly RhythmEvent[]) {
  let onsetTicks = 0,
    noteIndex = 0;
  const events: ExerciseEvent[] = rhythm.map((e) => {
    const event: ExerciseEvent =
      e.kind === "note"
        ? {
            kind: "note",
            midi: pitches[noteIndex],
            noteIndex: noteIndex++,
            onsetTicks,
            durationTicks: e.ticks,
          }
        : { kind: "rest", onsetTicks, durationTicks: e.ticks };
    onsetTicks += e.ticks;
    return Object.freeze(event);
  });
  return { events: Object.freeze(events), totalTicks: onsetTicks };
}
export function generateExercise(
  s: Settings,
  custom: readonly CustomPattern[] = [],
  rng: () => number = Math.random,
  id = Date.now(),
  registry: PresetRegistry = presetRegistry,
): Exercise {
  const errors = validateSettings(s, custom, registry);
  if (errors.length) throw Error(errors.join("; "));
  if (s.exerciseMode === "long-tone" && s.longTone.practice === "routine")
    return generateRoutine(s, id, registry).exercise;
  const fixed = s.exerciseMode === "long-tone" && s.longTone.target === "fixed";
  const keyScale = choose(
    keys(s, custom, registry).filter(
      (k) =>
        !fixed ||
        scalePool(k, s.lowMidi, s.highMidi).includes(s.longTone.targetMidi),
    ),
    rng,
  );
  const base = { id, keyScale: { ...keyScale }, snapshot: snapshot(s) };
  if (s.exerciseMode === "long-tone") {
    const midi = fixed
      ? s.longTone.targetMidi
      : choose(scalePool(keyScale, s.lowMidi, s.highMidi), rng);
    const rhythm: RhythmEvent[] = [
      { kind: "rest", ticks: 960 },
      { kind: "note", ticks: s.longTone.holdBeats * 480 },
    ];
    if (s.longTone.recoveryBeats)
      rhythm.push({ kind: "rest", ticks: s.longTone.recoveryBeats * 480 });
    return {
      ...base,
      source: "long-tone",
      rhythmIds: [],
      ...zip([midi], rhythm),
    };
  }
  const n = s.exerciseMode === "phrase" ? s.noteCount : 1;
  const usePattern =
    s.exerciseMode === "phrase" &&
    (s.generationMode === "patterns" ||
      (s.generationMode === "mixed" && rng() >= 0.5));
  const pattern = usePattern
    ? choose(eligible(s, keyScale, custom, registry), rng)
    : undefined;
  const tonic = pattern
    ? choose(fittingTonics(pattern, keyScale, s.lowMidi, s.highMidi), rng)
    : 0;
  let rhythm: RhythmEvent[],
    rhythmIds: string[] = [];
  if (s.exerciseMode !== "phrase") rhythm = [{ kind: "note", ticks: 480 }];
  else if (s.rhythmMode === "even")
    rhythm = Array.from({ length: n }, () => ({
      kind: "note",
      ticks: s.evenTicks,
    }));
  else if (pattern && pattern.rhythmId !== "automatic") {
    const r = registry.rhythms.find((r) => r.id === pattern.rhythmId)!;
    rhythm = r.events.map((e) => ({ ...e }));
    rhythmIds = [r.id];
  } else {
    const auto = automaticRhythm(
      n,
      registry.rhythms.filter((r) => s.enabledRhythmIds.includes(r.id)),
      rng,
    );
    rhythm = auto.events;
    rhythmIds = auto.rhythmIds;
  }
  let melody: MelodyMetadata | undefined;
  let pitches: number[];
  if (pattern)
    pitches = pattern.degrees.map((d) =>
      degreeMidi(tonic, keyScale.scaleId, d),
    );
  else if (s.exerciseMode === "phrase" && s.melody.style === "melodic") {
    const generated = generateMelodicPitches(
      {
        settings: s.melody,
        keyScale,
        pool: scalePool(keyScale, s.lowMidi, s.highMidi),
        lowMidi: s.lowMidi,
        highMidi: s.highMidi,
        rhythm,
      },
      rng,
    );
    pitches = generated.pitches;
    melody = generated.metadata;
  } else
    pitches = Array.from({ length: n }, () =>
      choose(scalePool(keyScale, s.lowMidi, s.highMidi), rng),
    );
  return {
    ...base,
    source: pattern
      ? custom.some((p) => p.id === pattern.id)
        ? "custom"
        : "preset"
      : "random",
    patternId: pattern?.id,
    melody,
    rhythmIds,
    ...zip(pitches, rhythm),
  };
}
export function generateRoutine(
  s: Settings,
  id = Date.now(),
  registry: PresetRegistry = presetRegistry,
): RoutinePlan {
  const routine = registry.routines.find((r) => r.id === s.longTone.routineId);
  if (!routine) throw Error("Unknown long-tone routine");
  const range = SOUND_RANGES[s.sound];
  const pitches = routine.degrees.map(
    (d) =>
      degreeMidi(routine.tonicMidi, routine.scaleId, d) -
      (routine.pitchBasis === "alto-eb" ? 9 : 0),
  );
  if (
    pitches.some(
      (m) =>
        m < range.lowMidi ||
        m > range.highMidi ||
        (s.pitchView === "alto-eb" && m + 9 > 127),
    )
  )
    throw Error("Routine outside supported pitch range");
  const repetitions = Math.floor(
    (routine.totalMs - routine.preparationMs) /
      (routine.holdMs + routine.restMs),
  );
  const cooldownMs =
    routine.totalMs -
    routine.preparationMs -
    repetitions * (routine.holdMs + routine.restMs);
  const events: ExerciseEvent[] = [],
    holds: RoutineHold[] = [];
  let ms = 0;
  const rest = (duration: number) => {
    if (duration)
      events.push({
        kind: "rest",
        onsetTicks: ms * 0.48,
        durationTicks: duration * 0.48,
      });
    ms += duration;
  };
  rest(routine.preparationMs);
  for (let i = 0; i < repetitions; i++) {
    const midi = pitches[i % pitches.length],
      onsetMs = ms;
    events.push({
      kind: "note",
      midi,
      noteIndex: i,
      onsetTicks: ms * 0.48,
      durationTicks: routine.holdMs * 0.48,
    });
    holds.push({
      midi,
      noteIndex: i,
      onsetTicks: ms * 0.48,
      durationTicks: routine.holdMs * 0.48,
      onsetMs,
      endMs: ms + routine.holdMs,
    });
    ms += routine.holdMs;
    rest(routine.restMs);
  }
  rest(cooldownMs);
  const exercise: Exercise = {
    id,
    keyScale: {
      tonicPc: mod(
        routine.tonicMidi - (routine.pitchBasis === "alto-eb" ? 9 : 0),
      ),
      scaleId: routine.scaleId,
    },
    source: "long-tone",
    rhythmIds: [],
    events,
    totalTicks: ms * 0.48,
    snapshot: snapshot({ ...s, bpm: 60 }),
  };
  return {
    id,
    presetId: routine.id,
    sound: s.sound,
    events,
    totalTicks: exercise.totalTicks,
    transportBpm: 60,
    repetitions,
    cooldownTicks: cooldownMs * 0.48,
    exercise,
    holds,
    routine,
    holdCount: repetitions,
    cooldownMs,
    preparationMs: routine.preparationMs,
    totalMs: routine.totalMs,
  };
}
const majorRoots = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
const minorRoots = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "Bb",
  "B",
];
const sharpRoots = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const letters = ["C", "D", "E", "F", "G", "A", "B"];
const naturals = [0, 2, 4, 5, 7, 9, 11];
const isMajor = (id: ScaleId) => id === "major" || id === "major-pentatonic";
export function displayMidi(midi: number, view: PitchView = "concert") {
  const value = midi + (view === "alto-eb" ? 9 : 0);
  if (!Number.isInteger(value) || value < 0 || value > 127)
    throw Error("Display pitch outside MIDI 0–127");
  return value;
}
export function displayRoot(k: KeyScale, view: PitchView = "concert") {
  return (
    k.scaleId === "chromatic"
      ? sharpRoots
      : isMajor(k.scaleId)
        ? majorRoots
        : minorRoots
  )[mod(k.tonicPc + (view === "alto-eb" ? 9 : 0))];
}
export function keySignature(k: KeyScale, view: PitchView = "concert") {
  return k.scaleId === "chromatic"
    ? "C"
    : displayRoot(k, view) + (isMajor(k.scaleId) ? "" : "m");
}
export function keyLabel(k: KeyScale, view: PitchView = "concert") {
  return `${displayRoot(k, view)} ${SCALE_NAMES[k.scaleId]}`;
}
export const scaleLabel = (id: ScaleId) => SCALE_NAMES[id];
export function spellPitch(
  midi: number,
  k: KeyScale = { tonicPc: 0, scaleId: "chromatic" },
  view: PitchView = "concert",
) {
  const m = displayMidi(midi, view),
    root = displayRoot(k, view),
    rootPc = mod(k.tonicPc + (view === "alto-eb" ? 9 : 0)),
    offset = mod(m - rootPc),
    degree = (SCALES[k.scaleId] as readonly number[]).indexOf(offset);
  let letter: string, accidental: string, octave: number;
  if (k.scaleId === "chromatic" || degree < 0) {
    const name = sharpRoots[mod(m)];
    letter = name[0];
    accidental = name.slice(1);
    octave = Math.floor(m / 12) - 1;
  } else {
    const degreeLetters =
      k.scaleId === "major-pentatonic"
        ? [0, 1, 2, 4, 5]
        : k.scaleId === "minor-pentatonic"
          ? [0, 2, 3, 4, 6]
          : k.scaleId === "minor-blues"
            ? [0, 2, 3, 4, 4, 6]
            : [0, 1, 2, 3, 4, 5, 6];
    const li = (letters.indexOf(root[0]) + degreeLetters[degree]) % 7;
    letter = letters[li];
    let delta = mod(m - naturals[li]);
    if (delta > 6) delta -= 12;
    accidental = delta > 0 ? "#".repeat(delta) : "b".repeat(-delta);
    octave = (m - delta - naturals[li]) / 12 - 1;
  }
  const name = `${letter}${accidental}${octave}`,
    key = `${letter.toLowerCase()}${accidental}/${octave}`;
  return { letter, accidental, octave, name, key, vexKey: key };
}
export function noteName(midi: number, view: PitchView = "concert") {
  return spellPitch(midi, { tonicPc: 0, scaleId: "chromatic" }, view).name;
}
export function parseNoteName(text: string, view: PitchView = "concert") {
  const match = /^([A-Ga-g])([#b]{0,2})(-?\d+)$/.exec(text.trim());
  if (!match) throw Error("Use a note and octave, for example C4 or Bb3");
  const delta = [...match[2]].reduce((n, c) => n + (c === "#" ? 1 : -1), 0);
  const midi =
    (Number(match[3]) + 1) * 12 +
    naturals[letters.indexOf(match[1].toUpperCase())] +
    delta -
    (view === "alto-eb" ? 9 : 0);
  if (midi < 0 || midi > 127) throw Error("Note outside MIDI range");
  return midi;
}
export const nameMidi = parseNoteName;
