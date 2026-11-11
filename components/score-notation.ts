import { useMDXComponents } from "@mdx-js/react";
import React, {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

export enum TalaDivider {
  Anga = "|",
  Measure = "||",
}

export enum OctavePosition {
  Lower = "lower",
  Middle = "middle",
  Upper = "upper",
}

export enum NotationSectionKind {
  Lyrics = "lyrics",
  Swaras = "swaras",
}

export enum NotationSectionKeyword {
  Swaras = "swaras",
}

export enum NotationDirectiveKeyword {
  Source = "source",
  Sahitya = "sahitya",
  Repeat = "repeat",
  Return = "return",
  Time = "time",
  Custom = "custom",
}

export enum NotationRowKind {
  Lyrics = "lyrics",
  Swara = "swara",
}

export type NotationInput = string | readonly string[];

export interface ParsedNotationLine {
  tokens: string[];
  solidBefore: number[];
  doubleBefore: number[];
  doubleEnd: boolean;
}

export interface ParsedNotationDirective {
  keyword: NotationDirectiveKeyword;
  label: string;
  value: string;
  /** One-based source line, set when parsed from a full score block. */
  line?: number;
}

export interface ParsedTimeSignature {
  /** Anga lengths in cells (units), repeated cyclically across measures. */
  grouping: number[];
  /** Time-signature denominator: 4 for crotchet cells, 8 for quaver cells. */
  denominator: 4 | 8;
}

/**
 * Parses an `@Time` directive value: a cyclical anga grouping over a crotchet
 * or quaver denominator, for example `(4+2+2)/4`, `4+2+2 / 4`, or `8/4`.
 */
export function parseTimeSignature(value: string): ParsedTimeSignature {
  let body = value.trim();
  if (body.startsWith("(")) {
    const closing = body.indexOf(")");
    if (closing > 0) {
      body = `${body.slice(1, closing)}${body.slice(closing + 1)}`;
    }
  }
  const match = body.match(/^(\d+(?:\s*\+\s*\d+)*)\s*\/\s*([48])$/u);
  if (!match) {
    throw new Error(
      `@Time must name an anga grouping over 4 or 8, for example "(4+2+2)/4" or "8/4"; got "${value}".`,
    );
  }
  const grouping = match[1].split("+").map((part) => Number(part.trim()));
  if (grouping.some((count) => !Number.isInteger(count) || count < 1)) {
    throw new Error(`@Time anga lengths must be positive: "${value}".`);
  }
  return { grouping, denominator: Number(match[2]) as 4 | 8 };
}

const timeLabel = (time: ParsedTimeSignature) =>
  `(${time.grouping.join("+")})/${time.denominator}`;

export interface SwaraLyricPair {
  swaras: string;
  lyrics: string;
}

interface ParsedNotationSectionBase {
  key: string;
  title: string;
  before: ParsedNotationDirective[];
  after: ParsedNotationDirective[];
  /** Declared `@Time` anga grouping and denominator, when the section has one. */
  time?: ParsedTimeSignature;
}

export interface ParsedSwaraSection extends ParsedNotationSectionBase {
  kind: NotationSectionKind.Swaras;
  content: string[];
}

export interface ParsedLyricsSection extends ParsedNotationSectionBase {
  kind: NotationSectionKind.Lyrics;
  content: SwaraLyricPair[];
}

export type ParsedNotationSection = ParsedSwaraSection | ParsedLyricsSection;

export interface ParsedScoreNotation {
  museScoreSource: string | null;
  sections: ParsedNotationSection[];
}

export class NotationParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column = 1) {
    super(message);
    this.name = "NotationParseError";
    this.line = line;
    this.column = column;
  }
}

export interface TalaBoundaryProps {
  /** Zero-based cell positions that begin with a single tala divider. */
  solidBefore?: readonly number[];
  /** Zero-based cell positions that begin with a double tala divider. */
  doubleBefore?: readonly number[];
  /** Draw a double tala divider after the final cell. */
  doubleEnd?: boolean;
}

export interface SwaraTableProps extends TalaBoundaryProps {
  swaras: NotationInput;
  lyrics?: NotationInput;
  /** Assigned automatically when the table is a direct child of MusicSection. */
  number?: number;
}

export interface SwaraGridProps extends TalaBoundaryProps {
  rows: readonly NotationInput[];
}

export interface SwaraLinesProps {
  lines: readonly Omit<SwaraTableProps, "number">[];
}

export interface MusicSectionProps {
  /** Used by the whole-section zoom dialog. */
  title: string;
  notationKind?: NotationSectionKind;
  children?: ReactNode;
}

