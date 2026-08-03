import type { ReactElement, ReactNode } from "react";

export interface TalaBoundaryProps {
  /** Zero-based cell positions that begin with a single tala divider. */
  solidBefore?: number[];
  /** Zero-based cell positions that begin with a double tala divider. */
  doubleBefore?: number[];
  /** Draw a double tala divider after the final cell. */
  doubleEnd?: boolean;
}

export interface SwaraTableProps extends TalaBoundaryProps {
  swaras: string[] | string;
  lyrics?: string[] | string;
  /** Assigned automatically when the table is a direct child of MusicSection. */
  number?: number;
}

export interface SwaraGridProps extends TalaBoundaryProps {
  rows: Array<string[] | string>;
}

export interface SwaraLinesProps {
  lines: Array<Omit<SwaraTableProps, "number">>;
}

export interface MusicSectionProps {
  /** Used by the whole-section zoom dialog. */
  title: string;
  notationKind?: "lyrics" | "swaras";
  children: ReactNode;
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

export function parseNotationText(source: string): ParsedNotation;
export function SwaraTable(props: SwaraTableProps): ReactElement;
export function SwaraGrid(props: SwaraGridProps): ReactElement;
export function SwaraLines(props: SwaraLinesProps): ReactElement;
export function MusicScore(props: MusicScoreProps): ReactElement;
export function MusicSection(props: MusicSectionProps): ReactElement;
