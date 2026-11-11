import { gunzipSync } from "fflate";
import manifest from "../data/ear_training_samples.json";

export interface SampleBundleDescriptor {
  url: string;
  sha256: string;
  uncompressedBytes: number;
  uncompressedSha256: string;
  entryCount: number;
  notices?: Readonly<Record<string, string>>;
}
export type SampleBundleEntries = ReadonlyMap<string, Uint8Array>;
export type ExpectedBundleEntries = ReadonlyMap<string, string | undefined>;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_TAR_BYTES = 32 * 1024 * 1024;
const abortError = () =>
  new DOMException("Sample loading cancelled", "AbortError");
export const sampleEntryName = (sample: { url: string }) =>
  sample.url.split("/").at(-1)!;
export function expectedSampleEntries(
  notices = (manifest as typeof manifest & { bundle?: SampleBundleDescriptor })
    .bundle?.notices,
): ExpectedBundleEntries {
  return new Map([
    ...Object.values(manifest.instruments).flatMap((instrument) =>
      instrument.samples.map(
        (sample) => [sampleEntryName(sample), sample.sha256] as const,
      ),
    ),
    ["ATTRIBUTION.txt", notices?.["ATTRIBUTION.txt"]],
    ["LICENSE.txt", notices?.["LICENSE.txt"]],
  ]);
}
async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("Sample verification requires HTTPS or localhost.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
function field(header: Uint8Array, offset: number, length: number) {
  const bytes = header.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  const visible = end < 0 ? bytes : bytes.subarray(0, end);
  if (visible.some((value) => value < 32 || value > 126))
    throw new Error("Invalid sample archive header text.");
  if (end >= 0 && bytes.subarray(end).some((value) => value !== 0))
    throw new Error("Invalid sample archive header padding.");
  return String.fromCharCode(...visible);
}
function octal(header: Uint8Array, offset: number, length: number) {
  const value = String.fromCharCode(...header.subarray(offset, offset + length))
    .replace(/[\0 ]+$/, "")
    .trim();
  if (!/^[0-7]+$/.test(value))
    throw new Error("Invalid sample archive numeric field.");
  return Number.parseInt(value, 8);
}
/** Pure archive boundary: validate every entry before exposing any audio bytes. */
export async function extractSampleBundle(
  compressed: Uint8Array,
  descriptor: SampleBundleDescriptor,
  expected: ExpectedBundleEntries = expectedSampleEntries(),
  signal?: AbortSignal,
): Promise<SampleBundleEntries> {
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  check();
  if (
    compressed.length < 18 ||
    compressed.length > MAX_TAR_BYTES ||
    !Number.isInteger(descriptor.uncompressedBytes) ||
    descriptor.uncompressedBytes < 1024 ||
    descriptor.uncompressedBytes > MAX_TAR_BYTES ||
    descriptor.uncompressedBytes % 512 !== 0
  )
    throw new Error("Invalid sample bundle size.");
  let tar: Uint8Array;
  if (compressed[0] === 0x1f && compressed[1] === 0x8b) {
    if (compressed.length > MAX_ARCHIVE_BYTES)
      throw new Error("Invalid sample bundle size.");
    if ((await sha256(compressed)) !== descriptor.sha256)
      throw new Error("Sample bundle checksum mismatch.");
    check();
    const gzipSize = new DataView(
      compressed.buffer,
      compressed.byteOffset + compressed.length - 4,
      4,
    ).getUint32(0, true);
    if (gzipSize !== descriptor.uncompressedBytes)
      throw new Error("Sample bundle expanded size mismatch.");
    try {
      tar = gunzipSync(
        compressed,
        new Uint8Array(descriptor.uncompressedBytes),
      );
    } catch {
      throw new Error("Unable to unpack sample bundle.");
    }
  } else {
    // Fetch transparently decodes Content-Encoding:gzip before exposing bytes.
    tar = compressed;
  }
  if (tar.length !== descriptor.uncompressedBytes)
    throw new Error("Sample bundle expanded size mismatch.");
  if (
    !descriptor.uncompressedSha256 ||
    (await sha256(tar)) !== descriptor.uncompressedSha256
  )
    throw new Error("Sample bundle expanded checksum mismatch.");
  check();
  const entries = new Map<string, Uint8Array>();
  let offset = 0,
    terminated = false;
  while (offset + 512 <= tar.length) {
    check();
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (
        offset + 1024 > tar.length ||
        tar.subarray(offset).some((byte) => byte !== 0)
      )
        throw new Error("Invalid sample archive end marker.");
      terminated = true;
      break;
    }
    const checksum = octal(header, 148, 8);
    let actualChecksum = 0;
    for (let index = 0; index < 512; index++)
      actualChecksum += index >= 148 && index < 156 ? 32 : header[index];
    if (checksum !== actualChecksum)
      throw new Error("Sample archive header checksum mismatch.");
    if (field(header, 257, 6) !== "ustar" || field(header, 263, 2) !== "00")
      throw new Error("Unsupported sample archive format.");
    if (
      field(header, 345, 155) !== "" ||
      field(header, 157, 100) !== "" ||
      ![0, 48].includes(header[156])
    )
      throw new Error("Sample archive accepts regular files only.");
    const name = field(header, 0, 100);
    if (!/^[A-Za-z0-9_-]+\.(mp3|txt)$/.test(name) || !expected.has(name))
      throw new Error(`Unexpected sample archive entry: ${name}`);
    if (entries.has(name))
      throw new Error(`Duplicate sample archive entry: ${name}`);
    const size = octal(header, 124, 12);
    const end = offset + 512 + size;
    const paddedEnd = offset + 512 + Math.ceil(size / 512) * 512;
    if (size <= 0 || end > tar.length || paddedEnd > tar.length)
      throw new Error("Truncated sample archive entry.");
    if (tar.subarray(end, paddedEnd).some((byte) => byte !== 0))
      throw new Error("Invalid sample archive entry padding.");
    entries.set(name, tar.subarray(offset + 512, end));
    offset = paddedEnd;
  }
  if (
    !terminated ||
    entries.size !== descriptor.entryCount ||
    entries.size !== expected.size ||
    [...expected.keys()].some((name) => !entries.has(name))
  )
    throw new Error(
      "Sample archive has missing entries or an invalid entry count.",
    );
  await Promise.all(
    [...expected].map(async ([name, checksum]) => {
      if (checksum && (await sha256(entries.get(name)!)) !== checksum)
        throw new Error(`Sample checksum mismatch: ${name}`);
    }),
  );
  check();
  return entries;
}

