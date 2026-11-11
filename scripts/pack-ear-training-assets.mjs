import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Deterministic, flat, regular-file USTAR: no ownership, dates or machine paths. */
export function createTar(entries) {
  const blocks = [];
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const seen = new Set();
  for (const { name, bytes } of sorted) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.length > 99 || seen.has(name))
      throw new Error(`Invalid archive entry ${name}`);
    seen.add(name);
    const header = Buffer.alloc(512);
    const field = (offset, length, value) =>
      header.write(value, offset, length, "ascii");
    field(0, 100, name);
    field(100, 8, "0000644\0");
    field(108, 8, "0000000\0");
    field(116, 8, "0000000\0");
    field(124, 12, bytes.length.toString(8).padStart(11, "0") + "\0");
    field(136, 12, "00000000000\0");
    header.fill(32, 148, 156);
    header[156] = 48;
    field(257, 6, "ustar\0");
    field(263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    field(148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
    blocks.push(
      header,
      Buffer.from(bytes),
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
export function compressTar(entries) {
  const tar = createTar(entries);
  const compressed = gzipSync(tar, { level: 9 });
  compressed[9] = 255; // Stable OS field across development/build machines.
  return { tar, compressed };
}
export async function packSamples() {
  // Only this explicit packaging command may download from the pinned source.
  await import("./download-ear-training-assets.mjs");
  const manifestUrl = new URL("data/ear_training_samples.json", root);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const entries = [];
  for (const instrument of Object.values(manifest.instruments))
    for (const sample of instrument.samples) {
      const name = sample.url.split("/").at(-1);
      const bytes = await readFile(
        new URL(`public/ear-training-samples/${name}`, root),
      );
      if (hash(bytes) !== sample.sha256)
        throw new Error(`Sample checksum mismatch: ${name}`);
      entries.push({ name, bytes });
    }
  const notices = {};
  for (const [name, source] of [
    ["ATTRIBUTION.txt", "licenses/ear-training-ATTRIBUTION.txt"],
    ["LICENSE.txt", "licenses/CC-BY-3.0-US.txt"],
  ]) {
    const bytes = await readFile(new URL(source, root));
    entries.push({ name, bytes });
    notices[name] = hash(bytes);
  }
  const { tar, compressed } = compressTar(entries);
  manifest.bundle = {
    url: "/ear-training-samples.tar.gz",
    sha256: hash(compressed),
    uncompressedBytes: tar.length,
    uncompressedSha256: hash(tar),
    entryCount: entries.length,
    notices,
  };
  await writeFile(
    new URL("public/ear-training-samples.tar.gz", root),
    compressed,
  );
  await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `Packed ${entries.length - 2} original samples and 2 notices: ${compressed.length} bytes (${manifest.bundle.sha256})`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await packSamples();
