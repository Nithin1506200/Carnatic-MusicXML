# Ear Training: Technical Implementation Guide

## Handoff contract

Implement the feature described in [Ear Training](eartraining.md), with the
following newer requirements taking precedence wherever the proposal differs:

1. **Do not add code splitting.** Use static imports for the new tool and its
   dependencies. Do not add `React.lazy`, dynamic `import()`, a Suspense boundary,
   manual chunk configuration, or a worker for this feature. Existing splitting
   elsewhere in the application stays unchanged.
2. **Predefined melodic and rhythmic patterns belong in TOML files.** They are
   editable data, not hard-coded arrays hidden inside React components.
3. **Generated phrases must have rhythmic patterns.** Random pitch generation
   must also receive a rhythm. Uniform notes remain an explicit easy option,
   but are not the default for multi-note phrases.
4. **Include long-tone practice** with a visible target pitch, preparation
   countdown, sustained reference audio, recovery time, and TOML routines
   that can run a complete timed practice session.

This guide is an implementation specification, not a claim that the feature
already exists. Implement only this tool; do not rewrite the score library,
Carnatic parser, content index, or existing score player. Do not add microphone
recognition, answer submission, grading, accounts, or persistent history.

The proposal's uniform-note restriction and its global note-duration and
inter-note-silence controls are superseded by the rhythm model below. Keep
`eartraining.md` as the earlier product proposal until a separate revision is
requested. This document governs those differences during implementation.

## Melodic generation extension

The [melodic generation guide](eartraining_melodic_generation.md) extends the
random-pitch behavior below. Generated phrases now default to weighted,
connected movement with variation and maximum-leap controls. Uniform sampling
remains an explicit option. Chord progressions are data in
`data/ear_training_harmony.toml`; exact patterns and long tones are unchanged.

## Compact UI and automatic scale selection

The current UI defaults supersede the earlier starting table: sound is
Saxophone, notation view is E-flat alto written pitch, and no key/scale is
selected. The default range is written Bb3–F#6 (stored as concert MIDI
49–81, Db3–A5). An empty selection means choose a compatible random key/scale for
each new exercise. Explicit selections still constrain generation. Concert
pitch is available without changing the sounding notes. Display controls sit in the playback toolbar beside End session. Other settings are below the practice area in a compact tabbed panel (Practice,
Melody, Rhythm, Patterns); Western engraving remains one horizontal system with
local overflow rather than wrapping into stacked systems.

## Committed audio bundle

The [sample packaging guide](ear-training-assets.md) supersedes the original
loose-file preparation proposal below. All 74 original MP3s and full notices
are stored in one tracked `public/ear-training-samples.tar.gz`. The browser
fetches and verifies that archive once, unpacks it in memory, and caches bytes
across replay and instrument changes. Normal dev/build is offline verification
only. An explicit packaging command rebuilds the archive; sample updates must
commit the archive, manifest, and attribution together. The tool includes a
visible source/license credit. No code splitting or upstream runtime fetches
are added.

## Current repository and integration points

The app uses React, TypeScript, Vite, and Vitest. It is deployed as a static
site; the new feature must not require a backend.

- `app/music-library.tsx` owns navigation. Add `ear-training` to `TOOL_IDS`,
  a Tools navigation button, and a conditional `<EarTraining />` branch.
  Statically import that component. The URL is `?doc=ear-training`; direct
  visits and browser back/forward must work. `TOOL_IDS` already keeps tool
  routes out of document fetching and normal document rendering.
- `components/score-audio.ts` renders entire MuseScore scores through webmscore.
  Do not use it for short generated phrases or modify its playback behavior.
- `smol-toml` is already a development dependency used by the raga generator.
  Move it to runtime dependencies when importing it in the browser. Import
  preset files with Vite's static `?raw` imports and parse them once.
- Add VexFlow as a runtime dependency for Western SVG engraving. Use static
  imports and the installed package's TypeScript API. Pin the selected version
  through the lockfile; do not use a CDN renderer or copy old tutorial APIs.
- Put tool styles in `app/globals.css`, namespaced under `.ear-training`.
  Do not hand-edit `app/generated-content.ts`. No catalog/index shape changes
  or per-score manifest additions are needed.

Suggested file responsibilities (ordinary modules, not separate bundles):

| File                                 | Responsibility                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `app/ear-training.tsx`               | Settings form, pattern editor, session reducer, actions, summary, lifecycle cleanup. |
| `components/ear-training-model.ts`   | Types, scale definitions, spelling/transposition, validation, pure generation.       |
| `components/ear-training-presets.ts` | Static raw TOML imports, parsing, schema validation, normalized presets.             |
| `components/ear-training-audio.ts`   | Sample loading, Web Audio scheduling, cancellation, disposal.                        |
| `components/ear-training-staff.tsx`  | Western engraving, reveal projection, responsive layout, highlighting.               |
| `data/ear_training_patterns.toml`    | Predefined melodic degree sequences and their paired rhythms.                        |
| `data/ear_training_long_tones.toml`  | Timed long-tone routines: scale, note order, hold, rest, and total duration.         |
| `data/ear_training_rhythms.toml`     | Reusable rhythmic motifs used with random pitches or custom patterns.                |

Keep functions small and explicit. Do not introduce a generic music framework,
an event bus, or a second routing system.

## Shared data model

All stored pitches are **concert MIDI integers**. MIDI 60 means concert C4.
The selected display view never mutates stored pitches or exercise audio.
All timing uses integer ticks: **480 ticks per quarter-note beat**.

Use these contracts as the starting interfaces; helper types can be added.

