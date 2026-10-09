import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  absolutePathFor,
  discoverContentFiles,
  renderDocument,
  root,
  scoresRoot,
} from "./content-render.mjs";
import {
  buildCatalog,
  buildSearchSource,
  scoreGroupsFor,
} from "./build-index.mjs";

/**
 * Static site content build. For every Markdown/MDX document it produces:
 *
 * - `public/generated-content/<id>.json` — the page (HTML, headings,
 *   metadata), fetched by the app when the document opens;
 * - `app/generated-content.ts` — the eager manifest: the handful of
 *   non-score documents, score group counts, and the URLs below;
 * - `app/generated/catalog.json` and `app/generated/search-index.json` —
 *   fetched lazily for browsing and searching scores (`scripts/build-index.mjs`);
 * - `public/generated-scores/` — the `.mscz` files scores reference;
 * - `public/vendor/webmscore/` — the self-hosted score renderer.
 *
 * Rendering is per file and cached under `.cache/content/` by source hash,
 * so a rebuild re-renders only changed documents; cache misses render in
 * worker threads. Every document error is reported before the build fails.
 */

const started = performance.now();
const outputFile = path.join(root, "app", "generated-content.ts");
const generatedDir = path.join(root, "app", "generated");
const generatedContentDir = path.join(root, "public", "generated-content");
const legacyDownloadsDir = path.join(root, "public", "downloads");
const generatedScoresDir = path.join(root, "public", "generated-scores");
const webMscoreVendorDir = path.join(root, "public", "vendor", "webmscore");
const cacheDir = path.join(root, ".cache", "content");

const sha1 = (value) => createHash("sha1").update(value).digest("hex");

const writeIfChanged = (file, content) => {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) {
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
};

/** Removes files under `directory` that are not in `keep`, and empty dirs. */
const pruneDirectory = (directory, keep) => {
  if (!fs.existsSync(directory)) return 0;
  let removed = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        if (fs.readdirSync(absolute).length === 0) fs.rmdirSync(absolute);
      } else if (!keep.has(absolute)) {
        fs.rmSync(absolute);
        removed += 1;
      }
    }
  };
  walk(directory);
  return removed;
};

// --- 1. Discover files and cache keys -------------------------------------

const contentFiles = discoverContentFiles();

/** Anything that changes how a file renders, beyond the file itself. */
const generatorHash = sha1(
  [
    "scripts/generate-content.mjs",
    "scripts/content-render.mjs",
    "scripts/content-worker.mjs",
    "scripts/build-index.mjs",
    "components/score-notation.ts",
    "components/ragas.generated.ts",
    "package-lock.json",
  ]
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\0"),
);

const entries = contentFiles.map((file, order) => {
  const source = fs.readFileSync(absolutePathFor(file), "utf8");
  const key = sha1(`${generatorHash}\0${file}\0${source}`);
  return { file, order, key, cacheFile: path.join(cacheDir, `${key}.json`) };
});

const records = new Map();
const cacheHits = [];
const misses = [];
for (const entry of entries) {
  try {
    if (fs.existsSync(entry.cacheFile)) {
      records.set(entry.file, JSON.parse(fs.readFileSync(entry.cacheFile, "utf8")));
      cacheHits.push(entry);
      continue;
    }
  } catch {
    // A corrupt cache entry is just a miss.
  }
  misses.push(entry);
}

// --- 2. Render cache misses -------------------------------------------------

const errors = [];

