# Score Notation and Metadata

Copy this block into a companion MDX file when adding a score. Replace every
`TODO`; use `Unknown` only when the source genuinely does not provide the
information.

This document is the practical contract for
`components/score-notation.ts`. Vitest reads the fenced `carnatic` example
below and verifies that it remains accepted by the production parser.

```yaml
title: TODO
alternate_titles: []
category: training | basics | jatiswara | kriti | varnam | bhajan
form: TODO
language: TODO
composer: TODO
raga: TODO # must exist in data/ragas.toml
tala: TODO
tala_grouping: TODO
# notation_unit: crotchet — default; declare only when cells use another
# unit, for example quaver cells. See "Rhythm and Duration".
keywords:
  - TODO
```

## Raga metadata

`raga` must be a name in `data/ragas.toml`, the canonical raga registry
(consumed as the generated `RagaName` union in `components/ragas.generated.ts`).
The arohana, avarohana, raga type, janya parentage, and melakarta number are
derived from the registry — never repeat them in score metadata (`arohana`,
`avarohana`, `raga_type`, `janya_of`, and `melakarta_number` are rejected by
`npm run validate:notation`). Alternate spellings registered in
`alternate_names` resolve to the same raga.

To use a raga that is not registered yet, add it to `data/ragas.toml` first —
with arohana, avarohana, janya parent, and a `reference` source — following
AGENTS.md's verification rules. When a composition's source genuinely deviates
from the registered scale, declare `arohana_override`/`avarohana_override` and
explain the variant in a `source` or `notation_exception` note.

Use `keywords` for source-supported alternate spellings, common form names,
instrument terms, and other phrases a reader may search for. Search already
indexes every metadata value, so do not repeat the title, composer, raga, or
tala unless a common alternate spelling is useful.

## Swaras and Lyrics

Score companions are MDX files. Put all notation in one fenced `carnatic`
text block where the rendered sections should appear:

```carnatic
@source: composition_name.mscz

# Pallavi
@Time: (4+2+2)/4
@Sahitya: TODO
S  R  G    M    | P    D    | N    Ṡ    ||
Ly ri TODO TODO | TODO TODO | TODO TODO ||
Ṡ    N    D    P    | M    G    | R    S    ||
TODO TODO TODO TODO | TODO TODO | TODO TODO ||
@Repeat: TODO

# Practice Phrase [swaras]

S R G M | P D | N Ṡ ||
Ṡ N D P | M G | R S ||
```

The content generator turns that block into `MusicScore` automatically.
`MusicScore` treats each heading as a named, zoomable section and generates the
visible section heading and tables. In a lyrical section, lines alternate in
this order: swaras, lyrics, swaras, lyrics. Blank lines are ignored. Add
`[swaras]` to a heading when every following line is a swara-only table row. A
line starting with `@` becomes section text. Its position before or after the
notation controls where it renders.

- Separate rhythmic cells with one or more spaces. Extra alignment spaces are
  collapsed, so each resulting token becomes one table column.
- Align the source text vertically by padding each cell with spaces. Run
  `npm run format:mdx` to add that padding automatically.
- Use `|` before an internal tala anga.
- Use `||` before a new measure or at the end of a complete measure.
- Put dividers at identical positions in an aligned swara and lyric pair.
- Do not add imports, JavaScript variables, arrays, object syntax, wrapping
  quotation marks, or manual component calls.

The component styles swaras, lyrics, tala dividers, and line numbers
consistently. Tara-sthayi tokens ending in an overdot, such as `"Ṡ"`, are
automatically bold; mandra-sthayi tokens ending in a dot below, such as `"Ṇ"`,
are automatically italic.

### Typing Octave Marks

The dotted marks are combining Unicode characters that are awkward to type, so
**swara rows** also accept ASCII aliases:

- A trailing apostrophe marks tāra sthāyi: `S'` is Ṡ, `S'R'` is ṠṘ.
- A lowercase letter marks mandra sthāyi: `s` is Ṣ, `nn,` holds two mandra
  quavers. Lowercase in a swara row always means mandra — write middle-sthayi
  swaras in uppercase.

