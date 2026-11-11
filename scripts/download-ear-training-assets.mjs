// Fetch verified source samples; this never renders exercises or executes source JS.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const manifest = JSON.parse(
  await readFile(
    new URL("../data/ear_training_samples.json", import.meta.url),
    "utf8",
  ),
);
const output = new URL("../public/ear-training-samples/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(output, { recursive: true });
for (const instrument of Object.values(manifest.instruments)) {
  let pack;
  for (const sample of instrument.samples) {
    const target = new URL(sample.url.split("/").at(-1), output);
    try {
      if (hash(await readFile(target)) === sample.sha256) continue;
    } catch {
      /* cache miss */
    }
    if (!pack) {
      const response = await fetch(sample.sourceUrl, {
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok)
        throw new Error(
          `Sample pack download failed (${response.status}): ${sample.sourceUrl}`,
        );
      const bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== instrument.sourceSha256)
        throw new Error("Source pack checksum mismatch");
      const text = bytes.toString("utf8");
      const assignment = text.indexOf(" = {", text.indexOf("MIDI.Soundfont."));
      if (assignment < 0) throw new Error("Unexpected sample pack format");
      // Source is a flat object of quoted names and data URIs, with a trailing comma.
      pack = JSON.parse(
        text
          .slice(text.indexOf("{", assignment), text.lastIndexOf("}") + 1)
          .replace(/,\s*}$/, "}"),
      );
    }
    const uri = pack[sample.sourceKey];
    if (typeof uri !== "string" || !uri.startsWith("data:audio/mp3;base64,"))
      throw new Error(`Missing source sample ${sample.sourceKey}`);
    const bytes = Buffer.from(uri.split(",")[1], "base64");
    if (hash(bytes) !== sample.sha256)
      throw new Error(
        `Sample checksum mismatch: ${sample.sound} ${sample.rootMidi}`,
      );
    await writeFile(target, bytes);
  }
}
await writeFile(
  new URL("ATTRIBUTION.txt", output),
  `${manifest.provenance.name}\n${manifest.provenance.author}\n${manifest.provenance.license}: ${manifest.provenance.licenseUrl}\nSource: ${manifest.provenance.source}\nRevision: ${manifest.provenance.revision}\n${manifest.provenance.modifications}\n`,
);
const count = Object.values(manifest.instruments).reduce(
  (total, instrument) => total + instrument.samples.length,
  0,
);
console.log(
  `All ${count} Ear Training source samples downloaded and checksum-verified locally in ${fileURLToPath(output)}`,
);