```ts
type PitchView = "concert" | "alto-eb";
type SoundId = "piano" | "saxophone";
type GenerationMode = "random" | "patterns" | "mixed";
type ExerciseMode = "single" | "phrase" | "timed" | "long-tone";
type VisibilityMode = "request" | "always" | "delayed";
type RhythmMode = "varied" | "even";

type ScaleId =
  | "major"
  | "natural-minor"
  | "harmonic-minor"
  | "melodic-minor-up"
  | "melodic-minor-down"
  | "major-pentatonic"
  | "minor-pentatonic"
  | "minor-blues"
  | "chromatic";

interface KeyScale {
  tonicPc: number; // integer 0..11, concert pitch class
  scaleId: ScaleId;
}

interface RhythmEvent {
  kind: "note" | "rest";
  ticks: number;
}

interface MelodicPreset {
  id: string;
  name: string;
  degrees: readonly number[];
  rhythmId: string;
}

interface RhythmPreset {
  id: string;
  name: string;
  events: readonly RhythmEvent[];
}

interface Settings {
  exerciseMode: ExerciseMode;
  generationMode: GenerationMode;
  sound: SoundId;
  pitchView: PitchView;
  keyScales: readonly KeyScale[];
  lowMidi: number;
  highMidi: number;
  noteCount: number;
  bpm: number;
  rhythmMode: RhythmMode;
  evenTicks: number;
  enabledRhythmIds: readonly string[];
  enabledPatternIds: readonly string[];
  visibility: VisibilityMode;
  firstNoteHint: boolean;
  noteNames: boolean;
  recallSeconds: number;
  longTone: {
    practice: "manual" | "routine";
    routineId: string;
    target: "fixed" | "random";
    targetMidi: number;
    holdBeats: 4 | 8 | 16;
    recoveryBeats: 0 | 4 | 8;
  };
}

type ExerciseEvent =
  | {
      kind: "note";
      midi: number;
      onsetTicks: number;
      durationTicks: number;
      noteIndex: number;
    }
  | { kind: "rest"; onsetTicks: number; durationTicks: number };

interface Exercise {
  id: number;
  keyScale: KeyScale;
  source: "random" | "preset" | "custom" | "long-tone";
  patternId?: string;
  rhythmIds: readonly string[];
  events: readonly ExerciseEvent[];
  totalTicks: number;
  snapshot: Readonly<Settings>;
}
```

Keep volume outside the snapshot because it changes immediately. Copy settings,
the nested long-tone settings, and all arrays when creating a snapshot; subsequent edits cannot change a
current exercise. `noteIndex` counts original note attacks from zero. A note
split into tied engraving segments still has one `noteIndex` and one audio
attack. Rests never count toward `noteCount`.

## TOML presets and validation

### Rhythm file

Use one versioned document with `[[rhythms]]` entries. The following is valid
starter content for `data/ear_training_rhythms.toml`:

```toml
schema_version = 1

[[rhythms]]
id = "quarter"
name = "Quarter note"
events = [{ kind = "note", ticks = 480 }]

[[rhythms]]
id = "long_short"
name = "Dotted quarter and eighth"
events = [
  { kind = "note", ticks = 720 },
  { kind = "note", ticks = 240 },
]

[[rhythms]]
id = "short_long"
name = "Eighth and dotted quarter"
events = [
  { kind = "note", ticks = 240 },
  { kind = "note", ticks = 720 },
]

[[rhythms]]
id = "rest_response"
name = "Quarter, eighth rest, eighth"
events = [
  { kind = "note", ticks = 480 },
  { kind = "rest", ticks = 240 },
  { kind = "note", ticks = 240 },
]

[[rhythms]]
id = "three_note"
name = "Quarter and two eighths"
events = [
  { kind = "note", ticks = 480 },
  { kind = "note", ticks = 240 },
  { kind = "note", ticks = 240 },
]

[[rhythms]]
id = "return_five"
name = "Five-note return rhythm"
events = [
  { kind = "note", ticks = 480 },
  { kind = "note", ticks = 240 },
  { kind = "note", ticks = 240 },
  { kind = "rest", ticks = 240 },
  { kind = "note", ticks = 240 },
  { kind = "note", ticks = 480 },
]
```

### Melodic file

Store paired melody/rhythm presets in `data/ear_training_patterns.toml`:

```toml
schema_version = 1

[[patterns]]
id = "ascending_three"
name = "Ascending three"
degrees = [1, 2, 3]
rhythm_id = "three_note"

[[patterns]]
id = "descending_three"
name = "Descending three"
degrees = [3, 2, 1]
rhythm_id = "three_note"

[[patterns]]
id = "return_five"
name = "Five-note return"
degrees = [1, 2, 3, 2, 1]
rhythm_id = "return_five"
```

These two TOML examples form a valid starter registry together. Add further
presets through these files, keeping rejection examples only in tests. A
three-degree pattern referencing a two-note rhythm must fail validation.

Parse the files with static imports such as
`import rhythmText from "../data/ear_training_rhythms.toml?raw"`.
Export `parsePresets(patternText, rhythmText)` for tests and a normalized
registry for the app. Do not fetch presets on opening the tool or introduce
a code-generation step. Catch registry errors at the tool boundary so a bad
preset disables Ear Training with a readable message rather than crashing
other pages. Tests must also parse the actual repository preset files so
invalid shipped data fails CI.

Validate before casting parsed TOML to application interfaces:

- Version must be exactly 1; reject unknown fields to expose misspellings.
- IDs must be unique within their registry and match `[a-z][a-z0-9_]*`.
  Names must be nonempty strings. Files must have at least one entry.
- Each rhythm has 1–64 events, starts and ends with a note, and contains only
  `note`/`rest` kinds. Allowed durations are 120, 240, 360, 480, 720, 960,
  1440, and 1920 ticks. No zero, negative, fractional, or nonfinite values.
- Degree arrays have 1–16 positive integers, bounded to 1–28. A referenced
  rhythm must exist and have exactly as many note events as degrees.
- Reject unknown rhythm IDs with the filename, entry ID, and field in the
  message. TOML syntax failures should retain available line/column details.

