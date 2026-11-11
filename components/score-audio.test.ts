import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fontBytes = new Uint8Array([82, 73, 70, 70]);
const mp3Bytes = new Uint8Array([73, 68, 51, 4]);

const fakeScore = () => ({
  // Match webmscore's transfer semantics: loading a soundfont detaches its buffer.
  setSoundFont: vi.fn(async (data: Uint8Array) => {
    expect(data).toEqual(fontBytes);
    structuredClone(data, { transfer: [data.buffer] });
  }),
  saveAudio: vi.fn(async () => new Uint8Array(mp3Bytes)),
});

describe("score audio", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fontBytes)),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns MP3 data and reuses the font across scores without transferring the cache", async () => {
    const { renderScoreAudio } = await import("./score-audio");
    const first = fakeScore();
    const second = fakeScore();
    const signal = new AbortController().signal;
    const audio = await renderScoreAudio(first, signal);
    await renderScoreAudio(second, signal);
    expect(audio.type).toBe("audio/mpeg");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(mp3Bytes);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.saveAudio).toHaveBeenCalledWith("mp3");
    expect(second.setSoundFont.mock.calls[0][0].buffer.byteLength).toBe(0);
    expect(fontBytes.byteLength).toBe(4);
  });

  it("allows retrying a failed instrument download", async () => {
    const { renderScoreAudio } = await import("./score-audio");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(
      renderScoreAudio(fakeScore(), new AbortController().signal),
    ).rejects.toThrow("instrument sounds");
    await expect(
      renderScoreAudio(fakeScore(), new AbortController().signal),
    ).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not access a score destroyed while instruments were downloading", async () => {
    const { renderScoreAudio } = await import("./score-audio");
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const score = fakeScore();
    const result = renderScoreAudio(score, controller.signal);
    controller.abort();
    finish(new Response(fontBytes));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(score.setSoundFont).not.toHaveBeenCalled();
    expect(score.saveAudio).not.toHaveBeenCalled();
  });

  it("stops before synthesis if the score changes while its soundfont is loading", async () => {
    const { renderScoreAudio } = await import("./score-audio");
    const controller = new AbortController();
    const score = fakeScore();
    score.setSoundFont.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      renderScoreAudio(score, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(score.saveAudio).not.toHaveBeenCalled();
  });

  it("discards audio completed after cancellation", async () => {
    const { renderScoreAudio } = await import("./score-audio");
    const controller = new AbortController();
    const score = fakeScore();
    score.saveAudio.mockImplementationOnce(async () => {
      controller.abort();
      return mp3Bytes;
    });
    await expect(
      renderScoreAudio(score, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects empty audio instead of showing a broken player", async () => {
    const { renderScoreAudio } = await import("./score-audio");
    const score = fakeScore();
    score.saveAudio.mockResolvedValueOnce(new Uint8Array());
    await expect(
      renderScoreAudio(score, new AbortController().signal),
    ).rejects.toThrow("did not produce any audio");
  });
});
