# Ear Training

## Purpose and status

Add an **Ear Training** module under **Tools** for listening to notes and
short phrases, remembering them, and trying to sing or play them back by ear.
The learner reveals the Western notation to check their own attempt, then
moves to the next exercise. No answer submission is required.

This is a product proposal for review, covering the experience, controls,
and acceptance criteria. Technical architecture, library choices, audio asset
selection, and implementation details belong in a separate document after
this proposal is approved.

The interaction is inspired by the call-and-response practice and result
visibility controls in the
[IWasDoingAllRight Online Ear Trainer](https://www.iwasdoingallright.com/tools/ear_training/online/).
This proposal focuses on single notes and melodic phrases rather than the
reference tool's full set of features.

## Audience and learning goals

The tool serves beginners learning to associate sound with notes and musicians
practising melodic recall on an instrument, particularly alto saxophone.
Learners should be able to:

- Listen to a single pitch and try to reproduce or name it independently.
- Remember and reproduce progressively longer phrases.
- Practise within selected Western keys, scales, and comfortable pitch ranges.
- Compare familiar patterns with less predictable random phrases.
- Adjust listening time and visual assistance without the pressure of scoring.

The module is independent of Carnatic notation. It uses Western note names,
scales, octaves, and staff notation; it does not require swaras, ragas, or the
repository's default `Sa` setting.

## Core practice flow

1. Open **Tools → Ear Training** and review the current settings.
2. Choose a sound, pitch view, range, key/scale selections, and exercise length.
3. Press **Start** to generate and play the first exercise. Opening the tool
   alone must not start audio.
4. Listen and try to sing, play, or recall the notes. The tool does not record
   or evaluate the attempt.
5. Use **Replay** to hear the same exercise again or **Show notes** to reveal it.
6. Compare the notation with the attempt, then press **Next** for a new exercise.
7. Stop or end the session at any time.

The current key and scale remain visible as practice context. Hiding the
exercise hides its notes and note-name labels, not the selected settings.

## Exercise types

### Single-note practice

Generate one note within the selected scale and pitch range. The learner can
listen repeatedly, attempt it independently, reveal it, and continue.

### Phrase practice

Generate a phrase of the chosen length and play its notes sequentially.
Length means the **number of notes**, not playback duration. Offer lengths of
1, 2, 3, 4, 5, ... notes, with a custom integer length from 1 to 16.

The first release uses evenly timed notes. Tempo and note duration can change,
but random rhythm, rests within patterns, chords, and simultaneous notes are
outside the initial feature.

### Timed single-note self-check

This is the self-directed version of the original mini-game:

1. Play one hidden note.
2. Start a visible recall countdown after the note finishes sounding.
3. Let the learner try to identify or reproduce it during that period.
4. Reveal the staff note and its optional name when the countdown ends.
5. Wait for **Next**; do not advance automatically.

Offer recall periods of 3, 5, and 10 seconds, plus a custom period from 1 to
60 seconds. The default is 5 seconds. **Show notes** can reveal early and
cancel the countdown. **Replay** hides the result, repeats the same note, and
gives a fresh recall period. **Stop** cancels playback and the countdown.

Timed mode always uses one note and delayed reveal. Retain ordinary phrase
length and visibility preferences when the learner returns to normal practice.
Disable the first-note hint in timed mode because it would disclose the answer.
There are no points, correct/incorrect buttons, or required responses.

## Musical settings

### Keys and scales

Allow one or more key-and-scale combinations, such as **C major** and
**G major**, to be selected. Initial scale choices are:

- Major and natural minor.
- Harmonic minor.
- Melodic minor — ascending form and descending form as separate choices.
- Major pentatonic and minor pentatonic.
- Blues, defined here as the six-note minor blues scale.
- Chromatic.

For melodic minor, the chosen form defines a fixed note pool even when a
random phrase changes direction. Do not silently switch forms according to
the movement of individual notes.

Each exercise uses exactly one selected key/scale combination, chosen at
random with equal likelihood. Multiple selections do not combine their notes
into a larger pool. Display the combination used by the current exercise.
At least one selection is required before starting.

### Pitch range and transposition

Provide editable lowest and highest notes, including octave numbers, and an
**Alto saxophone range** preset. Define that preset as written `Bb3–F#6`,
excluding altissimo; learners may narrow it to their comfortable range.
The default exercise range is concert `C4–C5`.

Offer two clearly labelled notation views:

| View                                | Display and playback relationship                                                |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Concert pitch                       | Display the notes at the pitches actually heard.                                 |
| E-flat alto saxophone written pitch | Display transposed alto notation; the displayed notes sound a major sixth lower. |

Changing the view changes the note labels, staff notation, range labels, and
key names consistently. It does not change the sounding exercise or its
sounding range. This module does not inherit written `Sa = G` from the score
library.

The chosen sound and pitch view are independent: piano sound can accompany
alto written notation, and saxophone sound can accompany concert notation.

### Western notation

Show the complete exercise on a treble staff after reveal, with an appropriate
key signature, accidentals, ledger lines, and note durations. Chromatic
exercises need consistent accidental spelling rather than an implied diatonic
scale. Optional note-name labels include octaves, for example `C4` and `F#4`,
and follow the selected pitch view.

Once the phrase is visible, highlight the current note during replay. Hidden
notes must also remain hidden in note-name labels and accessible descriptions
until revealed. A first-note hint exposes only the first note.

## Phrase generation and user patterns

Offer three generation choices:

| Choice   | Behavior                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Random   | Choose notes from the exercise's selected scale within the pitch range. Repeated notes are allowed.           |
| Patterns | Choose from the learner's enabled scale-degree patterns and fit the entire pattern within the selected range. |
| Mixed    | Choose a pattern-based phrase or a random phrase with equal likelihood for each exercise.                     |

User patterns are ordered lists of positive scale degrees rather than fixed
concert pitches. For example, in C major, `1–2–3–2–1` produces `C–D–E–D–C`.
Degrees above the scale's size continue into the next octave, so degree 8 in
a seven-note scale is the upper tonic. Degree counts depend on the selected
scale; patterns are not Carnatic notation or arbitrary scripts.

Allow learners to add, name, edit, enable, disable, and remove patterns for
the current session. Include ascending, descending, and returning patterns
as editable starting examples. Cross-session saved presets are deferred.

Only enabled patterns with the selected number of notes are eligible. Choose
an eligible pattern and a tonic octave that keep the entire pattern within
range. Never truncate, wrap individual notes, change the selected length, or
introduce out-of-scale notes to force a pattern to fit.

Before starting pattern or mixed practice, explain any selected scale/range
combination that has no eligible pattern. The learner must adjust the length,
range, patterns, or generation choice; do not silently fall back to random-only
practice. Reject empty or malformed patterns with a useful message.
Random-only practice does not require any patterns. If a selected scale has no
notes in the range, explain that before starting as well.

## Sound and playback controls

Offer **Piano** and **Saxophone** sounds using consistent, clearly pitched
samples suitable for the supported range. The sample license must permit
distribution with the website and the intended usage. Record the source,
license, and required attribution before including an asset; a description
such as “royalty-free” alone is insufficient.

Provide the following controls:

- **Tempo:** 40–200 BPM, default 80 BPM.
- **Note duration:** half a beat, one beat, or two beats; default one beat.
- **Inter-note silence:** 0, half a beat, or one beat; default 0. This is a gap
  after a note, separate from its sounding duration, with no trailing gap.
- **Volume:** adjustable with a mute option; start at a moderate level.
- **Replay:** repeat the exact current notes in the same order.
- **Next:** stop the current exercise and countdown, generate a new exercise,
  reset visibility according to the active mode, and play it.
- **Stop:** stop sound and any countdown without discarding the current phrase.
- **End session:** stop practice and show a session summary.

Settings changes apply to the next exercise. Do not silently replace an
exercise while it is playing. Volume changes take effect immediately; pitch
view changes can update the display immediately because they preserve sound.
Replay retains the current exercise's sound and timing settings. Replaying a
revealed phrase keeps it revealed in ordinary practice.

Do not allow overlapping exercises. Starting playback again must stop the
previous playback. Leaving the tool or ending the session stops all sound
and pending reveals.

## Visibility and keyboard behavior

Offer all three visibility modes:

| Mode                        | Behavior                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Reveal on request — default | Hide notes until **Show notes** is pressed.                                                 |
| Always visible              | Show the complete exercise before playback begins.                                          |
| Reveal after a delay        | Reveal automatically after a configurable recall period, measured from the end of playback. |

Delayed reveal uses the same recall-period choices as timed practice,
defaulting to 5 seconds. It remains available for multi-note phrases.
Ordinary delayed practice can also reveal early; replaying a still-hidden
phrase restarts its recall period.

An independent **Show first note** option is off by default and is available
in ordinary practice. Show the first note on the staff in the current pitch
view while keeping the remainder hidden. For a one-note exercise, this option
reveals the whole exercise; explain that consequence beside the control.

Use **Space** as the primary shortcut after the session starts:

- If any exercise notes remain hidden, reveal them and cancel pending reveal.
- If all notes are visible, perform **Next**.
- In timed mode, the same rule allows early reveal followed by manual advance.

Keep **Show notes**, **Replay**, and **Next** available as labelled buttons.
Do not intercept Space while typing in a field or using another interactive
control; preserve that control's normal keyboard behavior. When handled as
an exercise shortcut, prevent page scrolling and ignore held-key repetition
so one press performs one action.

## Default starting experience

| Setting            | Default                   |
| ------------------ | ------------------------- |
| Exercise           | Phrase practice, 3 notes  |
| Generation         | Random                    |
| Sound              | Piano                     |
| Notation view      | Concert pitch             |
| Key and scale      | C major only              |
| Range              | Concert C4–C5             |
| Tempo and duration | 80 BPM, one beat per note |
| Inter-note silence | None                      |
| Visibility         | Reveal on request         |
| First-note hint    | Off                       |
| Note-name labels   | On after reveal           |

Keep essential controls and playback actions easy to find. Group less
frequently used options, such as pattern editing and transposition, without
hiding the current settings. The staff and actions must work on narrow screens.

## Example sessions

### Learn one note at a time

Choose C major, length 1, and hidden notation. Press Start, listen, and try to
play the note. Press Space to reveal it. Press Space again to hear the next
exercise. Replay is available whenever another listen would help.

### Practise a five-note pattern

Choose C major, length 5, pattern generation, and `1–2–3–2–1`. Enable the
first-note hint. Listen and reproduce the phrase before revealing the full
notation. Replay preserves the exact notes and register.

### Practise across several scales

Select C major and G major in random generation mode. Each new exercise
chooses one of those combinations and identifies it visibly. All notes in
that exercise belong to that combination and stay within the chosen range.

### Timed self-check

Select timed single-note practice and a 5-second recall period. A note plays,
then the countdown starts. Try to name or reproduce it. When the note is
revealed, compare independently and press Next when ready.

## Session summary and usability

The session summary shows elapsed session time, the number of exercises
played, and the keys/scales used. Count an exercise once when its initial
playback completes; replays do not increase the count. Label these as practice
activity, not measured proficiency. There is no accuracy percentage, score,
or inferred weak-note analysis.

Show sound-loading progress and provide a clear retry action after failures.
Do not count a failed playback as practice or run a recall countdown before
successful playback. Preserve settings when a sound fails to load.

Identify invalid ranges, empty scale selections, and impossible pattern
settings before starting. If the page becomes hidden, stop playback and
cancel its countdown; returning must not unexpectedly resume sound or reveal
notes. The learner can replay the retained exercise.

All settings and actions need keyboard access and descriptive labels. Feedback
must not depend on color alone. The responsive staff should preserve readable
notes and octave information rather than shrink an entire phrase illegibly.

## Initial-release boundaries

The first release includes the complete listening, replay, reveal, and next
loop; selectable sounds, scales, range, and phrase length; editable session
patterns; the three visibility modes; and timed single-note self-check.

Defer microphone recognition, answer entry, automated grading, chord and
progression exercises, advanced rhythm generation, spoken answers, hands-free
automatic advancement, accounts, persistent presets, practice history, and
long-term progress analysis.

No new score files or audio exports are required by this proposal. This
document does not choose sample packs, software dependencies, data structures,
or a playback engine.

## Acceptance criteria for the feature

- Ear Training is reachable from Tools and starts only after an explicit action.
- A learner can complete a session using listening, replay, reveal, and Next
  without entering an answer or enabling a microphone.
- Generated exercises respect their chosen scale, exact note count, and range.
- Multiple scale selections produce separate exercises rather than a merged
  note pool. Impossible settings produce actionable explanations.
- Pattern and mixed generation follow enabled, compatible patterns without
  silently changing notes, phrase length, or generation mode.
- Both instrument sounds play the intended pitches. Changing sound does not
  transpose the exercise; changing pitch view preserves the sounding pitches.
- Western staff notation and optional names agree with the actual exercise,
  including octaves, accidentals, and alto transposition.
- All visibility modes work, the first-note hint discloses only its stated
  information, and Space reveals before advancing.
- Timed practice starts its countdown after playback, reveals on time, and
  waits for manual advancement. Stop, replay, early reveal, and navigation
  cancel or restart timers as described.
- Playback does not overlap, loading errors can be retried, and leaving the
  tool stops sound. Keyboard and narrow-screen use remain practical.
- Session summaries report activity only, with replays and failed playback
  excluded from the exercise count.
