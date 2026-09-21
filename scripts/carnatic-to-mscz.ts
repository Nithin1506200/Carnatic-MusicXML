import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { convertMdx } from "../components/carnatic-mscx.ts";

/**
 * Command-line converter: builds companion MDX files into MuseScore `.mscz`
 * archives (and optional PDF previews). The conversion itself lives in the
 * browser-safe `components/carnatic-mscx.ts` module, which is re-exported
 * here so existing imports keep working.
 */

export {
  buildMeasures,
  buildMscx,
  convertMdx,
  decomposeUnits,
  extractMetadata,
  notationBlocksFor,
  resolveUnit,
  scaleDegrees,
  swaraPitch,
  unitsToDuration,
  xmlEscape,
} from "../components/carnatic-mscx.ts";
export type { NoteUnit, ScoreMetadata } from "../components/carnatic-mscx.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Lists companion MDX score files under the given directory, sorted. */
export function listScoreFiles(scoresRoot: string): string[] {
  if (!fs.existsSync(scoresRoot)) return [];
  return fs
    .readdirSync(scoresRoot, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".mdx"))
    .sort()
    .map((name) => path.join(scoresRoot, name));
}

/** Interprets an interactive picker answer ("1,3" or "all") as indices. */
export function parseSelection(answer: string, count: number): number[] {
  if (answer.trim().toLowerCase() === "all") {
    return Array.from({ length: count }, (_, index) => index);
  }
  const indexes = new Set<number>();
  for (const part of answer.split(/[\s,]+/)) {
    if (!part) continue;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 1 || value > count) {
      throw new Error(`"${part}" is not a number between 1 and ${count}.`);
    }
    indexes.add(value - 1);
  }
  if (indexes.size === 0) {
    throw new Error("Select at least one score file.");
  }
  return [...indexes].sort((a, b) => a - b);
}

const MUSESCORE_COMMANDS = ["mscore", "musescore4", "musescore"];

const MUSESCORE_APP_PATHS = [
  "/Applications/MuseScore 4.app/Contents/MacOS/mscore",
  "/Applications/MuseScore Studio 4.app/Contents/MacOS/mscore",
];

/** MuseScore apps inside mounted DMG images (run without installing). */
const mountedMuseScorePaths = (): string[] => {
  try {
    return fs
      .readdirSync("/Volumes")
      .flatMap((volume) => {
        try {
          return fs
            .readdirSync(path.join("/Volumes", volume))
            .filter((entry) => /^MuseScore.*\.app$/u.test(entry))
            .map((app) =>
              path.join("/Volumes", volume, app, "Contents", "MacOS", "mscore"),
            );
        } catch {
          return [];
        }
      })
      .filter((executable) => fs.existsSync(executable));
  } catch {
    return [];
  }
};

/** Finds a MuseScore command-line executable, or null when none exists. */
export function findMuseScore(): string | null {
  for (const command of MUSESCORE_COMMANDS) {
    if (spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0) {
      return command;
    }
  }
  for (const executable of [
    ...MUSESCORE_APP_PATHS,
    ...mountedMuseScorePaths(),
  ]) {
    if (fs.existsSync(executable)) return executable;
  }
  return null;
}

type PdfExporter =
  | { type: "musescore"; command: string }
  | { type: "webmscore" };

interface WebMscoreScore {
  savePdf(): Promise<Uint8Array>;
  destroy(): void;
}

interface WebMscoreRuntime {
  ready: Promise<void>;
  load(format: "mscz", data: Uint8Array): Promise<WebMscoreScore>;
}

let webMscorePromise: Promise<WebMscoreRuntime> | null = null;

/**
 * Loads the bundled webmscore runtime. Its Node build predates the global
 * `navigator` and `fetch`, so they are shimmed away while it initializes.
 */
const loadWebMscore = (): Promise<WebMscoreRuntime> => {
  webMscorePromise ??= (async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: process.version },
      configurable: true,
      writable: true,
    });
    const fetchDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "fetch",
    );
    Object.defineProperty(globalThis, "fetch", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const module = (await import("webmscore")) as unknown as {
        default: WebMscoreRuntime;
      };
      await module.default.ready;
      return module.default;
    } finally {
      if (fetchDescriptor) {
        Object.defineProperty(globalThis, "fetch", fetchDescriptor);
      }
    }
  })();
  return webMscorePromise;
};

/** Picks a PDF renderer: the MuseScore CLI for full fidelity, else webmscore. */
export const findPdfExporter = async (): Promise<PdfExporter | null> => {
  const command = findMuseScore();
  if (command) return { type: "musescore", command };
  try {
    await loadWebMscore();
    return { type: "webmscore" };
  } catch {
    return null;
  }
};

