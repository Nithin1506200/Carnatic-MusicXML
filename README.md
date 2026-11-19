# Carnatic Music for Alto Saxophone

An LLM-friendly collection of Carnatic lessons and compositions arranged for
alto saxophone in MuseScore.

The default project convention is **written `Sa = G` on E-flat alto
saxophone**, which sounds as concert `Bb`. The complete, canonical writing
rules are in [the Carnatic saxophone memory bank](docs/carnatic_saxophone.md).

## Learning path and repository index

| No. | Section                                                             | Purpose                                                             | Status      |
| --: | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------- |
|   1 | [Training and sight-reading](docs/01_training_and_sight_reading.md) | Practice order, rhythm, breath, fingering, and reading rules        | Scaffolded  |
|   2 | [Basic notes and raga list](docs/02_basics_and_ragas.md)            | Swaras, octaves, exercises, alankaras, geethams, and raga reference | In progress |
|   3 | [Jatiswara](docs/03_jatiswara.md)                                   | Jati and swara-based pieces                                         | Planned     |
|   4 | [Krithis](docs/04_krithis.md)                                       | Kriti/kruthi repertoire                                             | Planned     |
|   5 | [Varnams](docs/05_varnams.md)                                       | Varnam repertoire and practice order                                | In progress |
|   6 | [Bhajans](docs/06_bhajans.md)                                       | Bhajane/bhajan repertoire                                           | Planned     |

Common spelling variants are accepted in discussion. Repository headings use
**Jatiswara**, **Kriti**, **Varnam**, and **Bhajan** consistently; a score's
original title and language should always be preserved.

## Available scores

| Section            | Composition                                                     | Raga            | Tala                        | Composer             | Files                                                                                                                                          |
| ------------------ | --------------------------------------------------------------- | --------------- | --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Basics / Exercises | Swara Adhyaaya — Sarale Varase to Saptasulaadi Taala Alankaaras | Mayamalavagowla | Aadi and Saptasulaadi talas | Traditional          | [Swaras](scores/02_basics/sarale_varase_to_alankaaras.mdx) · [MuseScore](scores/02_basics/sarale_varase_to_alankaaras.mscz)                    |
| Basics / Geetham   | Sri Gananatha (Lambodara Geetham)                               | Malahari        | Rupaka, `2 + 4`             | Purandara Dasa       | [Swaras, lyrics, and meaning](scores/02_basics/sri_gananatha_geethe.mdx) · [MuseScore](scores/02_basics/sri_gananatha_geethe.mscz)             |
| Varnam             | Ninnu Kori Yunnara                                              | Vasantha        | Aadi, `4 + 2 + 2`           | Tacchur Singarachari | [Carnatic notation, lyrics, and meaning](scores/05_varnams/ninnu_kori_vasantha_varnam.mdx)                                                     |
| Bhajan             | Bhagyada Lakshmi Baaramma                                       | Madhyamavathi   | Aadi, `4 + 2 + 2`           | Purandara Dasa       | [Swaras, lyrics, and meaning](scores/06_bhajans/bhagyada_lakshmi_baaramma.mdx) · [MuseScore](scores/06_bhajans/bhagyada_lakshmi_baaramma.mscz) |

## Static website

The Vite and React website discovers this README, repository documentation, and
score MDX during its build, then generates a fully static site. MDX is compiled
to the existing React notation components at build time. Every document is
loaded on demand; the entry bundle knows only the documentation pages and the
score group counts. Scores are listed from a lazily fetched catalog and found
through a lazily built in-browser search index (title, alternate titles, raga,
tala, composer, and `keywords`; documentation pages also match on their text),
both emitted by `scripts/build-index.mjs` as compact, hashed, immutable assets.
Score pages render the repository's MuseScore `.mscz` files directly in the
browser as paginated SVG notation. The build copies the source archives and
self-hosted WebAssembly renderer into ignored, generated static assets; it does
not create or commit MusicXML, PDF, image, or audio exports.

The content build (`npm run content`) renders each document once and caches
the result under `.cache/content/` by source hash, rendering changes in worker
threads, so rebuilds re-render only what changed and every notation or
metadata error is reported together. `npm run bench:content -- --count 15000`
measures the build and artifact sizes against a synthetic library of that size.

```sh
npm ci
npm run dev
npm test
npm run validate:notation
npm run build
```

### Ear Training

