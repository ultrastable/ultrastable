<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# packs/video: short video publishing with provenance

Class B pack (`US-SPEC-21`). OFF until enabled; every publish passes `guard.send` on channel `video`.

| Piece | Does |
|---|---|
| `submitVideo` | runs `checkVideo` (length, asset hash, provenance, disclosure on synthetic media, fresh public claim sources, allowlisted https links), records a canonical provenance hash, queues once per asset hash |
| `publish` loop | `guard.send` per queued video; the channel port gets the file reference and provenance; below the act rung it waits as a decision card |
| `verify` loop | `fetchVideo` read-back: live and same provenance hash, else item `VIDEOVERIFY-<id>` |
| `metrics` loop | counts, views, removal detection (`VIDEOREMOVED-<id>`) |

Channel port: `publish({title, description, assetRef, assetSha256, durationS, provenance, provenanceHash}) -> {id, url}`, `fetchVideo(id) -> {state, provenanceHash?, views?, url?} | null`. Secret by name only: `VIDEO_CHANNEL_TOKEN`. Tests: `video.test.js`.

## YouTube channel

`channels/youtube.js` (`createYoutubeChannel({ fetch, env, readAsset, privacy })`) is the JS counterpart of `../seed/plugins/youtube/plugin.py`: a resumable upload through an injected fetch, `private` or `unlisted` only (a request for `public` is refused: public release is a decision card for a person, US-21-R24), the provenance hash carried in the description and read back by `fetchVideo`, a read-only `probe()` (US-21-R25), and no credential in any URL or error. Tests: `channels.test.js`. The composition of the video itself runs server-side in `.github/workflows/demo-video.yml` with `../scripts/video_build.py`; this pack publishes what that produces.
