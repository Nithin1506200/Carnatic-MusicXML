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
}

export interface SwaraLyricPair {
  swaras: string;
  lyrics: string;
}

interface ParsedNotationSectionBase {
  key: string;
  title: string;
  before: ParsedNotationDirective[];
  after: ParsedNotationDirective[];
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

const cleanTextLine = (line: string) =>
  line
    .trim()
    .replace(/^["'`]\s*/, "")
    .replace(/\s*["'`]\s*,?\s*$/, "")
    .trim();

const unwrapQuotedValue = (value: string) =>
  value.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();

export function classifyOctave(token: string): OctavePosition {
  if (/\u0307$/u.test(token)) return OctavePosition.Upper;
  if (/\u0323$/u.test(token)) return OctavePosition.Lower;
  return OctavePosition.Middle;
}

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

export function validateAlignedLyrics(
  swaras: ParsedNotationLine,
  lyrics: ParsedNotationLine | null,
) {
  if (!lyrics) return;
  if (swaras.tokens.length !== lyrics.tokens.length) {
    throw new Error(
      `Swara and lyric lines must have the same number of cells (${swaras.tokens.length} !== ${lyrics.tokens.length}).`,
    );
  }
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
      target.push(directive);
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

    if (kind === NotationSectionKind.Swaras) {
      rows.forEach((row) => {
        try {
          parseNotationLine(row.value);
        } catch (error) {
          throw atNotationLine(error, row.line);
        }
      });
      return {
        key,
        title,
        kind,
        content: rows.map((row) => row.value),
        before,
        after,
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
      let parsedSwaras: ParsedNotationLine;
      try {
        parsedSwaras = parseNotationLine(swaras.value);
      } catch (error) {
        throw atNotationLine(error, swaras.line);
      }
      try {
        validateAlignedLyrics(parsedSwaras, parseNotationLine(lyrics.value));
      } catch (error) {
        throw atNotationLine(error, lyrics.line);
      }
      content.push({ swaras: swaras.value, lyrics: lyrics.value });
    }
    return { key, title, kind, content, before, after };
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
  index: number,
  solidBefore: readonly number[],
  doubleBefore: readonly number[],
  doubleEnd: boolean,
  length: number,
) =>
  [
    "swara-cell",
    solidBefore.includes(index) ? "tala-solid-before" : "",
    doubleBefore.includes(index) ? "tala-double-before" : "",
    doubleEnd && index === length - 1 ? "tala-double-end" : "",
  ]
    .filter(Boolean)
    .join(" ");

interface NotationRowProps extends Required<TalaBoundaryProps> {
  tokens: string[];
  kind?: NotationRowKind;
  number?: number;
  rowSpan?: number;
}

function NotationRow({
  tokens,
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
    tokens.map((token, index) =>
      React.createElement(
        "td",
        {
          className: cellClassName(
            index,
            solidBefore,
            doubleBefore,
            doubleEnd,
            tokens.length,
          ),
          key: index,
        },
        kind === NotationRowKind.Swara
          ? React.createElement(SwaraToken, { token })
          : token,
      ),
    ),
  );
}

function PalmLeafTable({ children }: { children?: ReactNode }) {
  return React.createElement(
    "div",
    { className: "palm-leaf-frame" },
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
  const parsedSwaras = parseNotationLine(swaras);
  const parsedLyrics = lyrics ? parseNotationLine(lyrics) : null;
  validateAlignedLyrics(parsedSwaras, parsedLyrics);
  const resolvedSolidBefore = solidBefore ?? parsedSwaras.solidBefore;
  const resolvedDoubleBefore = doubleBefore ?? parsedSwaras.doubleBefore;
  const resolvedDoubleEnd = doubleEnd ?? parsedSwaras.doubleEnd;

  return React.createElement(
    PalmLeafTable,
    null,
    React.createElement(
      "tbody",
      null,
      React.createElement(NotationRow, {
        tokens: parsedSwaras.tokens,
        number,
        rowSpan: lyrics ? 2 : 1,
        solidBefore: resolvedSolidBefore,
        doubleBefore: resolvedDoubleBefore,
        doubleEnd: resolvedDoubleEnd,
      }),
      parsedLyrics
        ? React.createElement(NotationRow, {
            tokens: parsedLyrics.tokens,
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
    null,
    React.createElement(
      "tbody",
      null,
      rows.map((row, index) => {
        const parsed = parseNotationLine(row);
        return React.createElement(NotationRow, {
          tokens: parsed.tokens,
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