export interface MusicScoreProps {
  source: string;
  /** Generated static URL for an @source MuseScore file. */
  museScoreSource?: string | null;
}

export type ParsedNotation = Record<
  string,
  Array<string | Omit<SwaraTableProps, "number">>
>;

const directiveKeywords = new Map<string, NotationDirectiveKeyword>([
  [NotationDirectiveKeyword.Source, NotationDirectiveKeyword.Source],
  ["sourceFile", NotationDirectiveKeyword.Source],
  [NotationDirectiveKeyword.Sahitya, NotationDirectiveKeyword.Sahitya],
  [NotationDirectiveKeyword.Repeat, NotationDirectiveKeyword.Repeat],
  [NotationDirectiveKeyword.Return, NotationDirectiveKeyword.Return],
  [NotationDirectiveKeyword.Time, NotationDirectiveKeyword.Time],
]);

const isDivider = (token: string): token is TalaDivider =>
  token === TalaDivider.Anga || token === TalaDivider.Measure;

const sameNumbers = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const sectionKey = (title: string) => {
  const words = title
    .replace(/^\d+\.\s*/, "")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0
        ? lower
        : `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");
};

// Unwraps a line that is quoted on BOTH ends (pasted quoted rows such as
// `"S R G",`); a lone trailing quote stays, since it can be a tāra alias.
const cleanTextLine = (line: string) => {
  const trimmed = line.trim();
  const quoted = trimmed.match(/^(["'`])([\s\S]*)\1\s*,?\s*$/u);
  return quoted ? quoted[2].trim() : trimmed;
};

const unwrapQuotedValue = (value: string) =>
  value.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();

export function classifyOctave(token: string): OctavePosition {
  // Strip trailing continuation marks so compact tokens such as "Ṡ," keep
  // their octave styling.
  const base = token.replace(/[.,-]+$/u, "").replace(/\d/gu, "");
  if (/\u0307$/u.test(base)) return OctavePosition.Upper;
  if (/\u0323$/u.test(base)) return OctavePosition.Lower;
  return OctavePosition.Middle;
}

/**
 * Token gate for ASCII octave aliases: uppercase letters with an optional
 * trailing apostrophe (tāra sthāyi), lowercase letters (mandra sthāyi), and
 * duration marks. Anything else — lyric words, stray quotes after combining
 * marks, mixed garbage — stays untouched so existing validation can reject it.
 */
const SWARA_ALIAS_TOKEN = /^(?:\p{Lu}\p{M}*\d*'?|\p{Ll}\p{M}*\d*|[.,-])+$/u;

/**
 * Rewrites keyboard-friendly octave aliases in one swara token to their
 * canonical Unicode form: a trailing apostrophe marks tāra sthāyi (`S'` is
 * Ṡ) and a lowercase letter marks mandra sthāyi (`s` is Ṣ). Aliases combine
 * with compact tokens (`S'R'` is ṠṘ; `nn,` holds two mandra quavers). Only
 * apply this to rows known to carry swaras; lyric text is never rewritten.
 */
export const normalizeSwaraToken = (token: string): string => {
  if (!SWARA_ALIAS_TOKEN.test(token)) return token;
  return token
    .replace(/(\p{Lu}\d*)'/gu, "$1\u0307")
    .replace(
      /(\p{Ll})(?!\u0323)/gu,
      (letter) => `${letter.toUpperCase()}\u0323`,
    )
    .replace(/\p{Ll}/gu, (letter) => letter.toUpperCase());
};

/** Applies swara octave aliases to every token of a swara row. */
export const normalizeSwaraRow = (value: string): string =>
  value.replace(/\S+/gu, normalizeSwaraToken);

/** Parses a row that is known to carry swaras, honoring octave aliases. */
const parseSwaraLine = (value: NotationInput): ParsedNotationLine => {
  const parsed = parseNotationLine(
    typeof value === "string"
      ? normalizeSwaraRow(value)
      : value.map(normalizeSwaraToken),
  );
  for (const token of parsed.tokens) {
    if (/\d/u.test(token) && !splitSwaraSlots(token)) {
      throw new Error(`Invalid explicit swara variant in "${token}".`);
    }
  }
  return parsed;
};

export function parseNotationLine(value: NotationInput): ParsedNotationLine {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.some((token) => !token.trim())) {
      throw new Error(
        "Notation arrays must contain at least one non-empty token.",
      );
    }
    if (value.some(isDivider)) {
      throw new Error(
        "Notation arrays cannot contain tala dividers; use a grouped string instead.",
      );
    }
    return {
      tokens: [...value],
      solidBefore: [],
      doubleBefore: [],
      doubleEnd: false,
    };
  }

  if (typeof value !== "string") {
    throw new TypeError("Notation must be an array or a grouped string.");
  }

  const sourceTokens = value.trim().split(/\s+/).filter(Boolean);
  if (sourceTokens.length === 0) {
    throw new Error("Notation must contain at least one token.");
  }

  const tokens: string[] = [];
  const solidBefore: number[] = [];
  const doubleBefore: number[] = [];
  let doubleEnd = false;

  sourceTokens.forEach((token, index) => {
    if (!isDivider(token)) {
      tokens.push(token);
      return;
    }

    if (tokens.length === 0) {
      throw new Error(
        "A tala divider cannot appear before the first notation cell.",
      );
    }
    if (index > 0 && isDivider(sourceTokens[index - 1])) {
      throw new Error("Consecutive tala dividers are not allowed.");
    }

    const isEnd = index === sourceTokens.length - 1;
    if (token === TalaDivider.Anga && isEnd) {
      throw new Error("A single tala divider cannot end a notation line.");
    }
    if (token === TalaDivider.Measure && isEnd) {
      doubleEnd = true;
    } else if (token === TalaDivider.Measure) {
      doubleBefore.push(tokens.length);
    } else {
      solidBefore.push(tokens.length);
    }
  });

  return { tokens, solidBefore, doubleBefore, doubleEnd };
}

