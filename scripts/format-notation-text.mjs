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

const alignLines = (lines) => {
  const tokens = lines.map((line) => line.trim().split(/\s+/));
  const length = tokens[0]?.length ?? 0;
  if (!length || tokens.some((row) => row.length !== length)) return lines;

  const widths = Array.from({ length }, (_, column) =>
    Math.max(...tokens.map((row) => visualWidth(row[column]))),
  );
  return tokens.map((row) =>
    row
      .map((token, column) => token.padEnd(token.length + widths[column] - visualWidth(token)))
      .join(" ")
      .trimEnd(),
  );
};

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
      const aligned = alignLines(notationIndexes.map((index) => lines[index]));
      notationIndexes.forEach((index, row) => {
        lines[index] = aligned[row];
      });
      return;
    }

    for (let row = 0; row < notationIndexes.length; row += 2) {
      const pairIndexes = notationIndexes.slice(row, row + 2);
      if (pairIndexes.length !== 2) continue;
      const aligned = alignLines(pairIndexes.map((index) => lines[index]));
      pairIndexes.forEach((index, pairRow) => {
        lines[index] = aligned[pairRow];
      });
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
