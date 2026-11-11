import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEarTrainingPlayer,
  nearestSample,
  sustainLoopBounds,
} from "./ear-training-audio";
import manifest from "../data/ear_training_samples.json";
import {
  createDefaultSettings,
  type Exercise,
  type RoutinePlan,
} from "./ear-training-model";

function fixture(): Exercise {
  return {
    id: 1,
    keyScale: { tonicPc: 0, scaleId: "major" },
    source: "random",
    rhythmIds: [],
    totalTicks: 1920,
    events: [
      {
        kind: "note",
        midi: 60,
        onsetTicks: 0,
        durationTicks: 480,
        noteIndex: 0,
      },
      { kind: "rest", onsetTicks: 480, durationTicks: 240 },
      {
        kind: "note",
        midi: 64,
        onsetTicks: 720,
        durationTicks: 1200,
        noteIndex: 1,
      },
    ],
    snapshot: { ...createDefaultSettings(), sound: "piano", bpm: 120 },
  };
}
function fakeAudio() {
  const sources: Array<
    Record<string, unknown> & { playbackRate: { value: number } }
  > = [];
  const gains: Array<
    Record<string, unknown> & {
      gain: { setValueAtTime: ReturnType<typeof vi.fn> };
    }
  > = [];
  function buffer() {
    const data = Float32Array.from(
      { length: 2000 },
      (_, index) => 0.05 * Math.sin((index * 2 * Math.PI) / 10),
    );
    return {
      duration: 2,
      length: 2000,
      numberOfChannels: 1,
      sampleRate: 1000,
      getChannelData: () => data,
    };
  }
  const context = {
    currentTime: 10,
    state: "running",
    destination: {},
    outputLatency: 0.1,
    onstatechange: null as null | (() => void),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => buffer()),
    createBuffer: vi.fn(buffer),
    createGain: vi.fn(() => {
      const gain = {
        gain: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
    createBufferSource: vi.fn(() => {
      const source = {
        playbackRate: { value: 1 },
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    }),
  };
  const fetcher = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
  const sampleLoader = {
    load: async () => {
      await fetcher();
      return new Map(
        Object.values(manifest.instruments).flatMap((instrument) =>
          instrument.samples.map(
            (sample) =>
              [sample.url.split("/").at(-1)!, new Uint8Array(8)] as const,
          ),
        ),
      );
    },
    dispose: vi.fn(),
  };
  const player = createEarTrainingPlayer({
    contextFactory: () => context as unknown as AudioContext,
    sampleLoader,
  });
  return { player, context, sources, gains, fetcher, sampleLoader };
}
afterEach(() => vi.useRealTimers());
describe("sampled audio scheduling", () => {
  it("schedules original attacks on one clock, preserves rests and tunes nearest roots", async () => {
    const { player, sources, gains } = fakeAudio();
    const times = await player.play(fixture());
    expect(times).toEqual({ startTime: 10.05, endTime: 12.05 });
    expect(sources).toHaveLength(2);
    expect(sources[0].start).toHaveBeenCalledWith(10.05);
    expect(sources[1].start).toHaveBeenCalledWith(10.8);
    expect(sources[1].playbackRate.value).toBe(1);
    expect(sources[1].stop).toHaveBeenCalledWith(12.05);
    expect(sources[1].loop).toBe(true);
    expect(sources[1].loopStart).toBe(0.62);
    player.setVolume(0.8);
    expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.8, 10);
    player.stop();
    for (const source of sources) expect(source.disconnect).toHaveBeenCalled();
    player.dispose();
  });
  it("sustains a 24-second hold with one attack and caps the source at its deadline", async () => {
    const { player, sources } = fakeAudio();
    const exercise = fixture();
    exercise.snapshot = { ...exercise.snapshot, bpm: 40 };
    exercise.events = [
      {
        kind: "note",
        midi: 60,
        onsetTicks: 0,
        durationTicks: 7680,
        noteIndex: 0,
      },
    ];
    exercise.totalTicks = 7680;
    const times = await player.play(exercise);
    expect(times.endTime - times.startTime).toBeCloseTo(24);
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
    expect(sources[0].stop).toHaveBeenCalledWith(34.05);
    player.dispose();
  });
  it("rejects decoded assets whose sustain loop exceeds the sample", async () => {
    const { player, context, sources } = fakeAudio();
    context.decodeAudioData.mockResolvedValueOnce({
      duration: 0.5,
      length: 500,
      numberOfChannels: 1,
      sampleRate: 1000,
      getChannelData: () => new Float32Array(500),
    });
    await expect(player.play(fixture())).rejects.toThrow(
      "Invalid sustain loop",
    );
    expect(sources).toHaveLength(0);
    player.dispose();
  });
  it("retains decoded buffers for replay but creates fresh single-use sources", async () => {
    const { player, context, sources } = fakeAudio();
    await player.play(fixture());
    await player.play(fixture());
    expect(context.decodeAudioData).toHaveBeenCalledTimes(37);
    expect(sources).toHaveLength(4);
    player.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });
  it("clears failed fetch promises so Retry can succeed", async () => {
    const { player, fetcher } = fakeAudio();
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(player.prepare(fixture())).rejects.toThrow("offline");
    await player.play(fixture());
    player.dispose();
  });
  it("rejects stopped pending loads without starting stale sound", async () => {
    const { player, fetcher, sources } = fakeAudio();
    let release!: () => void;
    fetcher.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    const pending = player.play(fixture());
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    player.stop();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sources).toHaveLength(0);
    player.dispose();
  });
  it("uses routine transport and interrupts a missed rolling onset", async () => {
    vi.useFakeTimers();
    const { context, sampleLoader } = fakeAudio();
    const interrupted = vi.fn();
    const player = createEarTrainingPlayer({
      contextFactory: () => context as unknown as AudioContext,
      sampleLoader,
      onInterrupted: interrupted,
    });
    const exercise = fixture();
    exercise.events = [
      exercise.events[0],
      {
        kind: "note",
        midi: 64,
        onsetTicks: 960,
        durationTicks: 480,
        noteIndex: 1,
      },
    ];
    exercise.totalTicks = 1920;
    const result = await player.playRoutine({
      exercise,
      transportBpm: 60,
    } as RoutinePlan);
    expect(result.endTime).toBe(14.05);
    context.currentTime = 13;
    await vi.advanceTimersByTimeAsync(100);
    expect(interrupted).toHaveBeenCalledWith(
      expect.stringContaining("deadline"),
    );
    expect(vi.getTimerCount()).toBe(0);
    player.dispose();
  });
  it("offsets visible completion for output latency when timestamps are absent", async () => {
    const { player } = fakeAudio();
    await player.prepare(fixture());
    expect(player.currentTime()).toBe(10);
    expect(player.audibleTime()).toBe(9.9);
    player.dispose();
  });
});
describe("bundled samples through the player", () => {
  it("fetches one actual archive, then decodes piano and saxophone without further requests", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../public/ear-training-samples.tar.gz", import.meta.url),
      ),
    );
    const { context } = fakeAudio();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array(bytes)),
    );
    const player = createEarTrainingPlayer({
      contextFactory: () => context as unknown as AudioContext,
      fetcher,
    });
    await player.play(fixture());
    expect(context.decodeAudioData).toHaveBeenCalledTimes(37);
    player.stop();
    const saxophone = fixture();
    saxophone.snapshot = { ...saxophone.snapshot, sound: "saxophone" };
    await player.play(saxophone);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(74);
    await player.play(fixture());
    expect(context.decodeAudioData).toHaveBeenCalledTimes(74);
    expect(fetcher).toHaveBeenCalledOnce();
    player.dispose();
  });
  it("never decodes or schedules samples from a damaged archive", async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL("../public/ear-training-samples.tar.gz", import.meta.url),
      ),
    );
    bytes[100] ^= 1;
    const { context, sources } = fakeAudio();
    const player = createEarTrainingPlayer({
      contextFactory: () => context as unknown as AudioContext,
      fetcher: vi.fn<typeof fetch>(
        async () => new Response(new Uint8Array(bytes)),
      ),
    });
    await expect(player.play(fixture())).rejects.toThrow("bundle checksum");
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    player.dispose();
  });
});
describe("phase-aligned sustain regions", () => {
  function sampledTone() {
    const sampleRate = 44100;
    const frequency = 440 * 2 ** ((60 - 69) / 12);
    const data = Float32Array.from(
      { length: sampleRate * 2 },
      (_, index) =>
        0.1 * Math.sin((index * 2 * Math.PI * frequency) / sampleRate),
    );
    return {
      duration: 2,
      length: data.length,
      numberOfChannels: 1,
      sampleRate,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  }
  function windowEnergy(buffer: AudioBuffer, end: number) {
    const data = buffer.getChannelData(0);
    const start = Math.round(0.6 * buffer.sampleRate),
      blend = Math.round(0.02 * buffer.sampleRate);
    const output = data.slice();
    for (let i = 0; i < blend; i++) {
      const mix = i / (blend - 1);
      output[end - blend + i] =
        data[end - blend + i] * (1 - mix) + data[start + i] * mix;
    }
    const loopStart = start + blend;
    const window = Math.round(0.01 * buffer.sampleRate);
    let minimum = Infinity,
      maximum = 0;
    // Every10ms across a full24-second hold, including all repeated seams.
    for (
      let offset = Math.round(0.1 * buffer.sampleRate);
      offset < 24 * buffer.sampleRate;
      offset += window
    ) {
      let energy = 0;
      for (let i = offset; i < offset + window; i++) {
        const index = i < end ? i : loopStart + ((i - end) % (end - loopStart));
        energy += output[index] ** 2;
      }
      const rms = Math.sqrt(energy / window);
      minimum = Math.min(minimum, rms);
      maximum = Math.max(maximum, rms);
    }
    return { minimum, maximum };
  }
  it("avoids recurring cancellation dips over24 seconds with phase-matched sampled waveforms", () => {
    const buffer = sampledTone();
    const loop = sustainLoopBounds(buffer, 60, 0.6, 1);
    const before = windowEnergy(buffer, 44100),
      after = windowEnergy(buffer, loop.end);
    expect(after.minimum).toBeGreaterThan(before.minimum * 1.5);
    expect(after.minimum / after.maximum).toBeGreaterThan(0.9);
    expect(loop.loopEnd).toBeLessThanOrEqual(1);
    expect(loop.loopStart).toBe(0.62);
  });
  it("rejects a valid-length buffer with a silent sustain region", () => {
    const tone = sampledTone();
    tone.getChannelData(0).fill(0);
    expect(() => sustainLoopBounds(tone, 60, 0.6, 1)).toThrow(
      "Silent sustain loop",
    );
  });
});
describe("licensed source sample manifest", () => {
  it("covers every supported MIDI note within three semitones and uses each exact root", () => {
    for (const sound of ["piano", "saxophone"] as const) {
      for (let midi = 48; midi <= 84; midi++)
        expect(
          Math.abs(nearestSample(sound, midi).rootMidi - midi),
        ).toBeLessThanOrEqual(3);
      expect(nearestSample(sound, 63).rootMidi).toBe(63);
      expect(() => nearestSample(sound, 47)).toThrow("Unsupported");
      for (const sample of manifest.instruments[sound].samples) {
        expect(sample.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(sample.sourceUrl).toContain(manifest.provenance.revision);
        expect(sample.loopEnd).toBeGreaterThan(sample.loopStart);
      }
    }
    expect(manifest.provenance.license).toBe("CC-BY-3.0");
  });
});