const exportPdf = async (
  exporter: PdfExporter,
  msczPath: string,
  pdfPath: string,
) => {
  if (exporter.type === "musescore") {
    // A macOS DMG-mounted MuseScore occasionally fails its very first launch
    // (Gatekeeper); retry once before crying wolf.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync(exporter.command, ["-o", pdfPath, msczPath], {
        stdio: "inherit",
      });
      if (result.status === 0) return;
      if (attempt === 1) {
        throw new Error(`MuseScore PDF export failed for ${msczPath}.`);
      }
    }
    return;
  }
  const runtime = await loadWebMscore();
  const score = await runtime.load(
    "mscz",
    new Uint8Array(fs.readFileSync(msczPath)),
  );
  try {
    fs.writeFileSync(pdfPath, await score.savePdf());
  } finally {
    score.destroy();
  }
};

const usage = `Usage: npm run mscz:generate -- [score.mdx ...] [--out <file.mscz>] [--unit crotchet|quaver] [--force] [--pdf]

Converts companion MDX files (YAML metadata + fenced carnatic block) into
MuseScore .mscz files for alto saxophone in G, using the duration semantics of
"Rhythm and Duration" in docs/score-notation.md.

Without score files, lists the MDX scores under scores/ and asks which to
convert: numbers separated by commas, or "all".

Options:
  --out     write a single score to this path (default: same stem as the .mdx)
  --force   overwrite an existing .mscz
  --pdf     also export a same-stem PDF next to each .mscz (default), using
            the MuseScore command line (on PATH, in /Applications, or on a
            mounted DMG), falling back to the bundled webmscore renderer
  --no-pdf  generate only the .mscz, no PDF export`;

interface CliOptions {
  force: boolean;
  out?: string;
  unit?: string;
  exporter?: PdfExporter;
}

const generate = async (input: string, options: CliOptions) => {
  const stem = path.basename(input, path.extname(input));
  const out = options.out ?? path.join(path.dirname(input), `${stem}.mscz`);
  const mdx = fs.readFileSync(input, "utf8");
  const { mscz, title } = convertMdx(mdx, { stem, unit: options.unit });
  if (fs.existsSync(out) && !options.force) {
    throw new Error(`${out} exists; pass --force to overwrite it.`);
  }
  fs.writeFileSync(out, mscz);
  console.log(`Wrote ${out} (alto sax in G, written Sa = G): ${title}`);
  if (options.exporter) {
    const pdf = out.replace(/\.mscz$/, ".pdf");
    await exportPdf(options.exporter, out, pdf);
    if (options.exporter.type === "webmscore") {
      console.log(
        `Wrote ${pdf} (webmscore preview; open in MuseScore for the exact app rendering)`,
      );
    } else {
      console.log(`Wrote ${pdf}`);
    }
  }
};

/** Interactively asks which score files to convert. */
const pickScores = async (): Promise<string[]> => {
  const files = listScoreFiles(path.join(repoRoot, "scores"));
  if (files.length === 0) {
    throw new Error("No MDX score files found under scores/.");
  }
  files.forEach((file, index) => {
    console.log(`${index + 1}: ${path.relative(repoRoot, file)}`);
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      "Select scores to convert (numbers separated by commas, or 'all'): ",
    );
    return parseSelection(answer, files.length).map((index) => files[index]);
  } finally {
    rl.close();
  }
};

const main = async (argv: string[]) => {
  if (argv.includes("--help")) {
    console.log(usage);
    return;
  }
  const inputs: string[] = [];
  const options: CliOptions = { force: false };
  let pdf = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      options.force = true;
    } else if (arg === "--pdf") {
      pdf = true;
    } else if (arg === "--no-pdf") {
      pdf = false;
    } else if (arg === "--out" || arg === "--unit") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} needs a value.`);
      if (arg === "--out") options.out = value;
      else options.unit = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else {
      inputs.push(arg);
    }
  }

  if (inputs.length === 0) {
    if (!process.stdin.isTTY) {
      console.log(usage);
      process.exit(1);
    }
    inputs.push(...(await pickScores()));
  }
  if (options.out && inputs.length > 1) {
    throw new Error("--out works with a single score file only.");
  }
  if (pdf) {
    options.exporter = (await findPdfExporter()) ?? undefined;
    if (!options.exporter) {
      throw new Error(
        "PDF export needs the MuseScore app (installed or mounted) or a working webmscore runtime; found neither.",
      );
    }
  }
  for (const input of inputs) {
    await generate(input, options);
  }
};

const invokedFile = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedFile) {
  main(process.argv.slice(2));
}
