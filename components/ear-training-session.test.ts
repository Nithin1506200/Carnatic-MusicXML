import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, generateExercise } from "./ear-training-model";
import {
  INITIAL_SESSION,
  sessionReducer,
  spaceShortcutAllowed,
  type SessionState,
} from "./ear-training-session";
const exercise = generateExercise(DEFAULT_SETTINGS, [], () => 0, 41);
const loaded = (): SessionState =>
  sessionReducer(INITIAL_SESSION, {
    type: "load",
    exercise,
    revealed: false,
    now: 1000,
    newSession: true,
  });
describe("ear-training session lifecycle", () => {
  it("reveals while playing without cancelling sound state", () => {
    const state = sessionReducer(sessionReducer(loaded(), { type: "play" }), {
      type: "reveal",
    });
    expect(state.status).toBe("playing");
    expect(state.revealed).toBe(true);
    expect(
      sessionReducer(state, {
        type: "complete",
        key: "C major",
        recall: true,
        routine: false,
        now: 2000,
      }).status,
    ).toBe("ready");
  });
  it("early reveal exits recall and stop retains the exercise and visibility", () => {
    const recalling = sessionReducer(loaded(), {
      type: "complete",
      key: "C major",
      recall: true,
      routine: false,
      now: 2000,
    });
    expect(recalling.status).toBe("recalling");
    const visible = sessionReducer(recalling, { type: "reveal" });
    expect(visible.status).toBe("ready");
    const stopped = sessionReducer(visible, { type: "stop" });
    expect(stopped.exercise).toBe(exercise);
    expect(stopped.revealed).toBe(true);
  });
  it("counts an interrupted exercise on its first completed replay, once", () => {
    let state = sessionReducer(loaded(), { type: "stop" });
    expect(state.completed).toEqual([]);
    state = sessionReducer(state, {
      type: "load",
      exercise,
      revealed: false,
      now: 1500,
    });
    state = sessionReducer(state, {
      type: "complete",
      key: "C major",
      recall: false,
      routine: false,
      now: 2000,
    });
    state = sessionReducer(state, {
      type: "load",
      exercise,
      revealed: true,
      now: 2200,
    });
    state = sessionReducer(state, {
      type: "complete",
      key: "C major",
      recall: false,
      routine: false,
      now: 2500,
    });
    expect(state.completed).toEqual([41]);
    expect(state.keys).toEqual(["C major"]);
    expect(state.startedAt).toBe(1000);
  });
  it("retains an exercise after recoverable audio failure and timed replay can hide it", () => {
    let state = sessionReducer(loaded(), { type: "reveal" });
    state = sessionReducer(state, {
      type: "error",
      message: "Missing sample; retry",
    });
    expect(state.exercise).toBe(exercise);
    expect(state.error).toContain("retry");
    state = sessionReducer(state, {
      type: "load",
      exercise,
      revealed: false,
      now: 2000,
    });
    expect(state.revealed).toBe(false);
    expect(state.error).toBe("");
  });
  it("routine completion is separate from exercise counts and preserves holds on interruption", () => {
    let state = sessionReducer(loaded(), {
      type: "frame",
      activeNote: null,
      remaining: 6,
      phase: "Cooldown",
      phaseRemaining: 6,
      completedHolds: 42,
      routineSeconds: 294,
    });
    state = sessionReducer(state, { type: "stop" });
    expect(state.completedHolds).toBe(42);
    expect(state.routineComplete).toBe(false);
    state = sessionReducer(state, {
      type: "complete",
      key: "G major",
      recall: false,
      routine: true,
      now: 301000,
    });
    expect(state.routineComplete).toBe(true);
    expect(state.status).toBe("ended");
    expect(state.completed).toEqual([]);
  });
});
describe("Space shortcut guard", () => {
  class Target {
    constructor(public interactive = false) {}
    closest() {
      return this.interactive ? {} : null;
    }
  }
  vi.stubGlobal("Element", Target);
  vi.stubGlobal("document", { querySelector: () => null });
  const key = (patch: Record<string, unknown> = {}) =>
    ({
      code: "Space",
      target: new Target(),
      repeat: false,
      isComposing: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      ...patch,
    }) as unknown as KeyboardEvent;
  it("only handles a noninteractive Space during eligible practice", () => {
    expect(spaceShortcutAllowed(key(), true, loaded(), false)).toBe(false);
    const ready = { ...loaded(), status: "ready" as const };
    expect(spaceShortcutAllowed(key(), true, ready, false)).toBe(true);
    for (const patch of [
      { repeat: true },
      { isComposing: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { target: new Target(true) },
    ])
      expect(spaceShortcutAllowed(key(patch), true, ready, false)).toBe(false);
    expect(spaceShortcutAllowed(key(), false, ready, false)).toBe(false);
    expect(spaceShortcutAllowed(key(), true, ready, true)).toBe(false);
    vi.stubGlobal("document", { querySelector: () => ({}) });
    expect(spaceShortcutAllowed(key(), true, ready, false)).toBe(false);
  });
});
