# Score Files

Keep each score as one MuseScore `.mscz` file and one same-stem React-compatible
MDX `.mdx` companion. Do not commit export or interchange formats.

## Planned category folders

```text
scores/
  01_training/
  02_basics/
  03_jatiswara/
  04_kritis/
  05_varnams/
  06_bhajans/
```

Related formats must share the same lowercase snake-case stem.

Example:

```text
scores/04_kritis/composition_name.mscz
scores/04_kritis/composition_name.mdx
```

The MDX companion must include complete swaras and lyrics, followed by
`## Meaning` as its final section. For a lesson without lyrics, state that
lyrics and meaning are not applicable.

Keep its notation in one fenced `carnatic` text block. Headings create named
sections; alternating lines contain swaras and lyrics, and `[swaras]` marks a
swara-only section. `@Label:` lines become section directions. Spaces create
cells, `|` marks internal tala angas, and `||` marks measure boundaries. The
optional first line `@source: same_stem.mscz` links the MuseScore source and
adds a button that opens its Western notation separately. The content generator
renders the block through `MusicScore`; do not add imports, variables, manual
section wrappers, or visible section headings.

Do not use spaces in filenames. Do not store MusicXML, unpacked MSCX,
temporary MuseScore exports, rendered test pages, or autosave files in the
repository.
