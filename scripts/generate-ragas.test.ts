import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getRaga, RAGAS } from "../components/ragas.generated.ts";
import { buildGeneratedModule, parseRagas } from "./generate-ragas.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toml = fs.readFileSync(path.join(root, "data", "ragas.toml"), "utf8");

describe("data/ragas.toml registry", () => {
  const ragas = parseRagas(toml);

  it("contains exactly the 72 melakartas, numbered 1 through 72", () => {
    const melakartas = ragas.filter((raga) => raga.type === "melakarta");
    expect(melakartas).toHaveLength(72);
    const numbers = melakartas
      .map((raga) => raga.melakartaNumber)
      .sort((left, right) => left! - right!);
    expect(numbers).toEqual(Array.from({ length: 72 }, (_, i) => i + 1));
  });

  it("keeps every melakarta avarohana the exact reverse of its arohana", () => {
    for (const raga of ragas.filter((entry) => entry.type === "melakarta")) {
      expect(raga.avarohana).toBe(
        raga.arohana.split(/\s+/).reverse().join(" "),
      );
    }
  });

  it("records the ragas used by repository scores with their exact scales", () => {
    const byName = new Map(ragas.map((raga) => [raga.name, raga]));
    expect(byName.get("Mayamalavagowla")).toMatchObject({
      type: "melakarta",
      melakartaNumber: 15,
      arohana: "S R1 G3 M1 P D1 N3 S",
      avarohana: "S N3 D1 P M1 G3 R1 S",
    });
    expect(byName.get("Malahari")).toMatchObject({
      type: "janya",
      janyaOf: "Mayamalavagowla",
      arohana: "S R1 M1 P D1 S",
      avarohana: "S D1 P M1 G3 R1 S",
    });
    expect(byName.get("Vasantha")).toMatchObject({
      type: "janya",
      janyaOf: "Suryakanta",
      arohana: "S M1 G3 M1 D2 N3 S",
      avarohana: "S N3 D2 M1 G3 R1 S",
    });
    expect(byName.get("Madhyamavathi")).toMatchObject({
      type: "janya",
      janyaOf: "Kharaharapriya",
      arohana: "S R2 M1 P N2 S",
      avarohana: "S N2 P M1 R2 S",
    });
  });

  it("gives every janya a resolvable parent, a scale, and a reference", () => {
    const melakartaNames = new Set(
      ragas
        .filter((raga) => raga.type === "melakarta")
        .map((raga) => raga.name),
    );
    for (const raga of ragas.filter((entry) => entry.type === "janya")) {
      expect(melakartaNames).toContain(raga.janyaOf);
      expect(raga.arohana).toMatch(/^S .+ S$/);
      expect(raga.avarohana).toMatch(/^S .+ S$/);
      expect(raga.reference.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps names and alternate names unique across the file", () => {
    const names = ragas.flatMap((raga) => [raga.name, ...raga.alternateNames]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("generated raga module", () => {
  it("exposes every raga with a typed name union", () => {
    expect(RAGAS).toHaveLength(parseRagas(toml).length);
    for (const raga of RAGAS) {
      expect(typeof raga.name).toBe("string");
      expect(["melakarta", "janya"]).toContain(raga.type);
    }
  });

  it("resolves canonical names and alternate spellings", () => {
    expect(getRaga("Mayamalavagowla")).toMatchObject({
      name: "Mayamalavagowla",
      melakartaNumber: 15,
    });
    expect(getRaga("Shankarabharanam")?.name).toBe("Dheerasankarabharanam");
    expect(getRaga("Madhyamavati")?.name).toBe("Madhyamavathi");
    expect(getRaga("Todi")?.name).toBe("Hanumatodi");
    expect(getRaga("Madeupragam")).toBeUndefined();
  });
});

describe("parseRagas validation", () => {
  const minimal = (blocks: string) => `
${Array.from({ length: 72 }, (_, i) => {
  const number = i + 1;
  return `
[[melakarta]]
number = ${number}
name = "M${number}"
arohana = "S R1 G1 M1 P D1 N1 S"
avarohana = "S N1 D1 P M1 G1 R1 S"
reference = "test"
`;
}).join("\n")}
${blocks}
`;

  it("rejects fewer than 72 melakartas", () => {
    expect(() =>
      parseRagas(
        '[[melakarta]]\nnumber = 1\nname = "X"\narohana = "S R1 G1 M1 P D1 N1 S"\navarohana = "S N1 D1 P M1 G1 R1 S"\nreference = "t"',
      ),
    ).toThrow("expected 72 melakartas");
  });

  it("rejects a melakarta whose avarohana is not the reversed arohana", () => {
    expect(() =>
      parseRagas(
        '[[melakarta]]\nnumber = 1\nname = "X"\narohana = "S R1 G1 M1 P D1 N1 S"\navarohana = "S N2 D1 P M1 G1 R1 S"\nreference = "t"',
      ),
    ).toThrow('melakarta "X": a melakarta avarohana must be the exact reverse');
  });

  it("rejects a janya whose parent does not exist", () => {
    expect(() =>
      parseRagas(
        minimal(
          '[[janya]]\nname = "J"\njanya_of = "Nowhere"\narohana = "S R1 S"\navarohana = "S R1 S"\nreference = "t"',
        ),
      ),
    ).toThrow('janya "J": janya_of "Nowhere" does not match any melakarta');
  });

  it("rejects duplicate names and alternate-name collisions", () => {
    expect(() =>
      parseRagas(
        minimal(
          [
            '[[janya]]\nname = "M1"\njanya_of = "M2"\narohana = "S R1 S"\navarohana = "S R1 S"\nreference = "t"',
          ].join("\n"),
        ),
      ),
    ).toThrow(
      'janya "M1" claims the name "M1", already used by melakarta "M1"',
    );
  });

  it("rejects malformed swara tokens", () => {
    expect(() =>
      parseRagas(
        minimal(
          '[[janya]]\nname = "J"\njanya_of = "M1"\narohana = "S R4 S"\navarohana = "S R4 S"\nreference = "t"',
        ),
      ),
    ).toThrow('swara token "R4" is not of the form');
  });

  it("accepts a janya of an aliased parent", () => {
    const ragas = parseRagas(
      minimal(
        '[[janya]]\nname = "J"\njanya_of = "M1"\narohana = "S R1 G1 M1 S"\navarohana = "S M1 G1 R1 S"\nreference = "t"',
      ),
    );
    expect(ragas.at(-1)).toMatchObject({ janyaOf: "M1", janyaOfNumber: 1 });
  });

  it("builds a module whose data round-trips through JSON", () => {
    const ragas = parseRagas(toml);
    const moduleText = buildGeneratedModule(ragas);
    expect(moduleText).toContain("export const RAGAS");
    expect(moduleText).toContain("as const");
    expect(moduleText).toContain("export const getRaga");
    const embedded = moduleText.match(
      /export const RAGAS = (\[[\s\S]*]) as const;/,
    );
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded![1])).toHaveLength(ragas.length);
  });
});
