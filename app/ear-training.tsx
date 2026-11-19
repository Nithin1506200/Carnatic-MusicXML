import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createEarTrainingPlayer } from "../components/ear-training-audio";
import {
  DEFAULT_SETTINGS,
  SCALE_NAMES,
  chordLabel,
  generateExercise,
  generateRoutine,
  keyLabel,
  spellPitch,
  validateSettings,
  type CustomPattern,
  type Exercise,
  type KeyScale,
  type RoutinePlan,
  type ScaleId,
  type Settings,
} from "../components/ear-training-model";
import {
  presetError,
  presetRegistry,
} from "../components/ear-training-presets";
import sampleManifest from "../data/ear_training_samples.json";
import { EarTrainingIcon } from "../components/ear-training-icons";
import EarTrainingStaff from "../components/ear-training-staff";
import {
  INITIAL_SESSION,
  sessionReducer,
  spaceShortcutAllowed,
} from "../components/ear-training-session";

const SETTINGS_TABS = ["practice", "melody", "rhythm", "patterns"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

const ROOTS = [
  "C",
  "C# / Db",
  "D",
  "D# / Eb",
  "E",
  "F",
  "F# / Gb",
  "G",
  "G# / Ab",
  "A",
  "A# / Bb",
  "B",
];
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
function patternReducer(
  state: CustomPattern[],
  action:
    | { type: "save"; pattern: CustomPattern }
    | { type: "remove"; id: string }
    | { type: "reset" },
) {
  if (action.type === "reset") return [];
  return action.type === "remove"
    ? state.filter((p) => p.id !== action.id)
    : [...state.filter((p) => p.id !== action.pattern.id), action.pattern];
}
function initialReveal(exercise: Exercise) {
  const s = exercise.snapshot;
  return (
    s.exerciseMode === "long-tone" ||
    (s.exerciseMode !== "timed" &&
      (s.visibility === "always" ||
        (s.firstNoteHint &&
          exercise.events.filter((e) => e.kind === "note").length === 1)))
  );
}

export default function EarTraining({
  shortcutsEnabled = true,
}: {
  shortcutsEnabled?: boolean;
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("practice");
  const [settings, setSettings] = useState<Settings>(() =>
    structuredClone(DEFAULT_SETTINGS),
  );
  const [state, dispatch] = useReducer(sessionReducer, INITIAL_SESSION);
  const [customPatterns, patternsDispatch] = useReducer(patternReducer, []);
  const [routinePlan, setRoutinePlan] = useState<RoutinePlan | null>(null);
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [keyRoot, setKeyRoot] = useState(0);
  const [keyScale, setKeyScale] = useState<ScaleId>("major");
  const [patternName, setPatternName] = useState("");
  const [patternDegrees, setPatternDegrees] = useState("");
  const [patternRhythm, setPatternRhythm] = useState("automatic");
  const [editingPattern, setEditingPattern] = useState<string | null>(null);
  const [patternError, setPatternError] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [keepSettings, setKeepSettings] = useState(false);
  const player = useRef<ReturnType<typeof createEarTrainingPlayer> | null>(
    null,
  );
  const operation = useRef(0);
  const frame = useRef(0);
  const revealed = useRef(false);
  const routineRef = useRef<RoutinePlan | null>(null);
  const nextId = useRef(1);
  const mounted = useRef(true);
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const updateMelody = (patch: Partial<Settings["melody"]>) =>
    setSettings((s) => ({ ...s, melody: { ...s.melody, ...patch } }));
  const updateLong = (patch: Partial<Settings["longTone"]>) =>
    setSettings((s) => ({ ...s, longTone: { ...s.longTone, ...patch } }));
  const cancel = useCallback(() => {
    operation.current++;
    cancelAnimationFrame(frame.current);
    player.current?.stop();
  }, []);
  const stop = useCallback(() => {
    cancel();
    dispatch({ type: "stop" });
  }, [cancel]);
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (
        document.hidden &&
        stateRef.current.exercise &&
        stateRef.current.status !== "ended"
      )
        stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false;
      cancel();
      player.current?.dispose();
      player.current = null;
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [cancel, stop]);
  useEffect(() => {
    player.current?.setVolume(muted ? 0 : volume);
  }, [volume, muted]);
  const reveal = useCallback(() => {
    revealed.current = true;
    dispatch({ type: "reveal" });
  }, []);
  async function play(
    exercise: Exercise,
    routine: RoutinePlan | null,
    replay: boolean,
    newSession = false,
  ) {
    cancel();
    const token = operation.current;
    routineRef.current = routine;
    setRoutinePlan(routine);
    const shouldReveal =
      replay && exercise.snapshot.exerciseMode !== "timed"
        ? state.revealed || initialReveal(exercise)
        : initialReveal(exercise);
    revealed.current = shouldReveal;
    dispatch({
      type: "load",
      exercise,
      revealed: shouldReveal,
      now: Date.now(),
      newSession,
    });
    if (!player.current)
      player.current = createEarTrainingPlayer({
        onInterrupted: () => {
          if (mounted.current) stop();
        },
      });
    const engine = player.current;
    engine.setVolume(muted ? 0 : volume);
    try {
      await engine.prepare(exercise);
      if (token !== operation.current || !mounted.current) return;
      const timing = routine
        ? await engine.playRoutine(routine)
        : await engine.play(exercise);
      if (token !== operation.current || !mounted.current) return;
      dispatch({ type: "play" });
      let complete = false,
        previousFrame = "";
      const bpm = routine?.transportBpm ?? exercise.snapshot.bpm;
      const secondsPerTick = 60 / bpm / 480;
      const tick = () => {
        if (token !== operation.current || !mounted.current) return;
        const now = engine.audibleTime();
        const elapsed = Math.max(0, now - timing.startTime);
        const elapsedTicks = elapsed / secondsPerTick;
        const current = exercise.events.find(
          (e) =>
            elapsedTicks >= e.onsetTicks &&
            elapsedTicks < e.onsetTicks + e.durationTicks,
        );
        const notes = exercise.events.filter((e) => e.kind === "note");
        const active = current?.kind === "note" ? current.noteIndex : null;
        const completedHolds = notes.filter(
          (e) => elapsedTicks >= e.onsetTicks + e.durationTicks,
        ).length;
        const next = notes.find((e) => e.onsetTicks > elapsedTicks);
        let phase = "",
          phaseRemaining = 0;
        if (exercise.source === "long-tone") {
          phase =
            current?.kind === "note"
              ? "Hold"
              : elapsedTicks < (notes[0]?.onsetTicks ?? 0)
                ? "Prepare"
                : routine &&
                    elapsedTicks >=
                      exercise.totalTicks - routine.cooldownMs * 0.48
                  ? "Cooldown"
                  : "Rest";
          phaseRemaining = current
            ? (current.onsetTicks + current.durationTicks - elapsedTicks) *
              secondsPerTick
            : Math.max(0, timing.startTime - now);
          if (next && phase === "Rest")
            phase += ` · next ${spellPitch(next.midi, exercise.keyScale, settingsRef.current.pitchView).name}`;
        }
        const frameKey = `${active}:${Math.ceil(timing.endTime - now)}:${phase}:${Math.ceil(phaseRemaining)}:${completedHolds}`;
        if (frameKey !== previousFrame) {
          previousFrame = frameKey;
          dispatch({
            type: "frame",
            activeNote: active,
            remaining: Math.max(0, timing.endTime - now),
            phase,
            phaseRemaining: Math.max(0, phaseRemaining),
            completedHolds,
            routineSeconds: Math.min(
              elapsed,
              timing.endTime - timing.startTime,
            ),
          });
        }
        if (now >= timing.endTime && !complete) {
          complete = true;
          const delayed =
            exercise.snapshot.exerciseMode === "timed" ||
            exercise.snapshot.visibility === "delayed";
          dispatch({
            type: "complete",
            key: keyLabel(exercise.keyScale, "concert"),
            recall: delayed,
            routine: !!routine,
            now: Date.now(),
          });
          if (routine) {
            engine.stop();
            return;
          }
          if (revealed.current || !delayed) return;
        }
        if (complete) {
          if (revealed.current) return;
          const remaining =
            timing.endTime + exercise.snapshot.recallSeconds - now;
          if (remaining <= 0) {
            reveal();
            return;
          }
          dispatch({ type: "recall", remaining });
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch (error) {
      if (token !== operation.current || !mounted.current) return;
      engine.stop();
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  function start(newSession = false) {
    // A failed Next preserves the retained exercise, but cannot leave old playback running.
    cancel();
    try {
      const routine =
        settings.exerciseMode === "long-tone" &&
        settings.longTone.practice === "routine"
          ? generateRoutine(settings)
          : null;
      const errors = routine ? [] : validateSettings(settings, customPatterns);
      setValidation(errors);
      if (errors.length) {
        if (state.exercise) dispatch({ type: "stop" });
        return;
      }
      const exercise =
        routine?.exercise ??
        generateExercise(
          settings,
          customPatterns,
          Math.random,
          nextId.current++,
        );
      void play(exercise, routine, false, newSession);
    } catch (error) {
      setValidation([error instanceof Error ? error.message : String(error)]);
      if (state.exercise) dispatch({ type: "stop" });
    }
  }
  const routineActive =
    !!routinePlan &&
    !!state.exercise &&
    state.status !== "idle" &&
    state.status !== "ended";
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!spaceShortcutAllowed(event, shortcutsEnabled, state, routineActive))
        return;
      event.preventDefault();
      if (!state.revealed) reveal();
      else start();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  function end() {
    cancel();
    dispatch({ type: "end", now: Date.now() });
  }
  function newSession() {
    cancel();
    routineRef.current = null;
    setRoutinePlan(null);
    if (!keepSettings) {
      setSettings(structuredClone(DEFAULT_SETTINGS));
      patternsDispatch({ type: "reset" });
      setEditingPattern(null);
      setPatternName("");
      setPatternDegrees("");
      setPatternRhythm("automatic");
      setPatternError("");
    }
    dispatch({ type: "reset" });
    setValidation([]);
  }
  function savePattern() {
    const raw = patternDegrees.trim();
    if (!raw || !/^\d+(?:[\s,-]+\d+)*$/.test(raw)) {
      setPatternError(
        "Enter positive scale degrees separated by spaces, commas, or hyphens.",
      );
      return;
    }
    const degrees = raw.split(/[\s,-]+/).map(Number);
    if (
      !patternName.trim() ||
      degrees.length > 16 ||
      degrees.some((d) => !Number.isInteger(d) || d < 1 || d > 28)
    ) {
      setPatternError(
        "Give the pattern a name and 1–16 degrees, each from 1 to 28.",
      );
      return;
    }
    const rhythm = presetRegistry.rhythms.find((r) => r.id === patternRhythm);
    if (
      patternRhythm !== "automatic" &&
      rhythm?.events.filter((e) => e.kind === "note").length !== degrees.length
    ) {
      setPatternError(
        "Choose a rhythm with the same number of note attacks as degrees.",
      );
      return;
    }
    const id = editingPattern?.startsWith("custom_")
      ? editingPattern
      : `custom_${nextId.current++}`;
    patternsDispatch({
      type: "save",
      pattern: {
        id,
        name: patternName.trim(),
        degrees,
        rhythmId: patternRhythm,
      },
    });
    setSettings((s) => ({
      ...s,
      enabledPatternIds: [
        ...new Set([
          ...s.enabledPatternIds.filter((p) => p !== editingPattern),
          id,
        ]),
      ],
    }));
    setPatternError("");
    setEditingPattern(null);
    setPatternName("");
    setPatternDegrees("");
  }
  const displayNote = (
    midi: number,
    key: KeyScale = settings.keyScales[0] ?? {
      tonicPc: 0,
      scaleId: "chromatic",
    },
  ) =>
    settings.pitchView === "alto-eb" && midi === 49
      ? "Bb3"
      : spellPitch(midi, key, settings.pitchView).name;
  const pitchOptions = Array.from(
    { length: settings.pitchView === "alto-eb" ? 119 : 128 },
    (_, midi) => (
      <option key={midi} value={midi}>
        {displayNote(midi)}
      </option>
    ),
  );
  const keyInputView = settings.sound === "saxophone" ? "alto-eb" : "concert";
  const isLong = settings.exerciseMode === "long-tone";
  const isRoutine = isLong && settings.longTone.practice === "routine";
  const isPhrase = settings.exerciseMode === "phrase";
  const isTimed = settings.exerciseMode === "timed";
  const melodyControlsEnabled =
    isPhrase && settings.generationMode !== "patterns";
  const melodicStyleEnabled =
    melodyControlsEnabled && settings.melody.style === "melodic";
  const nextVariation = settings.melody.randomizeVariation
    ? `random ${settings.melody.variationMin}–${settings.melody.variationMax}`
    : `${settings.melody.variation}/100`;
  let preview: RoutinePlan | null = null,
    previewError = "";
  if (isRoutine)
    try {
      preview = generateRoutine(settings);
    } catch (error) {
      previewError = String(error);
    }
  const loading = state.status === "loading";
  const ended = state.status === "ended";
  const active = !!state.exercise && !ended;
  const targetNotes =
    state.exercise?.events.filter((e) => e.kind === "note") ?? [];
  const targetNote =
    targetNotes.find((e) => e.noteIndex === state.activeNote) ??
    targetNotes[Math.min(state.completedHolds, targetNotes.length - 1)];
  const allPatterns = [...presetRegistry.patterns, ...customPatterns];
  const toggle = (list: readonly string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
  if (presetError)
    return (
      <section className="ear-training">
        <h1>Ear Training</h1>
        <p role="alert">
          The practice presets could not be loaded: {presetError}
        </p>
      </section>
    );
  return (
    <section className="ear-training">
      <header className="ear-training-header">
        <div className="ear-training-brand">
          <span className="ear-training-logo">
            <EarTrainingIcon name="ear" />
          </span>
          <div>
            <p className="ear-training-eyebrow">LISTEN · RECALL · PLAY</p>
            <h1>Ear Training</h1>
            <p>Listen, play it back, then reveal.</p>
          </div>
        </div>
        <span className="ear-training-badge">Western notation</span>
      </header>
      {ended ? (
        <section
          className="ear-training-summary"
          aria-labelledby="practice-summary"
        >
          <h2 id="practice-summary">
            {routinePlan ? "Routine results" : "Session summary"}
          </h2>
          {routinePlan ? (
            <>
              <p>
                {state.routineComplete
                  ? "Routine completed"
                  : "Routine interrupted"}
              </p>
              <dl>
                <div>
                  <dt>Complete reference holds</dt>
                  <dd>
                    {state.completedHolds} / {routinePlan.holdCount}
                  </dd>
                </div>
                <div>
                  <dt>Active practice time</dt>
                  <dd>{formatTime(state.routineSeconds)}</dd>
                </div>
                <div>
                  <dt>Planned duration</dt>
                  <dd>{formatTime(routinePlan.exercise.totalTicks / 480)}</dd>
                </div>
              </dl>
              <p>
                Reference playback is practice activity; it does not measure
                your sustained tone.
              </p>
            </>
          ) : (
            <>
              <dl>
                <div>
                  <dt>Exercises played</dt>
                  <dd>{state.completed.length}</dd>
                </div>
                <div>
                  <dt>Session time</dt>
                  <dd>
                    {formatTime(
                      ((state.endedAt ?? 0) - (state.startedAt ?? 0)) / 1000,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Keys and scales used (concert)</dt>
                  <dd>{state.keys.join(", ") || "No completed exercises"}</dd>
                </div>
              </dl>
              <p>
                This records practice activity, without scoring your
                performance.
              </p>
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={keepSettings}
              onChange={(e) => setKeepSettings(e.target.checked)}
            />{" "}
            Keep current settings for a new session
          </label>
          <button type="button" onClick={newSession}>
            New session
          </button>
        </section>
      ) : (
        <>
          <div className="ear-training-workspace">
            <section
              className="ear-training-practice"
              aria-label="Current exercise"
            >
              <div className="ear-training-context">
                <strong>
                  {state.exercise
                    ? keyLabel(state.exercise.keyScale, settings.pitchView)
                    : settings.keyScales.length
                      ? settings.keyScales
                          .map((key) => keyLabel(key, settings.pitchView))
                          .join(" · ")
                      : "Random key & scale"}
                </strong>
                <span>
                  {settings.pitchView === "concert"
                    ? "Concert pitch"
                    : "E-flat alto written pitch"}
                </span>
              </div>
              {settings.sound === "saxophone" &&
                (state.exercise || settings.keyScales.length > 0) && (
                  <p className="ear-training-panel-note">
                    {(state.exercise
                      ? [state.exercise.keyScale]
                      : settings.keyScales
                    )
                      .map(
                        (key) =>
                          `${keyLabel(key, "alto-eb")} written → ${keyLabel(key, "concert")} sounding`,
                      )
                      .join(" · ")}
                  </p>
                )}
              {state.exercise?.melody && (
                <div className="ear-training-melody-context">
                  <span>
                    Current phrase: {state.exercise.melody.variation}/100
                  </span>
                  {melodicStyleEnabled && (
                    <span>Next generated phrase: {nextVariation}</span>
                  )}
                  {state.exercise.melody.chords.length > 0 && (
                    <span>
                      Harmony:{" "}
                      {state.exercise.melody.chords
                        .map((chord) => chordLabel(chord, settings.pitchView))
                        .join(" → ")}
                    </span>
                  )}
                </div>
              )}
              {state.exercise ? (
                <EarTrainingStaff
                  exercise={state.exercise}
                  pitchView={settings.pitchView}
                  revealed={state.revealed}
                  firstNoteHint={
                    state.exercise.snapshot.exerciseMode !== "timed" &&
                    state.exercise.snapshot.firstNoteHint
                  }
                  noteNames={settings.noteNames}
                  activeNoteIndex={state.activeNote}
                  targetNoteIndex={
                    state.exercise.source === "long-tone"
                      ? targetNote?.noteIndex
                      : null
                  }
                />
              ) : (
                <div className="ear-training-welcome">
                  <span aria-hidden="true">♫</span>
                  <h2>Ready to listen</h2>
                  <p>Press Start for a new phrase.</p>
                </div>
              )}
              <div className="ear-training-status" role="status">
                {loading
                  ? "Loading instrument samples…"
                  : state.status === "error"
                    ? "Audio could not start"
                    : state.status === "recalling"
                      ? `Recall · ${Math.ceil(state.remaining)} seconds`
                      : state.status === "playing"
                        ? state.exercise?.source === "long-tone"
                          ? `${state.phase} · ${Math.ceil(state.phaseRemaining)}s`
                          : "Listening…"
                        : state.status === "stopped"
                          ? "Stopped — your exercise is retained"
                          : state.status === "ready"
                            ? state.revealed
                              ? "Compare your attempt, then continue"
                              : "Try it yourself, then reveal"
                            : "No recording or grading. Just listening and practice."}
              </div>
              {state.exercise?.source === "long-tone" && targetNote && (
                <p className="ear-training-progress">
                  <strong>
                    Target:{" "}
                    {displayNote(targetNote.midi, state.exercise.keyScale)}
                  </strong>
                </p>
              )}
              {routineActive && (
                <p className="ear-training-progress">
                  Reference{" "}
                  {Math.min(
                    (state.activeNote ?? state.completedHolds) + 1,
                    routinePlan!.holdCount,
                  )}{" "}
                  of {routinePlan!.holdCount} · {Math.ceil(state.remaining)}{" "}
                  seconds remaining · {state.completedHolds} complete holds
                </p>
              )}
              {state.error && state.status === "error" && (
                <div role="alert">
                  <p>{state.error}</p>
                  <button
                    type="button"
                    onClick={() =>
                      state.exercise &&
                      void play(state.exercise, routineRef.current, true)
                    }
                  >
                    Retry audio
                  </button>
                </div>
              )}
              <div className="ear-training-transport">
                <div className="ear-training-actions">
                  {!active && (
                    <button
                      className="ear-training-primary"
                      type="button"
                      onClick={() => start(true)}
                    >
                      <EarTrainingIcon name="play" />
                      {isRoutine ? "Start routine" : "Start"}
                    </button>
                  )}
                  {active && (
                    <>
                      <button
                        className="ear-training-primary"
                        type="button"
                        disabled={loading || state.revealed || routineActive}
                        onClick={reveal}
                      >
                        <EarTrainingIcon name="reveal" />
                        Show notes
                      </button>
                      <button
                        type="button"
                        disabled={loading || routineActive}
                        onClick={() => void play(state.exercise!, null, true)}
                      >
                        <EarTrainingIcon name="replay" />
                        Replay
                      </button>
                      <button
                        type="button"
                        disabled={loading || routineActive}
                        onClick={() => start()}
                      >
                        <EarTrainingIcon name="next" />
                        Next
                      </button>
                      <button type="button" onClick={stop}>
                        <EarTrainingIcon name="stop" />
                        Stop
                      </button>
                      {routineActive && (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => start()}
                        >
                          <EarTrainingIcon name="replay" />
                          Restart routine
                        </button>
                      )}
                      <button type="button" onClick={end}>
                        <EarTrainingIcon name="end" />
                        End session
                      </button>
                    </>
                  )}
                </div>
                <div
                  className="ear-training-display-bar"
                  role="group"
                  aria-label="Display options"
                >
                  <label>
                    Notation view
                    <select
                      value={settings.pitchView}
                      onChange={(e) =>
                        update(
                          "pitchView",
                          e.target.value as Settings["pitchView"],
                        )
                      }
                    >
                      <option value="alto-eb">E-flat alto written pitch</option>
                      <option value="concert">Concert pitch</option>
                    </select>
                  </label>
                  <label>
                    Visibility
                    <select
                      disabled={isLong || isTimed}
                      value={
                        isLong
                          ? "always"
                          : isTimed
                            ? "delayed"
                            : settings.visibility
                      }
                      onChange={(e) =>
                        update(
                          "visibility",
                          e.target.value as Settings["visibility"],
                        )
                      }
                    >
                      <option value="request">Reveal on request</option>
                      <option value="always">Always visible</option>
                      <option value="delayed">Reveal after a delay</option>
                    </select>
                  </label>
                  {!isLong &&
                    (isTimed || settings.visibility === "delayed") && (
                      <label title="Starts after playback finishes">
                        Recall (seconds)
                        <input
                          aria-label="Recall period (seconds)"
                          type="number"
                          min="1"
                          max="60"
                          value={settings.recallSeconds}
                          onChange={(e) =>
                            update("recallSeconds", Number(e.target.value))
                          }
                        />
                      </label>
                    )}
                  <label
                    className="ear-training-check"
                    title="For one-note exercises, this reveals the whole answer. Applies to the next exercise."
                  >
                    <input
                      type="checkbox"
                      disabled={isLong || isTimed}
                      checked={!isLong && !isTimed && settings.firstNoteHint}
                      onChange={(e) =>
                        update("firstNoteHint", e.target.checked)
                      }
                    />
                    First-note hint
                  </label>
                  <label className="ear-training-check">
                    <input
                      type="checkbox"
                      checked={settings.noteNames}
                      onChange={(e) => update("noteNames", e.target.checked)}
                    />
                    Note names
                  </label>
                </div>
                <div className="ear-training-volume">
                  <label>
                    Volume{" "}
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume}
                      onChange={(e) => setVolume(Number(e.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    aria-pressed={muted}
                    onClick={() => setMuted((m) => !m)}
                  >
                    <EarTrainingIcon name={muted ? "muted" : "volume"} />
                    {muted ? "Unmute" : "Mute"}
                  </button>
                </div>
              </div>
              {active && !routineActive && (
                <p className="ear-training-shortcut">
                  <kbd>Space</kbd>{" "}
                  {state.revealed ? "next exercise" : "reveal notes"} · Settings
                  apply to the next exercise; replay keeps the original sound
                  and timing.
                </p>
              )}

              {isLong && (
                <details className="ear-training-help">
                  <summary>Long-tone tips</summary>
                  <p className="ear-training-note">
                    Prepare, hold the target as long as comfortable, then rest.
                    Stop at any time. Piano uses a sampled sustain for longer
                    holds.
                  </p>
                </details>
              )}
            </section>
            <section
              className="ear-training-settings"
              aria-label="Practice settings"
            >
              <div className="ear-training-settings-heading">
                <h2>Practice settings</h2>
                <span>Changes apply to the next exercise</span>
              </div>
              <div
                className="ear-training-tabs"
                role="tablist"
                aria-label="Practice settings categories"
              >
                {SETTINGS_TABS.map((tab, index) => (
                  <button
                    key={tab}
                    id={`ear-training-tab-${tab}`}
                    type="button"
                    role="tab"
                    aria-selected={settingsTab === tab}
                    aria-controls={`ear-training-panel-${tab}`}
                    tabIndex={settingsTab === tab ? 0 : -1}
                    onClick={() => setSettingsTab(tab)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowRight")
                        next = (index + 1) % SETTINGS_TABS.length;
                      else if (event.key === "ArrowLeft")
                        next =
                          (index + SETTINGS_TABS.length - 1) %
                          SETTINGS_TABS.length;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End")
                        next = SETTINGS_TABS.length - 1;
                      else return;
                      event.preventDefault();
                      setSettingsTab(SETTINGS_TABS[next]);
                      document
                        .getElementById(
                          `ear-training-tab-${SETTINGS_TABS[next]}`,
                        )
                        ?.focus();
                    }}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              {settingsTab === "practice" && (
                <div
                  className="ear-training-tab-panel"
                  id="ear-training-panel-practice"
                  role="tabpanel"
                  aria-labelledby="ear-training-tab-practice"
                  tabIndex={0}
                >
                  <div className="ear-training-controls-grid">
                    <label>
                      Exercise
                      <select
                        value={settings.exerciseMode}
                        onChange={(e) =>
                          update(
                            "exerciseMode",
                            e.target.value as Settings["exerciseMode"],
                          )
                        }
                      >
                        <option value="phrase">Phrase practice</option>
                        <option value="single">Single note</option>
                        <option value="timed">
                          Timed single-note self-check
                        </option>
                        <option value="long-tone">Long tones</option>
                      </select>
                    </label>
                    <label>
                      <span className="ear-training-label-icon">
                        <EarTrainingIcon name={settings.sound} />
                        Sound
                      </span>
                      <select
                        value={settings.sound}
                        onChange={(e) =>
                          setSettings((current) => ({
                            ...current,
                            sound: e.target.value as Settings["sound"],
                            pitchView:
                              e.target.value === "saxophone"
                                ? "alto-eb"
                                : "concert",
                          }))
                        }
                      >
                        <option value="piano">Piano</option>
                        <option value="saxophone">Saxophone</option>
                      </select>
                    </label>
                    {!isRoutine && (
                      <>
                        <label>
                          Tempo (BPM)
                          <input
                            type="number"
                            min="40"
                            max="200"
                            value={settings.bpm}
                            onChange={(e) =>
                              update("bpm", Number(e.target.value))
                            }
                          />
                        </label>
                        {!isLong && (
                          <>
                            <label>
                              Number of notes
                              <input
                                type="number"
                                min="1"
                                max="16"
                                disabled={!isPhrase}
                                value={isPhrase ? settings.noteCount : 1}
                                onChange={(e) =>
                                  update("noteCount", Number(e.target.value))
                                }
                              />
                            </label>
                            <label>
                              Generation
                              <select
                                disabled={!isPhrase}
                                value={
                                  isPhrase ? settings.generationMode : "random"
                                }
                                onChange={(e) =>
                                  update(
                                    "generationMode",
                                    e.target
                                      .value as Settings["generationMode"],
                                  )
                                }
                              >
                                <option value="random">Random</option>
                                <option value="patterns">Patterns</option>
                                <option value="mixed">Mixed (50 / 50)</option>
                              </select>
                            </label>
                          </>
                        )}
                      </>
                    )}
                    {isLong && (
                      <>
                        <label>
                          Long-tone practice
                          <select
                            value={settings.longTone.practice}
                            onChange={(e) =>
                              updateLong({
                                practice: e.target.value as
                                  "manual" | "routine",
                              })
                            }
                          >
                            <option value="manual">Manual rounds</option>
                            <option value="routine">Preset routine</option>
                          </select>
                        </label>
                        {isRoutine ? (
                          <>
                            <label>
                              Routine
                              <select
                                value={settings.longTone.routineId}
                                onChange={(e) =>
                                  updateLong({ routineId: e.target.value })
                                }
                              >
                                {presetRegistry.routines.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {previewError && <p role="alert">{previewError}</p>}
                            {preview && (
                              <>
                                <p className="ear-training-panel-note">
                                  {formatTime(preview.totalMs / 1000)} ·{" "}
                                  {preview.holdCount} notes · hold{" "}
                                  {preview.routine.holdMs / 1000}s / rest{" "}
                                  {preview.routine.restMs / 1000}s ·{" "}
                                  {preview.cooldownMs / 1000}s cooldown
                                </p>
                                <p className="ear-training-panel-note">
                                  {keyLabel(
                                    preview.exercise.keyScale,
                                    settings.pitchView,
                                  )}{" "}
                                  · source{" "}
                                  {preview.routine.pitchBasis === "alto-eb"
                                    ? "alto written"
                                    : "concert"}{" "}
                                  · sequence {preview.routine.degrees.join("–")}{" "}
                                  · preparation {preview.preparationMs / 1000}s.
                                  Runs automatically; restart to apply changes.
                                </p>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <label>
                              Target
                              <select
                                value={settings.longTone.target}
                                onChange={(e) =>
                                  updateLong({
                                    target: e.target.value as
                                      "fixed" | "random",
                                  })
                                }
                              >
                                <option value="fixed">Fixed note</option>
                                <option value="random">Random note</option>
                              </select>
                            </label>
                            {settings.longTone.target === "fixed" && (
                              <>
                                <label>
                                  Fixed target
                                  <select
                                    value={settings.longTone.targetMidi}
                                    onChange={(e) =>
                                      updateLong({
                                        targetMidi: Number(e.target.value),
                                      })
                                    }
                                  >
                                    {pitchOptions}
                                  </select>
                                </label>
                              </>
                            )}
                            <label>
                              Hold
                              <select
                                value={settings.longTone.holdBeats}
                                onChange={(e) =>
                                  updateLong({
                                    holdBeats: Number(e.target.value) as
                                      4 | 8 | 16,
                                  })
                                }
                              >
                                {[4, 8, 16].map((beats) => (
                                  <option key={beats} value={beats}>
                                    {beats} beats (
                                    {((beats * 60) / settings.bpm).toFixed(1)}s)
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Recovery
                              <select
                                value={settings.longTone.recoveryBeats}
                                onChange={(e) =>
                                  updateLong({
                                    recoveryBeats: Number(e.target.value) as
                                      0 | 4 | 8,
                                  })
                                }
                              >
                                {[0, 4, 8].map((beats) => (
                                  <option key={beats} value={beats}>
                                    {beats} beats (
                                    {((beats * 60) / settings.bpm).toFixed(1)}s)
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p className="ear-training-panel-note">
                              Two preparation beats. Stop whenever you need.
                            </p>
                          </>
                        )}
                      </>
                    )}
                    <p className="ear-training-panel-note">
                      {settings.keyScales.length
                        ? settings.keyScales
                            .map((key) => keyLabel(key, settings.pitchView))
                            .join(" · ")
                        : "Random key & scale"}{" "}
                      · {displayNote(settings.lowMidi)}–
                      {displayNote(settings.highMidi)} ·{" "}
                      {settings.rhythmMode === "varied"
                        ? "Varied rhythm"
                        : "Even notes"}{" "}
                      <button
                        type="button"
                        onClick={() => setSettingsTab("melody")}
                      >
                        Edit melody
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettingsTab("rhythm")}
                      >
                        Edit rhythm
                      </button>
                    </p>
                  </div>
                </div>
              )}
              {settingsTab === "melody" && (
                <div
                  className="ear-training-tab-panel"
                  id="ear-training-panel-melody"
                  role="tabpanel"
                  aria-labelledby="ear-training-tab-melody"
                  tabIndex={0}
                >
                  <div className="ear-training-melody-grid">
                    <fieldset>
                      <legend>Selected combinations</legend>
                      <div className="ear-training-tags">
                        {!settings.keyScales.length && (
                          <span className="ear-training-random-chip">
                            Random key &amp; scale
                          </span>
                        )}
                        {settings.keyScales.map((key, index) => (
                          <button
                            type="button"
                            key={`${key.tonicPc}-${key.scaleId}`}
                            aria-label={`Remove ${keyLabel(key, keyInputView)}`}
                            onClick={() =>
                              update(
                                "keyScales",
                                settings.keyScales.filter(
                                  (_, i) => i !== index,
                                ),
                              )
                            }
                          >
                            {keyLabel(key, keyInputView)} ×
                          </button>
                        ))}
                      </div>
                      <div className="ear-training-fields">
                        <label>
                          Key (
                          {keyInputView === "alto-eb"
                            ? "alto written"
                            : "concert"}
                          )
                          <select
                            value={
                              (keyRoot + (keyInputView === "alto-eb" ? 9 : 0)) %
                              12
                            }
                            onChange={(e) =>
                              setKeyRoot(
                                (Number(e.target.value) -
                                  (keyInputView === "alto-eb" ? 9 : 0) +
                                  12) %
                                  12,
                              )
                            }
                          >
                            {ROOTS.map((root, pc) => (
                              <option key={pc} value={pc}>
                                {root}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Scale
                          <select
                            value={keyScale}
                            onChange={(e) =>
                              setKeyScale(e.target.value as ScaleId)
                            }
                          >
                            {Object.entries(SCALE_NAMES).map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            !settings.keyScales.some(
                              (k) =>
                                k.tonicPc === keyRoot && k.scaleId === keyScale,
                            )
                          )
                            update("keyScales", [
                              ...settings.keyScales,
                              { tonicPc: keyRoot, scaleId: keyScale },
                            ]);
                        }}
                      >
                        Add key / scale
                      </button>
                      {settings.keyScales.length > 0 && (
                        <button
                          type="button"
                          onClick={() => update("keyScales", [])}
                        >
                          Clear selection · use random
                        </button>
                      )}
                      <p className="ear-training-note">
                        Leave empty to randomize the key and scale. Selected
                        combinations are chosen with equal likelihood.
                      </p>
                    </fieldset>
                    <fieldset>
                      <legend>
                        Pitch range (
                        {settings.pitchView === "concert"
                          ? "concert"
                          : "alto written"}
                        )
                      </legend>
                      <div className="ear-training-fields">
                        <label>
                          Lowest note
                          <select
                            value={settings.lowMidi}
                            onChange={(e) =>
                              update("lowMidi", Number(e.target.value))
                            }
                          >
                            {pitchOptions}
                          </select>
                        </label>
                        <label>
                          Highest note
                          <select
                            value={settings.highMidi}
                            onChange={(e) =>
                              update("highMidi", Number(e.target.value))
                            }
                          >
                            {pitchOptions}
                          </select>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSettings((s) => ({
                            ...s,
                            lowMidi: 49,
                            highMidi: 81,
                          }))
                        }
                      >
                        Alto saxophone range
                      </button>
                      <p className="ear-training-note">
                        Written Bb3–F#6 · concert Db3–A5, excluding altissimo.
                      </p>
                    </fieldset>
                    <fieldset
                      disabled={!melodyControlsEnabled}
                      className="ear-training-melody-controls"
                    >
                      <legend>Random phrase melody</legend>
                      <label>
                        Note selection
                        <select
                          value={settings.melody.style}
                          onChange={(event) =>
                            updateMelody({
                              style: event.target
                                .value as Settings["melody"]["style"],
                            })
                          }
                        >
                          <option value="melodic">Connected melody</option>
                          <option value="uniform">
                            Uniform random (original)
                          </option>
                        </select>
                      </label>
                      <p className="ear-training-note">
                        These controls shape random phrases, including the
                        random half of Mixed. Enabled patterns keep their exact
                        pitches and rhythms.
                      </p>
                      <fieldset disabled={!melodicStyleEnabled}>
                        <legend>Variation and movement</legend>
                        <label>
                          Next phrase variation: {nextVariation}
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={settings.melody.variation}
                            disabled={settings.melody.randomizeVariation}
                            onChange={(event) =>
                              updateMelody({
                                variation: Number(event.target.value),
                              })
                            }
                          />
                          <span className="ear-training-note">
                            Low favors repeated notes and steps; high explores
                            larger permitted intervals. Applies on Next; Replay
                            keeps the current phrase. The maximum leap still
                            applies.
                          </span>
                        </label>
                        <label className="ear-training-check">
                          <input
                            type="checkbox"
                            checked={settings.melody.randomizeVariation}
                            onChange={(event) =>
                              updateMelody({
                                randomizeVariation: event.target.checked,
                              })
                            }
                          />
                          Randomize variation for each phrase
                        </label>
                        {settings.melody.randomizeVariation && (
                          <div className="ear-training-fields">
                            <label>
                              Minimum variation
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={settings.melody.variationMin}
                                onChange={(event) =>
                                  updateMelody({
                                    variationMin: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Maximum variation
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={settings.melody.variationMax}
                                onChange={(event) =>
                                  updateMelody({
                                    variationMax: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                        )}
                        <div className="ear-training-fields">
                          <label>
                            Maximum leap (semitones)
                            <input
                              type="number"
                              min="1"
                              max="12"
                              value={settings.melody.maxLeap}
                              onChange={(event) =>
                                updateMelody({
                                  maxLeap: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Contour
                            <select
                              value={settings.melody.contour}
                              onChange={(event) =>
                                updateMelody({
                                  contour: event.target
                                    .value as Settings["melody"]["contour"],
                                })
                              }
                            >
                              <option value="free">Free</option>
                              <option value="rising">Rising</option>
                              <option value="falling">Falling</option>
                              <option value="arch">Arch</option>
                              <option value="returning">Returning</option>
                            </select>
                          </label>
                        </div>
                      </fieldset>
                      <fieldset disabled={!melodicStyleEnabled}>
                        <legend>Harmony and color</legend>
                        <label>
                          Harmonic context
                          <select
                            value={settings.melody.harmony}
                            onChange={(event) =>
                              updateMelody({
                                harmony: event.target
                                  .value as Settings["melody"]["harmony"],
                              })
                            }
                          >
                            <option value="scale-only">Scale only</option>
                            <option value="tonic">Tonic chord</option>
                            <option value="I-IV-V-I">I–IV–V–I</option>
                            <option value="ii7-V7-Imaj7">ii7–V7–Imaj7</option>
                          </select>
                        </label>
                        <p className="ear-training-note">
                          Chord progressions currently use major scales. Harmony
                          guides note choices; no chord accompaniment plays.
                        </p>
                        <div className="ear-training-fields">
                          <label>
                            Chord emphasis
                            <select
                              value={settings.melody.chordEmphasis}
                              disabled={
                                settings.melody.harmony === "scale-only"
                              }
                              onChange={(event) =>
                                updateMelody({
                                  chordEmphasis: event.target
                                    .value as Settings["melody"]["chordEmphasis"],
                                })
                              }
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </label>
                          <label>
                            Chromaticism
                            <select
                              value={settings.melody.chromaticism}
                              onChange={(event) =>
                                updateMelody({
                                  chromaticism: event.target
                                    .value as Settings["melody"]["chromaticism"],
                                })
                              }
                            >
                              <option value="off">Off</option>
                              <option value="light">Light</option>
                              <option value="moderate">Moderate</option>
                              <option value="adventurous">Adventurous</option>
                            </select>
                          </label>
                        </div>
                        <p className="ear-training-note">
                          Chromatic color uses short approaches that resolve to
                          a scale or chord tone. Short phrases may have no
                          eligible place for one.
                        </p>
                      </fieldset>
                    </fieldset>
                  </div>
                </div>
              )}
              {settingsTab === "rhythm" && (
                <div
                  className="ear-training-tab-panel"
                  id="ear-training-panel-rhythm"
                  role="tabpanel"
                  aria-labelledby="ear-training-tab-rhythm"
                  tabIndex={0}
                >
                  <div className="ear-training-controls-grid">
                    <label>
                      Rhythm
                      <select
                        disabled={!isPhrase}
                        value={isPhrase ? settings.rhythmMode : "even"}
                        onChange={(e) =>
                          update(
                            "rhythmMode",
                            e.target.value as Settings["rhythmMode"],
                          )
                        }
                      >
                        <option value="varied">Varied rhythm</option>
                        <option value="even">Even notes</option>
                      </select>
                    </label>
                    {settings.rhythmMode === "even" ? (
                      <>
                        <label>
                          Even-note duration
                          <select
                            disabled={!isPhrase}
                            value={settings.evenTicks}
                            onChange={(e) =>
                              update("evenTicks", Number(e.target.value))
                            }
                          >
                            <option value="240">Eighth note</option>
                            <option value="480">Quarter note</option>
                            <option value="960">Half note</option>
                          </select>
                          <span className="ear-training-note">
                            Overrides paired pattern rhythms; no rests.
                          </span>
                        </label>
                      </>
                    ) : (
                      <>
                        <fieldset disabled={!isPhrase}>
                          {presetRegistry.rhythms.map((r) => (
                            <label className="ear-training-check" key={r.id}>
                              <input
                                type="checkbox"
                                checked={settings.enabledRhythmIds.includes(
                                  r.id,
                                )}
                                onChange={() =>
                                  update(
                                    "enabledRhythmIds",
                                    toggle(settings.enabledRhythmIds, r.id),
                                  )
                                }
                              />
                              {r.name}
                            </label>
                          ))}
                        </fieldset>
                      </>
                    )}
                  </div>
                </div>
              )}
              {settingsTab === "patterns" && (
                <div
                  className="ear-training-tab-panel"
                  id="ear-training-panel-patterns"
                  role="tabpanel"
                  aria-labelledby="ear-training-tab-patterns"
                  tabIndex={0}
                >
                  <div className="ear-training-patterns">
                    <p>
                      Degrees describe this scale, continuing into the next
                      octave. Only enabled patterns with the selected note count
                      and a fitting range can play. Editing a starter creates a
                      session copy.
                    </p>
                    <fieldset disabled={!isPhrase}>
                      <legend>Enabled patterns</legend>
                      {allPatterns.map((p) => (
                        <div className="ear-training-pattern" key={p.id}>
                          <label className="ear-training-check">
                            <input
                              type="checkbox"
                              checked={settings.enabledPatternIds.includes(
                                p.id,
                              )}
                              onChange={() =>
                                update(
                                  "enabledPatternIds",
                                  toggle(settings.enabledPatternIds, p.id),
                                )
                              }
                            />
                            <span>
                              {p.name} <small>{p.degrees.join("–")}</small>
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPattern(p.id);
                              setPatternName(p.name);
                              setPatternDegrees(p.degrees.join(" "));
                              setPatternRhythm(p.rhythmId);
                            }}
                          >
                            Edit
                          </button>
                          {p.id.startsWith("custom_") && (
                            <button
                              type="button"
                              onClick={() => {
                                patternsDispatch({ type: "remove", id: p.id });
                                update(
                                  "enabledPatternIds",
                                  settings.enabledPatternIds.filter(
                                    (id) => id !== p.id,
                                  ),
                                );
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </fieldset>
                    <fieldset disabled={!isPhrase}>
                      <legend>
                        {editingPattern
                          ? "Edit session pattern"
                          : "Add a pattern"}
                      </legend>
                      <div className="ear-training-fields">
                        <label>
                          Name
                          <input
                            value={patternName}
                            onChange={(e) => setPatternName(e.target.value)}
                            maxLength={80}
                          />
                        </label>
                        <label>
                          Scale degrees
                          <input
                            placeholder="1 2 3 2 1"
                            value={patternDegrees}
                            onChange={(e) => setPatternDegrees(e.target.value)}
                          />
                        </label>
                        <label>
                          Rhythm
                          <select
                            value={patternRhythm}
                            onChange={(e) => setPatternRhythm(e.target.value)}
                          >
                            <option value="automatic">Automatic</option>
                            {presetRegistry.rhythms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} (
                                {
                                  r.events.filter((e) => e.kind === "note")
                                    .length
                                }{" "}
                                notes)
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {patternError && <p role="alert">{patternError}</p>}
                      <button type="button" onClick={savePattern}>
                        {editingPattern ? "Save session copy" : "Add pattern"}
                      </button>
                      {editingPattern && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPattern(null);
                            setPatternName("");
                            setPatternDegrees("");
                          }}
                        >
                          Cancel edit
                        </button>
                      )}
                    </fieldset>
                  </div>
                </div>
              )}
            </section>
          </div>
          {validation.length > 0 && (
            <div role="alert" className="ear-training-errors">
              <strong>Adjust your practice settings</strong>
              <ul>
                {validation.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <details className="ear-training-audio-credit">
        <summary>Audio samples · FluidR3 GM · CC BY 3.0 US</summary>
        <p>
          We use FluidR3 GM piano and alto saxophone samples by Frank Wen,
          converted and packaged by gleitz and MIDI.js Soundfonts contributors.
          Original MP3 bytes are unchanged; playback applies phase-matched
          sustain loops and crossfades. No endorsement is implied.
        </p>
        <p>
          <a
            href={sampleManifest.provenance.source}
            target="_blank"
            rel="noreferrer"
          >
            Sample source
          </a>
          {" · "}
          <a
            href={sampleManifest.provenance.licenseUrl}
            target="_blank"
            rel="noreferrer"
          >
            CC BY 3.0 US license
          </a>
          {" · "}
          <a
            href={`${import.meta.env.BASE_URL}${sampleManifest.bundle.url.slice(1)}?v=${sampleManifest.bundle.sha256}`}
            download
          >
            Download audio bundle with full notices
          </a>
        </p>
      </details>
    </section>
  );
}
