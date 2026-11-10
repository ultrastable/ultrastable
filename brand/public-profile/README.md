# ultrastable/.github (public)

Contents for the special **public** repository `ultrastable/.github`. Its `profile/README.md` is the landing page of github.com/ultrastable. Everything here is SAFE NOW: generic, non-enabling, no internal mechanics.

## Create it (owner, one command, because agent sessions cannot create repos)
From a clone of the private repo:
```
gh repo create ultrastable/.github --public --description "Ultrastable: software that stays up" && cd brand/public-profile && git init -b main && git add -A && git commit -m "Org profile" && git remote add origin https://github.com/ultrastable/.github.git && git push -u origin main
```
(Repo creation, the avatar and the org settings below are identity-bound steps only an org owner can do.)

## Org settings text
- Name: Ultrastable
- Description: Coding agents write code. Ultrastable runs the system. From one idea to an organization that improves itself.
- URL: https://ultrastable.io
- Email: pilot@ultrastable.io
- Avatar: `profile/ultrastable-icon-512.png` (orange triangle mark, no tile)
- Repo social preview: `social-card.png`
- Verify the three domains on the org (Settings, Verified and approved domains).

## Public versus private
Public: this repo only (profile text, logo, banner), plus the domains. Private: `ultrastable/ultrastable` (platform, patent drafts, business plan, everything else). The profile mentions that a private repo exists and nothing about its contents.
