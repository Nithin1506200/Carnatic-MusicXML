import { strToU8, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import {
  classifyOctave,
  durationMarkUnits,
  normalizeSwaraRow,
  REST_TOKEN,
  RETIRED_DHIRGA_MARK,
  retiredDhirgaMessage,
  NotationSectionKind,
  OctavePosition,
  parseNotationLine,
  parseScoreNotation,
  splitSwaraSlots,
  type ParsedNotationDirective,
} from "./score-notation.ts";
import { getRaga } from "./ragas.generated.ts";

/**
 * Browser-safe conversion core: turns a companion MDX file (YAML metadata +
 * one fenced `carnatic` block) into a MuseScore `.mscz` archive for alto
 * saxophone, following `docs/carnatic_saxophone.md`: alto sax in G, written
 * Sa = G sounding concert Bb, swaras as lyric verse 1, sahitya as deep-
 * crimson verse 2, and dashed barlines at internal tala anga boundaries,
 * and a section break in the last measure of each notation section.
 *
 * Rhythm durations follow "Rhythm and Duration" in `docs/score-notation.md`:
 * one cell is one unit (a crotchet by default), swaras joined in one token
 * share a unit equally (`SR` is two quavers), and the duration marks
 * `.`/`-`/`,` (one unit each) extend the previous cell. A `*`
 * cell is a one-unit rest, and marks after it lengthen the rest. A mark that
 * opens a measure carries the previous measure's last swara across the
 * barline as a tied note (a lyric under it attaches to that tied note); a
 * mark with nothing before it in its section is an error. A section
 * `@Time:` directive pins that section's anga grouping and time-signature
 * denominator (for example `@Time: (4+2+2)/4` prints an 8/4 signature).
 *
 * The command-line tool is `scripts/carnatic-to-mscz.ts`.
 */

export interface ScoreMetadata {
  title?: string;
  form?: string;
  composer?: string;
  raga?: string;
  tala?: string;
  talaGrouping?: string;
  arohana?: string;
  avarohana?: string;
  notationUnit?: string;
}

export type NoteUnit = "crotchet" | "quaver";

interface ResolvedDuration {
  type: string;
  dots?: number;
  /** Tuplet number (3 for a triplet); the chord nominal duration type. */
  triplet?: number;
}

interface NoteEvent {
  kind: "chord" | "rest";
  /** Total length in units (one unit = the score's base duration). */
  units: number;
  /** Written MIDI pitch, written tpc, concert tpc; undefined for rests. */
  pitch?: number;
  tpc?: number;
  tpc2?: number;
  accidental?: string;
  /** Tie link from the previous note (a `<prev>` tie spanner) in a hold. */
  tieFromPrevious?: boolean;
  /** Tie link toward the following note (a `<next>` tie spanner) in a hold. */
  tieToNext?: boolean;
  /** Lyric verse 1: the swara token (with octave styling). */
  swaraText?: string;
  /** Lyric verse 2: the aligned sahitya syllable. */
  lyricText?: string;
}

interface Measure {
  /** Signature numerator: the number of units (cells) the measure spans. */
  lengthN: number;
  /** Signature denominator: 4 for crotchet units, 8 for quaver units. */
  lengthD: 4 | 8;
  events: NoteEvent[];
  /** Event indices after which a dashed tala divider is inserted. */
  dashedAfter: Set<number>;
  /** True when this measure ends a notation section. */
  sectionBreakAfter?: boolean;
  rehearsalMark?: string;
  staffTextsBefore: string[];
  staffTextsAfter: string[];
}

/** A fenced `carnatic` block or inline `parseNotationText` template. */
export interface CarnaticBlock {
  source: string;
  /** One-based line in the containing document where the content starts. */
  line: number;
}

const blockPattern = /```carnatic[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g;
const inlinePattern =
  /parseNotationText\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?`([\s\S]*?)`\s*\)/g;

const lineAtOffset = (source: string, offset: number) =>
  source.slice(0, offset).split(/\r?\n/).length;

const blocksForPattern = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].map((match) => {
    const contentOffset = (match.index ?? 0) + match[0].indexOf(match[1]);
    return {
      source: match[1],
      line: lineAtOffset(source, contentOffset),
    };
  });

/**
 * Extracts every parser-managed notation block of a document: fenced
 * `carnatic` blocks and inline `parseNotationText` templates, in document
 * order.
 */
export const notationBlocksFor = (source: string): CarnaticBlock[] =>
  [
    ...blocksForPattern(source, blockPattern),
    ...blocksForPattern(source, inlinePattern),
  ].sort((left, right) => left.line - right.line);

/** Svarasthana semitone offsets above Sa. */
const SVARASTHANA: Record<string, Record<string, number>> = {
  S: { "": 0 },
  R: { "1": 1, "2": 2, "3": 3 },
  G: { "1": 2, "2": 3, "3": 4 },
  M: { "1": 5, "2": 6 },
  P: { "": 7 },
  D: { "1": 8, "2": 9, "3": 10 },
  N: { "1": 9, "2": 10, "3": 11 },
};

/**
 * Written alto-sax spellings for each semitone above Sa in G scale,
 * following the documented pitch set (G Ab B C D Eb F# G).
 */
const TONIC_G_NAMES: { tpc: number; accidental?: string }[] = [
  { tpc: 15 }, // G
  { tpc: 10, accidental: "flat" }, // Ab
  { tpc: 17 }, // A
  { tpc: 12, accidental: "flat" }, // Bb
  { tpc: 19 }, // B
  { tpc: 14 }, // C
  { tpc: 21, accidental: "sharp" }, // C#
  { tpc: 16 }, // D
  { tpc: 11, accidental: "flat" }, // Eb
  { tpc: 18 }, // E
  { tpc: 13, accidental: "natural" }, // F
  { tpc: 20 }, // F#
];

/** Written middle Sa on the alto sax in G scale (G4). */
const WRITTEN_SA_MIDI = 67;
/** Alto sax in Eb: concert pitch is a major sixth below the written note. */
const TRANSPOSITION_SEMITONES = 9;
const TRANSPOSITION_TPC = 3; // G (tpc 15) sounds Bb (tpc 12)

export const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Resolves scale degrees from the raga's arohana and avarohana swaras. */
export function scaleDegrees(
  arohana: string,
  avarohana?: string,
): Map<string, number> {
  const degrees = new Map<string, number>();
  const addPhrase = (phrase: string) => {
    for (const raw of phrase.trim().split(/\s+/)) {
      const token = raw.replace(/[̣̇']/gu, "");
      const match = token.match(/^([SRGMPDNsrgmpdn])(\d*)$/u);
      if (!match) {
        throw new Error(`Cannot resolve a scale degree from "${raw}".`);
      }
      const letter = match[1].toUpperCase();
      const semitone = SVARASTHANA[letter]?.[match[2]];
      if (semitone === undefined) {
        throw new Error(`Unknown svarasthana "${raw}".`);
      }
      if (!degrees.has(letter)) degrees.set(letter, semitone);
    }
  };
  addPhrase(arohana);
  if (avarohana) addPhrase(avarohana);
  return degrees;
}

/** Splits a swara token such as "Ṡ" or a joined token "ṠṘ" into sounds. */
const octaveOffset = (sound: string): number => {
  const octave = classifyOctave(sound);
  if (octave === OctavePosition.Upper) return 1;
  if (octave === OctavePosition.Lower) return -1;
  return 0;
};

/** Written MIDI pitch, tpcs, and accidental for one swara sound in G. */
export const swaraPitch = (
  sound: string,
  degrees: Map<string, number>,
): { pitch: number; tpc: number; tpc2: number; accidental?: string } => {
  const match = sound.match(/^(\p{L})(\p{M}*)$/u);
  if (!match) throw new Error(`Cannot read a swara from "${sound}".`);
  const letter = match[1].toUpperCase();
  const semitone = degrees.get(letter);
  if (semitone === undefined) {
    throw new Error(
      `Swara "${sound}" is not in the declared arohana/avarohana.`,
    );
  }
  const resolved = TONIC_G_NAMES[semitone];
  return {
    pitch: WRITTEN_SA_MIDI + semitone + 12 * octaveOffset(sound),
    tpc: resolved.tpc,
    tpc2: resolved.tpc - TRANSPOSITION_TPC,
    accidental: resolved.accidental,
  };
};

/** Verse-1 lyric text for one swara sound, with octave styling. */
const styledSwaraText = (sound: string): string => {
  const octave = classifyOctave(sound);
  if (octave === OctavePosition.Upper) return `<b>${sound}</b>`;
  if (octave === OctavePosition.Lower) return `<i>${sound}</i>`;
  return sound;
};

const UNITS_TO_DURATION: [number, ResolvedDuration][] = [
  [4, { type: "whole" }],
  [3, { type: "half", dots: 1 }], // S . . — dotted minim
  [2, { type: "half" }], // S . — minim
  [1.5, { type: "quarter", dots: 1 }],
  [1, { type: "quarter" }], // one crotchet
  [0.75, { type: "eighth", dots: 1 }],
  [0.5, { type: "eighth" }], // one quaver of a joined pair
  [1 / 3, { type: "eighth", triplet: 3 }], // one quaver of a triplet (SRR)
  [0.25, { type: "16th" }], // one semiquaver of a joined group of four
  [1 / 6, { type: "16th", triplet: 3 }], // 16th-triplet in a quaver cell
];

export const unitsToDuration = (units: number): ResolvedDuration => {
  const resolved = UNITS_TO_DURATION.find(([total]) => total === units);
  if (!resolved) {
    throw new Error(`Unsupported note length of ${units} units.`);
  }
  return resolved[1];
};

/**
 * Splits a length in units into representable note values, longest first
 * (for example 9 units becomes whole + whole + quarter).
 */
export const decomposeUnits = (units: number): number[] => {
  const pieces: number[] = [];
  let remaining = units;
  for (const [total] of UNITS_TO_DURATION) {
    while (remaining >= total) {
      pieces.push(total);
      remaining = Math.round((remaining - total) * 100) / 100;
    }
  }
  if (remaining !== 0) {
    throw new Error(`Unsupported note length of ${units} units.`);
  }
  return pieces;
};

/**
 * Rewrites events longer than one note value into tied chords or chained
 * rests, keeping dashed tala dividers at their original positions.
 */
const decomposeMeasure = (measure: Measure) => {
  const events: NoteEvent[] = [];
  const dashedAfter = new Set<number>();
  let offset = 0;
  measure.events.forEach((event, index) => {
    const pieces = decomposeUnits(event.units);
    pieces.forEach((units, pieceIndex) => {
      events.push({
        ...event,
        units,
        // Ties inside the hold join the pieces; a tie carried across the
        // barline stays on the first (from) or last (to) piece.
        tieFromPrevious:
          event.kind === "chord" &&
          ((pieces.length > 1 && pieceIndex > 0) ||
            (Boolean(event.tieFromPrevious) && pieceIndex === 0)),
        tieToNext:
          event.kind === "chord" &&
          ((pieces.length > 1 && pieceIndex < pieces.length - 1) ||
            (Boolean(event.tieToNext) && pieceIndex === pieces.length - 1)),
        swaraText: pieceIndex === 0 ? event.swaraText : undefined,
        lyricText: pieceIndex === 0 ? event.lyricText : undefined,
      });
    });
    if (measure.dashedAfter.has(index)) {
      dashedAfter.add(index + offset + pieces.length - 1);
    }
    offset += pieces.length - 1;
  });
  measure.events = events;
  measure.dashedAfter = dashedAfter;
};

const unitDenominator = (unit: NoteUnit): 4 | 8 => (unit === "quaver" ? 8 : 4);

export const resolveUnit = (
  metadata: ScoreMetadata,
  override?: string,
): NoteUnit => {
  const raw = (override ?? metadata.notationUnit ?? "crotchet")
    .trim()
    .toLowerCase();
  if (["crotchet", "quarter"].includes(raw)) return "crotchet";
  if (["quaver", "eighth"].includes(raw)) return "quaver";
  throw new Error(`Unknown notation unit "${raw}"; use crotchet or quaver.`);
};

/**
 * Extracts the YAML metadata block of a companion MDX file.
 *
 * The `arohana`/`avarohana` come from `data/ragas.toml` (via the raga name);
 * a score may deviate from the registry only through the documented
 * `arohana_override`/`avarohana_override` keys (cite the source in `source`
 * or `notation_exception`).
 */
export function extractMetadata(mdxSource: string): ScoreMetadata {
  const block = mdxSource.match(/```yaml[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/);
  const parsed = (block ? parseYaml(block[1]) : null) as Record<
    string,
    unknown
  > | null;
  const record = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = parsed?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  };

  const ragaName = record("raga");
  let arohana = record("arohana_override", "arohanaOverride");
  let avarohana = record("avarohana_override", "avarohanaOverride");
  for (const key of ["arohana", "avarohana"]) {
    if (record(key)) {
      throw new Error(
        `Metadata "${key}" is now derived from data/ragas.toml; remove it. ` +
          `For a documented source variant, use ${key}_override with a source note.`,
      );
    }
  }
  if (ragaName && ragaName !== "TODO") {
    const raga = getRaga(ragaName);
    if (!raga) {
      throw new Error(
        `Unknown raga "${ragaName}" — add it to data/ragas.toml (with arohana, avarohana, and a reference) before using it.`,
      );
    }
    arohana ??= raga.arohana;
    avarohana ??= raga.avarohana;
  }
  if (
    (record("arohana_override", "arohanaOverride") ||
      record("avarohana_override", "avarohanaOverride")) &&
    !(record("source") || record("notation_exception"))
  ) {
    throw new Error(
      `Arohana/avarohana overrides must cite their source (add a "source" or "notation_exception" metadata key).`,
    );
  }

  return {
    title: record("title"),
    form: record("form"),
    composer: record("composer"),
    raga: ragaName,
    tala: record("tala"),
    talaGrouping: record("tala_grouping", "talaGrouping"),
    arohana,
    avarohana,
    notationUnit: record("notation_unit", "notationUnit"),
  };
}

