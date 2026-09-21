# 2. Basic Notes and Raga List

This section contains foundational swara exercises, alankaras, beginner
geethams, and a verified raga reference.

## Default swara map

For the project's written `Sa = G` alto-saxophone setup:

| Swarasthana | Written pitch |
| ----------- | ------------- |
| S           | G             |
| R1          | A-flat        |
| R2 / G1     | A             |
| R3 / G2     | B-flat        |
| G3          | B             |
| M1          | C             |
| M2          | C-sharp       |
| P           | D             |
| D1          | E-flat        |
| D2 / N1     | E             |
| D3 / N2     | F             |
| N3          | F-sharp       |
| Upper S     | G             |

Enharmonic swarasthanas share a written pitch in twelve-tone notation but keep
their raga-specific swara names.

## Raga list

The arohanas, avarohanas, classifications, and references of every raga used
here live in [`data/ragas.toml`](../data/ragas.toml), the canonical raga
registry (all 72 melakartas plus the janya ragas used by repository scores and
other common ragas). Score metadata declares only the raga name; the rest is
derived from the registry.

Only add a raga after verifying its arohana and avarohana from an authoritative
source, and record that source in the registry's `reference` field. Vakra
phrases, anya swaras, characteristic prayogas, and source variants must not be
reduced to an oversimplified scale — record them in the registry's `notes`
field and in the score's metadata.

Ragas in current use:

- **Mayamalavagowla** (Melakarta 15) — foundational exercises.
- **Malahari** (janya of Mayamalavagowla) — Sri Gananatha.

## Available beginner repertoire

- [Swara Adhyaaya — Sarale Varase to Saptasulaadi Taala Alankaaras
  (swaras)](../scores/02_basics/sarale_varase_to_alankaaras.mdx)
- [Swara Adhyaaya — Sarale Varase to Saptasulaadi Taala Alankaaras
  (MuseScore)](../scores/02_basics/sarale_varase_to_alankaaras.mscz)
- [Sri Gananatha / Lambodara Geetham
  (swaras, lyrics, and meaning)](../scores/02_basics/sri_gananatha_geethe.mdx)
- [Sri Gananatha / Lambodara Geetham
  (MuseScore)](../scores/02_basics/sri_gananatha_geethe.mscz)

## Backlog

- Basic sustained notes
- Additional verified beginner geethams