The session pattern editor uses the same validation. Represent session entries
as `CustomPattern` with `id`, `name`, `degrees`, and `rhythmId`, where rhythmId
is a valid registry ID or `"automatic"`. Use a `custom_` ID prefix so session
entries cannot collide with shipped presets. Keep the session pattern registry
in reducer state; pass it alongside Settings and RNG to generation/validation.
A predefined preset edited by the learner becomes a custom copy.
Let users enter a name and degrees separated by spaces, commas, or hyphens,
then choose a compatible rhythm from a dropdown. Do not implement a scripting
language or require editing TOML in the browser. Edited copies of shipped
patterns are session data; never write back to repository TOML files.

## Rhythm generation

Expose **Varied rhythm** (default) and **Even notes**. In varied mode, let the
learner enable rhythmic motifs from the TOML registry. Enable all starter
motifs initially. In even mode, offer eighth, quarter, and half notes; quarter
is the default. Tempo remains 40–200 quarter-note beats per minute, default 80.

A predefined melodic preset carries its paired rhythm. In varied mode,
pattern generation uses that rhythm exactly; enabled rhythm selections govern
random pitches and custom patterns that choose automatic rhythm. For custom
patterns, offer either an explicit matching rhythm or **Automatic**. In even
mode, replace any paired rhythm with equal durations and no rests; make this
override visible in the UI.

For automatic rhythm, assemble **complete motifs** to obtain exactly N note
attacks. Do not truncate a motif or drop its rests to meet a length.

1. Compute each enabled motif's number of note events.
2. Use bounded dynamic programming over remaining note count (0–16). State
   also tracks note-duration diversity: none, one particular duration, or
   varied. Track this across motifs, not only within a motif.
3. For N >= 2, require at least two distinct note durations in the final
   rhythm. For N = 1, any eligible one-note motif is allowed.
4. Enumerate motifs whose append operation leaves a reachable completion;
   choose uniformly among those candidates using the injected random source,
   append the full motif, and continue until no notes remain.
5. If no completion exists, return a validation error explaining the selected
   note count and rhythms. Do not fall back to uniform notes or retry forever.

This chooses among valid next motifs; it does not promise a uniform
probability over all possible completed sequences. Array order is stable so
seeded tests are reproducible. Paired melodic presets may deliberately use a
uniform rhythm; the diversity requirement applies to automatic varied rhythm.

Rhythmic rests are explicit events. There is no second global gap added after
notes, and no random timing jitter. This prevents the sound and staff from
having different rhythms. Do not implement swing or tuplets in this release.

## Pitch generation and spelling

Implement pure functions with an injected `rng(): number` returning a value in
`[0, 1)`. Production passes `Math.random`; tests pass controlled values.

Define scale pitch-class offsets in this exact order:

| Scale ID                           | Semitone offsets     |
| ---------------------------------- | -------------------- |
| major                              | 0, 2, 4, 5, 7, 9, 11 |
| natural-minor / melodic-minor-down | 0, 2, 3, 5, 7, 8, 10 |
| harmonic-minor                     | 0, 2, 3, 5, 7, 8, 11 |
| melodic-minor-up                   | 0, 2, 3, 5, 7, 9, 11 |
| major-pentatonic                   | 0, 2, 4, 7, 9        |
| minor-pentatonic                   | 0, 3, 5, 7, 10       |
| minor-blues                        | 0, 3, 5, 6, 7, 10    |
| chromatic                          | 0 through 11         |

For random pitches, enumerate all concert MIDI notes in the inclusive range
whose pitch class is in the chosen scale, then sample independently with
replacement. For patterns, resolve degree d with scale size k as:

```text
midi = tonicMidi + 12 * floor((d - 1) / k) + offsets[(d - 1) % k]
```

Enumerate tonic octaves that keep **every** note in range. Choose an eligible
pattern uniformly, then an eligible tonic octave uniformly. Never wrap
individual out-of-range notes into a different octave.

Before playback, validate every selected key/scale combination. Deduplicate
identical combinations. Require an inclusive integer range inside MIDI 0–127,
low <= high, note count 1–16, and at least one in-range scale note. Also require
that the chosen sound supports the range. In patterns/mixed mode, every
selected combination must have an enabled, fitting pattern of the required
length. Mixed mode chooses random versus pattern generation with probability
0.5 for each exercise; it does not splice fragments together.

Generation order is: validate settings, choose one key/scale, choose source,
resolve rhythm and pitches, then zip pitches onto the rhythm's note events.
Calculate cumulative onset ticks including rests; save the immutable exercise.
Replay must not call the generator again.

For single/timed mode use N = 1, random pitches, and a quarter-note duration;
retain phrase-specific settings for returning to phrase mode. Make irrelevant
pattern/rhythm controls disabled rather than creating impossible timed settings.

### Display spelling and transposition

Use concert MIDI for sound and `displayMidi = concertMidi + 9` for alto view.
Alto preset written Bb3–F#6 corresponds to concert Db3–A5 (MIDI 49–81).
Changing view converts labels only. Do not transpose samples or subtract nine
again during playback. Reject alto display values beyond MIDI 127.

For the 12 tonic pitch classes use these canonical display roots:

- Major-family scales (major, major pentatonic): C, Db, D, Eb, E, F, Gb, G,
  Ab, A, Bb, B.
- Minor-family scales: C, C#, D, Eb, E, F, F#, G, G#, A, Bb, B.
- Chromatic: C, C#, D, D#, E, F, F#, G, G#, A, A#, B; use a neutral key
  signature and sharp spellings for chromatic notes.

Recompute the canonical display root after adding nine semitones for alto.
For diatonic scales advance consecutive letter names from that root. For
pentatonic use major degree letters 1/2/3/5/6 or minor 1/3/4/5/7. Minor blues
uses minor 1/3/4/b5/5/7; the b5 and 5 share a letter. Derive the accidental
needed to match the actual MIDI value, allowing double accidentals when
musically necessary. Determine octave from the spelled pitch, not a
pitch-class string alone; cover B#/Cb octave boundaries in tests.

