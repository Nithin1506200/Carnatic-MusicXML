import manifest from "../data/ear_training_samples.json";
import {
  createSampleBundleLoader,
  sampleEntryName,
  type SampleBundleEntries,
} from "./ear-training-sample-bundle";
import type {
  Exercise,
  ExerciseEvent,
  SoundId,
  RoutinePlan,
} from "./ear-training-model";

export interface PlaybackTimes {
  startTime: number;
  endTime: number;
}
export interface PlayerOptions {
  onInterrupted?: (reason: string) => void;
  contextFactory?: () => AudioContext;
  fetcher?: typeof fetch;
  sampleLoader?: {
    load(signal: AbortSignal): Promise<SampleBundleEntries>;
    dispose(): void;
  };
}
type Sample = (typeof manifest.instruments.piano.samples)[number];
type Prepared = {
  buffer: AudioBuffer;
  sample: Sample;
  loopStart: number;
  loopEnd: number;
};
const abortError = () => new DOMException("Playback cancelled", "AbortError");
export function nearestSample(sound: SoundId, midi: number): Sample {
  const instrument = manifest.instruments[sound];
  if (
    !Number.isInteger(midi) ||
    midi < instrument.lowMidi ||
    midi > instrument.highMidi
  )
    throw new Error(
      `Unsupported ${sound} pitch: MIDI ${midi}. Supported range is ${instrument.lowMidi}–${instrument.highMidi}.`,
    );
  const sample = [...instrument.samples].sort(
    (a, b) =>
      Math.abs(a.rootMidi - midi) - Math.abs(b.rootMidi - midi) ||
      a.rootMidi - b.rootMidi,
  )[0];
  if (!sample || Math.abs(sample.rootMidi - midi) > 3)
    throw new Error(`No supported ${sound} sample for MIDI ${midi}`);
  return sample;
}

/** Match waveform phase before crossfading to reduce cancellation at repeated seams. */
export function sustainLoopBounds(
  decoded: AudioBuffer,
  rootMidi: number,
  loopStart: number,
  loopEnd: number,
) {
  const rate = decoded.sampleRate;
  const start = Math.round(loopStart * rate);
  const end = Math.min(decoded.length, Math.round(loopEnd * rate));
  const blend = Math.round(0.02 * rate);
  if (!(
    loopStart >= 0 &&
    end - start > blend * 2 &&
    loopEnd <= decoded.duration
  ))
    throw new Error("Invalid sustain loop: sample setup must be repaired.");
  const channels = Array.from(
    { length: decoded.numberOfChannels },
    (_, index) => decoded.getChannelData(index),
  );
  const period = rate / (440 * 2 ** ((rootMidi - 69) / 12));
  const firstEnd = Math.max(start + blend * 2, end - Math.ceil(period * 2));
  let bestEnd = end;
  let bestError = Infinity;
  // Search at most two fundamental periods, within the declared source region.
  for (let candidate = end; candidate >= firstEnd; candidate--) {
    let error = 0;
    for (const data of channels) {
      for (let i = 0; i < blend; i += 4) {
        const difference = data[candidate - blend + i] - data[start + i];
        error += difference * difference;
      }
    }
    if (error < bestError) {
      bestError = error;
      bestEnd = candidate;
    }
  }
  let energy = 0;
  for (const data of channels)
    for (let i = start; i < bestEnd; i++) energy += data[i] * data[i];
  if (energy / ((bestEnd - start) * channels.length) < 1e-10)
    throw new Error("Silent sustain loop: sample setup must be repaired.");
  return {
    start,
    end: bestEnd,
    blend,
    loopStart: (start + blend) / rate,
    loopEnd: bestEnd / rate,
  };
}