const directiveText = (directive: ParsedNotationDirective): string =>
  directive.label ? `${directive.label}: ${directive.value}` : directive.value;

const newMeasure = (denominator: 4 | 8): Measure => ({
  lengthN: 0,
  lengthD: denominator,
  events: [],
  dashedAfter: new Set(),
  staffTextsBefore: [],
  staffTextsAfter: [],
});

/** True when every token of a row is a swara pitch, a rest, or a mark. */
const looksLikeSwaraRow = (line: string): boolean =>
  parseNotationLine(line).tokens.every((token) => {
    if (token === REST_TOKEN) return true;
    if (durationMarkUnits[token] !== undefined) return true;
    const slots = splitSwaraSlots(token);
    return (
      slots !== null &&
      slots.some((slot) => slot.kind === "sound") &&
      slots
        .filter((slot) => slot.kind === "sound")
        .every((slot) => /^[SRGMPDN]/iu.test(slot.text))
    );
  });

/** Appends the measures of one notation line (with optional lyric row). */
function appendLineMeasures(
  measures: Measure[],
  swaras: string,
  lyrics: string | undefined,
  degrees: Map<string, number>,
  denominator: 4 | 8,
  unitScale: number,
  sectionStart: number,
) {
  const parsedSwaras = parseNotationLine(swaras);
  const lyricTokens = lyrics ? parseNotationLine(lyrics).tokens : [];

  let current = newMeasure(denominator);
  measures.push(current);
  let cellCount = 0;

  /**
   * The event a measure-opening mark continues: the last event of the
   * previous measure in this section (a swara to tie, or a rest to prolong).
   */
  const carrySource = (): NoteEvent | undefined => {
    if (current.events.length > 0) return undefined;
    const previousIndex = measures.length - 2;
    if (previousIndex < sectionStart) return undefined;
    return measures[previousIndex].events.at(-1);
  };

  /** Whether a mark here has anything to extend at all. */
  const canExtend = () =>
    current.events.length > 0 || carrySource() !== undefined;

  /**
   * Adds `units` of hold: to the previous event of this measure, else as a
   * continuation of the previous measure's last event — a tied note (which
   * takes the lyric syllable, if any) or a prolonged rest. Returns true when
   * a new tied chord was created.
   */
  const extend = (
    token: string,
    units: number,
    lyricSyllable: string | undefined,
  ) => {
    const previous = current.events.at(-1);
    if (previous) {
      previous.units += units;
      return false;
    }
    const source = carrySource();
    if (!source) {
      throw new Error(
        `Duration mark "${token}" has no swara to extend; write a rest as "${REST_TOKEN}".`,
      );
    }
    if (source.kind === "rest") {
      current.events.push({ kind: "rest", units });
      return false;
    }
    source.tieToNext = true;
    current.events.push({
      kind: "chord",
      units,
      pitch: source.pitch,
      tpc: source.tpc,
      tpc2: source.tpc2,
      accidental: source.accidental,
      tieFromPrevious: true,
      lyricText: lyricSyllable,
    });
    return true;
  };

  parsedSwaras.tokens.forEach((token, cellIndex) => {
    if (parsedSwaras.doubleBefore.includes(cellIndex)) {
      current.lengthN = cellCount;
      current = newMeasure(denominator);
      measures.push(current);
      cellCount = 0;
    }

    // One lyric cell pairs with one swara cell; a held/mark cell may only
    // pair with a lyric continuation mark.
    const lyricText = lyricTokens[cellIndex];
    const lyricSyllable =
      lyricText && lyricText !== "-" && lyricText !== "," ? lyricText : undefined;
    const heldCellError = () =>
      new Error(
        `Lyric "${lyricText}" falls under a held swara cell ("${token}") and has no note to attach to.`,
      );

    if (token === REST_TOKEN) {
      if (lyricSyllable) {
        throw new Error(
          `Lyric "${lyricText}" falls under a rest cell ("${token}") and has no note to attach to.`,
        );
      }
      current.events.push({ kind: "rest", units: unitScale });
      cellCount += 1;
    } else if (token === RETIRED_DHIRGA_MARK) {
      throw new Error(retiredDhirgaMessage());
    } else {
      appendToken(token, lyricText, lyricSyllable, heldCellError);
      cellCount += 1;
    }

    if (parsedSwaras.solidBefore.includes(cellIndex + 1)) {
      current.dashedAfter.add(current.events.length - 1);
    }
  });

  current.lengthN = cellCount;

  /** Appends one swara/compact token's slots to the current measure. */
  function appendToken(
    token: string,
    lyricText: string | undefined,
    lyricSyllable: string | undefined,
    heldCellError: () => Error,
  ) {
    const slots = splitSwaraSlots(token);
    if (!slots) {
      throw new Error(`Cannot read a swara from "${token}".`);
    }
    if (![1, 2, 3, 4].includes(slots.length)) {
      throw new Error(
        `Token "${token}" would need a ${slots.length}-slot subdivision; only 2, 3 (a triplet), or 4 slots share one unit.`,
      );
    }
    if (slots.length === 3 && slots.some((slot) => slot.kind === "mark")) {
      throw new Error(
        `Token "${token}" mixes a triplet with a held mark; triplets hold three full sounds (for example SRR).`,
      );
    }
    if (
      !slots.some((slot) => slot.kind === "sound") &&
      lyricSyllable &&
      (current.events.length > 0 || !canExtend())
    ) {
      throw heldCellError();
    }
    const slotUnits = unitScale / slots.length;
    let lyricAttached = false;
    for (const slot of slots) {
      if (slot.kind === "mark") {
        if (
          extend(token, slotUnits, lyricAttached ? undefined : lyricSyllable)
        ) {
          lyricAttached = true;
        }
        continue;
      }
      const pitchInfo = swaraPitch(slot.text, degrees);
      // The cell's lyric syllable attaches to its first sounding note; the
      // other sounds of a compact token (`NN`) carry the same syllable.
      const attachLyric = !lyricAttached;
      lyricAttached = true;
      current.events.push({
        kind: "chord",
        units: slotUnits,
        pitch: pitchInfo.pitch,
        tpc: pitchInfo.tpc,
        tpc2: pitchInfo.tpc2,
        accidental: pitchInfo.accidental,
        swaraText: styledSwaraText(slot.text),
        lyricText: attachLyric ? lyricText : undefined,
      });
    }
  }
}