Use the parent major/minor key signature for pentatonic, blues, and minor
variants. Raised sixth/seventh notes in minor variants appear as accidentals.
Do not infer the direction of melodic minor from a phrase's movement.

## Long-tone exercise

Add **Long tones** to the exercise selector in the same tool. This is a
play-along tone and breath-control exercise, not a hidden-note question.
Show the target pitch on the Western staff and as an octave-labelled name
throughout. Concert/alto view and piano/saxophone sound remain independent.
The app does not measure intonation, breath, loudness, or tone quality.

### Manual controls and defaults

Offer **Manual** and **Preset routine** within Long tones. Manual keeps the
single-round flow below; preset routines use the TOML contract in the next
section and advance between notes automatically.

- **Target:** Fixed note (default concert C4) or Random note. Fixed selection
  must lie within range and at least one selected key/scale combination.
  For fixed notes, choose uniformly among compatible selected combinations;
  for random notes, choose one selected combination and an in-range note.
  Every selected combination must have a nonempty range pool in random mode.
- **Hold:** 4, 8, or 16 quarter-note beats, default 8. Show the equivalent
  seconds beside the choice using the current tempo.
- **Preparation:** two silent beats before the tone, with a visible countdown.
- **Recovery:** 0, 4, or 8 silent beats after the tone, default 4.
- **Tempo:** reuse the shared 40–200 BPM control, default 80.
- **Sound, volume, range, and pitch view:** reuse the existing controls.

Explain the flow: prepare, sustain a steady note with the reference for as
long as comfortable, rest, then repeat or move on. The hold duration is a
practice target, not a measured result. The learner may stop at any point.
Do not show a successful-breath or in-tune indicator.

### Generation and playback contract

Generate a single note attack with duration `holdBeats * 480`. Prepend a
960-tick rest for preparation; append `recoveryBeats * 480` ticks of rest if
nonzero. Assign `source = "long-tone"`, `rhythmIds = []`, and `noteIndex = 0`.
The exercise duration includes preparation, hold, and recovery. These timing
values come from the explicit long-tone controls, not TOML melodic presets.
The TOML maximum event duration and start/end-with-note constraints apply to
preset data only; they must not reject this generated long-tone event list.

At the default 80 BPM with an eight-beat hold and four-beat recovery, expect:

| Phase      | Onset ticks | Duration ticks | Duration seconds |
| ---------- | ----------- | -------------- | ---------------- |
| Prepare    | 0           | 960            | 1.5              |
| Sustain C4 | 960         | 3840           | 6                |
| Recover    | 4800        | 1920           | 3                |

Total: 6720 ticks / 10.5 seconds. There is exactly one sample attack at
1.5 seconds. Do not retrigger the tone on each beat or at bar boundaries.
Engrave the sustained note with ties across bars. Show preparation/recovery
in separate phase indicators rather than including those rests in the target
staff. Keep their timing in the canonical event list for the player.

In `playing` status, derive the displayed phase and remaining beats/seconds
from the audio clock and the current event. Keep `revealed = true`; no recall
countdown or automatic next round runs. Disable reveal mode, first-note hint,
phrase length, generation choice, and rhythm selectors while retaining their
ordinary-practice values for switching back. Long tones bypass ordinary
pattern eligibility and rhythm-diversity checks.

**Replay** repeats the exact target and timing, including preparation and
recovery. **Next** generates using pending settings: fixed mode keeps the
chosen note; random mode may choose another. Space performs Next because the
target is visible. **Stop**, hidden-page handling, errors, and unmount cancel
all phases immediately. Recovery completion enters ready and counts this
exercise once. Interrupting a long tone does not count it as completed, and
a replay after completion does not increase the count.

Use a continuous sampled tone throughout the hold. Saxophone samples need a
verified sustain loop or enough recorded duration at the selected playback
rate. Piano retains its initial attack and uses a crossfaded sampled sustain for
long holds; label this behavior rather than promising an unmodified natural
decay. Do not fake sustain by
repeating sample attacks. Real sample checks at the 24-second maximum are
part of acceptance.

### TOML preset routines

Store predefined routines in **`data/ear_training_long_tones.toml`**, imported
statically with `?raw` and validated alongside the melodic/rhythmic registries.
Do not embed routine definitions in UI components. Extend `parsePresets` to
accept a third `longToneText` argument and return a routine registry as well.
The earlier two-argument signature describes only the melody/rhythm stage.

Ship a small library of routines rather than a single fixed workout. The
five-minute G-major example below is one preset, not a universal timing rule:

```toml
schema_version = 1

[[routines]]
id = "g_major_five_minutes"
name = "G major — 5 minutes"
pitch_basis = "concert"
tonic_midi = 67
scale_id = "major"
degrees = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2]
hold_ms = 5000
rest_ms = 2000
total_ms = 300000
preparation_ms = 0
```

Here G major explicitly means **concert G major**, starting at G4 (MIDI 67).
The order is G4, A4, B4, C5, D5, E5, F#5, G5, F#5, E5, D5, C5, B4, A4,
then repeat from G4. Every played note lasts five seconds and is followed by
a two-second rest. This is an ordered scale exercise, not random pitch choice.

Support `pitch_basis = "concert"` and `"alto-eb"`; the starter library below
includes both concert-pitch and written alto-saxophone routines. For alto-basis routines,
expand degrees in written MIDI first, then subtract nine to store concert
MIDI. For this preset, switching to alto display shows written E major while
the sounding G-major routine stays unchanged. Show the pitch basis and range
in the preset description so a learner can distinguish these cases.

### Starter routine library

Add the following entries to the **same** `data/ear_training_long_tones.toml`
file after the G-major entry. Do not repeat `schema_version` for every entry.
These are original practice suggestions, not transcriptions or claims about
an authoritative teaching method. Longer holds are optional practice targets;
learners can stop or choose a shorter routine at any time.

