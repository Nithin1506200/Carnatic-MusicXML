# Carnatic Saxophone Memory Bank

This is the canonical memory bank for writing Carnatic lessons and
compositions in MuseScore for alto saxophone in this repository.

## How to use this document

Before creating or editing a score:

1. Read this document and the relevant curriculum page linked by `README.md`.
2. Establish the source, raga, tala, tonic, and composition structure.
3. Complete the fields in `score-notation.md`.
4. Apply the notation rules below.
5. Run the validation checklist and update the repository index.

Rule priority, from highest to lowest:

1. The user's explicit instruction for the current score.
2. An authoritative source supplied or selected for that score.
3. Score-specific metadata and documented exceptions.
4. The defaults in this memory bank.

Never silently replace source notation with a repository default. If reliable
information is missing, label it as uncertain and request a source instead of
inventing it.

## Repository Score Files

- `../scores/02_basics/sri_gananatha_geethe.mscz`
- `../scores/02_basics/sri_gananatha_geethe.mdx`

## Alto Saxophone Convention

- Use Alto Saxophone as the instrument.
- MuseScore instrument id: `wind.reed.saxophone.alto`.
- Alto sax is an Eb transposing instrument.
- MuseScore transposition values used:
  - `transposeDiatonic = -5`
  - `transposeChromatic = -9`
- User preference for Carnatic saxophone material:
  - Write in G scale on alto sax.
  - Written `Sa = G`.
  - Written `G` on alto sax sounds concert `Bb`.
  - In MuseScore this appears as written key G and concert key Bb.
  - MuseScore key values seen after import/export:
    - `actualKey = 1`
    - `concertKey = -2`

These are repository defaults for new scores, not universal rules. A
score-specific tonic or transposition takes precedence when explicitly given.

## Swara Pitch Mapping For G-Scale Alto Sax

Use this as the default written-pitch map for the user's alto sax Carnatic files:

| Swara                   | Written pitch |
| ----------------------- | ------------- |
| S                       | G             |
| R1                      | Ab            |
| R2 / G1 area, if needed | A             |
| G3                      | B             |
| M1                      | C             |
| P                       | D             |
| D1                      | Eb            |
| N3                      | F#            |
| Upper S                 | G             |

For Mayamalavagowla:

- Arohana: `S R1 G3 M1 P D1 N3 S`
- Avarohana: `S N3 D1 P M1 G3 R1 S`
- Written alto sax pitch set in G scale:
  - `G Ab B C D Eb F# G`

For Malahari:

- Arohana: `S R1 M1 P D1 S`
- Avarohana: `S D1 P M1 G3 R1 S`
- Written alto sax pitch set in G scale:
  - `G Ab C D Eb G`
  - descending uses `B` for `G3`.

## Raga Representation

At the top of a composition or lesson, include a heading text frame with:

- Composition or lesson name.
- Raga name.
- Tala name and tala expansion.
- Composer, when known.
- Arohana and Avarohana.
- Instrument and scale note, for example:
  - `Alto Saxophone in G scale`
  - `Written Sa = G on alto sax; sounds concert Bb.`

Example heading:

```text
Sri Gananatha
Geethe 1 | Raga: Malahari | Tala: Rupaka (2 + 4 = 6 beats)
Composer: Purandara Dasa | Alto Saxophone in G scale
Arohana: S R1 M1 P D1 S | Avarohana: S D1 P M1 G3 R1 S
Written Sa = G on alto sax; sounds concert Bb. Swaras are black; English lyrics are deep crimson.
```

## Tala And Time Signature Conventions

Use the time signature that matches the lesson style.

For Sarale Varase in Mayamalavagowla:

- User wanted saxophone in `8/4`.
- Aadi tala grouping is `4 + 2 + 2`.
- Use dashed barlines after the internal group boundaries:
  - after beat 4
  - after beat 6
  - final barline at beat 8

For the current Saptasulaadi Taala Alankaara lesson style:

- Use eighth-note denominator for the tala total.
- Example: Dhruva Taala `4 + 2 + 4 + 4 = 14 beats` should be `14/8`, not `14/4`.
- Add dashed separators after each anga boundary.

Saptasulaadi entries already used in the current workbook:

| Tala     | Expansion                            | Time signature | Dashed separation        |
| -------- | ------------------------------------ | -------------- | ------------------------ |
| Dhruva   | `4 + 2 + 4 + 4 = 14`                 | `14/8`         | after 4, 6, 10           |
| Matya    | `4 + 2 + 4 = 10`                     | `10/8`         | after 4, 6               |
| Roopaka  | `2 + 4 = 6`                          | `6/8`          | after 2                  |
| Jampe    | source showed a 10-beat version      | `10/8`         | after each source anga   |
| Tiruputa | source grouping used `3 + 2 + 2 = 7` | `7/8`          | after 3, 5               |
| Atta     | source showed a 14-beat version      | `14/8`         | after each source anga   |
| Eka      | `4 = 4`                              | `4/8`          | no internal dashed split |

When the source book uses a different expansion, follow the source and mention the expansion explicitly in the text frame.

## Dashed Barline Rule

Dashed barlines are used to show Carnatic tala subdivisions inside one Western measure.

General rule:

- Take the tala expansion, for example `4 + 2 + 2`.
- Compute cumulative boundaries except the final total:
  - `4`
  - `4 + 2 = 6`
- Insert dashed barlines at those cumulative positions.
- Do not insert a dashed barline at the final measure boundary.

MuseScore `.mscx` representation:

```xml
<BarLine>
  <subtype>dashed</subtype>
</BarLine>
```

## Break And Layout Rules

- Current user preference: add system break after every 2 measures.
- Add page break after each lesson to separate lessons.
- Add a section break after each varase or major lesson section when needed.
- Do not change Alankaara unless the user explicitly asks.
- Avoid text overlap by using enough frame height and short wrapped lines.
- Prefer one clear text frame for heading and details instead of many stacked text items that can collide.

## Swaras And Lyrics

For geethe/compositions:

- Put swaras as lyric line 1.
- Put English transliterated lyrics as lyric line 2.
- Swaras should be black.
- English lyrics should use deep crimson, not bright red.
  - Preferred color: `#B00020`
  - MuseScore RGB: `r="176" g="0" b="32" a="255"`
- Upper-octave swaras should have a dot above and be bold, for example
  `<b>Ṡ</b>`, `<b>Ṙ</b>`, `<b>Ġ</b>`.
- Lower-octave swaras should have a dot below and be italic, for example
  `<i>Ṇ</i>`, `<i>Ḍ</i>`, `<i>P̣</i>`, `<i>Ṃ</i>`.
- Middle-octave swaras stay plain.

For the same-stem MDX companion:

- Keep every swara and lyric line together in one fenced `carnatic` text block.
  Do not scatter notation data through the rendered sections.
- Start each section with a `#` heading. In lyrical sections, alternate a swara
  line and its lyric line. Mark a swara-only section by appending `[swaras]` to
  its heading.
- When a MuseScore source exists, put `@source: same_stem.mscz` before the
  first section. The website uses it to add a separate Western-notation viewer;
  the directive is not rendered as section text.
- The content generator turns the fenced block into `MusicScore`
  automatically. It creates the section wrapper, visible heading, correct
  table type, numbering, and whole-section zoom without imports, variables, or
  manual component calls.
- Put sahitya, repeat, return, or other section text on an `@Label:` line, such
  as `@Repeat:`. Its position before or after the notation controls where it
  renders.
- Write each line horizontally. One or more spaces separate cells and are
  collapsed by the parser; use `|` for an internal tala anga and `||` for a
  measure boundary.
- Pad the source cells with spaces so each swara is visibly above its lyric;
  `npm run format:mdx` performs this alignment automatically.
- The component parser keeps every swara vertically aligned with its lyric
  syllable and validates matching cell counts and tala dividers.
- Do not show tala numbers above the table or add row-label columns.
- Show internal tala anga boundaries with a thin solid vertical divider and
  complete measure boundaries with a thick double vertical divider.
- Use larger type for the swara row and deep crimson `#B00020` for the lyric
  row.
- Write a refrain's complete notation only once. After each charanam, use a
  short repeat direction with its opening words, such as “Lambodara
  lakumikara…”, instead of duplicating the refrain table.
- For swara-only exercises, put each measure on its own table row and use one
  fixed cell per rhythmic subdivision. This keeps successive swara patterns
  vertically aligned without adding an empty lyric row.