/** Builds the complete measure list for one parsed notation block. */
export function buildMeasures(
  notationSource: string,
  metadata: ScoreMetadata,
  unit: NoteUnit,
): Measure[] {
  if (!metadata.arohana) {
    throw new Error("The score metadata must declare an arohana.");
  }
  const degrees = scaleDegrees(metadata.arohana, metadata.avarohana);
  const parsed = parseScoreNotation(notationSource);
  const measures: Measure[] = [];

  for (const section of parsed.sections) {
    // A declared @Time signature pins the section's unit denominator (and the
    // unit scale that follows from it); otherwise the score unit applies.
    const denominator = section.time?.denominator ?? unitDenominator(unit);
    const unitScale = denominator === 8 ? 0.5 : 1;
    const firstNewMeasure = measures.length;
    if (section.kind === NotationSectionKind.Swaras) {
      for (const swaras of section.content) {
        appendLineMeasures(
          measures,
          swaras,
          undefined,
          degrees,
          denominator,
          unitScale,
          firstNewMeasure,
        );
      }
    } else {
      for (const pair of section.content) {
        // Some scores are engraved swaras-only: a "lyric" row composed
        // entirely of swara tokens is a second swara line, not sahitya.
        const lyricAsSwaras = normalizeSwaraRow(pair.lyrics);
        const lyrics = looksLikeSwaraRow(lyricAsSwaras)
          ? undefined
          : pair.lyrics;
        appendLineMeasures(
          measures,
          pair.swaras,
          lyrics,
          degrees,
          denominator,
          unitScale,
          firstNewMeasure,
        );
        if (lyrics === undefined) {
          appendLineMeasures(
            measures,
            lyricAsSwaras,
            undefined,
            degrees,
            denominator,
            unitScale,
            firstNewMeasure,
          );
        }
      }
    }
    if (measures.length > firstNewMeasure) {
      const first = measures[firstNewMeasure];
      const last = measures.at(-1)!;
      first.rehearsalMark = section.title;
      first.staffTextsBefore.push(...section.before.map(directiveText));
      last.staffTextsAfter.push(...section.after.map(directiveText));
      last.sectionBreakAfter = true;
    }
  }

  if (measures.length === 0) {
    throw new Error("The notation block produced no measures.");
  }
  measures.forEach(decomposeMeasure);
  return measures;
}