export interface SwaraSlot {
  /** A swara sound ("S", "Ṡ") or an attached continuation mark. */
  kind: "sound" | "mark";
  text: string;
}

/**
 * Splits one swara token into its ordered slots: every letter and every
 * continuation mark in a token shares the token's one unit equally. `G,` is a
 * quaver swara tied to a quaver hold; `NN` is two quavers; `,,` is two hold
 * slots. Returns null when the token is not a swara token at all.
 */
export function splitSwaraSlots(token: string): SwaraSlot[] | null {
  const slots: SwaraSlot[] = [];
  for (const unitMatch of token.matchAll(/(\p{L}\p{M}*\d*\p{M}*)|([.,-])/gu)) {
    if (unitMatch[1] && /\d/u.test(unitMatch[1])) {
      const sound = unitMatch[1].replace(/\p{M}/gu, "");
      if (!/^(?:[RGDN][123]|M[12])$/u.test(sound)) {
        throw new Error(`Invalid explicit swara variant "${unitMatch[1]}".`);
      }
    }
    slots.push(
      unitMatch[1]
        ? { kind: "sound", text: unitMatch[1] }
        : { kind: "mark", text: unitMatch[2] },
    );
  }
  const consumed = slots.reduce((total, slot) => total + slot.text.length, 0);
  if (slots.length === 0 || consumed !== token.length) return null;
  return slots;
}

/** Number of equal subdivisions within a token's one beat. */
export function swaraSlotCount(token: string): number {
  return splitSwaraSlots(token)?.length ?? 1;
}

/** Maps slash-separated syllables to slots; the last syllable spans the remainder. */
export function splitLyricSlots(
  token: string,
  swaraToken: string,
): string[] | null {
  if (!token.includes("/")) return null;
  const parts = token.split("/").flatMap((part) => {
    // `nnu/ko-` is shorthand for `nnu/ko/-`.
    const match = part.match(/^(.+?)([-,]+)$/u);
    return match ? [match[1], ...match[2]] : [part];
  });
  const slots = splitSwaraSlots(swaraToken);
  if (parts.some((part) => !part) || !slots || parts.length > slots.length) {
    throw new Error(
      `Lyric "${token}" must have non-empty syllables fitting the slots of "${swaraToken}".`,
    );
  }
  parts.forEach((part, index) => {
    if (slots[index].kind === "mark" && part !== "-" && part !== ",") {
      throw new Error(
        `Lyric "${part}" falls under a held swara slot in "${swaraToken}".`,
      );
    }
  });
  return parts;
}

export function validateAlignedLyrics(
  swaras: ParsedNotationLine,
  lyrics: ParsedNotationLine | null,
) {
  if (!lyrics) return;
  if (swaras.tokens.length !== lyrics.tokens.length) {
    throw new Error(
      `Swara and lyric lines must have the same number of cells (${swaras.tokens.length} swara cells !== ${lyrics.tokens.length} lyric cells).`,
    );
  }
  lyrics.tokens.forEach((token, index) =>
    splitLyricSlots(token, swaras.tokens[index]),
  );
  if (
    !sameNumbers(swaras.solidBefore, lyrics.solidBefore) ||
    !sameNumbers(swaras.doubleBefore, lyrics.doubleBefore) ||
    swaras.doubleEnd !== lyrics.doubleEnd
  ) {
    throw new Error(
      "Swara and lyric lines must use tala dividers in the same positions.",
    );
  }
}

