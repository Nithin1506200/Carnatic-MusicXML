import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import manifest from "../data/ear_training_samples.json";
import {
  createSampleBundleLoader,
  expectedSampleEntries,
  extractSampleBundle,
  type SampleBundleDescriptor,
} from "./ear-training-sample-bundle";
const encoder = new TextEncoder();
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const testFiles = [
  { name: "piano-60.mp3", bytes: encoder.encode("sample payload") },
  { name: "ATTRIBUTION.txt", bytes: encoder.encode("source attribution") },
  { name: "LICENSE.txt", bytes: encoder.encode("license terms") },
];
type TestFile = {
  name: string;
  bytes: Uint8Array;
  type?: string;
  prefix?: string;
};
function fixture(
  files: TestFile[] = testFiles,
  change?: (tar: Uint8Array) => void,
) {
  const size = files.reduce(
    (total, file) => total + 512 + Math.ceil(file.bytes.length / 512) * 512,
    1024,
  );
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const file of files) {
    const header = tar.subarray(offset, offset + 512);
    const put = (start: number, text: string) =>
      header.set(encoder.encode(text), start);
    put(0, file.name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${file.bytes.length.toString(8).padStart(11, "0")}\0`);
    put(136, "00000000000\0");
    header.fill(32, 148, 156);
    put(156, file.type ?? "0");
    put(257, "ustar\0");
    put(263, "00");
    if (file.prefix) put(345, file.prefix);
    const sum = header.reduce((total, byte) => total + byte, 0);
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    tar.set(file.bytes, offset + 512);
    offset += 512 + Math.ceil(file.bytes.length / 512) * 512;
  }
  change?.(tar);
  const compressed = new Uint8Array(gzipSync(tar));
  const descriptor: SampleBundleDescriptor = {
    url: "/fixture.tar.gz",
    sha256: digest(compressed),
    uncompressedBytes: tar.length,
    uncompressedSha256: digest(tar),
    entryCount: files.length,
  };
  const expected = new Map(
    testFiles.map((file) => [file.name, digest(file.bytes)]),
  );
  return { compressed, descriptor, expected };
}
async function shipped() {
  const descriptor = (
    manifest as typeof manifest & { bundle: SampleBundleDescriptor }
  ).bundle;
  const bytes = new Uint8Array(
    await readFile(new URL(`../public${descriptor.url}`, import.meta.url)),
  );
  return { bytes, descriptor };
}
describe("verified instrument archive", () => {
  it("validates the actual checked-in archive and all74 audio checksums plus license notices", async () => {
    const { bytes, descriptor } = await shipped();
    const entries = await extractSampleBundle(bytes, descriptor);
    expect(entries.size).toBe(76);
    for (const [name, checksum] of expectedSampleEntries())
      expect(digest(entries.get(name)!)).toBe(checksum);
    expect(entries.get("LICENSE.txt")!.length).toBeGreaterThan(1000);
  });
  it("accepts HTTP-decoded tar bytes only after verifying their separate checksum", async () => {
    const { bytes, descriptor } = await shipped();
    const tar = new Uint8Array(gunzipSync(bytes));
    expect((await extractSampleBundle(tar, descriptor)).size).toBe(76);
    tar[1000] ^= 1;
    await expect(extractSampleBundle(tar, descriptor)).rejects.toThrow(
      "expanded checksum mismatch",
    );
  });
  it("extracts only complete verified payloads", async () => {
    const { compressed, descriptor, expected } = fixture();
    const entries = await extractSampleBundle(compressed, descriptor, expected);
    expect(entries.get("piano-60.mp3")).toEqual(testFiles[0].bytes);
  });
  it("rejects corrupt archives before decompression and corrupt samples before decoding", async () => {
    const { compressed, descriptor, expected } = fixture();
    await expect(
      extractSampleBundle(
        compressed,
        { ...descriptor, sha256: "0".repeat(64) },
        expected,
      ),
    ).rejects.toThrow("bundle checksum");
    expected.set("piano-60.mp3", "0".repeat(64));
    await expect(
      extractSampleBundle(compressed, descriptor, expected),
    ).rejects.toThrow("Sample checksum mismatch: piano-60");
    expected.set("piano-60.mp3", digest(testFiles[0].bytes));
    expected.set("LICENSE.txt", "0".repeat(64));
    await expect(
      extractSampleBundle(compressed, descriptor, expected),
    ).rejects.toThrow("Sample checksum mismatch: LICENSE");
  });
  it("rejects unsafe names, symlinks, prefixes, duplicates and unexpected entries", async () => {
    for (const files of [
      [{ ...testFiles[0], name: "../piano-60.mp3" }, ...testFiles.slice(1)],
      [{ ...testFiles[0], type: "2" }, ...testFiles.slice(1)],
      [{ ...testFiles[0], prefix: "directory" }, ...testFiles.slice(1)],
      [...testFiles, testFiles[0]],
      [...testFiles, { ...testFiles[0], name: "unexpected.mp3" }],
    ]) {
      const { compressed, descriptor, expected } = fixture(files);
      await expect(
        extractSampleBundle(compressed, descriptor, expected),
      ).rejects.toThrow(/entry|regular files/);
    }
  });
  it("rejects missing entries, damaged headers and invalid end markers", async () => {
    for (const setup of [
      fixture(testFiles.slice(1)),
      fixture(testFiles, (tar) => {
        tar[0] ^= 1;
      }),
      fixture(testFiles, (tar) => {
        tar[tar.length - 1] = 1;
      }),
    ])
      await expect(
        extractSampleBundle(setup.compressed, setup.descriptor, setup.expected),
      ).rejects.toThrow(/missing|checksum|end marker/);
  });
  it("bounds expanded size and rejects mismatched gzip lengths", async () => {
    const { compressed, descriptor, expected } = fixture();
    await expect(
      extractSampleBundle(
        compressed,
        { ...descriptor, uncompressedBytes: 64 * 1024 * 1024 },
        expected,
      ),
    ).rejects.toThrow("size");
    await expect(
      extractSampleBundle(
        compressed,
        {
          ...descriptor,
          uncompressedBytes: descriptor.uncompressedBytes + 512,
        },
        expected,
      ),
    ).rejects.toThrow("expanded size");
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      extractSampleBundle(compressed, descriptor, expected, aborted.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
describe("mounted bundle byte cache", () => {
  it("reports an HTML fallback as a missing server asset and permits retry", async () => {
    const { bytes } = await shipped();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<!doctype html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
    const loader = createSampleBundleLoader({ fetcher });
    await expect(loader.load(new AbortController().signal)).rejects.toThrow(
      "restart the dev server",
    );
    expect((await loader.load(new AbortController().signal)).size).toBe(76);
    loader.dispose();
  });
  it("loads a transparently HTTP-decoded tar response", async () => {
    const { bytes } = await shipped();
    const loader = createSampleBundleLoader({
      fetcher: vi.fn<typeof fetch>(
        async () =>
          new Response(new Uint8Array(gunzipSync(bytes)), {
            headers: { "Content-Encoding": "gzip" },
          }),
      ),
    });
    expect((await loader.load(new AbortController().signal)).size).toBe(76);
    loader.dispose();
  });

  it("fetches once and retains verified bytes across stop signals and instrument changes", async () => {
    const { bytes } = await shipped();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array(bytes)),
    );
    const loader = createSampleBundleLoader({ fetcher });
    const first = new AbortController();
    const [piano, saxophone] = await Promise.all([
      loader.load(first.signal),
      loader.load(first.signal),
    ]);
    first.abort();
    const replay = await loader.load(new AbortController().signal);
    expect(piano).toBe(saxophone);
    expect(replay).toBe(piano);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toContain("sha256=");
    loader.dispose();
    await expect(
      loader.load(new AbortController().signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("retries failed and cancelled downloads without retaining failed promises", async () => {
    const { bytes } = await shipped();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
    const loader = createSampleBundleLoader({ fetcher });
    await expect(loader.load(new AbortController().signal)).rejects.toThrow(
      "503",
    );
    expect((await loader.load(new AbortController().signal)).size).toBe(76);
    loader.dispose();
    const pendingFetch = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
    const retryLoader = createSampleBundleLoader({ fetcher: pendingFetch });
    const controller = new AbortController();
    const pending = retryLoader.load(controller.signal);
    controller.abort();
    const retry = retryLoader.load(new AbortController().signal);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect((await retry).size).toBe(76);
    expect(pendingFetch).toHaveBeenCalledTimes(2);
    retryLoader.dispose();
  });
});
