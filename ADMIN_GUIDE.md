# RCRD Spotify / Discogs Admin Guide

The profile menu and Settings include **Restart RCRD** on Windows whether or not Spotify or Discogs is connected. Open RCRD in the browser first so it can establish a local app session. Confirm the restart; the page waits up to 30 seconds for a replacement server and reloads when it is ready. Settings then shows **RCRD restarted successfully.** for eight seconds, then clears it. Restart errors remain visible. If tab storage is unavailable, confirmed success remains visible with a manual reload instruction instead. The running server checks its runtime identity, starts a hidden Node helper, and shuts itself down only after the restart response is sent. The helper waits for confirmed parent exit before launching the fixed server entry point with the same Node runtime and port; it does not terminate another process or rely on Windows CIM permissions. Connections and preferences are not cleared. An older running server requires one manual restart to load this endpoint. If the restart fails, use the launcher and reload the page.

RCRD is a local-first bridge between Spotify listening and Discogs catalog actions. Spotify supplies the current listening context and playback controls; Discogs supplies catalog search, collection, and wantlist actions. Purchases are intentionally completed manually on Discogs.

## Requirements

- Node.js 18 or newer
- npm available on the system `PATH`
- A Spotify Premium account for Web Playback SDK controls
- Spotify and Discogs developer applications with the callback URLs below

## Configuration

Copy `.env.example` to `.env` and fill the values locally. Never commit `.env`, paste credentials into source files, or expose them in browser code.

Required variables:

```text
DISCOGS_CONSUMER_KEY=your_discogs_consumer_key
DISCOGS_CONSUMER_SECRET=your_discogs_consumer_secret
DISCOGS_CALLBACK_URL=http://127.0.0.1:3000/auth/discogs/callback
DISCOGS_REQUEST_TOKEN_URL=https://api.discogs.com/oauth/request_token
DISCOGS_AUTHORIZE_URL=https://www.discogs.com/oauth/authorize
DISCOGS_ACCESS_TOKEN_URL=https://api.discogs.com/oauth/access_token

SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/spotify/callback
SPOTIFY_REFRESH_TOKEN_MAX_AGE_DAYS=180
GENIUS_ACCESS_TOKEN=optional_genius_client_access_token
```

The callback values must match the developer-console values exactly. Use `127.0.0.1` consistently for local development.

