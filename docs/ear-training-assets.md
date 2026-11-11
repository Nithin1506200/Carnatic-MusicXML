# Ear Training sample assets

## Committed archive and browser loading

All 74 original source samples, `ATTRIBUTION.txt`, and `LICENSE.txt` are in
`public/ear-training-samples.tar.gz`. This is a tracked source asset and must
be committed with the manifest and notices whenever samples change. Do not
commit loose MP3s. Normal `npm run assets:ear-training`, dev, and build commands
verify the committed archive and notice checksums **without upstream access or
tracked-file writes**. Missing/corrupt committed assets fail clearly rather
than silently downloading a replacement.

After an explicit playback action, the browser downloads this one archive
from the site's own base URL, with its SHA-256 in the request query for cache
invalidation. It verifies the compressed archive, unpacks the regular-file
USTAR entries in memory using the existing static `fflate` dependency, and
checks every original sample checksum before decoding. Hosts may automatically
HTTP-decompress a `.gz` response before JavaScript receives it; that TAR form
is verified against its own pinned SHA-256. Neither path skips integrity
checks. HTML fallback pages are reported as missing archives. The selected
instrument is fully decoded before its first note. Replay and instrument
changes reuse the unpacked archive. Failed or cancelled requests can retry;
there is no fallback to external sample URLs or loose sample requests.

Production output contains the archive rather than the local loose-file
cache. A clean checkout builds with the committed archive even when that
cache is absent and upstream network access is disabled.

## Explicit rebuilding

`npm run assets:ear-training:pack` is the only command that rebuilds the
archive. It may download missing/corrupt source samples into ignored
`public/ear-training-samples/`, checking pinned source-pack and sample SHA-256
values without executing upstream JavaScript. It packages sorted flat
filenames with fixed metadata, timestamps and gzip OS marker; identical input
produces identical archive bytes. It also updates the archive descriptor in
`data/ear_training_samples.json`.

Verify the result, then commit the archive, manifest, notices, and intentional
code changes together. Audio files are licensed source samples, not generated
exercise recordings. The gzip archive only slightly reduces MP3 size; its
main purpose is a single tracked asset and one browser audio download.

## Source and attribution

We use FluidR3 GM piano and alto saxophone samples by Frank Wen, converted and
packaged by gleitz and MIDI.js Soundfonts contributors. The checked-in
manifest pins the upstream revision and original per-sample checksums.
The upstream [README](https://github.com/gleitz/midi-js-soundfonts/blob/044fab8e1456bfafc5776e86dfd6bb8697149aef/README.md)
identifies FluidR3 GM as licensed under
[CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/).

Full notices are in `licenses/ear-training-ATTRIBUTION.txt` and
`licenses/CC-BY-3.0-US.txt`, and copied verbatim inside the archive. The tool
also displays a compact Audio samples credit linking the source, license, and
archive. No creator endorsement is implied. Sample licensing does not
relicense the application code. The packaged MP3 bytes are unchanged;
playback-time sustain modifications are described below and in attribution.

Both instruments support concert MIDI 48–84, with a source sample for each
semitone: 37 piano and 37 saxophone files, 74 total. This avoids pitch shifting
within the supported range. Native Web Audio decodes the local samples.
The attack is retained. Both instruments sustain within the original sample's
0.6–1.0 second region. Before applying a 20 ms crossfade, playback searches up
to two fundamental periods for the endpoint whose waveform best matches the
start of the blend. This reduces repeated phase cancellation from blending
opposing waveforms. The resulting loop stays inside the declared source region.
Held piano tones repeat a sampled sustain region rather than reproducing an
unlooped natural decay. Bounds and nonzero loop energy are validated against
every decoded buffer, so a 24-second hold cannot run past its sample or accept
a silent sustain region. The attack and release envelope fit inside the note
duration. No processed audio is written to disk.

Chrome OfflineAudioContext verification decoded all 37 saxophone samples and
rendered each through the player for a full 24-second hold, measuring every
10 ms window after the initial attack. No silent windows occurred. Phase
matching improved the worst minimum-to-median RMS ratio from 0.513 to 0.579;
sampled vibrato still causes normal loudness variation. This signal check
establishes continuous output, not perceived sample quality. A synthetic sampled
waveform regression measures every 10 ms over 24 seconds and rejects the
recurring cancellation dips produced by the earlier fixed endpoint crossfade.

Automated audio tests use fake Web Audio nodes to check timing, cancellation,
rolling scheduling, sample selection, volume and retry. They do not establish
perceived timbre or seamless audible looping. Before release, listen to both
instruments at the supported pitch extremes and a 24-second hold, including
stops, rests, replay, volume changes and a suspended tab. Verify decoding on
supported browsers and test the rhythmic fixture at 40, 80 and 200 BPM.