const renderInline = async (entry) => {
  try {
    records.set(entry.file, await renderDocument(entry.file));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
};

const renderWithWorkers = (queue, workerCount) =>
  new Promise((resolve, reject) => {
    const pending = [...queue];
    let active = 0;
    const workers = Array.from(
      { length: workerCount },
      () => new Worker(new URL("./content-worker.mjs", import.meta.url)),
    );
    const finish = () => {
      for (const worker of workers) void worker.terminate();
      resolve();
    };
    const feed = (worker) => {
      const entry = pending.shift();
      if (!entry) {
        if (active === 0) finish();
        return;
      }
      active += 1;
      worker.postMessage({ file: entry.file });
    };
    for (const worker of workers) {
      worker.on("message", (message) => {
        active -= 1;
        if (message.error) errors.push(message.error);
        else records.set(message.file, message.record);
        feed(worker);
      });
      worker.on("error", (error) => {
        for (const other of workers) void other.terminate();
        reject(error);
      });
      feed(worker);
    }
  });

const workerCount = Math.max(
  0,
  Math.min(
    Number(process.env.CONTENT_WORKERS ?? os.availableParallelism()),
    misses.length,
  ),
);
// Spawning a worker costs a few hundred milliseconds of module loading; a
// handful of changed files renders faster in this thread.
if (misses.length <= 4 || workerCount <= 1) {
  for (const entry of misses) await renderInline(entry);
} else {
  await renderWithWorkers(misses, workerCount);
}

if (errors.length > 0) {
  console.error(`${errors.length} document${errors.length === 1 ? "" : "s"} failed to build:\n`);
  for (const message of errors) console.error(`  ${message}\n`);
  process.exit(1);
}

// Cache the fresh renders; prune entries no build has touched in two weeks.
fs.mkdirSync(cacheDir, { recursive: true });
for (const entry of misses) {
  fs.writeFileSync(entry.cacheFile, JSON.stringify(records.get(entry.file)));
}
const staleBefore = Date.now() - 14 * 24 * 60 * 60 * 1000;
for (const entry of cacheHits) {
  fs.utimesSync(entry.cacheFile, new Date(), new Date());
}
for (const name of fs.readdirSync(cacheDir)) {
  const file = path.join(cacheDir, name);
  if (fs.statSync(file).mtimeMs < staleBefore) fs.rmSync(file);
}

const documents = entries.map((entry) => ({
  ...records.get(entry.file),
  order: entry.order,
}));
const scoreRecords = documents.filter((document) => document.category === "Scores");
const docRecords = documents.filter((document) => document.category !== "Scores");

// --- 3. Per-document page JSON ---------------------------------------------

const pageFiles = new Set();
let pagesWritten = 0;
for (const document of documents) {
  const destination = path.join(root, "public", document.contentUrl);
  pageFiles.add(destination);
  const page = JSON.stringify({
    id: document.id,
    title: document.title,
    category: document.category,
    sourcePath: document.sourcePath,
    html: document.html,
    headings: document.headings,
    metadata: document.metadata,
    scoreSource: document.scoreSource,
  });
  if (writeIfChanged(destination, page)) pagesWritten += 1;
}
const pagesRemoved = pruneDirectory(generatedContentDir, pageFiles);

// --- 4. Manifest, catalog, search index ------------------------------------

const groups = scoreGroupsFor(scoresRoot);
const counts = new Map(groups.map((group) => [group.key, 0]));
for (const record of scoreRecords) {
  const key = record.id.split("/")[1];
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const scoreGroups = groups.map((group) => ({
  ...group,
  count: counts.get(group.key) ?? 0,
}));

const catalog = buildCatalog(scoreRecords, groups);
const searchSource = buildSearchSource(scoreRecords, docRecords, groups);
const catalogJson = JSON.stringify(catalog);
const searchJson = JSON.stringify(searchSource);
writeIfChanged(path.join(generatedDir, "catalog.json"), catalogJson);
writeIfChanged(path.join(generatedDir, "search-index.json"), searchJson);

const manifest = docRecords.map((document) => ({
  id: document.id,
  title: document.title,
  category: document.category,
  order: document.order,
  excerpt: document.excerpt,
  contentUrl: document.contentUrl,
  sourcePath: document.sourcePath,
}));
const homeHtml = documents.find((document) => document.id === "home")?.html ?? "";
writeIfChanged(
  outputFile,
  [
    "// Generated by scripts/generate-content.mjs. Do not edit directly.",
    'import catalogUrl from "./generated/catalog.json?url";',
    'import searchIndexUrl from "./generated/search-index.json?url";',
    "",
    "/** Non-score documents: docs, READMEs, and project notes. */",
    `export const documents = ${JSON.stringify(manifest, null, 2)} as const;`,
    "/** Score groups (directories under scores/) with their document counts. */",
    `export const scoreGroups = ${JSON.stringify(scoreGroups, null, 2)} as const;`,
    `export const scoreCount = ${scoreRecords.length};`,
    "/** Lazily fetched score catalog and search source; see scripts/build-index.mjs. */",
    "export { catalogUrl, searchIndexUrl };",
    `export const homeHtml = ${JSON.stringify(homeHtml)};`,
    "",
  ].join("\n"),
);

// --- 5. MuseScore files referenced by scores --------------------------------

// MuseScore source files belong in the repository, not in the static website.
// Remove output made by older generator versions so stale downloads cannot ship.
fs.rmSync(legacyDownloadsDir, { recursive: true, force: true });

const scoreFiles = new Set();
let scoresCopied = 0;
for (const document of scoreRecords) {
  for (const scoreSource of document.scoreSources ?? []) {
    const source = absolutePathFor(scoreSource.repositoryPath);
    const destination = path.join(root, "public", scoreSource.publicUrl);
    if (scoreFiles.has(destination)) continue;
    scoreFiles.add(destination);
    const sourceStat = fs.statSync(source);
    const destinationStat = fs.existsSync(destination)
      ? fs.statSync(destination)
      : null;
    if (
      destinationStat &&
      destinationStat.size === sourceStat.size &&
      destinationStat.mtimeMs >= sourceStat.mtimeMs
    ) {
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    scoresCopied += 1;
  }
}
const scoresRemoved = pruneDirectory(generatedScoresDir, scoreFiles);

// --- 6. Self-hosted webmscore runtime ---------------------------------------

// Self-host webmscore so score rendering does not depend on a third-party CDN.
// MuseScore 4's engraving fonts are embedded so the renderer matches the app;
// the OFL/GPL font files are vendored under vendor/musescore-fonts.
const webMscorePackageDir = path.join(root, "node_modules", "webmscore");
const museScoreFontFiles = [
  "Edwin-Bold.otf",
  "Edwin-Italic.otf",
  "Edwin-Roman.otf",
  "Edwin-BdIta.otf",
  "Leland.otf",
  "LelandText.otf",
  "FreeSans.ttf",
];
const museScoreFontDirectories = [
  process.env.MUSESCORE_FONT_DIR,
  path.join(root, "vendor", "musescore-fonts"),
  "/Applications/MuseScore 4.app/Contents/Resources/fonts",
  "/Applications/MuseScore4.app/Contents/Resources/fonts",
].filter(Boolean);
const museScoreFontDirectory = museScoreFontDirectories.find((directory) =>
  museScoreFontFiles.every((filename) =>
    fs.existsSync(path.join(directory, filename)),
  ),
);
if (!museScoreFontDirectory) {
  throw new Error(
    "MuseScore 4 fonts were not found. Restore vendor/musescore-fonts or set MUSESCORE_FONT_DIR to a MuseScore Resources/fonts directory.",
  );
}

const VENDOR_RECIPE = "webmscore-vendor-2";
const vendorStamp = sha1(
  [
    VENDOR_RECIPE,
    fs.readFileSync(path.join(webMscorePackageDir, "package.json"), "utf8"),
    ...museScoreFontFiles.map((filename) => {
      const stat = fs.statSync(path.join(museScoreFontDirectory, filename));
      return `${filename}:${stat.size}:${stat.mtimeMs}`;
    }),
  ].join("\n"),
);
const stampFile = path.join(webMscoreVendorDir, ".stamp");
const vendorFresh =
  fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === vendorStamp;
if (!vendorFresh) {
  fs.rmSync(webMscoreVendorDir, { recursive: true, force: true });
  fs.mkdirSync(webMscoreVendorDir, { recursive: true });
  for (const filename of [
    "webmscore.lib.wasm",
    "webmscore.lib.mem.wasm",
    "webmscore.lib.data",
  ]) {
    fs.copyFileSync(
      path.join(webMscorePackageDir, filename),
      path.join(webMscoreVendorDir, filename),
    );
  }
  const browserRuntime = fs
    .readFileSync(path.join(webMscorePackageDir, "webmscore.cdn.mjs"), "utf8")
    .replace(
      /const CDN_PROVIDER = .*?\nconst URL_PREFIX = .*?\n/,
      "const URL_PREFIX = new URL('./', import.meta.url).href\n",
    )
    .replace(
      "export { WebMscoreW as default };",
      "globalThis.__webMscoreRuntime = WebMscoreW;\nexport { WebMscoreW as default };",
    );
  const embeddedFontPayloads = museScoreFontFiles.map((filename) =>
    fs
      .readFileSync(path.join(museScoreFontDirectory, filename))
      .toString("base64"),
  );
  fs.writeFileSync(
    path.join(webMscoreVendorDir, "webmscore.mjs"),
    `${browserRuntime}\nglobalThis.__webMscoreFonts = ${JSON.stringify(embeddedFontPayloads)}.map((encoded) => Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));\n`,
  );
  fs.writeFileSync(stampFile, vendorStamp);
}

// --- 7. Report ----------------------------------------------------------------

const kb = (value) => `${(value / 1024).toFixed(1)} kB`;
const elapsed = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  [
    `Generated ${documents.length} documents (${scoreRecords.length} scores) in ${elapsed}s:`,
    `  cache: ${cacheHits.length} hits, ${misses.length} rendered${workerCount > 1 && misses.length > 4 ? ` on ${workerCount} workers` : ""}`,
    `  pages: ${pagesWritten} written, ${pagesRemoved} removed`,
    `  scores: ${scoresCopied} copied, ${scoresRemoved} removed; webmscore ${vendorFresh ? "unchanged" : "rebuilt"}`,
    `  manifest ${kb(fs.statSync(outputFile).size)}, catalog ${kb(Buffer.byteLength(catalogJson))}, search index ${kb(Buffer.byteLength(searchJson))}`,
  ].join("\n"),
);