Lyrics are optional. If you want them, create a Genius API client in your [Genius account](https://genius.com/api-clients). Enter **RCRD** for App Name, leave **Icon URL** blank, and use `http://127.0.0.1:3000/` for App Website URL. Leave **Redirect URI** blank if Genius permits it; if the form requires a value, use `http://127.0.0.1:3000/` there too. RCRD does not use a Genius sign-in redirect, so do not enter the Spotify or Discogs callback URLs. If Genius rejects a local website URL, use a public project page you control and keep its content free of credentials. Copy the resulting **Client Access Token** into `GENIUS_ACCESS_TOKEN` in your local `.env`, and restart RCRD. Do not paste the token into chat, source code, or the browser. Click **Lyrics** in the track bar while a Spotify song is playing. RCRD sends only that song's title and artist to Genius for an on-demand match, then loads Genius-hosted lyrics in a sandboxed view; Genius may see your IP address when you open it. RCRD does not download or save the lyrics. If no safe match is found or the embed is unavailable, use the link to open Genius directly. Lyrics remain unavailable until the token is configured.

## Run the app

On Windows, open **Launch RCRD.cmd** to start or reopen the app without a visible server console. Open **RCRD.cmd** for the Start, Restart, Stop, and Status controls. The launcher needs Node.js on `PATH` and Chrome installed. It opens RCRD in a Chrome app window without the normal tab and navigation rows, using a dedicated profile at `.data/chrome-profile` rather than your normal Chrome profile. The previous Firefox profile and normal browser logins are not imported: reconnect Spotify and Discogs once in the new profile and set any browser-stored preferences, including volume, again. Later launches retain that profile's cookies and preferences. Keep the profile private and do not copy it when sharing the project. A manual server restart leaves the Chrome app window open; reload it afterward. This uses the installed Chrome engine, not the Electron prototype, and is not an independent browser runtime.

In VS Code, open this project folder, then choose **Terminal → Run Task** for **RCRD: Start**, **RCRD: Restart**, **RCRD: Stop**, or **RCRD: Test**. These tasks reuse the existing Windows launcher and Node test runner. To debug the server, stop a normally launched instance first, then select **Debug RCRD server (stop the running server first)** in **Run and Debug**. VS Code's Stop button ends that debug session.

To run the server manually from the project directory:

```powershell
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) with the default port. Run only one server instance on that port. If it is occupied, use **RCRD.cmd** to check or stop a launcher-managed instance; do not stop an unrelated process merely because it uses port 3000.

## Connecting accounts

1. Select **Connect Spotify** and complete Spotify authorization.
2. Select **Connect Discogs** and complete Discogs authorization.
3. Return to the app and confirm both connection buttons show their connected state.

OAuth state is stored in the local session and checked on callback. If a callback reports an expired or invalid session, start the connection again from the app instead of reusing an old callback URL.

## Settings

Select your profile image to open the menu for connection status, **Settings**, **Help & setup guide**, **Restart RCRD**, and **About RCRD**. The Settings view shows whether Spotify and Discogs are connected and the Spotify renewal window. It does not display or accept raw developer secrets. Each account shows **Connect** when disconnected or **Sign out** when connected. To change developer credentials, edit the local `.env` file and restart the server.

The guide's **Watch walkthrough** section plays the bundled, chaptered 1080p MP4 on demand and links to a plain-text transcript. The recording uses an isolated synthetic account and mocked providers, not local accounts, credentials, or session data. The local server serves only the named video and transcript files, with byte-range support for seeking; the share-package allowlist includes both files.

The **Sign out** buttons remove that session's RCRD authorization and cancel any pending authorization for that service. After Spotify sign-out, the app clears its cached account data and resets the profile, library, playlists, recommendations, and player. Discogs sign-out clears its collection and wantlist data from the browser. Responses from account requests started before sign-out are ignored. Sign-out does not revoke the application grant or clear the Spotify or Discogs website's browser cookies; it also leaves local preferences and unsynced records on this computer. Spotify's next connection shows its approval screen, where **Not you?** allows another account. For Discogs, open its website from Settings in the same browser profile, sign out there, then connect another account. This is one local profile, not private multi-user storage. A failure to save sign-out is reported instead of showing success.

**Clear RCRD data on this browser** is separate from Sign out and requires confirmation. It signs out both services, empties this browser's RCRD-only collection and wantlist, removes RCRD UI preferences, then reloads. If a sign-out or storage operation fails, it reports incomplete cleanup instead of claiming success. It does not remove `.env`, other browser profiles, or Spotify/Discogs website cookies. Use separate Windows/browser profiles for genuine privacy between people; this button does not turn one shared profile into a multi-user account system.

**Ambient visualizer** is an optional display mode in Settings. Automatic activation is off by default. Enable it to cover the app after five minutes without input while the RCRD tab is visible. Select **Start visualizer now** or the track-bar visualizer button to request browser fullscreen and hide the app title bar; the track-bar button works even when automatic activation is off. Browsers require a user action to enter fullscreen, so an idle-timer activation stays within the page; if fullscreen is unavailable or denied after a button click, the visualizer still opens in-page. Click, tap, press a key, or scroll to return to the app; moving the pointer alone does not close it. The display hides and pauses when the tab is hidden. Its off-center record faces spin continuously while the shapes and color fields drift. With Reduce Motion enabled, the background and shapes gently fade instead of drifting, but the records continue to spin while the visualizer is shown. This is ambient motion, not an analysis of Spotify's audio spectrum. It reduces the time the app's static interface stays on screen but cannot guarantee protection from image retention or display burn-in.

## Local-first security boundary

RCRD is intentionally designed as a local-only utility. The server listens on `127.0.0.1` by default, stores OAuth/session material under the local `.data` directory, and assumes a single browser on the same machine. Do not expose the server to other machines, public networks, or untrusted network interfaces unless you have independently reviewed the risk and hardened the deployment.

If you are sharing the source on GitHub, treat the project as local-first source code, not as an internet-facing service. The public repository should only document the local run model; remote deployment, public hosting, or shared multi-user access requires a separate security review and additional deployment hardening. The default loopback behavior is a safety control, not a general multi-user hosting model.

## Recovering local session state

RCRD stores runtime state in `.data` and may refuse to start cleanly if that directory contains stale or corrupted session data.

The Windows launcher gives newly created `.data` and browser-profile directories private permissions. For an existing `.data` directory, it stops if permissions are inherited or another account has an allow entry. A browser profile may inherit only approved permissions from the protected `.data` directory. The launcher does not revoke access on your behalf. Back up `.data` and review its directory and child-item permissions in Windows **Properties → Security → Advanced**. The server-only `npm start` path does not run this launcher permission check.

If the Spotify cache cannot be restored, RCRD stops before changing it. Back up `.data` first; then inspect only `spotify-cache.json`. Removing that cache file after a backup makes RCRD fetch Spotify data again without removing the separate OAuth session store. Do not remove `oauth-session.key` or `oauth-sessions.enc` to repair a cache error.

If a session or checkpoint appears corrupted:

1. Stop the app and close any running RCRD server.
2. Back up the entire `.data` directory before making changes.
3. Inspect the files in `.data` for stale session artifacts, stale PID files, or a missing `oauth-session.key`.
4. Remove only the invalid state file or the stale session data, then restart the server.
5. Reconnect the affected provider account if the encrypted OAuth store or a refresh token was lost.

Never share `.data` or `.env` files outside the local machine. They contain account and session state and can allow reuse of the connected account without re-authentication.

## Spotify controls

When Spotify is connected, the Web Playback SDK creates an RCRD browser device and the server transfers playback to it. The player supports:

- Current artwork and track details in the main player, with play/pause controls directly beside the listening context
- Click the track-bar album artwork (or focus it and press Enter) to open the current song's album and track list inside RCRD. This also works while paused and when the album is not saved. Spotify must provide a valid album ID and name; the artwork action is disabled otherwise. The current song is indicated in the track list.
- Previous and next track controls
- Shuffle and repeat controls
- Scrubbing the progress control
- Volume adjustment from the speaker button
- Saving or removing the current Spotify track from Liked Songs with the heart button
- Searching the current track in Discogs

Playback buttons send authenticated commands through the local server to Spotify's playback API. The browser SDK supplies the RCRD playback device, progress seeking, volume, and live player state; previous/next, play/pause, shuffle, repeat, and starting a selected result use Spotify's playback API. The SDK receives a short-lived Spotify access token through `/api/spotify/token`; developer secrets and refresh tokens remain server-side.

Spotify authorization requests the `streaming` scope for browser playback. A connected account without that granted scope can still browse, but RCRD does not supply its token to the Web Playback SDK. Playback health shows **Playback permission needed**; account reauthorization is available from Settings, not Playback health. Ensure the Spotify developer app has Web Playback SDK enabled. If Spotify reports `streaming` as granted but still rejects its internal `web-playback` check, reconnecting alone may not help; verify the app configuration and Spotify Premium status. Do not share the SDK's WebSocket URL or browser Network headers, as they can contain a short-lived access token.

Repeat follows Spotify's current playback state. Albums, artists, and playlists cycle through context repeat, track repeat, and off. The repeat button displays **ALL** for context repeat and **1** for single-track repeat; off has no badge. A single track started directly from search has no playback context, so it cycles between track repeat and off instead of sending an unsupported context-repeat command.


The Saved music view loads saved Spotify albums and recently played tracks using the `user-library-read` and `user-read-recently-played` scopes. The track-bar heart checks saved status once when the playing track changes and uses `user-library-modify` to save or remove that track from Spotify's Liked Songs. Existing connections need to reconnect once to grant the new permission. The heart is unavailable for non-track items; if the saved-status check fails, it offers a retry and never assumes the track is unliked. A successful change invalidates RCRD's saved-library cache; reopen **Saved music** to refresh its full listing instead of reloading a large library after every click.

Connection status is separate from feature permissions: Spotify continues to show **Connected** when only the Liked Songs permission is missing. Select **Enable Liked Songs** in the notice to grant it; this does not mean the account is disconnected. If the server has not loaded the new permission-status field, the notice asks for a RCRD restart instead of another authorization.

**RCRD Mix:** Play or select a Spotify song, then click **Mix** in the track bar. RCRD automatically builds a 100-song personal mix; you do not need another account, API key, or artist selection. Review it and choose **Start mix · replace playback**. Nothing plays automatically. Starting sends the complete sequence to your selected Spotify device, replacing its current sequence; Spotify's shuffle and repeat settings still apply. Closing the preview changes nothing, and signing out clears it.

Related artists can now qualify through account-free ListenBrainz artist-radio data, with Spotify artist identities cross-checked against exact MusicBrainz URL relationships. Discogs can supplement this with specific style matches: RCRD verifies the seed artist/album, matches candidate artist and album names on Spotify, requires overlapping genre context, rejects ambiguous artist identities, and never uses a broad genre alone. Discovery does not depend on your playlists. Your owned/collaborative playlists remain a fallback: a playlist must contain the starting song or two different songs crediting its lead artist; candidates need two songs or two such playlists, with very broad playlists excluded. Saved songs and exact-ID imported counts supplement/rank eligible artists; counts alone do not establish similarity. These are music-data and listener-affinity signals, not a guarantee of mood/audio similarity or Spotify Song Radio.

RCRD removes duplicate IDs, equivalent titles with the same artist credits, shared recording identifiers when supplied, known unavailable tracks, and labeled alternate versions absent from the starting song. Each mix contains at most ten songs per lead artist and four per album. **Playback requires at least 100 qualifying unique tracks**; fewer results show an explanation rather than unrelated filler. All 100 are selected by default; deselecting songs disables Start until 100 are selected again.

The first lookup can take up to a minute. Public metadata lookups use fixed HTTPS services, an identifying application User-Agent, at most one request per second per public provider, bounded memory caches, and provider cooldown guidance. RCRD sends only current catalog artist/recording identifiers to MusicBrainz/ListenBrainz and catalog artist/album/style queries to Discogs; it does not send imported history, playlists, account identity, or Spotify credentials to public metadata services. Sources, matching uncertainty, throttling and lookup limits are disclosed. Discovery checks at most 32 ListenBrainz artists and 36 Discogs artist/album searches, with no automatic broadening to unrelated artists. When discovery is sparse and time remains, the bounded personal-playlist fallback checks up to 200 summaries/eight playlists, 200 cold or 2,000 cached items per playlist, and 200 cold or 10,000 cached saved tracks. A shortfall describes the checked sources, not every song available in the account. No new listener accounts, Spotify permissions or dependencies are required; mixes are not saved as playlists.

Maintainer setup for public discovery: set `RCRD_METADATA_CONTACT` in the local `.env` to a real public HTTPS project/support URL or a contact email you are comfortable sharing with the API operators. A website and another account are not required. The contact is sent only in RCRD's server-side User-Agent; it is not shown in the app interface, and the real `.env` remains excluded from share packages. Blank or invalid contact settings disable MusicBrainz/ListenBrainz calls with an explicit notice rather than sending noncompliant requests; Discogs and personal-source fallback can still operate. This is application-maintainer configuration, not a new listener login. Public-source attribution appears in the Mix dialog.

Provider credits: the Mix preview links to MusicBrainz, ListenBrainz and Discogs; About lists Spotify, Discogs, MusicBrainz, ListenBrainz, and Genius and displays provider non-affiliation notices. Discogs catalog, collection, wantlist and pressing comparison records link to the applicable release or master page. Spotify result cards and the playing-track bar link to the corresponding Spotify content; album track rows link to their Spotify tracks. The playing-track bar uses a subdued Spotify icon so the transport controls remain legible. The Lyrics dialog identifies Genius, links to its song page, and shows Genius-hosted content rather than copying lyrics into RCRD. Provider names and trademarks remain their owners' property. See [Spotify's design guidelines](https://developer.spotify.com/documentation/design), [Discogs' API terms](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use), and [Genius](https://genius.com/) when distributing or changing the app. Attribution is not a substitute for permission to reproduce lyrics.

After Spotify connects, the Listening view fills **For your ears** with up to 30 unique albums from recently played tracks. Saved albums fill any remaining positions when fewer than 30 recent albums are available. **Long-term favorites** can also show up to 30 distinct albums after recent-listening and collection matches are excluded; fewer appear when Spotify provides fewer eligible albums. Both views show eight albums per page, with page controls beneath the cards. Long-term favorites has no refresh or cycling control; use its page controls to browse the available albums. **For your ears** retains its normal refresh control. Without a Spotify connection, the view prompts you to connect rather than showing sample albums.

Artist names on Spotify cards can be clicked (or activated with Enter/Space) to search the full Spotify catalog in Saved music. Artist names in the Discogs collection, wantlist, and catalog cards open an artist-filtered Discogs catalog search, clearing unrelated format, country, genre, year, and release identifiers. Combined artist credits search the displayed credit together. Album-title links remain separate and open the album's tracks; artist searches do not start playback or modify your library.

The home hero's right artwork panel has a **Find your next record** search form. Enter an artist or album, optionally choose vinyl or CD, and search the Discogs catalog. The search does not add records or make purchases automatically; review the editions before adding one to your collection or wantlist.

RCRD uses a low-glare dark theme across the application. Spotify green/lime actions, Discogs-oriented green surfaces, and album artwork remain higher-contrast accents so platform context and primary actions stay recognizable.

The Spotify view loads saved tracks and explicitly saved albums across provider pages, up to 100,000 items or 2,000 pages per fetch. If either limit is exceeded, the request fails with an error rather than showing a partial library as complete. Track saves are grouped by album, album-only saves are merged into the same library, and searches cover album titles, artists, and saved track names. While pagination is still loading, the view shows a loading state. Saved-library results default to 24 per page, with 12, 24, or 48 selectable in Saved music; this preference also applies to playlist tracks. Track rows, including playlist tracks, show a separate Plays field: imported ZIP history plus newer Spotify recent-play events from any device. An exact Spotify track-ID match is preferred. If the track ID changed but the imported history has exactly one song with the same title and artist, RCRD shows an approximate count marked “≈”; this may represent another recording. Ambiguous or missing matches show “Not recorded,” not zero. Album-only saves show a dash because counts are per song. Full-catalog search uses Spotify's server-side offset pagination and displays controls on both Listening and Saved music; the Saved music page-size selector is hidden in that search scope. The view also supports grid/list layout, sorting, scrolling, and playlist selection. List mode uses compact rows so more playlist tracks fit in the scroll area. Sorting supports artist, displayed title (song title for tracks, album title for album-only saves), album name, year, and recently saved/relevance where the selected result type provides that field; the Listening search exposes the same sort choices while catalog results are displayed. On wide screens, the sidebar contains the single playlist selector; on compact screens, the selector appears in Saved music. The app offers playlist-item access for playlists owned by or collaborative with the connected user; other followed playlists are omitted from its selector. The shared header search changes its placeholder and behavior based on the active view: Spotify library search in Saved music, full Spotify catalog search on Listening, and Discogs catalog search on Discogs views. Switching between platforms clears the query.

Saved music also offers **Play count** sorting for saved-library and playlist tracks. It checks counts across all matching tracks before settling the order, not just the current page. Use the direction arrow for highest-first or lowest-first; unknown counts and album-only entries stay last. The first count-based sort can take longer for a large library; subsequent sorts reuse recent cached counts. Play-count sorting is unavailable in full-catalog search and Listening, where the same complete song-count dataset is not available.

Click a Spotify album or song result's title, artwork, or album link to open its album's track listing inside RCRD. This works in Listening search, Saved music search, and full-catalog search when the result supplies an album ID. The album view retains the existing track playback, current-track indicator, and Liked Songs controls. **Back** restores the previous results. Artist and playlist search results do not imply an album and therefore do not offer this album action. Settings and the setup guide hide the shared search bar because those pages do not use it.

Use the Spotify **Search scope** selector to switch between the saved library and the entire Spotify catalog. Catalog searches cover albums, tracks, artists, and playlists through the server-side Spotify search endpoint. The endpoint caps requests at Spotify's current maximum of 10 results per item type.

Playable Spotify results display a **Play** button. Track results start that track; album, artist, and playlist results start their Spotify context in the RCRD browser player. Playback requires Spotify Premium, an active connection, and a ready RCRD browser device.

The Spotify navigation includes **DJ X ↗** as a launcher for Spotify's own DJ experience. Spotify does not expose DJ as a Web API or Web Playback SDK context, so the launcher opens Spotify's DJ search in a separate tab. Start DJ in Spotify; RCRD will continue following supported currently playing tracks and provides its normal playback controls and **Search in Discogs** action. DJ voice commentary and requests remain inside Spotify.

## Discogs actions

Discogs search is performed through the server so consumer credentials and OAuth secrets remain private. Catalog results use Discogs page metadata to provide numbered pagination. After authentication, the app loads collection and wantlist pages independently, up to 100,000 items or 2,000 pages per fetch, then displays records 24 at a time with numbered pagination. A fetch beyond those limits fails rather than presenting a partial collection or wantlist as complete. If one section fails, its error is displayed without hiding data successfully loaded for the other section. Collection and wantlist views start empty until Discogs data loads; any records you previously saved locally remain on this computer. Collection and wantlist actions require an authenticated Discogs session. Listing purchases are not automated by this app.

Entering **My collection** or **Wantlist** requests a fresh copy of that section from Discogs. Counts and records are synchronized whenever the view is opened; each tab has its own 12, 24, or 48 records-per-page preference and pagination is applied locally; rapid navigation ignores older overlapping responses.

The **Open on Discogs** link opens the human-facing release or master page on `www.discogs.com`. API `resource_url` values are used only for data retrieval and are never presented as browsing links.

Collection and wantlist sorting is applied to the complete synchronized account data before pagination. Available fields are recently added, artist, release title, year, and format. Explore sorting applies to the currently returned Discogs search page because the verified search contract does not provide global artist/song sorting.

Collection filters operate across the complete collection before pagination. Discogs `Vinyl` values and common vinyl descriptions such as `LP`, `12\"`, `10\"`, `7\"`, and `Shellac` are grouped under **Vinyl**; `CD` and `Compact Disc` are grouped under **CD**.

## Token and renewal behavior

Spotify access tokens are refreshed server-side as they expire. RCRD's `SPOTIFY_REFRESH_TOKEN_MAX_AGE_DAYS` setting drives a local renewal reminder (180 days by default, with a warning during the final 14 days); it does not itself expire Spotify's authorization. If Spotify rejects a refresh token, reconnect the account.

OAuth authorization is persisted locally across app and browser restarts for a browser that retains its valid session cookie. Refresh tokens and Discogs access credentials are encrypted with AES-256-GCM in `.data/oauth-sessions.enc`; its randomly generated local key is stored separately in `.data/oauth-session.key`. The HTTP server serves only explicitly listed public app files, excluding `.env` and `.data`. The `rcrd_session` cookie is HTTP-only, SameSite=Lax, and valid for 365 days by default; `SESSION_COOKIE_MAX_AGE_DAYS` may set a duration from 1 to 365 days. The server also rejects expired sessions and removes them from its store. Existing saved sessions without an expiry receive one bounded expiry when first loaded after this update. A browser without a valid saved cookie must connect through Spotify and Discogs again; it does not inherit another browser's account. Keep both `.env` and `.data` private when sharing the project folder or computer.

Spotify responses used for the profile, saved library, playlists, playlist tracks, recent listening, and repeated catalog searches are cached. Account data uses a local persistent cache keyed by a SHA-256 hash of the Spotify account ID. OAuth credentials are never written to that response cache; the refresh token is stored only in the separately encrypted OAuth session file. The entire `.data` directory is excluded by `.gitignore`, and an explicit Spotify disconnect removes that account's cached response data and saved authorization.

RCRD no longer asks for Spotify's email permission. New profile responses and cache entries contain only the ID, display name, first HTTPS image URL, and follower count used by the UI. On the first server start after this update, legacy full-profile cache entries are removed without deleting saved-library records; an existing Spotify authorization may retain its old provider grant until you sign out and connect again. The profile cache is not a substitute for private Windows filesystem access, and the library and listening cache still contain account-derived data.

## Optional Extended Streaming History import

Spotify does not expose lifetime play counts through RCRD's API access. The user must request and download the Extended Streaming History ZIP from [Spotify Privacy](https://www.spotify.com/account/privacy/), connect the matching Spotify account in RCRD, and select **Settings → Your listening history → Import Spotify ZIP**. RCRD asks the user to confirm the ZIP belongs to the connected account. If Spotify included an account ID in the audio history, RCRD also checks it and rejects a mismatch. If Spotify omitted the ID, RCRD cannot verify ownership; the user's explicit confirmation is required before its counts can be stored under the connected account. The import is local and needs no additional OAuth scope. RCRD counts qualifying music events of at least 30 seconds with a Spotify track URI; these are RCRD-derived counts, not official Spotify totals. After importing, search and sort all counted tracks in Settings. Each page loads up to 12 tracks; about six are visible at once in the scrollable list. Use First, Previous, Next, or Last to jump between pages. The imported ZIP snapshot does not update automatically, but Saved music can add Spotify recent-play events after the export cutoff. The recent-play feed exposes only a limited window, so long gaps between RCRD syncs may leave missing plays. Reimport a newer export to replace the baseline without double counting overlapping recent events.

The ZIP is limited to 256 MiB and is deleted from RCRD's temporary folder after parsing; the original downloaded file remains wherever the user saved it. The parser reads only audio history JSON inside the archive, does not extract paths, and limits entry counts, expanded data, events, and distinct tracks. If the export identifies an account, it must match the connected Spotify account ID; unidentified exports require explicit user confirmation. The import keeps URI, track title, artist, album, play count, and date range in `.data/listening-history` under an account-hashed filename. A separate account-hashed local ledger keeps recent track URIs and play timestamps for deduplication. This local summary is sensitive account-derived data and is not encrypted at rest; keep `.data` private. Use **Delete recorded counts** while connected to that account to clear both imported history and recent-play records; older provider events are ignored after deletion. Signing out or clearing browser data does not delete these summaries.

Non-sensitive interface preferences are stored in the browser under `rcrdUiPreferences`. These include volume, the Ambient visualizer setting, Spotify grid/list mode, search scope, sorting choices and directions, independent Discogs collection/wantlist page sizes, the collection format tab, and Discogs catalog filters. They survive normal browser and app restarts on the same device. Clearing site data resets them to defaults; account tokens are not stored in this browser preference object.

The saved library is lazy-loaded only when **Saved music** is opened. The Listening page uses the smaller recent-listening request, while playlist metadata remains available for the sidebar selector. A successfully loaded library is retained for 12 hours, playlist metadata and playlist tracks for 15 minutes, recent listening for 5 minutes, and profile data for 24 hours. Repeated catalog searches remain in memory for 30 seconds. Large Spotify downloads save each completed page in a separate local checkpoint file; after an interruption, a later attempt can resume from the saved offset without rewriting or downloading completed pages. Checkpoints expire after seven days and are removed after a successful cache write.

In-flight Spotify requests are serialized so a page load does not send multiple bursts at once. If Spotify returns `429`, the server preserves the status, honors `Retry-After` when supplied, and applies bounded exponential backoff when Spotify reports development-mode `QUOTA_EXCEEDED` without a reset time. A quota-exhausted response cannot be bypassed locally; wait for Spotify to reset the development quota before retrying.

Provider requests have a 20-second timeout and an 8 MiB response limit. Discogs `429` responses set a shared, bounded cooldown using `Retry-After` when available, or bounded exponential backoff otherwise; RCRD reports the wait rather than automatically retrying account mutations. RCRD listens on `127.0.0.1`, checks the local request host, and requires an application header while rejecting a mismatched `Origin` for account-changing API actions. These controls are intended for a local single-user app; they do not turn it into a hosted multi-user service.

## Security practices

- Keep `.env` local and protected by `.gitignore`.
- Do not log access tokens, refresh tokens, consumer secrets, authorization codes, or callback query strings.
- Keep Spotify and Discogs calls server-side where credentials are involved.
- Playback requests accept only an allowlist of actions, validated Spotify URIs, and validated browser device identifiers.
- Use exact loopback callback URLs; do not broaden redirects unnecessarily.
- The queue endpoint accepts only validated `spotify:track:<id>` URIs.
- Treat browser-rendered external content as untrusted and keep external links `noopener`-protected.

## Troubleshooting

### `npm` is not recognized

Install Node.js, reopen PowerShell, and confirm:

```powershell
node --version
npm --version
```

### Port 3000 is already in use

Use **RCRD.cmd** to check or stop a launcher-managed instance. If another application owns port 3000, close that application or configure a different `PORT` and matching OAuth callback URLs before starting RCRD.

### Spotify authorization state is invalid or expired

Start a new connection from the app. Confirm the Spotify redirect URI is exactly:

```text
http://127.0.0.1:3000/auth/spotify/callback
```

### Discogs says the OAuth session is expired or invalid

Reconnect Discogs from the app and confirm the Discogs callback URL uses the same host and port as the running app.

### Playback controls do not respond

Confirm Spotify Premium is active, the browser tab is open, and Spotify has been reconnected after any scope change. The SDK must report a ready browser device before controls can operate.

If **RCRD · Spotify** is missing from the available devices even though the player says **Ready**, open **Playback health** and choose **Reconnect RCRD player**. This recreates the playback device for the current RCRD window without signing out of Spotify. The device list refreshes when the SDK reports readiness; select **RCRD · Spotify** to transfer playback back. An explicitly selected external Spotify device remains selected during reconnection, so reconnecting alone does not take playback away from that window. During connection, the action reads **Connecting…** and is disabled; after 30 seconds, RCRD reports **Still connecting** while allowing a late SDK ready event or a manual Retry. An empty device list does not by itself prove that the account disconnected.

The track display refreshes after a successful device transfer and when RCRD regains focus. Spotify's SDK supplies local-player events; while you are actively interacting with a focused RCRD window, external-device metadata is checked every three seconds. After a minute without interaction, when unfocused, or when local SDK events cover playback, the API fallback remains approximately fifteen seconds. Hidden windows stop the polling timers. Overlapping checks are suppressed, and a requested immediate refresh can queue one follow-up behind an older in-flight check. These intervals are scheduling targets, not guarantees about Spotify/network response time; they do not change the audio transfer itself.

### Lyrics do not appear

Confirm `GENIUS_ACCESS_TOKEN` is set in the private local `.env` and restart RCRD. Start a Spotify song, select **Lyrics**, and wait for the Genius-hosted view. If no reliable match is found or the view cannot load, select **Read on Genius** to open the source page. Do not copy lyric text into RCRD as a workaround; RCRD does not store it.

## Validation commands

```powershell
node --check app.js
node --check server.js
npm test
npm run test:launcher
node --test tests/server-security.test.cjs
```

If npm is unavailable but Node is on `PATH`, run the same logic with:

```powershell
node tests/run.cjs
node --test tests/server-security.test.cjs
```

The Node suite and Windows launcher checks use synthetic data and do not call live Spotify or Discogs accounts or stop the running server. Syntax checks and passing unit tests do not replace a browser or security review.