| Preset                      | Goal and note order                             | Total | Hold / rest | Complete holds | Extra cooldown |
| --------------------------- | ----------------------------------------------- | ----- | ----------- | -------------- | -------------- |
| G major — 5 minutes         | Original concert G4–G5 scale up and down        | 5 min | 5 s / 2 s   | 42             | 6 s            |
| C major — short warm-up     | Concert C4–G4, stepwise up and down             | 3 min | 3 s / 3 s   | 30             | 0 s            |
| Alto G — repeated tonic     | Written G4 each time; sounds concert Bb3        | 5 min | 5 s / 5 s   | 30             | 0 s            |
| F major — gentle steps      | Concert F4–C5, stepwise up and down             | 4 min | 6 s / 4 s   | 24             | 0 s            |
| D major — triad tones       | Concert D4, F#4, A4, F#4, repeated              | 5 min | 6 s / 4 s   | 30             | 0 s            |
| A minor — scale loop        | Concert A3–A4 natural minor up and down         | 5 min | 8 s / 4 s   | 25             | 0 s            |
| Alto G — octave alternation | Alternate written G4/G5; sounds concert Bb3/Bb4 | 6 min | 8 s / 7 s   | 24             | 0 s            |
| C major — extended holds    | Concert C4–G4, stepwise up and down             | 5 min | 10 s / 5 s  | 20             | 0 s            |

```toml
[[routines]]
id = "c_major_short_warmup"
name = "C major — short warm-up"
pitch_basis = "concert"
tonic_midi = 60
scale_id = "major"
degrees = [1, 2, 3, 4, 5, 4, 3, 2]
hold_ms = 3000
rest_ms = 3000
total_ms = 180000
preparation_ms = 0

[[routines]]
id = "alto_g_repeated_tonic"
name = "Alto G — repeated tonic"
pitch_basis = "alto-eb"
tonic_midi = 67
scale_id = "major"
degrees = [1]
hold_ms = 5000
rest_ms = 5000
total_ms = 300000
preparation_ms = 0

[[routines]]
id = "f_major_gentle_steps"
name = "F major — gentle steps"
pitch_basis = "concert"
tonic_midi = 65
scale_id = "major"
degrees = [1, 2, 3, 4, 5, 4, 3, 2]
hold_ms = 6000
rest_ms = 4000
total_ms = 240000
preparation_ms = 0

[[routines]]
id = "d_major_triad_tones"
name = "D major — triad tones"
pitch_basis = "concert"
tonic_midi = 62
scale_id = "major"
degrees = [1, 3, 5, 3]
hold_ms = 6000
rest_ms = 4000
total_ms = 300000
preparation_ms = 0

[[routines]]
id = "a_minor_scale_loop"
name = "A minor — scale loop"
pitch_basis = "concert"
tonic_midi = 57
scale_id = "natural-minor"
degrees = [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2]
hold_ms = 8000
rest_ms = 4000
total_ms = 300000
preparation_ms = 0

[[routines]]
id = "alto_g_octave_alternation"
name = "Alto G — octave alternation"
pitch_basis = "alto-eb"
tonic_midi = 67
scale_id = "major"
degrees = [1, 8]
hold_ms = 8000
rest_ms = 7000
total_ms = 360000
preparation_ms = 0

[[routines]]
id = "c_major_extended_holds"
name = "C major — extended holds"
pitch_basis = "concert"
tonic_midi = 60
scale_id = "major"
degrees = [1, 2, 3, 4, 5, 4, 3, 2]
hold_ms = 10000
rest_ms = 5000
total_ms = 300000
preparation_ms = 0
```

The original routine block and this continuation block together define eight
presets. In every routine, cycle the degree sequence as many times as needed;
the duration may end after a partial pass through the sequence. Do not extend
practice to finish a scale, drop the final prescribed rest, or force every
routine to have 42 notes. Calculate counts and cooldown from each entry.

Use the short C-major warm-up as the initially selected preset when switching
from Manual into Preset routine for the first time; retain the learner's
selection for the rest of the mounted session. Present the goal, pitch basis,
range, and timings before Start. Distinguish the two alto G routines from
concert G major in the selection labels.

### Routine types and validation

Use a dedicated schema, not `MelodicPreset`: a timed routine repeats a whole
sequence and is not limited to a 16-note phrase.

```ts
interface LongToneRoutinePreset {
  id: string;
  name: string;
  pitchBasis: PitchView;
  tonicMidi: number;
  scaleId: ScaleId;
  degrees: readonly number[];
  holdMs: number;
  restMs: number;
  totalMs: number;
  preparationMs: number;
}

interface LongToneRoutinePlan {
  id: number;
  presetId: string;
  sound: SoundId;
  events: readonly ExerciseEvent[]; // canonical concert pitches, as elsewhere
  totalTicks: number;
  transportBpm: 60;
  repetitions: number; // individual held notes, not sequence cycles
  cooldownTicks: number;
}
```

Map TOML snake_case fields to these camelCase types. The schema uses
`pitch_basis = "alto-eb"` for the same `PitchView` value as the UI. Reject
unknown fields, duplicate/invalid IDs, missing names, unknown scale IDs, and
invalid pitch bases. Require MIDI tonic 0–127 and 1–64 positive degree
integers in 1–28. All expanded concert pitches must be in MIDI 0–127 and
supported by the chosen sound. Derive the routine range from its expanded
notes rather than clipping it to the manual practice range.

Timing fields are integer milliseconds divisible by 250: hold 1000–24000,
rest 0–60000, total 1000–3600000, and preparation 0–10000. A preset must fit
at least one complete hold/rest pair after preparation. Total duration
includes preparation, all holds, all rests, and any final cooldown. Loading
and the audio scheduling lead are outside the advertised practice duration.

### Exact duration and automatic sequencing