const accidentalSubtype = (accidental: string) =>
  accidental === "flat"
    ? "accidentalFlat"
    : accidental === "sharp"
      ? "accidentalSharp"
      : "accidentalNatural";

const lyricsElement = (no: number | null, text: string): string =>
  [
    "          <Lyrics>",
    ...(no !== null ? [`            <no>${no}</no>`] : []),
    `            <text>${text.includes("<") ? text : xmlEscape(text)}</text>`,
    "          </Lyrics>",
  ].join("\n");

/**
 * Where a tie's other note sits relative to this one, the way MuseScore's
 * `Location` records it: whole measures apart, plus the difference of the
 * two positions inside their measures (a whole-note fraction).
 */
interface TieLocation {
  measures: number;
  quarters: number;
}

const FRACTION_DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96];

/** Formats a length in crotchets as MuseScore's reduced whole-note fraction. */
const fractionText = (quarters: number): string => {
  const whole = quarters / 4;
  for (const denominator of FRACTION_DENOMINATORS) {
    const numerator = Math.round(whole * denominator);
    if (Math.abs(whole * denominator - numerator) < 1e-6) {
      return `${numerator}/${denominator}`;
    }
  }
  throw new Error(`Cannot express ${quarters} crotchets as a fraction.`);
};

const locationXml = (location: TieLocation): string[] => [
  "                <location>",
  ...(location.measures !== 0
    ? [`                  <measures>${location.measures}</measures>`]
    : []),
  `                  <fractions>${fractionText(location.quarters)}</fractions>`,
  "                  </location>",
];

