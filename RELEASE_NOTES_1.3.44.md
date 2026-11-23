# RCRD 1.3.44

## Changes

- Edit a Spotify playlist you own from Saved music. Rename it, search and add a song, or remove all copies of a song with a second confirmation click. Public playlists may require reconnecting once for Spotify's public-playlist permission. The playlist and sidebar counts refresh after each saved change.
- The Previous control restarts the current track after 15 seconds of playback; another press near the beginning goes to the preceding track. The setup guide now explains this behavior.
- Synthetic browser checks are part of the release gate. They cover narrow layouts, dialogs, playback controls, update states, account switching, and playlist editing without connecting to real accounts.

## Release checks

Run `npm ci`, `npx playwright install chromium`, `npm test`, `npm run test:crlf`, `npm run test:launcher`, `npm run test:history-parser`, `npm run test:share`, and `npm run test:browser`. GitHub Actions runs these suites on push and pull request. The release ZIP should be built with `scripts/Build-RCRD-Share.ps1` and its version and SHA-256 digest verified before publishing. Do not include `.env` or `.data`.

The automatic update itself still needs a manual check from a launcher-managed 1.3.43 install after publishing a verified `RCRD-1.3.44.zip` release. The synthetic browser check exercises the available, current, and failed-install UI states; it does not replace the running application files.
