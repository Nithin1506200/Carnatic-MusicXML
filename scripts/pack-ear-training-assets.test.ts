import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compressTar } from "./pack-ear-training-assets.mjs";

describe("committed audio packaging", () => {
  it("produces identical gzip bytes regardless of input order with canonical TAR metadata", () => {
    const entries = [
      { name: "saxophone-60.mp3", bytes: Buffer.from([1, 2, 3]) },
      { name: "ATTRIBUTION.txt", bytes: Buffer.from("Source credit") },
    ];
    const a = compressTar(entries);
    const b = compressTar([...entries].reverse());
    expect(a.compressed).toEqual(b.compressed);
    expect(gunzipSync(a.compressed)).toEqual(a.tar);
    expect(a.compressed[9]).toBe(255);
    expect(a.tar.subarray(0, 16).toString()).toBe("ATTRIBUTION.txt\0");
    expect(a.tar.subarray(108, 124).toString()).toBe("0000000\0".repeat(2));
    expect(a.tar.subarray(136, 148).toString()).toBe("00000000000\0");
    expect(a.tar.subarray(-1024).every((byte: number) => byte === 0)).toBe(
      true,
    );
  });
  it("rejects duplicate entries and paths rather than creating ambiguous archives", () => {
    const entry = { name: "same.mp3", bytes: Buffer.from([0]) };
    expect(() => compressTar([entry, entry])).toThrow("Invalid archive entry");
    expect(() => compressTar([{ ...entry, name: "../sample.mp3" }])).toThrow(
      "Invalid archive entry",
    );
  });
  it("verifies committed assets without network access", () => {
    const script = fileURLToPath(
      new URL("./prepare-ear-training-assets.mjs", import.meta.url),
    );
    const source = `globalThis.fetch = () => { throw new Error('Network must not be used'); }; await import(${JSON.stringify(new URL(`file://${script}`).href)});`;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      { encoding: "utf8" },
    );
    expect(output).toContain(
      "Verified committed audio bundle offline (74 samples",
    );
  });
});
