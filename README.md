# RCRD — Start here

RCRD is a local-first Spotify and Discogs bridge for listening, catalog discovery, and collection/wantlist workflows. Developer secrets and refresh tokens stay on the local server; Spotify playback uses a short-lived access token in the browser.

## Find what you need

- **New user:** Follow the [first-time setup](#first-time-setup) before launching RCRD. After launch, select your profile image and open **Help & setup guide**. Its **Watch walkthrough** section offers a narrated, chaptered tour and a readable transcript.
- **Already set up:** Double-click **Launch RCRD.cmd** to open the app. Use **RCRD.cmd** for server status, restart, or stop.
- **Configuration, maintenance, or troubleshooting:** Open the [Admin Guide](ADMIN_GUIDE.md).
- **Privacy and sharing:** Read the [Security Note](SECURITY.md) before sharing a source package or changing how the local server is exposed.

Optional recorded play counts: connect the matching Spotify account, request Spotify's Extended Streaming History ZIP from [Spotify Privacy](https://www.spotify.com/account/privacy/), then select **Settings → Your listening history → Import Spotify ZIP**. Saved music combines that historical snapshot with newer recent-play events reported by Spotify across devices. An “≈” count means the imported ZIP matched one song by title and artist under a different Spotify track ID; ambiguous or absent matches say “Not recorded” instead of claiming zero. Long gaps can exceed Spotify's recent-play window, so these are not guaranteed lifetime totals. RCRD does not download the export for you or keep the raw ZIP. See the [Admin Guide](ADMIN_GUIDE.md) for limits and deletion.

Optional lyrics: create a [Genius API client](https://genius.com/api-clients), put its Client Access Token in `GENIUS_ACCESS_TOKEN` in your private local `.env`, and restart RCRD. Select **Lyrics** in the track bar to request the current song. RCRD matches its title and artist through Genius and shows Genius-hosted lyrics when available, with a direct link as fallback; it does not store lyric text. See the [Admin Guide](ADMIN_GUIDE.md) for setup, privacy, and troubleshooting. RCRD is independent and is not affiliated with Genius.

## Purpose

This project is designed to run on a single machine in a trusted local environment. It connects to Spotify and Discogs through a local Node server, keeps OAuth state on the machine, and stores browser preferences locally.

It is intentionally not designed as a public internet service or shared multi-user deployment.

## Local-first security model

- The server binds to loopback by default.
- OAuth and runtime state are stored in a local `.data` directory.
- Sensitive credentials are kept server-side.
- Optional Genius lyrics are loaded on demand in a sandboxed view; opening that view can contact Genius from your browser.
- Public GitHub sharing is acceptable as source code review, but this app should not be exposed to the internet or a shared network without a separate security review and deployment hardening.

See [SECURITY.md](SECURITY.md) for the repo’s security guidance.

## Requirements

- [Node.js](https://nodejs.org/en/download) 18 or newer (choose an LTS installer with npm)
- [Google Chrome](https://www.google.com/chrome/) for the dedicated Windows launcher
- Spotify and Discogs developer app credentials (see the first-run steps below)

Read these steps before opening RCRD for the first time; the in-app guide is only available after the launcher succeeds.

## First-time setup

1. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), create an app with the Web API and Web Playback SDK enabled. The [Spotify app setup guide](https://developer.spotify.com/documentation/web-api/concepts/apps) explains where to find its Client ID and Client Secret. Register `http://127.0.0.1:3000/auth/spotify/callback` as its Redirect URI for RCRD's default port.
2. In [Discogs Developer settings](https://www.discogs.com/settings/developers), register an application and note its Consumer Key and Consumer Secret. Register `http://127.0.0.1:3000/auth/discogs/callback` as its callback URL for the default port. [Discogs' account-settings guide](https://support.discogs.com/hc/en-us/articles/360007423833-How-Do-I-Change-My-Account-Settings) shows where to find Developers. RCRD uses application credentials, not a personal API token.
3. Copy `.env.example` to `.env`. Put your Spotify values in `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`, and Discogs values in `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET`. Keep both callback values consistent with those registered above.
4. Keep `.env` and `.data` local and private; do not publish or share them.
5. Install dependencies:

```bash
npm install
```

6. On Windows, open **Launch RCRD.cmd**. To start only the server for use in an ordinary browser, run:

```bash
npm start
```

For the server-only option, open:

```text
http://127.0.0.1:3000
```

## Commands

```bash
npm start
npm test
npm run test:history-parser
npm run test:launcher
npm run test:share
npm run launch
npm run restart
npm run stop
npm run status
```

On Windows, **Launch RCRD.cmd** (or `npm run launch`) starts the local server and opens RCRD in a Chrome app window without the normal tab and navigation rows. It uses a separate profile at `.data/chrome-profile`, not your normal Chrome profile; browser logins and preferences are not imported. When switching from the previous Firefox launcher, reconnect Spotify and Discogs once and set any browser-stored preferences again. Later launches retain this Chrome profile's cookies and preferences. **RCRD.cmd** provides restart and stop controls; a manual restart leaves the app window open, so reload it afterward. `npm start` starts only the server for ordinary browser use. Keep `.data` private because the profile contains browser session data.

The Windows launcher creates new `.data` and browser-profile directories with private permissions for your Windows account, SYSTEM, and Administrators. It does not silently change permissions on an existing directory: `.data` must not inherit access, and neither it nor the browser profile may allow another account. A browser profile may inherit only those approved permissions from the protected `.data` directory. Back up `.data`, then use Windows **Properties → Security → Advanced** to review the directory and child items before changing access. `npm start` does not perform this Windows launcher check.

## Notes

- This app is intended for local personal use.
- Do not run it on a public host without a separate secure deployment design.
- Features such as playback, account disconnect, and provider API calls are designed for a single trusted user context.

## Sharing a local source package

On Windows, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Build-RCRD-Share.ps1` to create a ZIP in `release/` from an explicit list of app files. It excludes `.env`, `.data`, browser profiles, tests, local shortcuts, and legacy desktop files. The package uses a name-free `SHARE_README.md` as its setup guide by default. To include the existing contributor credit in the packaged README, add `-IncludeContributorCredit`. Review licensing and attribution before broader redistribution. Do not ZIP the entire working directory or expose its local server to other machines.

## Author and contributors

Created by Kevin M. Byrd with ChatGPT.

## License

This project is currently provided as source code for local project use and experimentation. Add a license file before publishing it publicly in a broader or formal distribution context.
