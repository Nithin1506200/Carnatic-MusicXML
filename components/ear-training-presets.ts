import { parse } from "smol-toml";
import patternText from "../data/ear_training_patterns.toml?raw";
import rhythmText from "../data/ear_training_rhythms.toml?raw";
import longToneText from "../data/ear_training_long_tones.toml?raw";
import type {
  MelodicPreset,
  RhythmPreset,
  RhythmEvent,
  LongToneRoutinePreset,
} from "./ear-training-model";

export interface PresetRegistry {
  patterns: MelodicPreset[];
  rhythms: RhythmPreset[];
  routines: LongToneRoutinePreset[];
  longTones: LongToneRoutinePreset[];
}
const scaleIds = [
  "major",
  "natural-minor",
  "harmonic-minor",
  "melodic-minor-up",
  "melodic-minor-down",
  "major-pentatonic",
  "minor-pentatonic",
  "minor-blues",
  "chromatic",
];
function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}
function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(context, "expected a table");
  return value as Record<string, unknown>;
}
function fields(o: Record<string, unknown>, allowed: string[], ctx: string) {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) fail(ctx, `unknown field ${k}`);
}
function integer(v: unknown, min: number, max: number, ctx: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    fail(ctx, `expected integer ${min}–${max}`);
  return v;
}
function degrees(v: unknown, maxLength: number, ctx: string): number[] {
  if (!Array.isArray(v) || !v.length || v.length > maxLength)
    fail(ctx, `expected 1–${maxLength} degrees`);
  return v.map((d) => integer(d, 1, 28, ctx));
}
function entries(
  text: string,
  kind: string,
  file: string,
): Record<string, unknown>[] {
  let doc: Record<string, unknown>;
  try {
    doc = object(parse(text), file);
  } catch (e) {
    fail(file, String(e));
  }
  fields(doc, ["schema_version", kind], file);
  if (doc.schema_version !== 1) fail(file, "schema_version must be 1");
  const list = doc[kind];
  if (!Array.isArray(list) || !list.length) fail(file, `missing ${kind}`);
  const ids = new Set<string>();
  return list.map((v) => {
    const o = object(v, file);
    if (typeof o.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(o.id))
      fail(file, "invalid id");
    if (ids.has(o.id)) fail(file, `duplicate id ${o.id}`);
    ids.add(o.id);
    if (typeof o.name !== "string" || !o.name.trim())
      fail(`${file} ${o.id}`, "name must be nonempty");
    return o;
  });
}
export function parsePresets(
  patternSource: string,
  rhythmSource: string,
  routineSource?: string,
): PresetRegistry {
  const rhythms: RhythmPreset[] = entries(
    rhythmSource,
    "rhythms",
    "ear_training_rhythms.toml",
  ).map((o) => {
    const ctx = `ear_training_rhythms.toml ${o.id}`;
    fields(o, ["id", "name", "events"], ctx);
    if (!Array.isArray(o.events) || !o.events.length || o.events.length > 64)
      fail(ctx, "events must contain 1–64 entries");
    const events: RhythmEvent[] = o.events.map((v) => {
      const e = object(v, ctx);
      fields(e, ["kind", "ticks"], ctx);
      if (e.kind !== "note" && e.kind !== "rest")
        fail(ctx, "unknown event kind");
      if (
        ![120, 240, 360, 480, 720, 960, 1440, 1920].includes(e.ticks as number)
      )
        fail(ctx, "invalid ticks");
      return { kind: e.kind, ticks: e.ticks as number };
    });
    if (events[0].kind !== "note" || events.at(-1)!.kind !== "note")
      fail(ctx, "events must start and end with a note");
    return { id: o.id as string, name: o.name as string, events };
  });
  const patterns: MelodicPreset[] = entries(
    patternSource,
    "patterns",
    "ear_training_patterns.toml",
  ).map((o) => {
    const ctx = `ear_training_patterns.toml ${o.id}`;
    fields(o, ["id", "name", "degrees", "rhythm_id"], ctx);
    const ds = degrees(o.degrees, 16, ctx);
    const r = rhythms.find((r) => r.id === o.rhythm_id);
    if (!r) fail(ctx, `rhythm_id ${String(o.rhythm_id)} does not exist`);
    if (r.events.filter((e) => e.kind === "note").length !== ds.length)
      fail(ctx, "degrees and rhythm_id note count mismatch");
    return {
      id: o.id as string,
      name: o.name as string,
      degrees: ds,
      rhythmId: r.id,
    };
  });
  const routines: LongToneRoutinePreset[] =
    routineSource === undefined
      ? []
      : entries(routineSource, "routines", "ear_training_long_tones.toml").map(
          (o) => {
            const ctx = `ear_training_long_tones.toml ${o.id}`;
            fields(
              o,
              [
                "id",
                "name",
                "pitch_basis",
                "tonic_midi",
                "scale_id",
                "degrees",
                "hold_ms",
                "rest_ms",
                "total_ms",
                "preparation_ms",
              ],
              ctx,
            );
            if (o.pitch_basis !== "concert" && o.pitch_basis !== "alto-eb")
              fail(ctx, "invalid pitch_basis");
            if (!scaleIds.includes(o.scale_id as string))
              fail(ctx, "unknown scale_id");
            const timing = (field: string, min: number, max: number) => {
              const n = integer(o[field], min, max, `${ctx} ${field}`);
              if (n % 250) fail(ctx, `${field} must be divisible by 250`);
              return n;
            };
            const holdMs = timing("hold_ms", 1000, 24000),
              restMs = timing("rest_ms", 0, 60000),
              totalMs = timing("total_ms", 1000, 3600000),
              preparationMs = timing("preparation_ms", 0, 10000);
            if (totalMs - preparationMs < holdMs + restMs)
              fail(ctx, "must fit one complete hold/rest pair");
            const tonicMidi = integer(o.tonic_midi, 0, 127, ctx),
              ds = degrees(o.degrees, 64, ctx);
            const offsets: Record<string, number[]> = {
              major: [0, 2, 4, 5, 7, 9, 11],
              "natural-minor": [0, 2, 3, 5, 7, 8, 10],
              "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
              "melodic-minor-up": [0, 2, 3, 5, 7, 9, 11],
              "melodic-minor-down": [0, 2, 3, 5, 7, 8, 10],
              "major-pentatonic": [0, 2, 4, 7, 9],
              "minor-pentatonic": [0, 3, 5, 7, 10],
              "minor-blues": [0, 3, 5, 6, 7, 10],
              chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            };
            const os = offsets[o.scale_id as string];
            for (const d of ds) {
              const midi =
                tonicMidi +
                12 * Math.floor((d - 1) / os.length) +
                os[(d - 1) % os.length] -
                (o.pitch_basis === "alto-eb" ? 9 : 0);
              if (midi < 0 || midi > 127)
                fail(ctx, "expanded concert pitch outside MIDI range");
            }
            return {
              id: o.id as string,
              name: o.name as string,
              pitchBasis: o.pitch_basis,
              tonicMidi,
              scaleId: o.scale_id as LongToneRoutinePreset["scaleId"],
              degrees: ds,
              holdMs,
              restMs,
              totalMs,
              preparationMs,
            };
          },
        );
  return { patterns, rhythms, routines, longTones: routines };
}
let registry: PresetRegistry = {
  patterns: [],
  rhythms: [],
  routines: [],
  longTones: [],
};
let error: string | null = null;
try {
  registry = parsePresets(patternText, rhythmText, longToneText);
} catch (e) {
  error = String(e);
}
export const presetRegistry = registry;
export const presetError = error;