/** Mounted-tool engine. No context, fetch, or sound is created on import. */
export function createEarTrainingPlayer(options: PlayerOptions = {}) {
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let volume = 0.5;
  let generation = 0;
  let disposed = false;
  let controller = new AbortController();
  let refill: ReturnType<typeof setInterval> | undefined;
  let activeEnd = 0;
  const cache = new Map<string, Promise<Prepared>>();
  const ready = new Set<string>();
  const nodes = new Map<AudioBufferSourceNode, GainNode>();
  const sampleLoader =
    options.sampleLoader ??
    createSampleBundleLoader({ fetcher: options.fetcher });
  function stop() {
    generation++;
    controller.abort();
    controller = new AbortController();
    if (refill !== undefined) clearInterval(refill);
    refill = undefined;
    activeEnd = 0;
    for (const key of cache.keys()) if (!ready.has(key)) cache.delete(key);
    for (const [source, gain] of nodes) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
      gain.disconnect();
    }
    nodes.clear();
  }
  function interrupted(reason: string) {
    stop();
    options.onInterrupted?.(reason);
  }
  async function unlock() {
    if (disposed) throw new Error("Audio player has been disposed");
    if (!context) {
      context = options.contextFactory?.() ?? new AudioContext();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
      context.onstatechange = () => {
        if (
          context &&
          context.state !== "running" &&
          activeEnd > context.currentTime
        )
          interrupted("Audio context suspended; restart practice to continue.");
      };
    }
    // Called synchronously from the explicit Start/Replay/Next action, before fetch.
    if (context.state !== "running") await context.resume();
    return context;
  }
  async function load(
    sound: SoundId,
    midi: number,
    signal: AbortSignal,
  ): Promise<Prepared> {
    const sample = nearestSample(sound, midi);
    const key = `${sound}:${sample.url}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const entries = await sampleLoader.load(signal);
      const bytes = entries.get(sampleEntryName(sample));
      if (!bytes)
        throw new Error(`Missing bundled sample: ${sampleEntryName(sample)}`);
      if (signal.aborted || !context) throw abortError();
      // decodeAudioData may detach its input; preserve the verified bundle cache.
      const decoded = await context.decodeAudioData(
        new Uint8Array(bytes).buffer,
      );
      if (signal.aborted) throw abortError();
      const loop = sustainLoopBounds(
        decoded,
        sample.rootMidi,
        sample.loopStart,
        sample.loopEnd,
      );
      // Retain the attack, then crossfade phase-matched waveforms in memory.
      const buffer = context.createBuffer(
        decoded.numberOfChannels,
        decoded.length,
        decoded.sampleRate,
      );
      const { start, end, blend } = loop;
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const original = decoded.getChannelData(channel);
        const data = buffer.getChannelData(channel);
        data.set(original);
        for (let i = 0; i < blend; i++) {
          const mix = i / (blend - 1);
          data[end - blend + i] =
            original[end - blend + i] * (1 - mix) + original[start + i] * mix;
        }
      }
      ready.add(key);
      return {
        buffer,
        sample,
        loopStart: loop.loopStart,
        loopEnd: loop.loopEnd,
      };
    })();
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  }
  async function prepare(exercise: Exercise) {
    const token = generation;
    await unlock();
    if (token !== generation) throw abortError();
    const sound = exercise.snapshot.sound;
    for (const event of exercise.events)
      if (event.kind === "note") nearestSample(sound, event.midi);
    // Decode the complete local instrument before practice; later targets need no network.
    await Promise.all(
      manifest.instruments[sound].samples.map((sample) =>
        load(sound, sample.rootMidi, controller.signal),
      ),
    );
    if (token !== generation || disposed) throw abortError();
  }
  function schedule(
    event: Extract<ExerciseEvent, { kind: "note" }>,
    prepared: Prepared,
    start: number,
    end: number,
  ) {
    if (!context || !master) throw new Error("Audio not prepared");
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = prepared.buffer;
    source.playbackRate.value =
      2 ** ((event.midi - prepared.sample.rootMidi) / 12);
    source.loop = true;
    source.loopStart = prepared.loopStart;
    source.loopEnd = prepared.loopEnd;
    const edge = Math.min(0.012, (end - start) / 4);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.8, start + edge);
    gain.gain.setValueAtTime(0.8, end - edge);
    gain.gain.linearRampToValueAtTime(0, end);
    source.connect(gain);
    gain.connect(master);
    nodes.set(source, gain);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      nodes.delete(source);
    };
    source.start(start);
    source.stop(end);
  }
  async function begin(
    exercise: Exercise,
    bpm: number,
    rolling: boolean,
  ): Promise<PlaybackTimes> {
    // Stop invalidates any older decode/fetch before creating this operation.
    stop();
    const token = generation;
    await prepare(exercise);
    if (!context || token !== generation) throw abortError();
    if (context.state !== "running") {
      interrupted("Audio context suspended; restart practice to continue.");
      throw abortError();
    }
    const clock = context;
    const secondsPerTick = 60 / bpm / 480;
    const startTime = clock.currentTime + 0.05;
    const endTime = startTime + exercise.totalTicks * secondsPerTick;
    const notes = exercise.events.filter((event) => event.kind === "note");
    const buffers = await Promise.all(
      notes.map((event) =>
        load(exercise.snapshot.sound, event.midi, controller.signal),
      ),
    );
    if (token !== generation) throw abortError();
    activeEnd = endTime;
    let next = 0;
    function fill() {
      if (token !== generation) return;
      while (next < notes.length) {
        const event = notes[next];
        const onset = startTime + event.onsetTicks * secondsPerTick;
        if (rolling && onset > clock.currentTime + 1) break;
        if (onset < clock.currentTime) {
          interrupted(
            "Routine interrupted: an audio scheduling deadline was missed. Restart from the beginning.",
          );
          return;
        }
        schedule(
          event,
          buffers[next],
          onset,
          Math.min(endTime, onset + event.durationTicks * secondsPerTick),
        );
        next++;
      }
      if (next === notes.length && refill !== undefined) {
        clearInterval(refill);
        refill = undefined;
      }
    }
    fill();
    if (rolling && next < notes.length && token === generation)
      refill = setInterval(fill, 100);
    return { startTime, endTime };
  }
  return {
    prepare,
    play: (exercise: Exercise) => begin(exercise, exercise.snapshot.bpm, false),
    playRoutine: (plan: RoutinePlan) =>
      begin(plan.exercise, plan.transportBpm, true),
    stop,
    setVolume(value: number) {
      if (!Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value));
      if (context && master)
        master.gain.setValueAtTime(volume, context.currentTime);
    },
    currentTime: () => context?.currentTime ?? 0,
    audibleTime() {
      if (!context) return 0;
      const timestamp = context.getOutputTimestamp?.();
      if (
        timestamp &&
        typeof timestamp.contextTime === "number" &&
        typeof timestamp.performanceTime === "number" &&
        timestamp.contextTime > 0 &&
        timestamp.performanceTime > 0
      )
        return Math.min(
          context.currentTime,
          timestamp.contextTime +
            Math.max(0, performance.now() - timestamp.performanceTime) / 1000,
        );
      return Math.max(
        0,
        context.currentTime -
          (context.outputLatency ?? context.baseLatency ?? 0),
      );
    },
    dispose() {
      stop();
      disposed = true;
      cache.clear();
      ready.clear();
      sampleLoader.dispose();
      if (context) {
        context.onstatechange = null;
        void context.close();
      }
      master?.disconnect();
      context = undefined;
      master = undefined;
    },
  };
}
export type EarTrainingPlayer = ReturnType<typeof createEarTrainingPlayer>;
