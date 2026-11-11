import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";

/**
 * Reads `data/ragas.toml` — the canonical raga registry — validates it, and
 * emits `components/ragas.generated.ts`, a fully typed lookup module consumed
 * by the score converter, the notation validator, and the static-site content
 * generator. The generated file is git-ignored; run `npm run ragas:generate`
 * (it also runs as the first step of `validate:notation`, `content`,
 * `mscz:generate`, and `test`).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tomlFile = path.join(root, "data", "ragas.toml");
const generatedFile = path.join(root, "components", "ragas.generated.ts");

const fail = (message: string): never => {
  throw new Error(`data/ragas.toml: ${message}`);
};

interface TomlMelakarta {
  number: number;
  name: string;
  alternate_names?: string[];
  arohana: string;
  avarohana: string;
  reference: string;
  notes?: string;
}

interface TomlJanya {
  name: string;
  janya_of: string;
  alternate_names?: string[];
  arohana: string;
  avarohana: string;
  reference: string;
  notes?: string;
}

interface NormalizedRaga {
  name: string;
  type: "melakarta" | "janya";
  melakartaNumber?: number;
  janyaOf?: string;
  janyaOfNumber?: number;
  arohana: string;
  avarohana: string;
  alternateNames: string[];
  notes?: string;
  reference: string;
}

const SWARA_TOKEN = /^[SRGMPDN][1-3]?$/;

const scaleTokens = (scale: string, entry: string): string[] => {
  const tokens = scale.trim().split(/\s+/);
  for (const token of tokens) {
    if (!SWARA_TOKEN.test(token)) {
      fail(
        `${entry}: swara token "${token}" is not of the form S, R1, G3, ...`,
      );
    }
  }
  if (tokens[0] !== "S" || tokens.at(-1) !== "S") {
    fail(`${entry}: arohana/avarohana must begin and end with S.`);
  }
  return tokens;
};

const requireString = (
  value: unknown,
  entry: string,
  field: string,
): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    fail(`${entry}: "${field}" must be a non-empty string.`);
  }
  return text;
};

const aliasesOf = (value: unknown, entry: string): string[] => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    fail(`${entry}: "alternate_names" must be an array of strings.`);
  }
  return (value as string[]).map((item) => item.trim());
};

// Standard Kanakangi–Rasikapriya scheme: https://karnatik.com/melakarta.pdf.
const MELAKARTA_RG = ["R1 G1", "R1 G2", "R1 G3", "R2 G2", "R2 G3", "R3 G3"];
const MELAKARTA_DN = ["D1 N1", "D1 N2", "D1 N3", "D2 N2", "D2 N3", "D3 N3"];

/** Parses and validates the TOML registry into normalized raga records. */
export function parseRagas(tomlSource: string): NormalizedRaga[] {
  let parsed: unknown;
  try {
    parsed = parseToml(tomlSource);
  } catch (error) {
    fail(
      `TOML syntax error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const data = parsed as {
    melakarta?: TomlMelakarta[];
    janya?: TomlJanya[];
  };
  const melakartaEntries = Array.isArray(data.melakarta)
    ? data.melakarta
    : fail("expected a [[melakarta]] table array.");

  const seenNames = new Map<string, string>();
  const claimName = (claimed: string, entry: string): void => {
    const owner = seenNames.get(claimed);
    if (owner) {
      fail(`${entry} claims the name "${claimed}", already used by ${owner}.`);
    }
    seenNames.set(claimed, entry);
  };

  const melakartas: Map<string, { name: string; number: number }> = new Map();
  const records: NormalizedRaga[] = [];

  const numbers = new Set<number>();
  for (const entry of melakartaEntries) {
    const tag = `melakarta "${entry?.name ?? "?"}"`;
    if (
      !Number.isInteger(entry.number) ||
      entry.number < 1 ||
      entry.number > 72
    ) {
      fail(`${tag}: number must be an integer between 1 and 72.`);
    }
    if (numbers.has(entry.number)) {
      fail(`${tag}: melakarta number ${entry.number} is used twice.`);
    }
    numbers.add(entry.number);
    const name = requireString(entry.name, tag, "name");
    claimName(name, tag);
    const alternateNames = aliasesOf(entry.alternate_names, tag);
    for (const alias of alternateNames) claimName(alias, tag);
    const arohana = requireString(entry.arohana, tag, "arohana");
    const avarohana = requireString(entry.avarohana, tag, "avarohana");
    const up = scaleTokens(arohana, `${tag} arohana`);
    const down = scaleTokens(avarohana, `${tag} avarohana`);
    if ([...up].reverse().join(" ") !== down.join(" ")) {
      fail(
        `${tag}: a melakarta avarohana must be the exact reverse of its arohana.`,
      );
    }
    const withinHalf = (entry.number - 1) % 36;
    const madhyama = entry.number <= 36 ? "M1" : "M2";
    const expected = `S ${MELAKARTA_RG[Math.floor(withinHalf / 6)]} ${madhyama} P ${MELAKARTA_DN[withinHalf % 6]} S`;
    if (up.join(" ") !== expected) {
      fail(
        `${tag}: arohana does not match melakarta number ${entry.number}; expected "${expected}", got "${arohana}".`,
      );
    }
    records.push({
      name,
      type: "melakarta",
      melakartaNumber: entry.number,
      arohana,
      avarohana,
      alternateNames,
      notes: typeof entry.notes === "string" ? entry.notes : undefined,
      reference: requireString(entry.reference, tag, "reference"),
    });
    melakartas.set(name, { name, number: entry.number });
    for (const alias of alternateNames) {
      melakartas.set(alias, { name, number: entry.number });
    }
  }
  if (numbers.size !== 72) {
    fail(`expected 72 melakartas; found ${melakartaEntries.length}.`);
  }
  for (let number = 1; number <= 72; number += 1) {
    if (!numbers.has(number)) fail(`melakarta number ${number} is missing.`);
  }

  if (data.janya !== undefined && !Array.isArray(data.janya)) {
    fail("expected [[janya]] to be a table array.");
  }
  for (const entry of data.janya ?? []) {
    const tag = `janya "${entry?.name ?? "?"}"`;
    const name = requireString(entry.name, tag, "name");
    claimName(name, tag);
    const alternateNames = aliasesOf(entry.alternate_names, tag);
    for (const alias of alternateNames) claimName(alias, tag);
    const parentName = requireString(entry.janya_of, tag, "janya_of");
    const parent =
      melakartas.get(parentName) ??
      fail(
        `${tag}: janya_of "${parentName}" does not match any melakarta name or alias.`,
      );
    records.push({
      name,
      type: "janya",
      janyaOf: parent.name,
      janyaOfNumber: parent.number,
      arohana: requireString(entry.arohana, tag, "arohana"),
      avarohana: requireString(entry.avarohana, tag, "avarohana"),
      alternateNames,
      notes: typeof entry.notes === "string" ? entry.notes : undefined,
      reference: requireString(entry.reference, tag, "reference"),
    });
    scaleTokens(records.at(-1)!.arohana, `${tag} arohana`);
    scaleTokens(records.at(-1)!.avarohana, `${tag} avarohana`);
  }

  return records;
}

/** Builds the contents of components/ragas.generated.ts. */
export function buildGeneratedModule(ragas: NormalizedRaga[]): string {
  const data = ragas.map((raga) => {
    const entry: Record<string, unknown> = {
      name: raga.name,
      type: raga.type,
    };
    if (raga.melakartaNumber !== undefined) {
      entry.melakartaNumber = raga.melakartaNumber;
    }
    if (raga.janyaOf !== undefined) {
      entry.janyaOf = raga.janyaOf;
      entry.janyaOfNumber = raga.janyaOfNumber;
    }
    entry.arohana = raga.arohana;
    entry.avarohana = raga.avarohana;
    entry.alternateNames = raga.alternateNames;
    if (raga.notes) entry.notes = raga.notes;
    entry.reference = raga.reference;
    return entry;
  });

  return `/**
 * GENERATED FILE — do not edit directly.
 *
 * Emitted by scripts/generate-ragas.ts from data/ragas.toml, the canonical
 * raga registry. Regenerate with \`npm run ragas:generate\` (it also runs as
 * the first step of validate:notation, content, mscz:generate, and test).
 */
/* eslint-disable */
export const RAGAS = ${JSON.stringify(data, null, 2)} as const;

/** Union of every raga name in data/ragas.toml. */
export type RagaName = (typeof RAGAS)[number]["name"];

export type RagaInfo = (typeof RAGAS)[number];

/**
 * Finds a raga by its canonical name or one of its alternate spellings
 * (alternate_names in data/ragas.toml). Returns undefined when unknown.
 */
export const getRaga = (name: string): RagaInfo | undefined =>
  RAGAS.find(
    (raga) =>
      raga.name === name ||
      (raga.alternateNames as readonly string[]).includes(name),
  );
`;
}

export const generateRagas = (): {
  melakartas: number;
  janyas: number;
} => {
  const toml = fs.readFileSync(tomlFile, "utf8");
  const ragas = parseRagas(toml);
  fs.mkdirSync(path.dirname(generatedFile), { recursive: true });
  fs.writeFileSync(generatedFile, buildGeneratedModule(ragas));
  return {
    melakartas: ragas.filter((raga) => raga.type === "melakarta").length,
    janyas: ragas.filter((raga) => raga.type === "janya").length,
  };
};

const invokedFile = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedFile) {
  const summary = generateRagas();
  console.log(
    `Generated components/ragas.generated.ts: ${summary.melakartas} melakartas, ${summary.janyas} janya ragas.`,
  );
}
