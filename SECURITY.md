# Security note

RCRD is intentionally a local-first application and is not designed for public, internet-facing deployment.

## Supported model

- The server binds to loopback by default (`127.0.0.1`)
- OAuth credentials and runtime state are stored under `.data` on the local machine
- Optional imported Spotify listening-count summaries and a local ledger of recent Spotify track URIs/play timestamps are stored under `.data/listening-history` as account-derived data; they are not encrypted at rest. The imported ZIP is deleted from RCRD's temporary folder after processing, but the user's original download is untouched.
- Optional Genius lyrics use a server-side Client Access Token (`GENIUS_ACCESS_TOKEN`) from `.env` for song matching. When you request Lyrics, RCRD sends the current title and artist to Genius and loads a sandboxed Genius-hosted view if available. That browser request can reveal your IP address to Genius. RCRD does not store lyric text.
- Browser requests must present a valid local session and same-origin request headers for account-changing actions
- Public source sharing on GitHub is acceptable only as a local-run project, not as a hosted service

## Do not do this

- Do not expose the app to a public network or a shared LAN without a separate security review
- Do not commit `.env`, `.data`, or any OAuth/session files
- Do not paste a Genius Client Access Token into the browser, chat, logs, or a source package. The optional lyrics feature does not authorize copying, scraping, or redistributing lyric text.
- Use **Delete recorded counts** in Settings while connected to the matching Spotify account before sharing the computer or project folder. This clears both the import and RCRD's recent-play ledger. Signing out and clearing browser data do not delete those server-side records.
- Do not share the working folder as a ZIP. Use the explicit `scripts/Build-RCRD-Share.ps1` package and review its contents before distribution.
- Do not log access tokens, refresh tokens, or callback query strings
- Do not assume a browser on another machine can safely share the same local state

## If someone wants to deploy it remotely

That should be treated as a separate deployment project with:

- explicit authorization controls
- restricted network exposure
- stronger TLS and reverse-proxy controls
- a new threat model and security review

This file does not replace a full deployment review for any non-local environment.