- Use `-` and `,` consistently to show continuation or held duration.
- Add an overdot to tara-sthayi swaras, for example `Ṡ`; the notation
  component emphasizes the token automatically.
  Add a dot below and italics to mandra-sthayi swaras, for example `Ṇ Ḍ P̣`.
- Place the complete meaning after all swaras and lyrics as the final section.

### Fenced `carnatic` Block Rendering

The generator replaces each fenced `carnatic` block with `MusicScore`. For
each heading and its following lines, `MusicScore` creates:

```text
@source: composition_name.mscz
  -> optional button opening the MuseScore engraving separately

# Pallavi
  -> MusicSection title="Pallavi"
  -> visible h3 heading

swara line
sahitya line
  -> SwaraLines
  -> one numbered SwaraTable with aligned swara and lyric rows

# Muktayi Swara [swaras]
swara row
swara row
  -> MusicSection title="Muktayi Swara"
  -> SwaraGrid with two numbered rows
```

Within a lyrical section, the first significant line is always swaras, the
next is its sahitya, and subsequent lines continue alternating. Blank lines
and `@Label:` directions do not affect pairing. `@Label:` before notation
renders above the tables; the same syntax after notation renders below them.
The parser rejects mismatched cell counts or tala-divider positions.

Spaces separate cells, `|` produces an internal tala divider, and `||`
produces a measure divider. Extra spaces are retained in source code for
visual vertical alignment but collapse to token boundaries during parsing.

MuseScore 4 style color convention:

- `lyricsOddColor` controls lyric verse 1.
- `lyricsEvenColor` controls lyric verse 2.
- For black swaras and deep crimson lyrics:

```xml
<lyricsOddColor r="0" g="0" b="0" a="255"/>
<lyricsEvenColor r="176" g="0" b="32" a="255"/>
```

Octave styling rule for swara lyric text:

- Determine the written middle `Sa`.
- Any swara in the octave above middle `Sa` is bold.
- Any swara below middle `Sa` is italic.
- For the user's alto sax G-scale setup, middle `Sa = written G`; upper octave starts at the next written `G`.

## Sri Gananatha Geethe Details

The existing repository score records:

- Name: `Sri Gananatha`, also known as `Lambodara Geetham`.
- Raga: `Malahari`.
- Tala: `Rupaka`.
- Composer: `Purandara Dasa`.
- Arohana: `S R1 M1 P D1 S`.
- Avarohana: `S D1 P M1 G3 R1 S`.
- Created as alto saxophone in G scale:
  - Written `Sa = G`
  - Sounds concert `Bb`
  - Time signature `6/8`
  - Tala expansion shown as `2 + 4 = 6 beats`
  - Upper-octave `Ṡ` and `Ṙ` labels should have an overdot and be bold.
  - English lyrics use deep crimson `#B00020`.

## Useful Validation Checklist

Before finalizing a score:

- Confirm the metadata sidecar has no unresolved `TODO` values, or document why
  a field is unknown.
- Confirm the source and every transcription uncertainty are recorded.
- Confirm `.mscz` opens as a ZIP and contains:
  - `score_style.mss`
  - one `.mscx`
  - `META-INF/container.xml`
  - thumbnail and settings files
- Confirm instrument is alto saxophone.
- Confirm measure durations agree with the time signature.
- Confirm written key is G and concert key is Bb when using the user's preferred G-scale alto sax setup.
- Confirm swara and lyric lines are both present.
- Confirm lyric verse 2 is deep crimson via `lyricsEvenColor`.
- Confirm upper-octave swara labels have an overdot and are bold, and
  lower-octave swara labels have a dot below and are italic.
- Export or preview pages when possible to catch heading overlap and text overflow.
- Add the completed score to its curriculum page and the root `README.md`.
- Confirm the same-stem `.mdx` contains complete swaras and lyrics and ends with
  the meaning.

## MuseScore CLI Note

MuseScore 4 was found at:

```text
/Users/nithin.n/Desktop/MuseScore 4.app/Contents/MacOS/mscore
```

The shell did not find `mscore` through `PATH`, but this direct path worked for conversion. PNG export produced valid preview files, though MuseScore printed a crash message after export in this environment.
