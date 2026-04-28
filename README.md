# NAIGC Nationals 2026 — Photo Picker

Internal triage tool for NAIGC ops leadership. Team members pick their top 40 favorites from ~700 candidate photos.

## One-time setup

1. `npm install`
2. `npm run build` — generates `docs/photos/`, `docs/thumbs/`, `docs/manifest.json`
3. Push to GitHub; enable Pages from `main` branch, `/docs` folder.

## Adding new photos

Drop them in the source folder and re-run `npm run build` (skips already-processed files), then push.

## Tech

- Vanilla HTML/CSS/JS, no build tools for the site itself.
- Firebase Firestore for real-time shared selections.
- `sharp` for thumbnail generation.
