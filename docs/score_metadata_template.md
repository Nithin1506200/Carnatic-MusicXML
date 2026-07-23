# Score Metadata Template

Copy this block into a companion MDX file when adding a score. Replace every
`TODO`; use `Unknown` only when the source genuinely does not provide the
information.

```yaml
title: TODO
alternate_titles: []
category: training | basics | jatiswara | kriti | varnam | bhajan
form: TODO
language: TODO
composer: TODO
raga: TODO
raga_type: Melakarta | Janya raga
janya_of: TODO
arohana: TODO
avarohana: TODO
tala: TODO
tala_grouping: TODO
```

## Swaras and Lyrics

Score companions are MDX files. Put all notation in one fenced `carnatic`
text block where the rendered sections should appear:

````mdx
```carnatic
# Pallavi
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
````

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

### `carnatic` Block Component Mapping

The content generator converts one fenced `carnatic` block into the following
React component structure:

| Text inside the `carnatic` block                | Generated behavior or component                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `# Pallavi`                                     | Starts `<MusicSection title="Pallavi">` and generates its visible `### Pallavi` heading.             |
| First notation line after a lyrical heading     | Becomes the `swaras` value for one `SwaraTable`.                                                     |
| Second notation line                            | Becomes the matching `lyrics` value for that `SwaraTable`.                                           |
| Additional pairs of lines                       | Generate additional numbered `SwaraTable` components in the same `SwaraLines` section.               |
| `# Muktayi Swara [swaras]`                      | Starts a swara-only section rendered through `SwaraGrid`; every notation line is one numbered row.   |
| `@Sahitya: ...` before notation                 | Generates emphasized section text above the tables.                                                  |
| `@Repeat: ...` or `@Return: ...` after notation | Generates emphasized direction text below the tables.                                                |
| A token separated by spaces                     | Creates one table cell and therefore one vertical swara/lyric column.                                |
| `\|`                                            | Adds a single internal tala divider before the next cell.                                            |
| `\|\|`                                          | Adds a double measure divider before the next cell, or after the final cell when placed at line end. |
| `Ṡ`, `Ṙ`, and other overdot tokens              | Render automatically as emphasized tara-sthayi swaras.                                               |
| `Ṇ`, `Ḍ`, and other dot-below tokens            | Render automatically as emphasized mandra-sthayi swaras.                                             |
| Blank line                                      | Adds source readability only; it does not create a row or break swara–sahitya pairing.               |

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