The parser rewrites aliases to the canonical dotted form, and
`npm run format:mdx` does the same in the saved file. `.`, `,`, and `-`
cannot mark octaves: they are duration marks. Lyric rows are never rewritten,
so apostrophes in sahitya words such as `don't` stay verbatim.

### Explicit Swara Variants

Write a numbered swara to override the raga's default for that sound only:
`N N3 N` uses the registered N, then N3, then the registered N again.
Allowed variants are `R1`–`R3`, `G1`–`G3`, `M1`–`M2`, `D1`–`D3`, and
`N1`–`N3`. S and P have no numbered variants. Numbers do not add rhythmic
slots: `N2N3` is two sounds in one cell. Octave aliases work too: `n3` is
lower N3, and `N3'` is upper N3. Record source-supported accidental usage
in the score's source or notation-exception metadata.

### Splitting Lyrics Within a Cell

A plain lyric cell attaches to the first sound and continues across the
remaining sounds: `SR RG GM ,,` over `Ni nnu ko -` starts Ni on S,
nnu on the next R, and ko on G.

Use `/` to start successive syllables within one swara cell:

```text
SR    GMM     GMM    ||
Ni/nu nnu/ko- lee/me ||
```

Ni maps to S, nu to R; nnu maps to G, ko to the first M, and `-` to the
second M. A trailing continuation in a split cell is shorthand:
`nnu/ko-` equals `nnu/ko/-`. In `lee/me`, lee starts on G and me starts
on the first M and continues across the second M. The final syllable spans
any remaining slots. Slash separators are not printed as lyrics.

Each split part needs a slot; empty parts and too many syllables are errors.
A new syllable cannot start on a held slot, so use `la/-` under `G,`.
Spaces and tala dividers still align by whole cells. Each cell has equal beat
width in the swara display; split syllables and their swaras subdivide inside
that cell. `SR GMM GMM` therefore occupies three equal beats in 3/4, with
two subdivisions in the first beat and three in each remaining beat.

### Rhythm and Duration

Rhythm is read from the cells:

- One space-separated swara token is one duration unit, rendered as one table
  cell. One unit is one **crotchet** (quarter note) by default. When a score's
  cells carry another unit — for example quaver cells in an `x/8` exercise —
  declare it in the score metadata (`notation_unit`, or describe the
  convention in `notation_exception`).
- A token divides its one unit into equal **slots**: every swara letter and
  every continuation mark (`,`, `.`, `-`) inside the token counts as one
  slot. One token holds 1, 2, 3, or 4 slots — `SR` is two quavers, `SRR` is
  a crotchet triplet (three quaver-triplets, sound letters only), `SRGM` is
  four semiquavers, `G,` is a quaver swara tied to a quaver hold, and `,,`
  is two held quaver slots. `D, ,,` notates four tied quavers (a minim).
- A mark written as its own space-separated token still adds a full unit:
  `G , ,` is four tied crotchets, while `G, ,,` is four tied quavers.
- A `.` cell extends the previous swara by one unit: `S .` is a minim,
  `S . .` is three units (a dotted minim), and `S . S .` is two minims.
- `-` and `,` are alternate one-unit continuation marks; use them where the
  score's metadata declares them and keep one convention consistently within
  a score. The dhirga mark `;` is not supported: hold a swara for two beats
  with two cells, `S , ,` or `S - -`.
- A duration mark that opens a measure continues the last swara of the
  previous measure across the barline: `N Ṡ || - N D P` holds Ṡ as a tied note
  into the next avarta, also when the new measure starts a new notation line.
  A sahitya syllable under that cell (for example `sā`) attaches to the tied
  note. This never crosses a section heading.
- Silence is written only as `*`: one rest cell of one unit. Duration marks
  after it lengthen the rest (`* -` is a two-unit rest, `* ;` a three-unit
  rest). A sahitya cell under `*` must be empty or a continuation mark.
- A duration mark must have something to extend. A section whose first cell
  is `-`, `.`, `,`, or a mark-only token such as `,,` is invalid: write
  `*` for a rest instead.

The cells between tala dividers should match the anga lengths in the declared
unit; for example `S R G M | P D | N Ṡ ||` is `4 + 2 + 2` crotchet units.

### The `@Time` Directive