/**
 * Validates one parsed swara row against a declared `@Time` signature: the
 * cells between any two tala dividers must match the cyclical anga lengths
 * and every row must span whole measures (a double divider at its end). The
 * paired lyric row follows the same division through swara–sahitya slot
 * alignment: one lyric cell per slot, so its per-anga cell count equals the
 * swara row's slot count for that anga.
 */
const validateRowTime = (
  row: ParsedNotationLine,
  time: ParsedTimeSignature,
) => {
  if (!row.doubleEnd) {
    throw new Error(
      `Rows under @Time ${timeLabel(time)} must end with || so each row spans whole measures.`,
    );
  }
  const starts = [0, ...row.solidBefore, ...row.doubleBefore].sort(
    (a, b) => a - b,
  );
  if (starts.length % time.grouping.length !== 0) {
    throw new Error(
      `Rows under @Time ${timeLabel(time)} must span whole ${time.grouping.join("+")} measures; this row stops after anga ${starts.length % time.grouping.length} of ${time.grouping.length}.`,
    );
  }
  starts.forEach((start, angaIndex) => {
    const end =
      angaIndex + 1 < starts.length ? starts[angaIndex + 1] : row.tokens.length;
    const expected = time.grouping[angaIndex % time.grouping.length];
    const count = end - start;
    if (count !== expected) {
      throw new Error(
        `Anga ${angaIndex + 1} has ${count} cells; @Time ${timeLabel(time)} expects ${expected}.`,
      );
    }
  });
};

export interface ParsedSwaraBeat {
  /** Source text of the cell, for example "S" or the joined token "SR". */
  text: string;
  /**
   * Individual sounds in the cell; more than one for joined subdivisions
   * ("SR" -> ["S", "R"]), empty for a standalone duration mark.
   */
  sounds: string[];
  /**
   * Total duration in units; duration marks fold into the previous cell.
   * One unit is the score's base duration, a crotchet by default.
   */
  units: number;
  /** True for a `*` rest cell (plus the marks folded into it). */
  rest?: boolean;
}

/** Duration weight of each standalone duration mark, in base units. */
export const durationMarkUnits: Readonly<Record<string, number>> = {
  ".": 1,
  "-": 1,
  ",": 1,
};

/** The retired dhirga mark: rejected with a pointer to `,` / `-`. */
export const RETIRED_DHIRGA_MARK = ";";

/** Error text for a `;` cell, shared by the parser and the converter. */
export const retiredDhirgaMessage = () =>
  `The dhirga mark "${RETIRED_DHIRGA_MARK}" is not supported; hold a swara with one "," or "-" cell per beat.`;

/** The only way to write silence: a one-unit rest cell. Marks extend it. */
export const REST_TOKEN = "*";

/** True for a cell that only holds duration: `-`, `,`, `,,`, and the like. */
export const isDurationMarkToken = (token: string): boolean =>
  durationMarkUnits[token] !== undefined ||
  (splitSwaraSlots(token)?.every((slot) => slot.kind === "mark") ?? false);

export function parseSwaraDurations(value: NotationInput): ParsedSwaraBeat[] {
  const { tokens } = parseSwaraLine(value);
  const beats: ParsedSwaraBeat[] = [];

  const extend = (token: string, units: number) => {
    const previous = beats.at(-1);
    if (previous) {
      previous.units += units;
      return;
    }
    // A mark opening the line continues the previous line's last cell; the
    // section-level parser rejects one with nothing before it.
    beats.push({ text: token, sounds: [], units });
  };

  tokens.forEach((token) => {
    if (token === REST_TOKEN) {
      beats.push({ text: token, sounds: [], units: 1, rest: true });
      return;
    }
    const markUnits = durationMarkUnits[token];
    if (markUnits !== undefined) {
      extend(token, markUnits);
      return;
    }
    const slots = splitSwaraSlots(token);
    if (!slots) {
      beats.push({ text: token, sounds: [token], units: 1 });
      return;
    }
    const sounds = slots
      .filter((slot) => slot.kind === "sound")
      .map((slot) => slot.text);
    if (sounds.length === 0) {
      // A mark-only token such as ",," still spans one unit, shared by its
      // mark slots, and extends the previous beat.
      extend(token, 1);
      return;
    }
    // Sounds and attached marks share the token's one unit: `G,` is a
    // one-unit beat whose sound spans its two quaver slots.
    beats.push({ text: token, sounds, units: 1 });
  });

  return beats;
}

