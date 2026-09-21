import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  NotationParseError,
  parseScoreNotation,
} from "../components/score-notation.ts";
import { notationBlocksFor } from "../components/carnatic-mscx.ts";
import { getRaga } from "../components/ragas.generated.ts";

export { notationBlocksFor } from "../components/carnatic-mscx.ts";

interface NotationIssue {
  file: string;
  line: number;
  column: number;
  message: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scoresDirectory = path.join(root, "scores");
const guideFile = path.join(root, "docs", "score-notation.md");

const discoverMdxFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverMdxFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [absolute] : [];
  });

const notationFiles = () => [...discoverMdxFiles(scoresDirectory), guideFile];

const metadataPattern = /```yaml[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/;

const lineAtOffset = (source: string, offset: number) =>
  source.slice(0, offset).split(/\r?\n/).length;

/**
 * Keys whose values are derived from data/ragas.toml; scores must not repeat
 * them. Per-score source variants use the *_override keys plus a source note.
 */
const ragaDerivedKeys = [
  "arohana",
  "avarohana",
  "raga_type",
  "janya_of",
  "melakarta_number",
];

/** Validates the YAML score metadata against the raga registry. */
const validateMetadata = (source: string, file: string): NotationIssue[] => {
  const match = source.match(metadataPattern);
  if (!match) return [];
  const blockStartLine = lineAtOffset(
    source,
    (match.index ?? 0) + match[0].indexOf(match[1]),
  );

  let metadata: Record<string, unknown>;
  try {
    const parsed: unknown = parseYaml(match[1]);
    if (parsed === null || parsed === undefined) return [];
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return [
        {
          file,
          line: blockStartLine,
          column: 1,
          message: "Score metadata must be a YAML mapping.",
        },
      ];
    }
    metadata = parsed as Record<string, unknown>;
  } catch (error) {
    return [
      {
        file,
        line: blockStartLine,
        column: 1,
        message: `Invalid YAML metadata: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  const keyLine = (key: string): number => {
    const offset = match[1]
      .split(/\r?\n/)
      .findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
    return offset === -1 ? blockStartLine : blockStartLine + offset;
  };

  const issues: NotationIssue[] = [];
  const raga =
    typeof metadata.raga === "string" ? metadata.raga.trim() : undefined;
  if (raga && raga !== "TODO" && !getRaga(raga)) {
    issues.push({
      file,
      line: keyLine("raga"),
      column: 1,
      message: `Unknown raga "${raga}"; add it to data/ragas.toml (with arohana, avarohana, and a reference) before using it.`,
    });
  }
  for (const key of ragaDerivedKeys) {
    if (metadata[key] !== undefined) {
      issues.push({
        file,
        line: keyLine(key),
        column: 1,
        message: `Metadata "${key}" is derived from data/ragas.toml; remove it. For a documented source variant, use arohana_override/avarohana_override with a source note.`,
      });
    }
  }
  if (
    metadata.arohana_override !== undefined ||
    metadata.avarohana_override !== undefined
  ) {
    const overrideKey =
      metadata.arohana_override !== undefined
        ? "arohana_override"
        : "avarohana_override";
    if (
      metadata.source === undefined &&
      metadata.notation_exception === undefined
    ) {
      issues.push({
        file,
        line: keyLine(overrideKey),
        column: 1,
        message: `"${overrideKey}" must be backed by a "source" or "notation_exception" metadata note citing the score's variant.`,
      });
    }
  }
  return issues;
};

export const validateNotationFile = (absoluteFile: string): NotationIssue[] => {
  const source = fs.readFileSync(absoluteFile, "utf8");
  const file = path.relative(root, absoluteFile).replaceAll("\\", "/");

  return [
    ...validateMetadata(source, file),
    ...notationBlocksFor(source).flatMap((block) => {
      try {
        parseScoreNotation(block.source);
        return [];
      } catch (error) {
        const relativeLine =
          error instanceof NotationParseError ? error.line : 1;
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
    }),
  ];
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
