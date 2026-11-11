// Normal dev/build is verification-only: no downloads or tracked-file writes.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("data/ear_training_samples.json", root), "utf8"),
);
const bundle = manifest.bundle;
if (!bundle)
  throw new Error(
    "Missing audio bundle metadata. Run npm run assets:ear-training:pack and commit the archive and manifest.",
  );
let bytes;
try {
  bytes = await readFile(new URL(`public${bundle.url}`, root));
} catch {
  throw new Error(
    "Missing committed audio archive. Restore it from Git; use npm run assets:ear-training:pack only to rebuild it.",
  );
}
if (createHash("sha256").update(bytes).digest("hex") !== bundle.sha256)
  throw new Error(
    "Audio archive checksum mismatch. Restore it from Git or explicitly rebuild and commit it.",
  );
const tar = gunzipSync(bytes, { maxOutputLength: bundle.uncompressedBytes });
if (
  createHash("sha256").update(tar).digest("hex") !== bundle.uncompressedSha256
)
  throw new Error("Audio archive expanded checksum mismatch.");
if (tar.length !== bundle.uncompressedBytes)
  throw new Error("Audio archive length mismatch.");
for (const [name, source] of [
  ["ATTRIBUTION.txt", "licenses/ear-training-ATTRIBUTION.txt"],
  ["LICENSE.txt", "licenses/CC-BY-3.0-US.txt"],
]) {
  const text = await readFile(new URL(source, root));
  if (createHash("sha256").update(text).digest("hex") !== bundle.notices[name])
    throw new Error(
      `Audio notice changed: ${name}. Rebuild and commit the archive.`,
    );
}
console.log(
  `Verified committed audio bundle offline (${bundle.entryCount - 2} samples, ${bytes.length} bytes).`,
);