Keep each preset's declared holds and rests intact; do not shorten a last
note to fit the timer. Compute:

```text
availableMs = totalMs - preparationMs
pairMs = holdMs + restMs
repetitions = floor(availableMs / pairMs)
cooldownMs = availableMs - repetitions * pairMs
```

Expand `repetitions` notes by cycling through `degrees` in their declared
order. Emit an optional preparation rest, then a note and rest for each
repetition (omit zero-length rests), then a final silent cooldown if nonzero.
The cooldown is separate from the last regular rest. Explain it in the
preset preview rather than silently leaving time unaccounted for.

For the example: **42 notes × (5 seconds + 2 seconds) = 294 seconds**, followed
by **6 seconds of cooldown**, totaling exactly **300 seconds**. This is three
complete passes through the 14-note sequence. Sounding time is 210 seconds;
regular rests total 84 seconds. The last A4 begins at second 287, ends at
292, rests until 294, and the cooldown finishes at 300. No 43rd note starts.

Seconds-based routines are independent of the user's phrase BPM. Use an
internal transport of 60 BPM: `ticks = milliseconds * 480 / 1000`, yielding
integer ticks for the allowed timing values. At this transport each hold is
2400 ticks, each rest 960, the cooldown 2880, and the total 144000. Pass the
plan's transport BPM to the shared scheduler; do not substitute Settings.bpm.
Keep the manual beat-based long-tone model separate so changing shared tempo
does not change a five-second preset hold. Engrave each target using this
transport and show “hold 5 seconds” rather than implying the phrase tempo.

The routine's preset selection replaces manual key/scale, range, order, hold,
recovery, and tempo controls while it is selected. Keep those manual values
for returning to Manual. Sound, volume, pitch view, and note-name visibility
remain available. Changing preset or sound takes effect on the next explicit
Start/restart; it must not mutate an active plan.

Selecting a preset shows its duration, scale and pitch basis, range, sequence,
hold/rest times, complete-note count, and cooldown. **Start routine** begins
only after successful sample preparation; automatic sequencing then runs
through the plan without Next clicks. Show current target, note X of the calculated total (42 for the G-major example),
phase (prepare/hold/rest/cooldown), phase seconds remaining, and total seconds
remaining. Show the next target during rest. Targets are always visible.

During a routine disable ordinary Replay, Next, and their Space shortcut so
skips cannot invalidate the duration promise. Provide **Stop** and **Restart
routine**. Stop/hide/navigation cancel all scheduled work; no automatic resume.
Restart begins a fresh plan from the start, after a new explicit action.
Space is ignored in routine mode; focused buttons retain normal activation.
On completion stop sound, enter ended, and show routine results automatically.
This automatic progression is specific to preset long-tone routines; manual
long tones and ear-training recall modes retain their earlier behavior.

Reuse sample caches, gain, cancellation tokens, and the same audio clock.
Schedule routine sources with a rolling one-second lookahead, replenished
about every 100 ms; source start/end times must still be absolute audio-clock
timestamps. If a background suspension or delayed refill misses a note onset,
stop as interrupted rather than playing late or compressing the sequence.
Always cap the final envelope and scheduled sources at the routine deadline.
Clear the lookahead timer in addition to sources and animation frames on stop.

Track routine results separately: completed holds (credited at their note end,
not rest end), actual active practice seconds, planned duration, and completion
versus interruption. A stopped partial hold does not count. Ear-training
exercise counts must not increase for each routine note. No routine counts as
completed before its final cooldown ends; do not imply that played reference
notes prove the learner sustained them.

## Staff rendering

