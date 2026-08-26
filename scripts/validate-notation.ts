import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  NotationParseError,
  parseScoreNotation,
} from "../components/score-notation.ts";

interface CarnaticBlock {
  source: string;
  line: number;
}

interface NotationIssue {
  file: string;
  line: number;
  column: number;
  message: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scoresDirectory = path.join(root, "scores");
const guideFile = path.join(root, "docs", "score-notation.md");
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

export const notationBlocksFor = (source: string): CarnaticBlock[] =>
  [
    ...blocksForPattern(source, blockPattern),
    ...blocksForPattern(source, inlinePattern),
  ].sort((left, right) => left.line - right.line);

const discoverMdxFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverMdxFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [absolute] : [];
  });

const notationFiles = () => [...discoverMdxFiles(scoresDirectory), guideFile];

export const validateNotationFile = (absoluteFile: string): NotationIssue[] => {
  const source = fs.readFileSync(absoluteFile, "utf8");
  const file = path.relative(root, absoluteFile).replaceAll("\\", "/");

  return notationBlocksFor(source).flatMap((block) => {
    try {
      parseScoreNotation(block.source);
      return [];
    } catch (error) {
      const relativeLine = error instanceof NotationParseError ? error.line : 1;
      const column = error instanceof NotationParseError ? error.column : 1;
      return [
        {
          file,
          line: block.line + relativeLine - 1,
          column,
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  });
};

const formatIssue = (issue: NotationIssue) =>
  `${issue.file}:${issue.line}:${issue.column} - error Carnatic notation: ${issue.message}`;

const validateAll = () => {
  const files = notationFiles();
  const issues = files.flatMap(validateNotationFile);
  issues.forEach((issue) => console.log(formatIssue(issue)));
  return { files, issues };
};

const runOnce = () => {
  const { files, issues } = validateAll();
  if (issues.length > 0) {
    process.exitCode = 1;
    return;
  }

  const blocks = files.reduce(
    (total, file) =>
      total + notationBlocksFor(fs.readFileSync(file, "utf8")).length,
    0,
  );
  console.log(`Validated ${blocks} Carnatic notation blocks.`);
};

const runWatcher = () => {
  const validate = () => {
    console.log("Watching Carnatic notation");
    validateAll();
    console.log("Notation validation ready");
  };

  const fingerprint = () => {
    try {
      return notationFiles()
        .map((file) => {
          const stats = fs.statSync(file);
          return `${file}:${stats.mtimeMs}:${stats.size}`;
        })
        .join("\n");
    } catch {
      return `rescan:${Date.now()}`;
    }
  };

  let previousFingerprint = fingerprint();
  validate();
  setInterval(() => {
    const nextFingerprint = fingerprint();
    if (nextFingerprint === previousFingerprint) return;
    previousFingerprint = nextFingerprint;
    validate();
  }, 250);
};

const invokedFile = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedFile) {
  if (process.argv.includes("--watch")) runWatcher();
  else runOnce();
}