export function parseNotationDirective(
  rawLine: string,
): ParsedNotationDirective | null {
  const line = rawLine.trim();
  if (!line.startsWith("@") && !line.startsWith(">")) return null;

  const marker = line[0];
  const body = line.slice(1).trim();
  if (!body) throw new Error("Notation directives cannot be empty.");

  if (marker === ">") {
    return {
      keyword: NotationDirectiveKeyword.Custom,
      label: "",
      value: body,
    };
  }

  const match = body.match(/^([^:]+):\s*(.*)$/u);
  if (!match) {
    throw new Error(
      `Notation directive must use @Keyword: value syntax: ${line}`,
    );
  }

  const label = match[1].trim();
  const value = match[2].trim();
  if (!label || !value) {
    throw new Error(
      `Notation directive must include a keyword and value: ${line}`,
    );
  }

  const normalized = sectionKey(label);
  return {
    keyword:
      directiveKeywords.get(normalized) ?? NotationDirectiveKeyword.Custom,
    label,
    value,
  };
}

interface DraftNotationSection {
  key: string;
  title: string;
  kind: NotationSectionKind;
  headingLine: number;
  rows: Array<{ value: string; line: number }>;
  before: ParsedNotationDirective[];
  after: ParsedNotationDirective[];
}

const atNotationLine = (error: unknown, line: number): NotationParseError => {
  if (error instanceof NotationParseError) return error;
  if (error instanceof Error)
    return new NotationParseError(error.message, line);
  return new NotationParseError(String(error), line);
};