Use VexFlow's SVG renderer in an effect owned by the staff component; clear
and rebuild its container when the exercise, view, visibility, or measured
width changes. Dispose the ResizeObserver and remove old SVG on cleanup.
The [VexFlow project](https://github.com/0xfe/vexflow) provides the renderer;
read the installed version's types and examples before using its APIs.

Use 4/4 bars, treble clef, and real durations. Split any event crossing a
1920-tick bar boundary. Decompose remaining durations into supported note
values, using dotted values where possible. Tie all fragments of the same
note attack; split rests without ties. Beam eighth/sixteenth notes within
quarter-beat groups. An incomplete final bar stays incomplete: do not add
playback padding or invent a new time signature.

Keep an engraving-fragment-to-`noteIndex` mapping. All tied segments highlight
for the same sustained audio note. Do not reattack a tied segment. Rest
segments have no active note highlight. Playback uses the original event list,
never the engraving fragments.

Project visibility **before** constructing SVG or accessible note text:

- Hidden: render a neutral listening placeholder, no hidden full-score DOM.
- First-note hint: engrave only the first note, with no later pitches, rhythms,
  durations, or accessible descriptions leaked through hidden elements.
- Revealed/always visible: engrave the full phrase and optional octave labels.

Reflow into multiple systems at narrow widths, preserving a practical minimum
note spacing. Use horizontal overflow as a last resort; do not shrink a long
phrase until it is unreadable. The staff must not steal keyboard focus.

## Sample assets and audio scheduling

Use native Web Audio with decoded sampled instruments. Do not render MP3s or
create score/audio exports. Samples are source assets from a licensed pack,
not generated practice recordings. Load sample bytes after explicit Start,
not at module import time. Asset requests are allowed; they are not code
splitting.

**Asset dependency:** this repository does not currently provide a verified
piano/saxophone sample manifest. Asset acquisition is a required implementation
step, not an assumed existing resource. Do not invent download URLs or claim
that the existing SF3 can be decoded with `decodeAudioData`. Select a pack
with redistribution rights, retain its license/attribution and original
checksums, and populate a checked-in metadata manifest. Keep downloaded audio
in ignored build/static output, obtainable through an explicit reproducible
asset-preparation command. Do not commit audio exports or silently substitute
an oscillator when real samples are unavailable. A missing pack must produce
a clear loading/setup error; it is a release blocker for that instrument.

Each manifest sample record needs `sound`, `rootMidi`, HTTPS `sourceUrl`,
`sha256`, local served URL, and optional loop-start/end seconds. Per instrument
record declared supported low/high MIDI and license/provenance. The preparation
command verifies checksums and writes only ignored assets; production runtime
loads self-hosted URLs. Add its invocation before dev/build so a clean checkout
has a documented path to playable assets. Asset failures must fail clearly.

Choose the nearest supported root sample, breaking equal-distance ties toward
the lower root. Rate is `2 ** ((targetMidi - rootMidi) / 12)`. Require a root
within three semitones for every supported pitch. Validate loop bounds against
the decoded buffer; use a valid sustain loop or require enough resampled
buffer duration for the whole note. Never silently let a saxophone sample end
early on a long note. The longest phrase-preset note is six seconds at 40 BPM. Long-tone practice
requires a 16-beat / 24-second sustain at that tempo; validate assets against
that longer requirement, not just ordinary phrase lengths.

Cache decoded buffers by sound/sample URL for the mounted tool. Remove failed
load promises so Retry works. Resume/create AudioContext inside Start/Replay/
Next user gestures. Use a master GainNode (initial gain 0.5) and a per-note
GainNode for a short attack/release envelope to avoid clicks. The envelope
fits inside the notated duration; explicit rests supply silence.

Schedule notes against one AudioContext clock, with a 50 ms scheduling lead:

```text
secondsPerTick = 60 / bpm / 480
start = context.currentTime + 0.05
noteStart = start + onsetTicks * secondsPerTick
noteEnd = noteStart + durationTicks * secondsPerTick
exerciseEnd = start + totalTicks * secondsPerTick
```

Use a fresh source node for each attack and replay. The Web Audio API's
[buffer source nodes](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)
are single-use; decoded buffers can be reused. Its
[playbackRate](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate)
changes sample speed and pitch.

All assets needed for an exercise must load successfully before scheduling.
Audio-source start times drive rhythm; do not use a JavaScript interval to
start individual notes. Use requestAnimationFrame to read the audio clock for
highlighting, completion, and countdown. Prefer the browser's
[output timestamp](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp)
for mapping audible progress when available; otherwise use the audio clock.
Never derive note timing by accumulating React timer callbacks.

On completion, start the recall period from exerciseEnd, not when the asset
request began or the Play button was pressed. In the fallback clock path,
allow reported output latency before starting the visible recall period.
Volume uses the master gain and does not regenerate events.

Expose an imperative player with `prepare(exercise)`, `play(exercise)`,
`stop()`, `setVolume(value)`, and `dispose()`. `play` reports its start/end
clock times and supports cancellation. Track source/gain nodes and disconnect
them when finished or stopped. Close the AudioContext and clear caches when
the component is disposed; no global engine starts merely from an import.

## Session state and race handling

Keep imperative audio in refs and serializable UI/session data in a reducer.
Use these statuses: `idle`, `loading`, `playing`, `recalling`, `ready`,
`stopped`, `error`, `ended`. Reveal is a separate flag; a phrase can be visible
while playing. Keep the current exercise on stop or recoverable error.

| Action             | Required behavior                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Start              | Validate settings, begin session, generate once, prepare, play.                                          |
| Next               | Cancel previous work, validate pending settings, generate once, reset visibility, prepare, play.         |
| Replay             | Cancel previous work and replay the retained snapshot; never reroll rhythm, notes, instrument, or tempo. |
| Show notes         | Set revealed, cancel pending reveal, keep sound playing if already playing.                              |
| Playback ends      | Count completion once; enter recalling if hidden with delayed/timed reveal, otherwise ready.             |
| Recall deadline    | Reveal and enter ready; do not automatically advance.                                                    |
| Stop / page hidden | Cancel sound, animation frame, requests, and reveal deadline; preserve exercise and visibility.          |
| End                | Cancel all work and show summary; no automatic restart.                                                  |
| Error              | Stop current work, preserve settings/exercise, expose Retry.                                             |

Replay in timed mode hides again and starts a fresh recall period after audio.
Ordinary replay preserves revealed notes; if still hidden, restart its delayed
reveal after playback. First-note hint is forced off in timed mode.
Always-visible mode and a one-note first-note hint count as fully revealed.

Every Start/Next/Replay/Retry gets a monotonically increasing operation token.
Stop, hide, end, and unmount invalidate it. Check it after every awaited load
and before every callback dispatch; stale operations cannot start sound,
reveal old notes, overwrite errors, or increment counts. Abort fetches where
possible. An AudioContext entering a non-running state interrupts practice
like Stop; no catch-up playback on returning to the tab.

Disable advancement controls while loading. Retry prepares and plays the
same exercise without generating another one. If validation fails on Next,
retain the old exercise and show field errors. Do not begin an overlapping
session. Bind cleanup to unmount and document visibility changes, accounting
for React StrictMode's setup/cleanup cycle.

Default settings: phrase/random, 3 notes, C major, concert C4–C5, piano,
80 BPM, varied rhythm, all starter motifs enabled, request reveal, no hint,
labels on, 5-second recall. Long-tone defaults are fixed concert C4, eight
hold beats, and four recovery beats. Restore these for a new session unless the learner
keeps current settings explicitly; no localStorage persistence in v1.

The Space handler runs only during an active session with a current exercise.
Ignore repeat/composing/modifier events, interactive/editable targets, and an
open modal/dialog/search overlay. A hidden phrase reveals; an already visible
phrase advances. Do not intercept Space in the loading/error/ended states.
Prevent scrolling only when actually handling the shortcut. Pass the shell's
search/modal-open state into the tool as `shortcutsEnabled` so a background
listener cannot advance while the command palette is open.

Count exercises once by exercise ID on their first successful completed
playback, including completion reached through Retry/Replay after an initial
interruption. Do not increment for later replays, partial playback, or failed
loads. Summary reports count, completed key/scale combinations, and elapsed
wall-clock session time from first Start to End. Do not report accuracy.

## Worked fixtures and tests

### Exact rhythmic example

For concert C major, tonic MIDI 60, pattern `return_five`, and 120 BPM, expect:

| Event  | MIDI | Onset ticks | Duration ticks | Onset seconds relative to scheduled start |
| ------ | ---- | ----------- | -------------- | ----------------------------------------- |
| Note 0 | 60   | 0           | 480            | 0                                         |
| Note 1 | 62   | 480         | 240            | 0.5                                       |
| Note 2 | 64   | 720         | 240            | 0.75                                      |
| Rest   | —    | 960         | 240            | 1.0                                       |
| Note 3 | 62   | 1200        | 240            | 1.25                                      |
| Note 4 | 60   | 1440        | 480            | 1.5                                       |

The exercise lasts 1920 ticks / 2 seconds, has five attacks and one rest.
In alto view these sound identically but display A4, B4, C#5, B4, A4 with an
A-major signature. Replay preserves every value. A five-second recall period
reveals at seven seconds relative to scheduled start, plus output-latency
compensation when needed.

### Automated coverage

Use Vitest for meaningful behavior tests next to the model, presets, audio,
and reducer. Keep tests independent of Carnatic converter snapshots.

- Parse actual shipped TOML; reject duplicate IDs, unknown versions/fields,
  malformed events, nonexistent rhythms, and degree/note-count mismatches.
- Cover every scale's membership and degree expansion, inclusive range edges,
  octave fitting, empty pools, and unsatisfied mixed-mode patterns.
- Test long-tone fixed/random selection, scale/range validation, default
  10.5-second fixture, single attack across ties, zero recovery, and 24-second
  maximum hold. Verify preparation/recovery cancellation, retained settings,
  always-visible behavior, and once-only completion after recovery.
- Parse all eight shipped long-tone presets and assert their table totals,
  hold counts, cooldowns, degree ordering, and pitch basis conversions. Check
  repeated tonic stays on one pitch, triad tones use degrees 1/3/5/3, minor
  uses natural-minor offsets, and octave alternation has exactly 12 semitones
  between targets. Require unique IDs and full holds/rests for partial passes.
- Check the G-major routine's ordered MIDI
  pitches, 42 holds, 210 seconds sounding, 84 seconds regular rest, six-second
  cooldown, and 144000 total ticks at its fixed transport. Assert final note
  onset/end at 287/292 seconds, no 43rd attack, and completion at 300 seconds.
  Cover exact divisibility (zero cooldown), preparation included in total,
  invalid timing values, unsupported sample range, alto-basis conversion,
  BPM independence, missed-lookahead interruption, cleanup, and restarted
  plans not accepting stale callbacks or counts.
- With controlled RNG, prove selection of each source/key, exact note count,
  rests consuming time but not degrees, and no out-of-range pitches.
- For lengths 2–16 prove default automatic rhythms have varied durations.
  Verify unreachable note counts fail and one-note/even modes work.
- Check the worked fixture exactly. A bar-crossing sustained note must become
  tied staff fragments while remaining one playback event and one attack.
- Check concert-to-alto MIDI +9, range conversion, octave boundaries, flats,
  minor raised tones, blues b5, and unchanged playback after changing view.
- Use fake AudioContext/source nodes to assert scheduled timestamps, rate,
  stop/disconnect cleanup, volume, fetch failure/retry, and stale-load rejection.
  Do not claim fake-node tests prove audible sample quality.
- Test reducer/controller sequences: reveal while playing, early reveal,
  timed replay, interrupted first playback, completion counting once, rapid
  Next/Stop, leaving during loading, hidden-page cancellation, and no late
  dispatch after unmount. Inject clock/player boundaries rather than sleeping.

### Manual acceptance and commands

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` after
implementation. The build must retain hard notation validation. Run
`npm run bench:content -- --count 15000` if changing the content build or index;
this feature should not require such a change.

Verify desktop and narrow-screen flows, direct URL/back/forward, audio unlock
in supported browsers, keyboard-only use, search-modal shortcut suppression,
all visibility modes, first-note hint, delayed/timed reveal, and real rhythmic
rests. Run long-tone fixed/random rounds with zero and nonzero recovery;
check audible sustain, phase countdowns, ties, and stopping during every phase. Inspect SVG ties, beams, accidentals, ledger lines, and replay highlights.
Use the audible fixture to check sample pitch, note lengths, and tempo at
40/80/200 BPM. Hide the tab, navigate away, and retry failed sample loads.
Check the console for leaked contexts, duplicate playback, and cleanup errors.
Inspect the production bundle to confirm this feature adds no dynamic imports
or dedicated code-split chunks. Audio asset downloads remain separate assets.

## Implementation order and completion gates

1. **Model and TOML:** add validated presets, pitch/rhythm generation, and pure
   tests, including the long-tone routine registry. Gate: rhythmic and
   five-minute routine fixtures plus invalid-input tests pass.
2. **Assets and player:** verify licenses, add reproducible preparation and
   manifest, implement scheduling/cancellation. Gate: both instruments play
   the fixture and sustain the longest supported notes without early cutoff.
3. **Staff:** add static VexFlow dependency and engraving adapter. Gate:
   pitches, rests, ties, and transpose agree with model/audio.
4. **Session UI:** add reducer, controls, editor, visibility, keyboard shortcuts,
   summary, long-tone phases, and cleanup. Gate: manual listening, timed
   self-check, and long-tone loops work fully.
5. **Shell integration:** add the statically imported tool route and responsive
   styles. Gate: direct navigation, search overlay, back/forward, and existing
   tools work; required checks pass.

Do not stop at an oscillator demo, a text-only note list, equal-duration random
notes, or hard-coded component presets. Report incomplete asset/licensing work
explicitly. Do not stage, commit, or push files without explicit authorization.
