# Instructions for Music-Writing Assistants

These instructions apply to the whole repository.

## Required reading

Before creating or changing a score, read:

1. `docs/carnatic_saxophone.md` — canonical notation, instrument, pitch, tala,
   lyric, layout, and validation rules.
2. The relevant curriculum page linked from `README.md`.
3. `docs/score-notation.md` — required facts and notation syntax for a new
   lesson or composition.

If a source manuscript, book, audio recording, or user instruction conflicts
with a project default, follow the source or the user's explicit instruction
and record the exception in the score metadata. Do not silently guess missing
swara, sahitya, raga, tala, composer, or octave information.

## Score-writing rules

- Treat `docs/carnatic_saxophone.md` as the source of truth.
- Treat `data/ragas.toml` as the canonical raga registry. Score metadata
  declares only `raga: <name>`; the arohana, avarohana, raga type, janya
  parentage, and melakarta number are derived from the registry (the generated
  `RagaName` union in `components/ragas.generated.ts`). Before using an
  unregistered raga, add it to the registry with arohana, avarohana, janya
  parent, and a `reference` source. Per-score source variants use
  `arohana_override`/`avarohana_override` plus a `source` note.
- Default to alto saxophone with written `Sa = G` only when the user or source
  does not specify another tonic.
- Store each score as exactly two repository files: one MuseScore `.mscz` file
  and one same-stem `.mdx` companion file.
- Name files with lowercase ASCII snake case, for example
  `sri_gananatha_geethe.mscz` and `sri_gananatha_geethe.mdx`.
- Put new material in the matching category described in `scores/README.md`.
- Add every completed score to the root `README.md` index.
- Put the complete swaras and lyrics in the companion MDX file. If an
  instrumental exercise has no lyrics, write `Lyrics: Not applicable`.
- End every score MDX file with `## Meaning`. Keep that as the final
  section. State when a meaning is approximate or not applicable.
- Keep swaras, lyrics, pitch, octave styling, tala grouping, and metadata
  mutually consistent.
- Validate the `.mscz` archive and visually inspect a rendered MuseScore page
  before declaring a score complete.

## Notation parser validation

- Put parser-managed notation in a fenced `carnatic` block or an inline
  `parseNotationText` template. Follow `docs/score-notation.md` for the grammar.
- Run `npm run validate:notation` after editing notation. It reports failures
  as an MDX path, line, and column and exits unsuccessfully when any block is
  invalid.
- Run `npm test` after changing parser rules. Keep the practical example in
  `docs/score-notation.md` and real repository notation covered by Vitest.
- Converter cases live in `components/carnatic-cases.ts` and are shared by
  `scripts/carnatic-to-mscz.test.ts` and the in-app **Converter test cases**
  tool (`?doc=cases`). Each case's output is snapshotted under
  `components/__snapshots__/carnatic-cases/`; after an intended converter
  change, review the diffs in the tool and accept them with
  `npx vitest run -u`. Add new notation behaviour as a case there rather than
  as a page-only example.
- Do not bypass parser failures. `npm run build` runs notation validation before
  content generation and must remain a hard failure for malformed notation.
- The VS Code workspace automatically runs `npm run validate:notation:watch`.
  Saved notation errors should appear on the affected line in the Problems
  panel; the configured short auto-save delay makes this near-immediate while
  editing. After task configuration changes, reload VS Code or start **Watch
  Carnatic notation** once from **Tasks: Run Task**.

## Safe editing

- Do not create or commit `.musicxml`, `.mscx`, PDF, image, or audio exports.
- Do not overwrite a hand-edited `.mscz` unless the user asks for that.
- Do not invent authoritative Carnatic notation. Mark uncertain transcription
  explicitly and ask for a source when correctness depends on it.
- Keep source-derived facts separate from repository layout preferences.