export function parseScoreNotation(source: string): ParsedScoreNotation {
  if (typeof source !== "string") {
    throw new TypeError("Notation text must be a string.");
  }

  const drafts: DraftNotationSection[] = [];
  const keys = new Set<string>();
  let current: DraftNotationSection | null = null;
  let museScoreSource: string | null = null;

  const lines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    const line = cleanTextLine(rawLine);
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s*(.+)$/u);
    if (heading) {
      const bracketedSuffix = heading[1].match(/\s*\[([^\]]*)\]\s*$/u);
      const swarasSuffix = new RegExp(
        `\\s*\\[${NotationSectionKeyword.Swaras}\\]\\s*$`,
        "iu",
      );
      if (
        (heading[1].includes("[") || heading[1].includes("]")) &&
        !swarasSuffix.test(heading[1])
      ) {
        const marker = bracketedSuffix?.[1]?.trim();
        const renderedMarker = marker ? `[${marker}]` : "bracketed marker";
        throw new NotationParseError(
          `Unknown notation section marker ${renderedMarker}. Use [${NotationSectionKeyword.Swaras}] for a swara-only section.`,
          lineNumber,
        );
      }
      const kind = swarasSuffix.test(heading[1])
        ? NotationSectionKind.Swaras
        : NotationSectionKind.Lyrics;
      const title = heading[1].replace(swarasSuffix, "").trim();
      const key = sectionKey(title);
      if (!key) {
        throw new NotationParseError(
          `Notation section has no usable name: ${line}`,
          lineNumber,
        );
      }
      if (keys.has(key)) {
        throw new NotationParseError(
          `Duplicate notation section: ${title}`,
          lineNumber,
        );
      }
      current = {
        key,
        title,
        kind,
        headingLine: lineNumber,
        rows: [],
        before: [],
        after: [],
      };
      keys.add(key);
      drafts.push(current);
      continue;
    }

    let directive: ParsedNotationDirective | null;
    try {
      directive = parseNotationDirective(line);
    } catch (error) {
      throw atNotationLine(error, lineNumber);
    }
    if (directive) {
      if (directive.keyword === NotationDirectiveKeyword.Source) {
        if (current) {
          throw new NotationParseError(
            "@source must appear before the first notation section.",
            lineNumber,
          );
        }
        if (museScoreSource) {
          throw new NotationParseError(
            "Notation can declare only one @source file.",
            lineNumber,
          );
        }
        const requestedSource = unwrapQuotedValue(directive.value);
        if (!/\.mscz$/iu.test(requestedSource)) {
          throw new NotationParseError(
            "@source must reference a MuseScore .mscz file.",
            lineNumber,
          );
        }
        museScoreSource = requestedSource;
        continue;
      }

      if (!current) {
        throw new NotationParseError(
          `Notation directive appears before a section heading: ${line}`,
          lineNumber,
        );
      }
      const target = current.rows.length === 0 ? current.before : current.after;
      target.push({ ...directive, line: lineNumber });
      continue;
    }

    if (!current) {
      throw new NotationParseError(
        `Notation line appears before a section heading: ${line}`,
        lineNumber,
      );
    }
    current.rows.push({ value: line.replace(/\s+/g, " "), line: lineNumber });
  }

  if (drafts.length === 0) {
    throw new NotationParseError(
      "Notation must contain at least one section heading.",
      1,
    );
  }

  const sections = drafts.map<ParsedNotationSection>((draft) => {
    const { key, title, kind, headingLine, rows, before, after } = draft;
    if (rows.length === 0) {
      throw new NotationParseError(
        `Notation section is empty: ${title}`,
        headingLine,
      );
    }

    const timeDirectives = before.filter(
      (directive) => directive.keyword === NotationDirectiveKeyword.Time,
    );
    if (timeDirectives.length > 1) {
      throw new NotationParseError(
        `${title} may declare @Time only once.`,
        timeDirectives[1].line ?? headingLine,
      );
    }
    const lateTime = after.find(
      (directive) => directive.keyword === NotationDirectiveKeyword.Time,
    );
    if (lateTime) {
      throw new NotationParseError(
        "@Time must appear before the section's notation rows.",
        lateTime.line ?? headingLine,
      );
    }
    let time: ParsedTimeSignature | undefined;
    if (timeDirectives[0]) {
      try {
        time = parseTimeSignature(timeDirectives[0].value);
      } catch (error) {
        throw atNotationLine(error, timeDirectives[0].line ?? headingLine);
      }
    }

    // A duration mark can only extend something: the section's first cell
    // must be a swara or a `*` rest, never `-`, `;`, or `,,`.
    const rejectOpeningMark = (row: { value: string; line: number }) => {
      const first = parseNotationLine(normalizeSwaraRow(row.value)).tokens[0];
      if (first !== undefined && isDurationMarkToken(first)) {
        throw new NotationParseError(
          `Section "${title}" opens with the duration mark "${first}" but has no swara to extend; write a rest as "${REST_TOKEN}".`,
          row.line,
        );
      }
    };
    try {
      rejectOpeningMark(rows[0]);
    } catch (error) {
      throw atNotationLine(error, rows[0].line);
    }
    rows.forEach((row) => {
      if (row.value.split(" ").includes(RETIRED_DHIRGA_MARK)) {
        throw new NotationParseError(retiredDhirgaMessage(), row.line);
      }
    });

    if (kind === NotationSectionKind.Swaras) {
      rows.forEach((row) => {
        try {
          const parsed = parseSwaraLine(row.value);
          if (time) validateRowTime(parsed, time);
        } catch (error) {
          throw atNotationLine(error, row.line);
        }
      });
      return {
        key,
        title,
        kind,
        content: rows.map((row) => normalizeSwaraRow(row.value)),
        before,
        after,
        time,
      };
    }

    if (rows.length % 2 !== 0) {
      throw new NotationParseError(
        `${title} must contain alternating swara and lyric lines; found ${rows.length} lines.`,
        rows.at(-1)?.line ?? headingLine,
      );
    }
    const content: SwaraLyricPair[] = [];
    for (let index = 0; index < rows.length; index += 2) {
      const swaras = rows[index];
      const lyrics = rows[index + 1];
      const normalizedSwaras = normalizeSwaraRow(swaras.value);
      let parsedSwaras: ParsedNotationLine;
      try {
        parsedSwaras = parseSwaraLine(normalizedSwaras);
        if (time) validateRowTime(parsedSwaras, time);
      } catch (error) {
        throw atNotationLine(error, swaras.line);
      }
      try {
        validateAlignedLyrics(parsedSwaras, parseNotationLine(lyrics.value));
      } catch (error) {
        throw atNotationLine(error, lyrics.line);
      }
      content.push({ swaras: normalizedSwaras, lyrics: lyrics.value });
    }
    return { key, title, kind, content, before, after, time };
  });

  return { museScoreSource, sections };
}

export function parseNotationText(source: string): ParsedNotation {
  const result: ParsedNotation = {};
  for (const section of parseScoreNotation(source).sections) {
    result[section.key] = section.content;
  }
  return result;
}

function SwaraToken({ token }: { token: string }) {
  const octave = classifyOctave(token);
  if (octave === OctavePosition.Upper) {
    return React.createElement("strong", null, token);
  }
  if (octave === OctavePosition.Lower) {
    return React.createElement("em", null, token);
  }
  return token;
}

const cellClassName = (
  start: number,
  solidBefore: readonly number[],
  doubleBefore: readonly number[],
  doubleEnd: boolean,
  isLastCell: boolean,
) =>
  [
    "swara-cell",
    solidBefore.includes(start) ? "tala-solid-before" : "",
    doubleBefore.includes(start) ? "tala-double-before" : "",
    doubleEnd && isLastCell ? "tala-double-end" : "",
  ]
    .filter(Boolean)
    .join(" ");

interface NotationCell {
  text: string;
  /** Beat index, used for tala boundaries. */
  start: number;
  content?: ReactNode;
}

