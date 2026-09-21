/**
 * Line-oriented diff used by the "Converter test cases" page to show how the
 * current converter output departs from a stored snapshot. Common prefix and
 * suffix lines are trimmed first, then the changed span is aligned with a
 * longest-common-subsequence table; spans too large for that are shown as a
 * removed block followed by an added block.
 */

export type DiffLine = { kind: " " | "-" | "+"; text: string };

/** Largest pair of line arrays the quadratic LCS is allowed to compare. */
const LCS_LIMIT = 4000;

export const lineDiff = (before: string, after: string): DiffLine[] => {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const result: DiffLine[] = a
    .slice(0, start)
    .map((text) => ({ kind: " ", text }) as DiffLine);

  if (midA.length * midB.length > LCS_LIMIT * LCS_LIMIT) {
    // Too large for a precise alignment: show the changed span as a block.
    for (const text of midA) result.push({ kind: "-", text });
    for (const text of midB) result.push({ kind: "+", text });
  } else {
    // Classic LCS table on the changed span only.
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        table[i * cols + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * cols + j + 1] + 1
            : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        result.push({ kind: " ", text: midA[i] });
        i += 1;
        j += 1;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
        result.push({ kind: "-", text: midA[i] });
        i += 1;
      } else {
        result.push({ kind: "+", text: midB[j] });
        j += 1;
      }
    }
    while (i < midA.length) result.push({ kind: "-", text: midA[i++] });
    while (j < midB.length) result.push({ kind: "+", text: midB[j++] });
  }

  for (const text of a.slice(endA)) result.push({ kind: " ", text });
  return result;
};

export type DiffHunkLine = DiffLine | { kind: "skip"; count: number };

/** Keeps changed lines plus a little context, collapsing long equal runs. */
const CONTEXT = 3;

export const hunkify = (lines: DiffLine[]) => {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === " ") return;
    for (
      let k = Math.max(0, index - CONTEXT);
      k <= Math.min(lines.length - 1, index + CONTEXT);
      k += 1
    ) {
      keep[k] = true;
    }
  });
  const output: DiffHunkLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) output.push({ kind: "skip", count: skipped });
      skipped = 0;
      output.push(line);
    } else {
      skipped += 1;
    }
  });
  if (skipped > 0) output.push({ kind: "skip", count: skipped });
  return output;
};