/** MuseScore 3/4 tie: a spanner on both notes, each pointing at the other. */
const tieSpannerXml = (ties: {
  next?: TieLocation;
  prev?: TieLocation;
}): string[] => {
  const rows: string[] = [];
  if (ties.next) {
    rows.push(
      '              <Spanner type="Tie">',
      "                <Tie>",
      "                  </Tie>",
      "                <next>",
      ...locationXml(ties.next),
      "                  </next>",
      "                </Spanner>",
    );
  }
  if (ties.prev) {
    rows.push(
      '              <Spanner type="Tie">',
      "                <prev>",
      ...locationXml(ties.prev),
      "                  </prev>",
      "                </Spanner>",
    );
  }
  return rows;
};

const chordXml = (
  event: NoteEvent,
  ties: { next?: TieLocation; prev?: TieLocation } = {},
): string => {
  const { type, dots } = unitsToDuration(event.units);
  const rows = ["          <Chord>"];
  if (dots) rows.push(`            <dots>${dots}</dots>`);
  rows.push(`            <durationType>${type}</durationType>`);
  if (event.swaraText) rows.push(lyricsElement(null, event.swaraText));
  if (event.lyricText !== undefined) {
    rows.push(lyricsElement(1, event.lyricText));
  }
  rows.push("            <Note>");
  if (event.accidental && !event.tieFromPrevious) {
    rows.push(
      "              <Accidental>",
      `                <subtype>${accidentalSubtype(event.accidental)}</subtype>`,
      "              </Accidental>",
    );
  }
  rows.push(
    ...tieSpannerXml(ties),
    `              <pitch>${event.pitch! - TRANSPOSITION_SEMITONES}</pitch>`,
    `              <tpc>${event.tpc2}</tpc>`,
    `              <tpc2>${event.tpc}</tpc2>`,
  );
  rows.push("            </Note>", "          </Chord>");
  return rows.join("\n");
};