A section may declare its signature once, before its notation rows, for
example `@Time: (4+2+2)/4`, `4+2+2 / 4`, or `8/4`. The directive is both a
visible section note and a semantic contract:

- Every swara row must end with `||` and span whole measures: the cells
  between any two dividers must match the cyclical grouping (`4`, then `2`,
  then `2`, then repeat).
- The lyric row follows the same division through swara–sahitya cell
  alignment: one lyric cell per swara cell, so a lyric row has the same
  `4 | 2 | 2` cell division as its swara row.
- The MuseScore converter uses the declared denominator (`4` or `8`) for that
  section's time signature instead of the score-wide notation unit.

In a lyric row, `-` and `,` keep their usual role as syllable continuation
marks. The duration rules above govern the swara row.

Swara–sahitya alignment is counted in cells: every swara cell pairs with
exactly one lyric cell, so `G, M | NN |` pairs with `la ti | ka |`. A joined
token such as `NN` still engraves as two quavers — it is one alignment cell
whose syllable sits on the first sound of the pair. The printed time
signature follows the tokens per measure: 4 + 2 + 2 crotchet cells render
`8/4`.

### `carnatic` Block Component Mapping

The content generator converts one fenced `carnatic` block into the following
React component structure:

| Text inside the `carnatic` block                | Generated behavior or component                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@source: composition_name.mscz`                | Adds a button that opens the MuseScore file as separate Western notation; the directive stays hidden.       |
| `@Time: (4+2+2)/4`                              | Declares the section's anga grouping and signature denominator; rows are validated against it.              |
| `# Pallavi`                                     | Starts `<MusicSection title="Pallavi">` and generates its visible `### Pallavi` heading.                    |
| First notation line after a lyrical heading     | Becomes the `swaras` value for one `SwaraTable`.                                                            |
| Second notation line                            | Becomes the matching `lyrics` value for that `SwaraTable`.                                                  |
| Additional pairs of lines                       | Generate additional numbered `SwaraTable` components in the same `SwaraLines` section.                      |
| `# Muktayi Swara [swaras]`                      | Starts a swara-only section rendered through `SwaraGrid`; every notation line is one numbered row.          |
| `@Sahitya: ...` before notation                 | Generates emphasized section text above the tables.                                                         |
| `@Repeat: ...` or `@Return: ...` after notation | Generates emphasized direction text below the tables.                                                       |
| A token separated by spaces                     | Creates one table cell and therefore one vertical swara/lyric column; one unit of duration.                 |
| Swaras joined in one token, such as `SR`        | One cell subdividing the unit into 2, 3 (triplet), or 4 slots, for example two quavers or four semiquavers. |
| A `.`, `-`, or `,` cell                         | A duration mark extending the previous swara by one unit (see Rhythm and Duration).                         |
| A `*` cell                                      | A one-unit rest; duration marks after it lengthen the rest.                                                 |
| Marks attached inside a token, such as `G,`     | Slot subdivision: the swara ties with the mark inside one cell.                                             |
| Single tala divider                             | Adds an internal tala divider before the next cell.                                                         |
| Double measure divider                          | Adds a measure divider before the next cell, or after the final cell when placed at line end.               |
| `Ṡ`, `Ṙ`, and other overdot tokens              | Render automatically as emphasized tara-sthayi swaras.                                                      |
| `Ṇ`, `Ḍ`, and other dot-below tokens            | Render automatically as emphasized mandra-sthayi swaras.                                                    |
| `S'` (apostrophe after a letter)                | Typing alias for a tara-sthayi swara; the parser and formatter rewrite it to the dotted form.               |
| `s` or other lowercase swara letter             | Typing alias for a mandra-sthayi swara; the parser and formatter rewrite it to the dotted form.             |
| Blank line                                      | Adds source readability only; it does not create a row or break swara–sahitya pairing.                      |

For a lyrical section, the significant notation lines always alternate:

```text
# Section name
SWARA LINE 1
SAHITYA LINE 1
SWARA LINE 2
SAHITYA LINE 2
```

The parser removes extra alignment spaces when determining cells, then
validates that each swara–sahitya pair has the same number of cells and
identical `|`/`||` positions. The source formatter adds padding spaces back so
the corresponding tokens also align visually in the MDX file.

### Parser Model

