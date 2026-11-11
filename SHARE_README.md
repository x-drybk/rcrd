# RCRD local source package

RCRD runs on your own computer. It connects Spotify listening with Discogs catalog, collection, and wantlist features. This package is source code for a local app, not a hosted service or a multi-user server.

After launch, open your profile menu → **Help & setup guide** → **Watch walkthrough** for a narrated tour. The video and its readable transcript are included locally; playback is optional and does not require a streaming account.

## Before starting

- Install [Node.js](https://nodejs.org/en/download) 18 or newer (choose an LTS installer with npm) and [Google Chrome](https://www.google.com/chrome/) on Windows before launching RCRD.
- Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Follow [Spotify's app setup guide](https://developer.spotify.com/documentation/web-api/concepts/apps) to find the Client ID and Client Secret, and register `http://127.0.0.1:3000/auth/spotify/callback` as its Redirect URI for the default port.
- Register an application in [Discogs Developer settings](https://www.discogs.com/settings/developers). [Discogs' settings guide](https://support.discogs.com/hc/en-us/articles/360007423833-How-Do-I-Change-My-Account-Settings) shows where Developers is. Note the Consumer Key and Consumer Secret, and register `http://127.0.0.1:3000/auth/discogs/callback` as its callback URL for the default port. RCRD does not use a personal API token.
- Copy `.env.example` to `.env` and enter those credentials locally. Keep the callback values consistent with the URLs registered above. Never send `.env` to another person.
- Run `npm install`, then open `Launch RCRD.cmd`. Use `RCRD.cmd` for restart and stop controls.

RCRD stores account authorization, Spotify library cache, and its dedicated browser profile under `.data` on your computer. Keep that directory private. Do not expose the local server to other machines or the internet. See the [Admin Guide](ADMIN_GUIDE.md) and [Security Note](SECURITY.md) for details.

Optional recorded play counts can start with the account holder's Extended Streaming History ZIP from [Spotify Privacy](https://www.spotify.com/account/privacy/). After connecting the matching Spotify account, select **Settings → Your listening history → Import Spotify ZIP**. Saved music also adds newer Spotify recent-play events across devices, but long gaps can leave missing plays. RCRD keeps a local summary and recent-play ledger, not the raw ZIP; reimport a newer export to update the baseline. Use **Delete recorded counts** in the same Settings card before sharing the computer.

Optional lyrics require a [Genius API client](https://genius.com/api-clients). Put its Client Access Token in `GENIUS_ACCESS_TOKEN` in your private `.env`, restart RCRD, and choose **Lyrics** in the track bar. RCRD sends the current title and artist to Genius only when requested, then displays a Genius-hosted view when available; Genius may receive your IP address. Lyrics are not stored by RCRD. If the hosted view cannot load, use **Read on Genius**. RCRD is independent and not affiliated with Genius. Keep the token out of source packages.

The packaging script selects named source files and excludes known runtime-data paths. This default setup note omits contributor names; review the archive, contributor credit, and licensing before broader redistribution.
