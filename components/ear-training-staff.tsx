import { useEffect, useRef, useState } from "react";
import {
  Accidental,
  Annotation,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
} from "vexflow";
import {
  keySignature,
  spellPitch,
  type Exercise,
  type PitchView,
} from "./ear-training-model";

import {
  engravingFragments,
  projectStaffEvents,
  vexDuration,
  type StaffFragment,
} from "./ear-training-engraving";

export default function EarTrainingStaff({
  exercise,
  pitchView,
  revealed,
  firstNoteHint,
  noteNames,
  activeNoteIndex = null,
  targetNoteIndex = null,
}: {
  exercise: Exercise;
  pitchView: PitchView;
  revealed: boolean;
  firstNoteHint: boolean;
  noteNames: boolean;
  activeNoteIndex?: number | null;
  targetNoteIndex?: number | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const visible = revealed || firstNoteHint;
  // Projection happens before engraving: hidden exercises never enter the SVG.
  const events = projectStaffEvents(
    exercise,
    revealed,
    firstNoteHint,
    targetNoteIndex,
  );
  const notes = events.filter((e) => e.kind === "note");
  const description = visible
    ? notes
        .map((e) => spellPitch(e.midi, exercise.keyScale, pitchView).name)
        .join(", ")
    : "Notes hidden. Listen and try to reproduce the exercise.";
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, Math.floor(entries[0].contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    el.replaceChildren();
    if (!visible) return;
    try {
      const fragments = engravingFragments(
        projectStaffEvents(exercise, revealed, firstNoteHint, targetNoteIndex),
      );
      const bars = [...new Set(fragments.map((f) => f.bar))];
      // Keep every measure on one system; scroll the staff rather than wrap it.
      const rows = [bars];
      const renderWidth = Math.max(
        width,
        16 +
          bars.reduce(
            (sum, bar) =>
              sum +
              Math.max(
                180,
                fragments.filter((f) => f.bar === bar).length * 42 + 80,
              ),
            0,
          ),
      );
      const renderer = new Renderer(el, Renderer.Backends.SVG);
      renderer.resize(renderWidth, rows.length * 160 + 30);
      const context = renderer.getContext();
      const built: {
        fragment: StaffFragment;
        note: StaveNote;
        system: number;
      }[] = [];
      rows.forEach((system, systemIndex) => {
        let x = 8;
        const minimums = system.map((bar) =>
          Math.max(
            180,
            fragments.filter((f) => f.bar === bar).length * 42 + 80,
          ),
        );
        const extra =
          Math.max(0, renderWidth - 16 - minimums.reduce((a, b) => a + b, 0)) /
          system.length;
        system.forEach((bar, barIndex) => {
          const staveWidth = minimums[barIndex] + extra;
          const stave = new Stave(x, systemIndex * 160 + 25, staveWidth);
          if (!barIndex)
            stave
              .addClef("treble")
              .addKeySignature(keySignature(exercise.keyScale, pitchView));
          if (bar === 0) stave.addTimeSignature("4/4");
          stave.setContext(context).draw();
          const pieces = fragments.filter((f) => f.bar === bar);
          const staveNotes = pieces.map((fragment) => {
            const event = fragment.event;
            const pitch =
              event.kind === "note"
                ? spellPitch(event.midi, exercise.keyScale, pitchView)
                : null;
            const note = new StaveNote({
              keys: [pitch?.vexKey ?? "b/4"],
              ...vexDuration(fragment),
            });
            if (fragment.dotted) Dot.buildAndAttach([note]);
            if (pitch && pitch.accidental)
              note.addModifier(new Accidental(pitch.accidental), 0);
            // Include naturals explicitly so raised/minor/chromatic tones are unambiguous.
            else if (pitch) note.addModifier(new Accidental("n"), 0);
            if (pitch && noteNames && fragment.onsetTicks === event.onsetTicks)
              note.addModifier(
                new Annotation(pitch.name).setFont("Arial", 12),
                0,
              );
            if (event.kind === "note" && event.noteIndex === activeNoteIndex)
              note.setStyle({ fillStyle: "#2563eb", strokeStyle: "#2563eb" });
            built.push({ fragment, note, system: systemIndex });
            return note;
          });
          const beams = Beam.generateBeams(staveNotes, {
            groups: [new Fraction(1, 4)],
          });
          Formatter.FormatAndDraw(context, stave, staveNotes, {
            autoBeam: false,
          });
          beams.forEach((beam) => beam.setContext(context).draw());
          x += staveWidth;
        });
      });
      built.forEach((current, index) => {
        const previous = built[index - 1];
        if (
          !previous ||
          current.fragment.event.kind !== "note" ||
          previous.fragment.event.kind !== "note" ||
          current.fragment.event.noteIndex !== previous.fragment.event.noteIndex
        )
          return;
        const style =
          current.fragment.event.noteIndex === activeNoteIndex
            ? { fillStyle: "#2563eb", strokeStyle: "#2563eb" }
            : {};
        if (previous.system === current.system)
          new StaveTie({
            firstNote: previous.note,
            lastNote: current.note,
            firstIndexes: [0],
            lastIndexes: [0],
          })
            .setStyle(style)
            .setContext(context)
            .draw();
        else {
          new StaveTie({
            firstNote: previous.note,
            firstIndexes: [0],
            lastIndexes: [0],
          })
            .setStyle(style)
            .setContext(context)
            .draw();
          new StaveTie({
            lastNote: current.note,
            firstIndexes: [0],
            lastIndexes: [0],
          })
            .setStyle(style)
            .setContext(context)
            .draw();
        }
      });
      el.querySelector("svg")?.setAttribute("aria-hidden", "true");
    } catch (cause) {
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = `Staff rendering: ${cause instanceof Error ? cause.message : "Could not render staff"}`;
      el.append(message);
    }
    return () => el.replaceChildren();
  }, [
    exercise,
    pitchView,
    revealed,
    firstNoteHint,
    noteNames,
    activeNoteIndex,
    targetNoteIndex,
    width,
    visible,
  ]);
  return (
    <div className="ear-training-staff" role="img" aria-label={description}>
      {!visible && (
        <div className="ear-training-hidden">
          <strong>Listen first</strong>
          <span>
            Sing, play, or recall the phrase. Reveal it when you’re ready.
          </span>
        </div>
      )}
      <div ref={container} className="ear-training-engraving" />
      {!revealed && firstNoteHint && <p>First-note hint only</p>}
    </div>
  );
}
