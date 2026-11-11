import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const scoreRoot = path.join(root, "scores");

const files = [];
const collect = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolutePath);
    else if (entry.name.endsWith(".mdx")) files.push(absolutePath);
  }
};
collect(scoreRoot);

const visualWidth = (token) =>
  Array.from(token.normalize("NFD").replace(/\p{Mark}/gu, "")).length;

// ASCII octave aliases, mirroring normalizeSwaraToken in
// components/score-notation.ts: `S'` is Ṡ (tāra), `s` is Ṣ (mandra).
const aliasTokenGate = /^(?:\p{Lu}\p{M}*\d*'?|\p{Ll}\p{M}*\d*|[.,-])+$/u;
const normalizeSwaraToken = (token) =>
  !aliasTokenGate.test(token)
    ? token
    : token
        .replace(/(\p{Lu}\d*)'/gu, "$1\u0307")
        .replace(
          /(\p{Ll})(?!\u0323)/gu,
          (letter) => `${letter.toUpperCase()}\u0323`,
        )
        .replace(/\p{Ll}/gu, (letter) => letter.toUpperCase());
const normalizeSwaraRow = (line) => line.replace(/\S+/gu, normalizeSwaraToken);

const padTo = (token, cells) =>
  token.padEnd(token.length + cells - visualWidth(token));

/** Pads equal-token-count rows column by column. */
const alignColumns = (rows) => {
  const length = rows[0]?.length ?? 0;
  if (!length || rows.some((row) => row.length !== length)) return null;
  const widths = Array.from({ length }, (_, column) =>
    Math.max(...rows.map((row) => visualWidth(row[column]))),
  );
  return rows.map((row) =>
    row
      .map((token, column) => padTo(token, widths[column]))
      .join(" ")
      .trimEnd(),
  );
};

const alignLines = (lines) => {
  const tokens = lines.map((line) => line.trim().split(/\s+/));
  return alignColumns(tokens) ?? lines;
};

/**
 * Pads swara/lyric pairs column by column; lyric cells pair 1:1 with swara
 * cells, so both rows share the same token columns, dividers included.
 */
const alignSwaraLyricPairs = (pairs) =>
  alignColumns(pairs.flatMap((pair) => [pair.swaras, pair.lyrics])) ?? [];

const alignNotationBlock = (block) => {
  const lines = block.split("\n");
  let headingIndex = -1;

  const alignSection = (start, end) => {
    if (start < 0) return;
    const swarasOnly = /\[swaras\]\s*$/i.test(lines[start]);
    const notationIndexes = [];
    for (let index = start + 1; index < end; index += 1) {
      const line = lines[index].trim();
      if (line && !line.startsWith(">") && !line.startsWith("@")) {
        notationIndexes.push(index);
      }
    }

    if (swarasOnly) {
      const aligned = alignLines(
        notationIndexes.map((index) => normalizeSwaraRow(lines[index])),
      );
      notationIndexes.forEach((index, row) => {
        lines[index] = aligned[row];
      });
      return;
    }

    const pairs = [];
    for (let row = 0; row + 1 < notationIndexes.length; row += 2) {
      pairs.push({
        swaras: normalizeSwaraRow(lines[notationIndexes[row]])
          .trim()
          .split(/\s+/),
        lyrics: lines[notationIndexes[row + 1]].trim().split(/\s+/),
      });
    }
    const alignedPairs = alignSwaraLyricPairs(pairs);
    for (let row = 0; row < notationIndexes.length; row += 1) {
      if (alignedPairs[row] !== undefined) {
        lines[notationIndexes[row]] = alignedPairs[row];
      }
    }
  };

  lines.forEach((line, index) => {
    if (!line.trim().match(/^#{1,6}\s*/)) return;
    alignSection(headingIndex, index);
    headingIndex = index;
  });
  alignSection(headingIndex, lines.length);
  return lines.join("\n");
};

const notationPattern =
  /(export const notation =\s*(?:parseNotationText\(\s*)?(?:\/\* prettier-ignore \*\/\s*)?`)([\s\S]*?)(`(?:\);|;))/g;
const carnaticBlockPattern = /(```carnatic\r?\n)([\s\S]*?)(\r?\n```)/g;
const changed = [];

for (const absolutePath of files.sort()) {
  const source = fs.readFileSync(absolutePath, "utf8");
  const formatted = source
    .replace(
      notationPattern,
      (_, opening, block, closing) =>
        `${opening}${alignNotationBlock(block)}${closing}`,
    )
    .replace(
      carnaticBlockPattern,
      (_, opening, block, closing) =>
        `${opening}${alignNotationBlock(block)}${closing}`,
    );
  if (formatted === source) continue;
  changed.push(path.relative(root, absolutePath));
  if (!checkOnly) fs.writeFileSync(absolutePath, formatted);
}

if (checkOnly && changed.length) {
  console.error("Notation text alignment is required:");
  changed.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log(
  changed.length
    ? `Aligned notation text in ${changed.length} file(s).`
    : "Notation text is already aligned.",
);