The TypeScript parser exposes enums instead of passing notation keywords around
as unrelated strings:

| Enum                       | Values                                                    |
| -------------------------- | --------------------------------------------------------- |
| `TalaDivider`              | `Anga`, `Measure`                                         |
| `OctavePosition`           | `Lower`, `Middle`, `Upper`                                |
| `NotationSectionKind`      | `Lyrics`, `Swaras`                                        |
| `NotationSectionKeyword`   | `Swaras`                                                  |
| `NotationDirectiveKeyword` | `Source`, `Sahitya`, `Repeat`, `Return`, `Time`, `Custom` |
| `NotationRowKind`          | `Swara`, `Lyrics`                                         |

`TalaDivider.Anga` serializes to `|`; `TalaDivider.Measure` serializes to
`||`.

`parseNotationLine` tokenizes one grouped line and records tala boundaries.
`parseNotationDirective` parses case-insensitive `@Keyword: value` lines.
`parseScoreNotation` validates a complete score block, including section order,
directive placement, swara–sahitya alignment, and an optional `.mscz` source.
`parseNotationText` returns the keyed section data used by MDX exercises.

`parseSwaraDurations` folds a notation line into `ParsedSwaraBeat` durations:
every swara cell reports `units`, joined tokens report their individual
`sounds`, and the duration marks `.` / `-` / `,` (one unit each)
extend the previous cell, and a `*` cell is a one-unit rest (`rest: true`)
that marks lengthen in the same way. A mark opening a line continues the
previous line's last cell; `parseScoreNotation` rejects a mark that opens a
section, since nothing precedes it.
Durations are relative units; naming one unit (a crotchet by default) is score
metadata, not parser state.

Parser failures are intentional for:

- notation or non-source directives before the first section heading;
- unknown or malformed bracketed section markers (`[swaras]` is the only
  supported marker);
- duplicate or empty sections;
- lyrical sections with an odd number of notation lines;
- different cell counts or tala-divider positions in a swara–sahitya pair;
- leading, consecutive, or trailing single tala dividers;
- malformed `@Keyword: value` syntax;
- duplicate, misplaced, or malformed `@Time` directives, notation rows that
  do not span whole measures under `@Time`, or anga cell counts that break
  the declared grouping; and
- duplicate, misplaced, or non-`.mscz` `@source` directives.

### Validation

Run `npm run validate:notation` to validate every fenced `carnatic` block and
inline `parseNotationText` input. The static build runs this command first and
fails with the MDX path, line, and column when notation is invalid.

The repository's VS Code workspace starts `npm run validate:notation:watch`
when the folder opens. With the configured short auto-save delay, parser errors
appear in the Problems panel and on the affected MDX line shortly after typing.
This checks saved text; unsaved keystroke-level diagnostics would require a
dedicated VS Code language extension.

After the task configuration is first added or changed, reload the VS Code
window or run **Tasks: Run Task > Watch Carnatic notation** once. Open this
repository root as the workspace and trust it; VS Code does not start automatic
tasks in an untrusted workspace.

Do not add manual table HTML, `Swaras`/`Lyrics` label columns, inline colors,
numbered tala headers, or scattered notation text inside the rendered
section. Preserve source syllable divisions and use `-` or `,` consistently
for continuation.

## Repeated Refrains

Write the complete refrain notation only at its first occurrence. After each
charanam, do not duplicate the refrain table. Add a short repeat direction
using the refrain's opening words, for example:

```text
@Repeat: “Lambodara lakumikara…” and continue to Charanam 2.
```

After the final charanam, omit “continue to…”:

```text
@Repeat: “Lambodara lakumikara…”
```

## Per-score completion checklist

- Source facts were transcribed without guessing.
- Swaras match pitches and octave styling.
- Tala count and internal anga boundaries are correct.
- Sahitya is aligned with the notes and transliteration is consistent.
- MuseScore instrument, transposition, written key, and concert key are correct.
- The rendered score was checked for collisions, overflow, and awkward breaks.
- The `.mscz`, `.mdx`, section index, and root index agree.

## Meaning

Place the complete line-by-line meaning here, after all notation and lyrics.
This must be the final section of the file. Relate important original words to
their meanings in parentheses and clearly state when a translation is
uncertain.
