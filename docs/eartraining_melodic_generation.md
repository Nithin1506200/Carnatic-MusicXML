# Melodic ear-training generation

This extends [the implementation guide](eartraining_implementation.md). The
original uniform sampler picked each pitch independently from the entire scale
range. The melodic generator instead considers previous notes, rhythm,
harmonic context, and the intended ending.

## Controls

Melodic generation applies to the random branch of phrase practice, including
the random half of Mixed mode. It does not alter predefined/user patterns,
single-note questions, or long-tone exercises.

| Control                  | Meaning                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Melodic / Uniform random | Melodic uses contextual weights; Uniform retains the original independent sampler.                  |
| Variation, 0–100         | Changes the spread of preferred intervals and register, plus contour/motif flexibility. Default 25. |
| Randomize variation      | Samples one value per new phrase between the configured minimum and maximum, default 20–50.         |
| Maximum leap             | Hard semitone limit between adjacent notes, default 7. Variation cannot override it.                |
| Chromaticism             | Off, light, moderate, or adventurous. Controls opportunities for resolved chromatic gestures.       |
| Harmony                  | Scale only, tonic chord, I–IV–V–I, or ii7–V7–Imaj7.                                                 |
| Chord emphasis           | Low, medium, or high preference for chord tones on accented/longer notes.                           |
| Contour                  | Free, rising, falling, arch, or returning; a probabilistic preference within the selected range.    |

Low variation does not mean every note is identical. It makes smaller intervals
and a narrower register more likely. High variation does not guarantee leaps,
and the configured maximum leap remains binding. Short phrases need not have
an empirical pitch variance matching the control value.

Chromaticism is independent of variation. Increasing chromaticism does not
increase the maximum leap or enable unrestricted out-of-key sampling.
Uniform mode bypasses the melodic controls rather than pretending to apply
them to independent uniform sampling.

## Generation flow

1. Validate settings and choose one of the selected key/scale combinations.
2. Choose pattern or random generation according to the existing mode.
3. Build the complete rhythm before choosing random melodic pitches. Preserve
   note count, rests, note lengths, and onset ticks.
4. For melodic generation, choose the variation once and establish the harmonic
   context over the phrase timeline.
5. Compute backward log probabilities for valid paths to the ending. Sample
   each next pitch using both its local musical weight and the probability of
   completing the remaining phrase smoothly.
6. Apply context-dependent weights for interval size, register, harmonic
   stability, contour, repetition, and recovery after a leap.
7. Permit chromatic gestures only when their resolution can fit in remaining
   note slots. Preserve the requested total note count.
8. Freeze the resulting exercise, including the actual sampled variation and
   chord timeline. Replay plays that same event list without rerunning sampling.

Patterns keep their exact degree sequence and paired rhythm. Any melodic
settings shown alongside Mixed mode affect only its generated branch.

## Mathematical model

The design combines a proximity-weighted walk with register attraction and
context-dependent transitions. Conceptually, candidate pitch p receives:

```text
weight(p) = exp(
  -(p - previousPitch)^2 / (2 * stepSpread^2)
  -(p - registerCenter)^2 / (2 * registerSpread^2)
) * harmonyWeight * contourWeight * repetitionAndResolutionWeight
```

Normalize candidate weights to probabilities and sample using the injected
random source. Use numerical stabilization when calculating very small
weights. Backward probability messages include the remaining path cost, not
just a boolean check that an ending can be reached. This prevents short, low-
variation phrases from postponing a large forced jump until the final note.
Repetition penalties grow with variation so low settings can sustain or repeat
notes rather than being pushed into unnecessary changes. Hard constraints remove candidates before weighting; they must not
be implemented merely as penalties that randomness can ignore.

This is a rule-based stochastic model with explicit parameters. It does not
train a model, require a dataset, or call a remote AI service.

The approach is informed by Temperley's proximity/register/key model,
[described in his ISMIR paper](https://archives.ismir.net/ismir2006/paper/000030.pdf),
and research on
[constrained Markov generation](https://ijcai.org/proceedings/2011/113).
The specific weights and defaults are application design choices, not values
claimed to be experimentally optimal.

## Harmony and chromaticism

Progression definitions live in `data/ear_training_harmony.toml`. The two
progressions currently require Major for every selected key. Tonic-chord
practice supports tonal scales using major/minor harmony; a chromatic scale
uses Scale only because it has no implied tonic triad.

Each phrase traverses one progression. Chord changes align to actual note
onsets; shorter-than-progression phrases omit intermediate changes while
retaining the first and last harmony (a one-note phrase uses the final tonic).
There are no zero-duration phantom chords. TOML root offsets and qualities
specify harmony; there is no fixed four-beat chord duration to prevent a short
exercise from reaching its final tonic.

Chord structure guides the melodic line; it does not add audible chord
accompaniment. The harmonic timeline uses the phrase's actual rhythmic
positions, including rests. Prefer nearby chord tones at changes rather than
independently jumping to a new root in another register. Longer notes and
accented positions receive stronger harmonic preferences.

Passing, neighboring, and approach gestures add controlled tension. The
basic embellishment vocabulary follows the
[University of Puget Sound music-theory examples](https://musictheory.pugetsound.edu/mt21c/AddingNonChordTones.html).
Require an in-range resolution and enough remaining note slots before choosing
an out-of-scale tone. Do not end with an unresolved chromatic note. These
constraints describe this tool's practice style rather than universal rules
for composition or jazz improvisation.

One illustration over a G-major context is `G4 A4 B4 C#5 D5 B4 A4 G4`:
C#5 approaches D5 by a semitone. Enabling chromaticism explicitly relaxes
scale membership for eligible gestures; it never relaxes instrument range or
maximum leap. An out-of-chord note can still belong to the scale and must not
be mistaken for a chromatic note.

## Validation and verification

Reject invalid variation ranges and unsupported harmonic/scale combinations
with useful messages. Do not silently switch the key, remove a chord, disable
chromaticism, widen the range, or exceed the maximum leap to satisfy a phrase.
If no valid constrained path exists, report that the learner should adjust
settings. All searches must terminate predictably.

Tests should check exact note counts and rhythm preservation, range and leap
limits, scale membership with chromaticism off, resolved chromatic gestures,
harmonic timelines, and reproducible seeded generation. Compare distributions
across many seeded phrases to verify that variation affects melodic spread;
do not demand a particular empirical variance from one short phrase.

Check replay after changing pending settings, both pitch views, hidden-note
behavior, and Mixed mode. The staff must show the actual generated chromatic
pitches and accidentals. No new code splitting or changes to the audio engine
are required.

The UI distinguishes the active phrase's sampled variation from the next
phrase's setting. When randomization is enabled, the pending label shows the
minimum–maximum interval instead of an inactive fixed slider value. Changing
settings never rewrites an exercise being replayed.
