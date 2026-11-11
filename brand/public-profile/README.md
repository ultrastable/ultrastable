# Organization profile (ready to flip)

**Ultrastable is the foundation for any autonomous system.**

Ultrastable runs on itself: its roadmap, issues, managers, trust ledger, plussing budget and specs are run by the same code it gives everyone else, from this repository alone, with any tools (`python3 -m foundation selfhost`).

`profile/README.md` is the org page shown at github.com/ultrastable once the `ultrastable/.github` repo holds it (that repo is archived; unarchiving it and the org avatar upload are the only parts GitHub exposes no session-safe API for, tracked in `github/org-settings.json` under `manual_ui_only`). Regenerate the images with `python3 brand/tools/generate.py` and `node brand/tools/render-generated.js`; the org page text is written by hand from `brand/brand.json`.

Upload-ready files: `profile/ultrastable-icon-512.png` (org avatar), `brand/generated/cards/<repo>.png` (per-repo social preview, 1280x640).
Contact: pilot@ultrastable.io (routing in `docs/ops/CONTACT.md`).