/** One lazy fetch and verified byte cache for the mounted tool, including both sounds. */
export function createSampleBundleLoader(
  options: { fetcher?: typeof fetch } = {},
) {
  let cached: SampleBundleEntries | undefined;
  let pending:
    { signal: AbortSignal; promise: Promise<SampleBundleEntries> } | undefined;
  let disposed = false;
  async function download(signal: AbortSignal) {
    const descriptor = (
      manifest as typeof manifest & { bundle: SampleBundleDescriptor }
    ).bundle;
    if (!descriptor)
      throw new Error(
        "Sample bundle metadata is missing. Run npm run assets:ear-training.",
      );
    const response = await (options.fetcher ?? fetch)(
      `${import.meta.env.BASE_URL}${descriptor.url.replace(/^\//, "")}?sha256=${descriptor.sha256}`,
      { signal },
    );
    if (!response.ok)
      throw new Error(
        `Missing instrument sample bundle (${response.status}). Run npm run assets:ear-training and retry.`,
      );
    if (
      response.headers?.get("content-type")?.toLowerCase().includes("text/html")
    )
      throw new Error(
        "Instrument sample bundle is missing: the server returned an HTML page. Run npm run assets:ear-training, restart the dev server, and retry.",
      );
    const declaredLength = Number(response.headers?.get("content-length"));
    if (declaredLength > MAX_TAR_BYTES)
      throw new Error("Sample bundle download exceeds its size limit.");
    let bytes: Uint8Array;
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          if (signal.aborted) throw abortError();
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_TAR_BYTES)
            throw new Error("Sample bundle download exceeds its size limit.");
          chunks.push(next.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    return extractSampleBundle(
      bytes,
      descriptor,
      expectedSampleEntries(descriptor.notices),
      signal,
    );
  }
  return {
    load(signal: AbortSignal): Promise<SampleBundleEntries> {
      if (disposed || signal.aborted) return Promise.reject(abortError());
      if (cached) return Promise.resolve(cached);
      if (pending && !pending.signal.aborted) return pending.promise;
      const operation = {
        signal,
        promise: Promise.resolve(null as unknown as SampleBundleEntries),
      };
      operation.promise = download(signal)
        .then((entries) => {
          if (signal.aborted || disposed) throw abortError();
          cached = entries;
          return entries;
        })
        .finally(() => {
          if (pending === operation) pending = undefined;
        });
      pending = operation;
      return operation.promise;
    },
    dispose() {
      disposed = true;
      cached = undefined;
      pending = undefined;
    },
  };
}
