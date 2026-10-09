# MuseScore engraving fonts

These files are copied unchanged from MuseScore Studio 4
(`MuseScore 4.app/Contents/Resources/fonts`). `scripts/generate-content.mjs`
embeds them into the self-hosted webmscore renderer so the in-browser score
matches MuseScore's engraving, and so CI builds do not need MuseScore
installed.

| File                              | Family       | Licence                        |
| --------------------------------- | ------------ | ------------------------------ |
| Leland.otf, LelandText.otf        | Leland       | SIL Open Font License 1.1      |
| Edwin-Roman/Italic/Bold/BdIta.otf | Edwin        | SIL Open Font License 1.1      |
| FreeSans.ttf                      | GNU FreeFont | GNU GPL v3 with font exception |

Set `MUSESCORE_FONT_DIR` to another MuseScore `Resources/fonts` directory to
build against a different MuseScore version.
