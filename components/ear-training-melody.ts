import { parse } from "smol-toml";
import harmonyText from "../data/ear_training_harmony.toml?raw";
import type { KeyScale, PitchView, RhythmEvent } from "./ear-training-model";

export interface MelodySettings {
  style: "melodic" | "uniform";
  variation: number;
  randomizeVariation: boolean;
  variationMin: number;
  variationMax: number;
  maxLeap: number;
  chromaticism: "off" | "light" | "moderate" | "adventurous";
  harmony: "scale-only" | "tonic" | "I-IV-V-I" | "ii7-V7-Imaj7";
  chordEmphasis: "low" | "medium" | "high";
  contour: "free" | "rising" | "falling" | "arch" | "returning";
}
export const DEFAULT_MELODY_SETTINGS: Readonly<MelodySettings> = Object.freeze({
  style: "melodic",
  variation: 25,
  randomizeVariation: false,
  variationMin: 20,
  variationMax: 50,
  maxLeap: 7,
  chromaticism: "off",
  harmony: "scale-only",
  chordEmphasis: "medium",
  contour: "free",
});
export type ChordQuality =
  "major" | "minor" | "minor7" | "dominant7" | "major7";
export interface MelodyChord {
  name: string;
  rootPc: number;
  quality: ChordQuality;
  startTicks: number;
  endTicks: number;
  pitchClasses: readonly number[];
}
export interface MelodyMetadata {
  variation: number;
  chords: readonly MelodyChord[];
}
interface Progression {
  id: string;
  roots: number[];
  qualities: ChordQuality[];
}
const chordIntervals: Record<ChordQuality, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
};
const mod = (n: number) => ((n % 12) + 12) % 12;
const roots = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const suffix: Record<ChordQuality, string> = {
  major: "",
  minor: "m",
  minor7: "m7",
  dominant7: "7",
  major7: "maj7",
};
export function chordLabel(
  chord: Pick<MelodyChord, "rootPc" | "quality">,
  view: PitchView = "concert",
) {
  return (
    roots[mod(chord.rootPc + (view === "alto-eb" ? 9 : 0))] +
    suffix[chord.quality]
  );
}
export function parseHarmonyPresets(text: string): readonly Progression[] {
  const document = parse(text) as Record<string, unknown>;
  if (
    document.schema_version !== 1 ||
    Object.keys(document).some(
      (k) => !["schema_version", "progressions"].includes(k),
    ) ||
    !Array.isArray(document.progressions)
  )
    throw Error(
      "data/ear_training_harmony.toml: expected version 1 progression registry",
    );
  const ids = new Set<string>();
  const result = document.progressions.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw Error("Harmony preset must be a table");
    const p = item as Record<string, unknown>;
    if (
      Object.keys(p).some(
        (k) => !["id", "name", "root_offsets", "qualities"].includes(k),
      )
    )
      throw Error("Unknown harmony preset field");
    if (typeof p.id !== "string" || !p.id || ids.has(p.id))
      throw Error("Harmony preset IDs must be unique");
    ids.add(p.id);
    if (typeof p.name !== "string" || !p.name.trim())
      throw Error("Harmony preset needs a name");
    if (
      !Array.isArray(p.root_offsets) ||
      !p.root_offsets.length ||
      p.root_offsets.length > 16 ||
      p.root_offsets.some((n) => !Number.isInteger(n) || n < 0 || n > 11)
    )
      throw Error("Harmony root_offsets must be pitch classes");
    if (
      !Array.isArray(p.qualities) ||
      p.qualities.length !== p.root_offsets.length ||
      p.qualities.some(
        (q) => typeof q !== "string" || !Object.hasOwn(chordIntervals, q),
      )
    )
      throw Error("Harmony qualities must match root_offsets");
    return {
      id: p.id,
      roots: p.root_offsets as number[],
      qualities: p.qualities as ChordQuality[],
    };
  });
  if (!["I-IV-V-I", "ii7-V7-Imaj7"].every((id) => ids.has(id)))
    throw Error("Missing required harmony progression");
  return result;
}
let harmonyError = "";
let progressions: readonly Progression[] = [];
try {
  progressions = parseHarmonyPresets(harmonyText);
} catch (e) {
  harmonyError = String(e);
}
export function validateMelodySettings(
  m: MelodySettings,
  keyScales: readonly KeyScale[],
): string[] {
  const errors: string[] = [];
  if (!m || !["uniform", "melodic"].includes(m.style))
    return ["Choose a melody generation style"];
  if (m.style === "uniform") return [];
  if (harmonyError) errors.push(harmonyError);
  for (const field of ["variation", "variationMin", "variationMax"] as const)
    if (!Number.isInteger(m[field]) || m[field] < 0 || m[field] > 100)
      errors.push(`${field} must be 0–100`);
  if (typeof m.randomizeVariation !== "boolean")
    errors.push("Randomize variation must be on or off");
  if (m.variationMin > m.variationMax)
    errors.push("Variation minimum must not exceed maximum");
  if (!Number.isInteger(m.maxLeap) || m.maxLeap < 1 || m.maxLeap > 12)
    errors.push("Maximum leap must be 1–12 semitones");
  if (!["off", "light", "moderate", "adventurous"].includes(m.chromaticism))
    errors.push("Choose a chromaticism level");
  if (!["scale-only", "tonic", "I-IV-V-I", "ii7-V7-Imaj7"].includes(m.harmony))
    errors.push("Choose a harmonic context");
  if (!["low", "medium", "high"].includes(m.chordEmphasis))
    errors.push("Choose a chord emphasis");
  if (!["free", "rising", "falling", "arch", "returning"].includes(m.contour))
    errors.push("Choose a melodic contour");
  if (
    ["I-IV-V-I", "ii7-V7-Imaj7"].includes(m.harmony) &&
    keyScales.some((k) => k.scaleId !== "major")
  )
    errors.push(
      "Chord progressions currently require Major for every selected key; use Scale only or Tonic chord for other scales",
    );
  if (m.harmony === "tonic" && keyScales.some((k) => k.scaleId === "chromatic"))
    errors.push(
      "Chromatic scales have no implied tonic chord; choose Scale only",
    );
  return errors;
}
function random(rng: () => number) {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw Error("RNG must return a value in [0, 1)");
  return value;
}
function sample<T>(
  items: readonly T[],
  logWeights: readonly number[],
  rng: () => number,
): T {
  const highest = Math.max(...logWeights);
  const weights = logWeights.map((w) => Math.exp(w - highest));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = random(rng) * total;
  for (let i = 0; i < items.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return items[i];
  }
  return items.at(-1)!;
}
function chordsFor(
  key: KeyScale,
  totalTicks: number,
  m: MelodySettings,
  slots: readonly NoteSlot[],
): MelodyChord[] {
  if (m.harmony === "scale-only") return [];
  const progression = progressions.find((p) => p.id === m.harmony);
  const minor = !["major", "major-pentatonic"].includes(key.scaleId);
  const length = progression?.roots.length ?? 1;
  const anchors = slots.map((_, i) =>
    slots.length === 1
      ? length - 1
      : slots.length < length
        ? Math.round((i * (length - 1)) / (slots.length - 1))
        : Math.floor((i * length) / slots.length),
  );
  const result: MelodyChord[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (i && anchors[i] === anchors[i - 1]) continue;
    if (result.length) result[result.length - 1].endTicks = slots[i].onset;
    const rootPc = mod(key.tonicPc + (progression?.roots[anchors[i]] ?? 0));
    const quality =
      progression?.qualities[anchors[i]] ?? (minor ? "minor" : "major");
    const chord = {
      rootPc,
      quality,
      startTicks: i === 0 ? 0 : slots[i].onset,
      endTicks: totalTicks,
      pitchClasses: chordIntervals[quality].map((p) => mod(rootPc + p)),
      name: "",
    };
    chord.name = chordLabel(chord);
    result.push(chord);
  }
  return result;
}
interface NoteSlot {
  onset: number;
  ticks: number;
  strength: number;
}
export interface MelodicGenerationInput {
  settings: MelodySettings;
  keyScale: KeyScale;
  pool: readonly number[];
  lowMidi: number;
  highMidi: number;
  rhythm: readonly RhythmEvent[];
}
/** Rhythm-aware weighted path sampling conditioned on the full ending cost. */
export function generateMelodicPitches(
  input: MelodicGenerationInput,
  rng: () => number = Math.random,
): { pitches: number[]; metadata: MelodyMetadata } {
  const { settings: m, keyScale: key, pool, lowMidi, highMidi, rhythm } = input;
  const errors = validateMelodySettings(m, [key]);
  if (errors.length) throw Error(errors.join("; "));
  if (!pool.length)
    throw Error("Melodic generation needs at least one in-range scale note");
  let totalTicks = 0;
  const slots: NoteSlot[] = [];
  for (const event of rhythm) {
    if (event.kind === "note") {
      const beat = totalTicks % 1920;
      slots.push({
        onset: totalTicks,
        ticks: event.ticks,
        strength:
          beat === 0
            ? 1
            : beat % 960 === 0
              ? 0.75
              : beat % 480 === 0
                ? 0.45
                : 0.2,
      });
    }
    totalTicks += event.ticks;
  }
  if (!slots.length) throw Error("Melodic rhythm needs a note");
  const variation = m.randomizeVariation
    ? m.variationMin +
      Math.floor(random(rng) * (m.variationMax - m.variationMin + 1))
    : m.variation;
  const chords = chordsFor(key, totalTicks, m, slots);
  const chordAt = (index: number) =>
    chords.find(
      (c) =>
        slots[index].onset >= c.startTicks && slots[index].onset < c.endTicks,
    );
  const finalChord = chordAt(slots.length - 1);
  let targets = pool.filter((p) =>
    finalChord
      ? finalChord.pitchClasses.includes(mod(p))
      : mod(p - key.tonicPc) === 0,
  );
  // A restricted range can omit the tonic: select the closest available scale tone.
  if (!targets.length && !finalChord) targets = [...pool];
  if (!targets.length)
    throw Error(
      "No final chord tone fits this range; widen the range or choose Scale only",
    );
  const spread = variation / 100;
  const sigmaStep = 0.8 + 6.2 * spread ** 1.3;
  const sigmaRegister = 3 + 8 * spread;
  const center = (lowMidi + highMidi) / 2;
  const emphasis = { low: 0.6, medium: 1.4, high: 2.8 }[m.chordEmphasis];
  const repeatPenalty = 0.05 + 1.05 * spread;
  const targetSet = new Set(targets);
  // Unary weights depend on actual rhythmic slots, harmonic context and contour.
  const nodeWeights = slots.map((slot, i) => {
    const fraction = slots.length === 1 ? 0.5 : i / (slots.length - 1);
    const contourCenter =
      m.contour === "rising"
        ? lowMidi + (highMidi - lowMidi) * fraction
        : m.contour === "falling"
          ? highMidi - (highMidi - lowMidi) * fraction
          : m.contour === "arch"
            ? lowMidi + (highMidi - lowMidi) * Math.sin(Math.PI * fraction)
            : center;
    const chord = chordAt(i);
    return pool.map((p) => {
      let score = -((p - center) ** 2) / (2 * sigmaRegister ** 2);
      if (m.contour !== "free" && m.contour !== "returning")
        score -= (p - contourCenter) ** 2 / (2 * sigmaRegister ** 2);
      if (chord?.pitchClasses.includes(mod(p)))
        score += emphasis * (slot.strength + Math.min(slot.ticks / 960, 1));
      return score;
    });
  });
  const transitionWeights = pool.map((previous) =>
    pool.map((p) => {
      const distance = Math.abs(p - previous);
      return distance > m.maxLeap
        ? -Infinity
        : -(distance ** 2) / (2 * sigmaStep ** 2) -
            (distance === 0 ? repeatPenalty : 0);
    }),
  );
  const logSumExp = (values: readonly number[]) => {
    const highest = Math.max(...values);
    if (highest === -Infinity) return -Infinity;
    return (
      highest +
      Math.log(
        values.reduce((sum, value) => sum + Math.exp(value - highest), 0),
      )
    );
  };
  // A reachable endpoint alone is insufficient: an easy early choice might leave
  // only an expensive final leap. Backward path mass accounts for every future
  // step and unary cost before the first note is sampled. Work is O(N * P²).
  const futureWeights = slots.map(() => pool.map(() => -Infinity));
  futureWeights[slots.length - 1] = pool.map((p) =>
    targetSet.has(p) ? 0 : -Infinity,
  );
  for (let i = slots.length - 2; i >= 0; i--)
    for (let p = 0; p < pool.length; p++)
      futureWeights[i][p] = logSumExp(
        pool.map(
          (_, next) =>
            transitionWeights[p][next] +
            nodeWeights[i + 1][next] +
            futureWeights[i + 1][next],
        ),
      );
  const pitches: number[] = [];
  let previousIndex: number | undefined;
  for (let i = 0; i < slots.length; i++) {
    const previous = pitches.at(-1),
      before = pitches.at(-2);
    const candidateIndices = pool
      .map((_, p) => p)
      .filter(
        (p) =>
          Number.isFinite(futureWeights[i][p]) &&
          (previousIndex === undefined ||
            Number.isFinite(transitionWeights[previousIndex][p])),
      );
    if (!candidateIndices.length)
      throw Error("No melody can satisfy this maximum leap and ending");
    const weights = candidateIndices.map((index) => {
      const p = pool[index];
      let score = nodeWeights[i][index] + futureWeights[i][index];
      if (previousIndex !== undefined)
        score += transitionWeights[previousIndex][index];
      // Small history-dependent preferences supplement the first-order path model.
      // At low variation repeated notes are useful, rather than heavily penalized.
      if (previous !== undefined && before !== undefined) {
        if (p === previous && p === before) score -= 2.4 * spread;
        const oldStep = previous - before,
          newStep = p - previous;
        if (
          Math.abs(oldStep) >= 5 &&
          Math.sign(oldStep) !== Math.sign(newStep) &&
          Math.abs(newStep) <= 2
        )
          score += 0.7 * spread;
        if (
          Math.abs(oldStep) <= 2 &&
          Math.sign(oldStep) === Math.sign(newStep) &&
          newStep !== 0
        )
          score += 0.18 * spread;
        if (newStep === oldStep) score += (1 - spread) * 0.1;
      }
      if (m.contour === "returning" && pitches.length)
        score -= (p - pitches[0]) ** 2 / (2 * sigmaRegister ** 2);
      return score;
    });
    previousIndex = sample(candidateIndices, weights, rng);
    pitches.push(pool[previousIndex]);
  }
  // Embellish existing weak note slots, reserving their following target for resolution.
  const amount = { off: 0, light: 0.12, moderate: 0.3, adventurous: 0.55 }[
    m.chromaticism
  ];
  const scaleClasses = new Set(pool.map(mod));
  for (let i = 1; i < slots.length - 1; i++) {
    if (
      !amount ||
      slots[i].ticks > 480 ||
      slots[i].strength >= 0.75 ||
      slots[i].onset + slots[i].ticks !== slots[i + 1].onset
    )
      continue;
    const previous = pitches[i - 1],
      target = pitches[i + 1],
      chord = chordAt(i + 1);
    if (chord && !chord.pitchClasses.includes(mod(target))) continue;
    const options = [target - 1, target + 1].filter(
      (p) =>
        p >= lowMidi &&
        p <= highMidi &&
        !scaleClasses.has(mod(p)) &&
        Math.abs(p - previous) <= m.maxLeap &&
        Math.abs(p - target) <= m.maxLeap,
    );
    if (options.length && random(rng) < amount) {
      pitches[i] = sample(
        options,
        options.map((p) => -Math.abs(p - previous)),
        rng,
      );
      i++;
    }
  }
  return {
    pitches,
    metadata: Object.freeze({
      variation,
      chords: Object.freeze(
        chords.map((c) =>
          Object.freeze({ ...c, pitchClasses: Object.freeze(c.pitchClasses) }),
        ),
      ),
    }),
  };
}