/** Subdivide inside one beat cell, preserving equal beat widths. */
const subdividedBeat = (parts: ReactNode[], slots: number): ReactElement =>
  React.createElement(
    "span",
    {
      className: "swara-beat-subdivisions",
      style: {
        display: "grid",
        // Keep two-note groups close, with the same inset in the lyric row.
        width: slots === 2 ? "70%" : undefined,
        marginInline: slots === 2 ? "auto" : undefined,
        gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))`,
      },
    },
    parts.map((part, index) =>
      React.createElement(
        "span",
        {
          key: index,
          style:
            index === parts.length - 1
              ? { gridColumn: `span ${slots - index}` }
              : undefined,
        },
        part,
      ),
    ),
  );

const swaraCells = (tokens: string[], lyrics?: string[]): NotationCell[] =>
  tokens.map((token, start) => {
    const slots = lyrics?.[start]?.includes("/")
      ? splitSwaraSlots(token)
      : null;
    return {
      text: token,
      start,
      content: slots
        ? subdividedBeat(
            slots.map((slot) =>
              React.createElement(SwaraToken, { token: slot.text }),
            ),
            slots.length,
          )
        : undefined,
    };
  });

const lyricCells = (tokens: string[], swaraTokens: string[]): NotationCell[] =>
  tokens.map((token, start) => {
    const parts = splitLyricSlots(token, swaraTokens[start]);
    return {
      text: token,
      start,
      content: parts
        ? subdividedBeat(parts, swaraSlotCount(swaraTokens[start]))
        : undefined,
    };
  });

interface NotationRowProps extends Required<TalaBoundaryProps> {
  cells: NotationCell[];
  kind?: NotationRowKind;
  number?: number;
  rowSpan?: number;
}

function NotationRow({
  cells,
  kind = NotationRowKind.Swara,
  number,
  rowSpan,
  solidBefore,
  doubleBefore,
  doubleEnd,
}: NotationRowProps) {
  return React.createElement(
    "tr",
    {
      className:
        kind === NotationRowKind.Lyrics ? "swara-lyrics" : "swara-notes",
    },
    number !== undefined
      ? React.createElement(
          "td",
          {
            className: "swara-row-number",
            rowSpan,
            "aria-hidden": true,
          },
          React.createElement("span", null, number),
        )
      : null,
    cells.map((cell, index) =>
      React.createElement(
        "td",
        {
          className: cellClassName(
            cell.start,
            solidBefore,
            doubleBefore,
            doubleEnd,
            index === cells.length - 1,
          ),
          key: index,
        },
        cell.content ??
          (kind === NotationRowKind.Swara
            ? React.createElement(SwaraToken, { token: cell.text })
            : cell.text),
      ),
    ),
  );
}

function PalmLeafTable({
  children,
  rows,
}: {
  children?: ReactNode;
  rows: string[][];
}) {
  const beats = Math.max(...rows.map((row) => row.length));
  const longestCell = Math.max(
    ...rows
      .flat()
      .map((token) => Array.from(token.replace(/[\p{M}/]/gu, "")).length),
  );
  // Reserve room for the larger swara font, split syllables, and tala borders.
  const beatWidth = Math.max(7, longestCell * 0.85 + 2);
  return React.createElement(
    "div",
    {
      className: "palm-leaf-frame",
      style: { width: `min(100%, ${beats * beatWidth + 2.2}em)` },
    },
    React.createElement(
      "table",
      { className: "swara-notation-table" },
      children,
    ),
  );
}

export function SwaraTable({
  swaras,
  lyrics,
  number,
  solidBefore,
  doubleBefore,
  doubleEnd,
}: SwaraTableProps): ReactElement {
  const parsedSwaras = parseSwaraLine(swaras);
  const parsedLyrics = lyrics ? parseNotationLine(lyrics) : null;
  validateAlignedLyrics(parsedSwaras, parsedLyrics);
  const resolvedSolidBefore = solidBefore ?? parsedSwaras.solidBefore;
  const resolvedDoubleBefore = doubleBefore ?? parsedSwaras.doubleBefore;
  const resolvedDoubleEnd = doubleEnd ?? parsedSwaras.doubleEnd;

  return React.createElement(
    PalmLeafTable,
    {
      rows: [
        parsedSwaras.tokens,
        ...(parsedLyrics ? [parsedLyrics.tokens] : []),
      ],
    },
    React.createElement(
      "tbody",
      null,
      React.createElement(NotationRow, {
        cells: swaraCells(parsedSwaras.tokens, parsedLyrics?.tokens),
        number,
        rowSpan: lyrics ? 2 : 1,
        solidBefore: resolvedSolidBefore,
        doubleBefore: resolvedDoubleBefore,
        doubleEnd: resolvedDoubleEnd,
      }),
      parsedLyrics
        ? React.createElement(NotationRow, {
            cells: lyricCells(parsedLyrics.tokens, parsedSwaras.tokens),
            kind: NotationRowKind.Lyrics,
            solidBefore: resolvedSolidBefore,
            doubleBefore: resolvedDoubleBefore,
            doubleEnd: resolvedDoubleEnd,
          })
        : null,
    ),
  );
}

export function SwaraGrid({
  rows,
  solidBefore,
  doubleBefore,
  doubleEnd,
}: SwaraGridProps): ReactElement {
  return React.createElement(
    PalmLeafTable,
    { rows: rows.map((row) => parseSwaraLine(row).tokens) },
    React.createElement(
      "tbody",
      null,
      rows.map((row, index) => {
        const parsed = parseSwaraLine(row);
        return React.createElement(NotationRow, {
          cells: swaraCells(parsed.tokens),
          number: index + 1,
          solidBefore: solidBefore ?? parsed.solidBefore,
          doubleBefore: doubleBefore ?? parsed.doubleBefore,
          doubleEnd: doubleEnd ?? parsed.doubleEnd,
          key: index,
        });
      }),
    ),
  );
}

export function SwaraLines({ lines }: SwaraLinesProps): ReactElement {
  return React.createElement(
    React.Fragment,
    null,
    lines.map((line, index) =>
      React.createElement(SwaraTable, {
        ...line,
        number: index + 1,
        key: index,
      }),
    ),
  );
}

const headingId = (title: string) =>
  title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");

function Direction({ directive }: { directive: ParsedNotationDirective }) {
  if (!directive.label) {
    return React.createElement(
      "p",
      { className: "music-direction" },
      directive.value,
    );
  }
  const kind =
    directive.keyword === NotationDirectiveKeyword.Custom
      ? sectionKey(directive.label)
      : directive.keyword;
  return React.createElement(
    "p",
    { className: `music-direction music-direction-${kind}` },
    React.createElement("strong", null, `${directive.label}:`),
    ` ${directive.value}`,
  );
}

function NotationEyeIcon() {
  return React.createElement(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": true },
    React.createElement("path", {
      d: "M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z",
    }),
    React.createElement("circle", { cx: 12, cy: 12, r: 2.75 }),
  );
}

export function MusicScore({
  source,
  museScoreSource,
}: MusicScoreProps): ReactElement {
  const { sections } = parseScoreNotation(source);
  const { h3: MdxHeading } = useMDXComponents();
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      {
        type: "button",
        className: "notation-overview-trigger",
        "data-notation-overview": true,
        "aria-label": "Open notation view",
        title: "Open notation view",
      },
      React.createElement(NotationEyeIcon),
    ),
    museScoreSource
      ? React.createElement(
          "button",
          {
            type: "button",
            className: "engraved-score-trigger",
            "data-engraved-score": museScoreSource,
            "aria-label": "Display Western notation",
          },
          "Display Western notation",
          React.createElement("span", { "aria-hidden": true }, "↗"),
        )
      : null,
    sections.map((section) => {
      const id = headingId(section.title);
      return React.createElement(
        MusicSection,
        {
          title: section.title,
          notationKind: section.kind,
          key: section.key,
        },
        MdxHeading
          ? React.createElement(MdxHeading, null, section.title)
          : React.createElement(
              "h3",
              { id },
              section.title,
              React.createElement(
                "a",
                {
                  className: "heading-anchor",
                  href: `#${id}`,
                  "aria-label": `Link to ${section.title}`,
                },
                "#",
              ),
            ),
        section.before.map((directive, index) =>
          React.createElement(Direction, {
            directive,
            key: `before-${index}`,
          }),
        ),
        section.kind === NotationSectionKind.Swaras
          ? React.createElement(SwaraGrid, { rows: section.content })
          : React.createElement(SwaraLines, { lines: section.content }),
        section.after.map((directive, index) =>
          React.createElement(Direction, {
            directive,
            key: `after-${index}`,
          }),
        ),
      );
    }),
  );
}

export function MusicSection({
  title,
  notationKind,
  children,
}: MusicSectionProps): ReactElement {
  let lineNumber = 0;
  const numberedChildren = Children.map(children, (child) => {
    if (!isValidElement<SwaraTableProps>(child) || child.type !== SwaraTable) {
      return child;
    }
    lineNumber += 1;
    return cloneElement(child, { number: lineNumber });
  });

  return React.createElement(
    "div",
    {
      className: "music-section",
      "data-music-section": true,
      "data-title": title,
      "data-notation-kind": notationKind,
    },
    numberedChildren,
  );
}
