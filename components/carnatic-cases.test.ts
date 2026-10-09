import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARNATIC_CASES } from "./carnatic-cases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The "Converter test cases" page bundles repository scores through literal
 * `import.meta.glob` patterns, so every file-backed case must be in that
 * list — otherwise the case fails only in the browser as "not bundled".
 */
const bundledPatterns = () => {
  const page = fs.readFileSync(
    path.join(root, "app", "converter-cases.tsx"),
    "utf8",
  );
  const block = /BUNDLED_CASE_SCORES = \[([\s\S]*?)\] as const/u.exec(page);
  const globBlock = /import\.meta\.glob<string>\(\s*\[([\s\S]*?)\]/u.exec(page);
  const list = (source: string | undefined) =>
    [...(source ?? "").matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  return {
    declared: list(block?.[1]),
    globbed: list(globBlock?.[1]).map((entry) => entry.replace(/^\.\.\//u, "")),
  };
};

describe("file-backed converter cases", () => {
  const fileCases = CARNATIC_CASES.filter((testCase) => testCase.file);

  it("are all bundled by the test-cases page", () => {
    const { declared, globbed } = bundledPatterns();
    expect(globbed).toEqual(declared);
    for (const testCase of fileCases) {
      expect(declared).toContain(testCase.file);
    }
  });

  it("point at files that exist", () => {
    for (const testCase of fileCases) {
      expect(fs.existsSync(path.join(root, testCase.file!))).toBe(true);
    }
  });
});
