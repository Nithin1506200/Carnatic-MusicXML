import { describe, expect, it } from "vitest";
import { hunkify, lineDiff } from "./line-diff.ts";

const render = (before: string, after: string) =>
  lineDiff(before, after).map((line) => `${line.kind}${line.text}`);

describe("line diff", () => {
  it("reports identical texts as context only", () => {
    expect(render("a\nb", "a\nb")).toEqual([" a", " b"]);
  });

  it("marks a changed line as removed then added", () => {
    expect(render("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("aligns insertions and deletions inside the changed span", () => {
    expect(render("a\nb\nc\nd", "a\nc\nx\nd")).toEqual([
      " a",
      "-b",
      " c",
      "+x",
      " d",
    ]);
  });

  it("handles a completely new or emptied text", () => {
    expect(render("", "a\nb")).toEqual(["-", "+a", "+b"]);
    expect(render("a", "")).toEqual(["-a", "+"]);
  });

  it("collapses long unchanged runs into skip markers with context", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "LINE 10");
    const hunks = hunkify(lineDiff(before, after));
    expect(hunks[0]).toEqual({ kind: "skip", count: 7 });
    expect(hunks.slice(1, 9).map((line) => line.kind)).toEqual([
      " ", " ", " ", "-", "+", " ", " ", " ",
    ]);
    expect(hunks[9]).toEqual({ kind: "skip", count: 6 });
  });
});