const restXml = (event: NoteEvent): string => {
  const { type, dots } = unitsToDuration(event.units);
  const rows = ["          <Rest>"];
  if (dots) rows.push(`            <dots>${dots}</dots>`);
  rows.push(
    `            <durationType>${type}</durationType>`,
    "          </Rest>",
  );
  return rows.join("\n");
};

const titleFrameXml = (metadata: ScoreMetadata, hasLyrics: boolean): string => {
  const title = metadata.title ?? "Untitled";
  const details = [
    [
      metadata.form,
      metadata.raga ? `Raga: ${metadata.raga}` : undefined,
      metadata.tala
        ? `Tala: ${metadata.tala}${metadata.talaGrouping ? ` (${metadata.talaGrouping})` : ""}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" | "),
    `Composer: ${metadata.composer ?? "Unknown"} | Alto Saxophone in G scale`,
    metadata.arohana
      ? `Arohana: ${metadata.arohana} | Avarohana: ${metadata.avarohana ?? "Unknown"}`
      : undefined,
    `Written Sa = G on alto sax; sounds concert Bb.${hasLyrics ? " Swaras are black; English lyrics are deep crimson." : ""}`,
  ]
    .filter((line): line is string => Boolean(line && line.trim()))
    .map(xmlEscape);
  const detailText = details.join("<br/>");
  return [
    "      <VBox>",
    "        <height>10</height>",
    "        <Text>",
    "          <style>frame</style>",
    // For multi-line break rendering, keep <br/> outside the bold element,
    // matching the engraved repository scores.
    `          <text><font size="20"/><b>${xmlEscape(title)}</b><br/><font size="11"/>${detailText}</text>`,
    "          </Text>",
    "        </VBox>",
  ].join("\n");
};

/** Renders the measure list as a complete .mscx document. */
export function buildMscx(
  metadata: ScoreMetadata,
  measures: Measure[],
): string {
  const hasLyrics = measures.some((measure) =>
    measure.events.some((event) => event.lyricText !== undefined),
  );
  const rows: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<museScore version="4.50">`,
    `  <Score>`,
    `    <Division>480</Division>`,
    `    <Style>`,
    `      <lyricsOddColor r="0" g="0" b="0" a="255"/>`,
    `      <lyricsEvenColor r="176" g="0" b="32" a="255"/>`,
    `    </Style>`,
    `    <showInvisible>1</showInvisible>`,
    `    <showUnprintable>1</showUnprintable>`,
    `    <showFrames>1</showFrames>`,
    `    <showMargins>0</showMargins>`,
    `    <metaTag name="workTitle">${xmlEscape(metadata.title ?? "Untitled")}</metaTag>`,
    `    <metaTag name="composer">${xmlEscape(metadata.composer ?? "")}</metaTag>`,
    `    <Part>`,
    `      <Staff>`,
    `        <StaffType group="pitched">`,
    `          <name>stdNormal</name>`,
    `        </StaffType>`,
    `      </Staff>`,
    `      <trackName>Alto Saxophone</trackName>`,
    `      <Instrument id="alto-saxophone">`,
    `        <longName>Alto Saxophone</longName>`,
    `        <shortName>A. Sax.</shortName>`,
    `        <description>Alto Saxophone</description>`,
    `        <musicXMLid>wind.reed.saxophone.alto</musicXMLid>`,
    `        <minPitchP>49</minPitchP>`,
    `        <maxPitchP>92</maxPitchP>`,
    `        <minPitchA>49</minPitchA>`,
    `        <maxPitchA>80</maxPitchA>`,
    `        <transposeDiatonic>-5</transposeDiatonic>`,
    `        <transposeChromatic>-9</transposeChromatic>`,
    `        <instrumentId>wind.reed.saxophone.alto</instrumentId>`,
    `        <Channel>`,
    `          <program value="65"/>`,
    `          <synti>Fluid</synti>`,
    `        </Channel>`,
    `      </Instrument>`,
    `    </Part>`,
    `    <Staff id="1">`,
    titleFrameXml(metadata, hasLyrics),
  ];

  let currentSignature = "";
  const lastMeasure = measures.at(-1)!;

  /** Start position (in crotchets from the measure start) of every event. */
  const startsOf = (measure: Measure): number[] => {
    const starts: number[] = [];
    let position = 0;
    for (const event of measure.events) {
      starts.push(position);
      position += event.units;
    }
    return starts;
  };
  const measureStarts = measures.map(startsOf);

  /** Relative locations of the notes this event is tied to, if any. */
  const tieLocations = (measureIndex: number, eventIndex: number) => {
    const measure = measures[measureIndex];
    const event = measure.events[eventIndex];
    const starts = measureStarts[measureIndex];
    const ties: { next?: TieLocation; prev?: TieLocation } = {};
    if (event.tieToNext) {
      ties.next =
        eventIndex + 1 < measure.events.length
          ? { measures: 0, quarters: event.units }
          : { measures: 1, quarters: -starts[eventIndex] };
    }
    if (event.tieFromPrevious) {
      if (eventIndex > 0) {
        ties.prev = { measures: 0, quarters: -measure.events[eventIndex - 1].units };
      } else {
        const previousStarts = measureStarts[measureIndex - 1] ?? [];
        ties.prev = {
          measures: -1,
          quarters: previousStarts.at(-1) ?? 0,
        };
      }
    }
    return ties;
  };

  measures.forEach((measure, measureIndex) => {
    rows.push("      <Measure>");
    if (measure.sectionBreakAfter) {
      // A section break already starts the next section on a new line, so it
      // replaces the regular two-measure line break for this measure.
      rows.push(
        "        <LayoutBreak>",
        "          <subtype>section</subtype>",
        "        </LayoutBreak>",
      );
    } else if (measureIndex > 0 && measureIndex % 2 === 0) {
      rows.push(
        "        <LayoutBreak>",
        "          <subtype>line</subtype>",
        "        </LayoutBreak>",
      );
    }
    rows.push("        <voice>");
    if (measureIndex === 0) {
      rows.push(
        "          <Clef>",
        "            <concertClefType>G</concertClefType>",
        "            <transposingClefType>G</transposingClefType>",
        "            <isHeader>1</isHeader>",
        "          </Clef>",
        "          <KeySig>",
        "            <concertKey>-2</concertKey>",
        "            <actualKey>1</actualKey>",
        "            <mode>major</mode>",
        "          </KeySig>",
      );
    }
    const signature = `${measure.lengthN}/${measure.lengthD}`;
    if (signature !== currentSignature) {
      currentSignature = signature;
      rows.push(
        "          <TimeSig>",
        `            <sigN>${measure.lengthN}</sigN>`,
        `            <sigD>${measure.lengthD}</sigD>`,
        "          </TimeSig>",
      );
    }
    if (measure.rehearsalMark) {
      rows.push(
        "          <RehearsalMark>",
        `            <text>${xmlEscape(measure.rehearsalMark)}</text>`,
        "          </RehearsalMark>",
      );
    }
    for (const text of measure.staffTextsBefore) {
      rows.push(
        "          <StaffText>",
        `            <text>${xmlEscape(text)}</text>`,
        "          </StaffText>",
      );
    }
    const dashedBarline = [
      "          <BarLine>",
      "            <subtype>dashed</subtype>",
      "          </BarLine>",
    ];
    let eventIndex = 0;
    while (eventIndex < measure.events.length) {
      const event = measure.events[eventIndex];
      const duration = unitsToDuration(event.units);
      if (duration.triplet && event.kind === "chord") {
        // MuseScore 4 marks a tuplet with a sibling <Tuplet> start marker
        // (normalNotes/actualNotes/baseNote/Number) followed by the chords
        // and a closing <endTuplet/>; chords must NOT nest inside <Tuplet>.
        rows.push(
          "          <Tuplet>",
          "            <normalNotes>2</normalNotes>",
          `            <actualNotes>${duration.triplet}</actualNotes>`,
          `            <baseNote>${duration.type}</baseNote>`,
          "            <Number>",
          "              <style>tuplet</style>",
          `              <text>${duration.triplet}</text>`,
          "            </Number>",
          "          </Tuplet>",
        );
        const groupUnits = event.units;
        let grouped = 0;
        while (
          eventIndex < measure.events.length &&
          measure.events[eventIndex].kind === "chord" &&
          measure.events[eventIndex].units === groupUnits &&
          grouped < duration.triplet
        ) {
          rows.push(
            chordXml(
              measure.events[eventIndex],
              tieLocations(measureIndex, eventIndex),
            ),
          );
          eventIndex += 1;
          grouped += 1;
        }
        rows.push("          <endTuplet/>");
        if (measure.dashedAfter.has(eventIndex - 1)) {
          rows.push(...dashedBarline);
        }
        continue;
      }
      rows.push(
        event.kind === "rest"
          ? restXml(event)
          : chordXml(event, tieLocations(measureIndex, eventIndex)),
      );
      if (measure.dashedAfter.has(eventIndex)) {
        rows.push(...dashedBarline);
      }
      eventIndex += 1;
    }
    for (const text of measure.staffTextsAfter) {
      rows.push(
        "          <StaffText>",
        `            <text>${xmlEscape(text)}</text>`,
        "          </StaffText>",
      );
    }
    if (measure === lastMeasure) {
      rows.push(
        "          <BarLine>",
        "            <subtype>end</subtype>",
        "          </BarLine>",
      );
    }
    rows.push("        </voice>", "      </Measure>");
  });

  rows.push("    </Staff>", "  </Score>", "</museScore>");
  return rows.join("\n") + "\n";
}

/** Converts a companion MDX file into a MuseScore .mscz archive. */
export function convertMdx(
  mdxSource: string,
  options: { stem: string; unit?: string },
): { mscx: string; mscz: Uint8Array; title: string } {
  const [block] = notationBlocksFor(mdxSource);
  if (!block) {
    throw new Error("The MDX file has no Carnatic notation block.");
  }
  const metadata = extractMetadata(mdxSource);
  const unit = resolveUnit(metadata, options.unit);
  const measures = buildMeasures(block.source, metadata, unit);
  const mscx = buildMscx(metadata, measures);
  const mscz = zipSync({
    "META-INF/container.xml": strToU8(
      [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<container>`,
        `  <rootfiles>`,
        `    <rootfile full-path="${options.stem}.mscx"/>`,
        `  </rootfiles>`,
        `</container>`,
      ].join("\n"),
    ),
    [`${options.stem}.mscx`]: strToU8(mscx),
  });
  return { mscx, mscz, title: metadata.title ?? options.stem };
}
