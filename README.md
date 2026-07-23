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

| Section            | Composition                                                     | Raga            | Tala                        | Composer             | Files                                                                                                                              |
| ------------------ | --------------------------------------------------------------- | --------------- | --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Basics / Exercises | Swara Adhyaaya — Sarale Varase to Saptasulaadi Taala Alankaaras | Mayamalavagowla | Aadi and Saptasulaadi talas | Traditional          | [Swaras](scores/02_basics/sarale_varase_to_alankaaras.mdx) · [MuseScore](scores/02_basics/sarale_varase_to_alankaaras.mscz)        |
| Basics / Geetham   | Sri Gananatha (Lambodara Geetham)                               | Malahari        | Rupaka, `2 + 4`             | Purandara Dasa       | [Swaras, lyrics, and meaning](scores/02_basics/sri_gananatha_geethe.mdx) · [MuseScore](scores/02_basics/sri_gananatha_geethe.mscz) |
| Varnam             | Ninnu Kori Yunnara                                              | Vasantha        | Aadi, `4 + 2 + 2`           | Tacchur Singarachari | [MDX transcription](scores/05_varnams/ninnu_kori_vasantha_varnam.mdx) · MuseScore not created by user request                      |

## Static website

The Node.js website reads this README and the repository Markdown and MDX during its
build, then generates a fully static site with client-side global search.
MuseScore `.mscz` source files remain repository-only and are not copied into
the website or its static output.

```sh
npm ci
npm run dev
npm run build
```

The static site is written to `dist/client/`. It does not require a database or
Node.js server after deployment and can be hosted by any static-site provider.

## Rules for contributors and LLMs

- Read [AGENTS.md](AGENTS.md) and
  [docs/carnatic_saxophone.md](docs/carnatic_saxophone.md) before writing or
  editing music.
- Use [the score metadata template](docs/score_metadata_template.md) for every
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