Open **Tools → Ear Training** (or `?doc=ear-training`) for Western-notation
listening practice, rhythmic phrases, and long tones. Use Show notes to check
an exercise, Replay to hear it again, and Next to continue. Space reveals
hidden notes, then advances. Long-tone presets run automatically and have
separate Stop and Restart controls. Default playback uses saxophone sound
and E-flat alto written pitches over the saxophone range Bb3–F#6; switch to
Concert pitch when needed. With no
key/scale selected, each exercise chooses a compatible random key and scale.
The staff stays on one horizontal line, with local scrolling for long phrases.
Settings sit below the staff in a compact tabbed panel. For saxophone, keys are
selected in written pitch: G major displays a G-major staff and sounds concert
B-flat major. Selecting saxophone restores alto written view; the optional
concert view changes the displayed staff without changing the chosen sounding
exercise. Key-signature accidentals are carried correctly within each bar.

Generated phrases offer connected melodic movement with adjustable variation,
a maximum leap, chord guidance, and optional resolved chromaticism. The
variation can be randomized within a chosen range for each new phrase. Uniform
random sampling remains available. See the
[melodic generation guide](docs/eartraining_melodic_generation.md) for details.

Predefined melodies, rhythms, and long-tone routines live in
`data/ear_training_patterns.toml`, `data/ear_training_rhythms.toml`, and
`data/ear_training_long_tones.toml`. See the
[implementation guide](docs/eartraining_implementation.md) for their schemas.

All 74 piano and saxophone source samples are stored in the **tracked**
`public/ear-training-samples.tar.gz`, with attribution and full license text.
Dev/build verifies that archive locally; clean checkouts do not download audio
from upstream. Playback downloads the archive once, verifies and unpacks it in
memory, then prepares the selected instrument before starting. Replay and
instrument changes reuse the cached bundle.

We use **FluidR3 GM** samples by **Frank Wen**, converted and packaged by
**gleitz and MIDI.js Soundfonts contributors**, under
[CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/).
Original MP3 bytes are unchanged; playback applies phase-matched sustain loops
and crossfades. See [full attribution](licenses/ear-training-ATTRIBUTION.txt),
[license text](licenses/CC-BY-3.0-US.txt), and the
[sample packaging guide](docs/ear-training-assets.md).

For an intentional sample update, run `npm run assets:ear-training:pack` to
rebuild the archive from checksum-verified upstream samples, then commit the
archive, updated manifest, and notices together. Keep the archive tracked in
Git; loose MP3s are only an ignored local packaging cache. Normal builds never
rewrite the committed archive.

### Generating MuseScore files and PDFs from MDX

One companion MDX converts into a MuseScore `.mscz`, and by default also a
same-stem PDF:

```sh
# pick scores from a list, or pass paths; writes .mscz + .pdf per score
npm run mscz:generate
npm run mscz:generate -- scores/05_varnams/ninnu_kori_vasantha_varnam.mdx --force
```

Options: `--no-pdf` skips the PDF, `--out <file.mscz>` writes a single score
to a chosen path, and `--unit crotchet|quaver` overrides the metadata's
notation unit. PDF export uses the MuseScore command line (on PATH, in
`/Applications`, or on a mounted DMG) and falls back to the bundled webmscore
renderer. Generated `.mscz` and `.pdf` files stay local: `.mscz` files are
committed with their MDX companions, PDFs are git-ignored exports.

The static site is written to `dist/client/`. It does not require a database or
Node.js server after deployment and can be hosted by any static-site provider;
`.github/workflows/build.yml` tests, lints, and builds it on every push with the
render cache restored between runs. The MuseScore engraving fonts the renderer
embeds are vendored under `vendor/musescore-fonts/`.

## Rules for contributors and LLMs

- Read [AGENTS.md](AGENTS.md) and
  [docs/carnatic_saxophone.md](docs/carnatic_saxophone.md) before writing or
  editing music.
- Use [the score notation and metadata guide](docs/score-notation.md) for every
  new item.
- Keep only a same-stem `.mscz` and `.mdx` pair for every score.
- The `.mdx` companion must contain metadata, complete swaras, complete lyrics,
  and a final meaning section.
- Add a new score to this README after it passes the validation checklist.
- See [scores/README.md](scores/README.md) for file naming and category
  placement.

## Default notation at a glance

- Instrument: E-flat alto saxophone.
- Written tonic: `Sa = G`; sounding tonic: concert `Bb`.
- Swaras: lyric line 1, black.
- English transliterated lyrics: lyric line 2, deep crimson `#B00020`.
- Upper-octave swaras: overdot and bold, for example `Ṡ`; lower-octave
  swaras: dot below and italic, for example `Ṇ Ḍ P̣`.
- Tala subdivisions: dashed internal barlines at cumulative anga boundaries.
- Layout: system break after every two measures unless the piece needs a
  documented exception.

These are repository defaults, not universal Carnatic-music rules. Explicit
user instructions and authoritative source notation take precedence.
