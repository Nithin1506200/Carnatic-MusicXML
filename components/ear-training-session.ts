import type { Exercise } from "./ear-training-model";
export type SessionStatus =
  | "idle"
  | "loading"
  | "playing"
  | "recalling"
  | "ready"
  | "stopped"
  | "error"
  | "ended";
export interface SessionState {
  status: SessionStatus;
  exercise: Exercise | null;
  revealed: boolean;
  error: string;
  completed: readonly number[];
  keys: readonly string[];
  startedAt: number | null;
  endedAt: number | null;
  activeNote: number | null;
  remaining: number;
  phase: string;
  phaseRemaining: number;
  completedHolds: number;
  routineSeconds: number;
  routineComplete: boolean;
}
export const INITIAL_SESSION: SessionState = {
  status: "idle",
  exercise: null,
  revealed: false,
  error: "",
  completed: [],
  keys: [],
  startedAt: null,
  endedAt: null,
  activeNote: null,
  remaining: 0,
  phase: "",
  phaseRemaining: 0,
  completedHolds: 0,
  routineSeconds: 0,
  routineComplete: false,
};
export type SessionAction =
  | {
      type: "load";
      exercise: Exercise;
      revealed: boolean;
      now: number;
      newSession?: boolean;
    }
  | { type: "play" }
  | {
      type: "frame";
      activeNote: number | null;
      remaining: number;
      phase: string;
      phaseRemaining: number;
      completedHolds: number;
      routineSeconds: number;
    }
  | {
      type: "complete";
      key: string;
      recall: boolean;
      routine: boolean;
      now: number;
    }
  | { type: "reveal" }
  | { type: "recall"; remaining: number }
  | { type: "stop" }
  | { type: "end"; now: number }
  | { type: "error"; message: string }
  | { type: "reset" };
export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "reset":
      return INITIAL_SESSION;
    case "load":
      return {
        ...(action.newSession ? INITIAL_SESSION : state),
        status: "loading",
        exercise: action.exercise,
        revealed: action.revealed,
        error: "",
        startedAt: action.newSession
          ? action.now
          : (state.startedAt ?? action.now),
        activeNote: null,
        remaining: 0,
        phase: "",
        completedHolds: 0,
        routineSeconds: 0,
        routineComplete: false,
      };
    case "play":
      return { ...state, status: "playing" };
    case "frame": {
      const { type: _, ...values } = action;
      void _;
      return { ...state, ...values };
    }
    case "reveal":
      return {
        ...state,
        revealed: true,
        status: state.status === "recalling" ? "ready" : state.status,
        remaining: 0,
      };
    case "recall":
      return { ...state, status: "recalling", remaining: action.remaining };
    case "stop":
      return { ...state, status: "stopped", activeNote: null, remaining: 0 };
    case "end":
      return {
        ...state,
        status: "ended",
        endedAt: action.now,
        activeNote: null,
        remaining: 0,
      };
    case "error":
      return {
        ...state,
        status: "error",
        error: action.message,
        activeNote: null,
      };
    case "complete": {
      if (!state.exercise) return state;
      const counted = state.completed.includes(state.exercise.id);
      return {
        ...state,
        status: action.routine
          ? "ended"
          : action.recall && !state.revealed
            ? "recalling"
            : "ready",
        activeNote: null,
        completed:
          action.routine || counted
            ? state.completed
            : [...state.completed, state.exercise.id],
        keys:
          action.routine || counted || state.keys.includes(action.key)
            ? state.keys
            : [...state.keys, action.key],
        routineComplete: action.routine,
        endedAt: action.routine ? action.now : state.endedAt,
      };
    }
  }
}
export function spaceShortcutAllowed(
  event: KeyboardEvent,
  enabled: boolean,
  state: SessionState,
  routine: boolean,
): boolean {
  if (
    !enabled ||
    routine ||
    !state.exercise ||
    ["idle", "loading", "error", "ended"].includes(state.status) ||
    event.code !== "Space" ||
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  )
    return false;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'input,select,textarea,button,a,summary,[contenteditable]:not([contenteditable="false"]),[role="tab"],[role="menuitem"],[role="button"],[role="dialog"],[role="combobox"],[role="slider"],[role="checkbox"],[role="switch"]',
    )
  )
    return false;
  return !document.querySelector(
    'dialog[open],[role="dialog"][aria-modal="true"]',
  );
}
