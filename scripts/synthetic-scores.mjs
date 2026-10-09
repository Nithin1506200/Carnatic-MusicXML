import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { RAGAS } from "../components/ragas.generated.ts";

/**
 * Content-build benchmark: writes N synthetic scores into a scratch scores
 * tree, then runs `scripts/generate-content.mjs` against it (cold cache,
 * warm cache, and after touching ten files) and reports timings and the
 * sizes of the manifest, catalog, and search index.
 *
 *   npm run bench:content -- --count 15000 [--out <dir>] [--keep]
 *
 * The scratch tree lives under the OS temp directory unless --out is given.
 * The repository's own generated output is rebuilt from the real scores at
 * the end, so the benchmark leaves the working tree as it found it.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const count = Number(option("--count", "15000"));
const keep = args.includes("--keep");
const out = path.resolve(
  option("--out", path.join(os.tmpdir(), "carnatic-synthetic-scores")),
);

const groups = [
  ["01_training", "Training Scores"],
  ["02_basics", "Basic Lessons and Geethams"],
  ["03_jatiswara", "Jatiswara Scores"],
  ["04_kritis", "Kriti Scores"],
  ["05_varnams", "Varnam Scores"],
  ["06_bhajans", "Bhajan Scores"],
];
const composers = [
  "Tyagaraja",
  "Muthuswami Dikshitar",
  "Syama Sastri",
  "Purandara Dasa",
  "Swati Tirunal",
  "Papanasam Sivan",
  "Annamacharya",
  "Mysore Vasudevachar",
];
const talas = ["Aadi", "Roopaka", "Misra Chapu", "Khanda Chapu", "Ata", "Eka"];
const words = [
  "Vatapi", "Ganapatim", "Nidhi", "Chala", "Sukhama", "Endaro", "Mahanubhavulu",
  "Brochevarevarura", "Jagadananda", "Karaka", "Sri", "Raghuvara", "Ninnu",
  "Kori", "Vanajakshi", "Sarasijanabha", "Mokshamu", "Galada", "Bhagyada",
  "Lakshmi", "Baaramma", "Krishna", "Nee", "Begane", "Baro", "Marubalka",
];

// Deterministic pseudo-random so runs are comparable.
let seed = 1234567;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list) => list[Math.floor(random() * list.length)];

const scoreMdx = (index, groupKey) => {
  const raga = pick(RAGAS).name;
  const title = `${pick(words)} ${pick(words)} ${index}`;
  return `# ${title}

\`\`\`yaml
title: "${title}"
composer: "${pick(composers)}"
raga: "${raga}"
tala: "${pick(talas)}"
tala_grouping: "4 + 2 + 2"
language: Telugu
keywords: ["${groupKey.slice(3)}", "Carnatic saxophone", "${raga} raga"]
\`\`\`

\`\`\`carnatic
# Pallavi
S R G M | P D | N Ṡ ||
sa ri ga ma | pa dha | ni sā ||
Ṡ N D P | M G | R S ||
sā ni dha pa | ma ga | ri sa ||
\`\`\`

## Meaning

Synthetic benchmark score ${index}; meaning not applicable.
`;
};

const writeSyntheticTree = () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(root, "scores", "README.md"), path.join(out, "README.md"));
  for (const [key, label] of groups) {
    fs.mkdirSync(path.join(out, key), { recursive: true });
    fs.writeFileSync(path.join(out, key, "README.md"), `# ${label}\n`);
  }
  for (let index = 0; index < count; index += 1) {
    const [key] = groups[index % groups.length];
    fs.writeFileSync(
      path.join(out, key, `synthetic_${String(index).padStart(6, "0")}.mdx`),
      scoreMdx(index, key),
    );
  }
};

const runBuild = (label, env = {}) => {
  const started = performance.now();
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", path.join(root, "scripts", "generate-content.mjs")],
    {
      cwd: root,
      env: { ...process.env, CONTENT_SCORES_DIR: out, ...env },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`\n== ${label}: ${seconds}s\n${output.trim().split("\n").map((line) => `   ${line}`).join("\n")}`);
};

const sizes = () => {
  const report = (label, file) => {
    const bytes = fs.readFileSync(file);
    const gz = gzipSync(bytes).length;
    console.log(
      `   ${label.padEnd(14)} ${(bytes.length / 1024).toFixed(0).padStart(7)} kB raw ${(gz / 1024).toFixed(0).padStart(6)} kB gzip`,
    );
  };
  console.log("\n== Artifact sizes");
  report("manifest", path.join(root, "app", "generated-content.ts"));
  report("catalog", path.join(root, "app", "generated", "catalog.json"));
  report("search index", path.join(root, "app", "generated", "search-index.json"));
};

console.log(`Writing ${count} synthetic scores to ${out}…`);
writeSyntheticTree();
// A fresh cache for the cold run, in a scratch directory the real build never uses.
const cache = path.join(root, ".cache", "content");
const cacheBackup = path.join(root, ".cache", "content.real");
fs.rmSync(cacheBackup, { recursive: true, force: true });
if (fs.existsSync(cache)) fs.renameSync(cache, cacheBackup);

try {
  runBuild("Cold build (empty cache)");
  runBuild("Warm build (nothing changed)");
  const touched = fs
    .readdirSync(path.join(out, groups[3][0]))
    .filter((name) => name.endsWith(".mdx"))
    .slice(0, 10);
  for (const name of touched) {
    const file = path.join(out, groups[3][0], name);
    fs.appendFileSync(file, "\nTouched for the incremental benchmark.\n");
  }
  runBuild("Incremental build (10 files touched)");
  sizes();
} finally {
  fs.rmSync(cache, { recursive: true, force: true });
  if (fs.existsSync(cacheBackup)) fs.renameSync(cacheBackup, cache);
  if (!keep) fs.rmSync(out, { recursive: true, force: true });
  console.log("\nRestoring the repository's generated output…");
  execFileSync(
    process.execPath,
    ["--import", "tsx", path.join(root, "scripts", "generate-content.mjs")],
    { cwd: root, stdio: "inherit" },
  );
}
