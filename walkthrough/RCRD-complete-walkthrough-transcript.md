# RCRD complete walkthrough

Screen recording of the real RCRD interface using an isolated example account, synthetic music, and simulated provider responses. Provider authorization and software installation are explained using the guide; no real accounts or credentials are filmed.

## Official setup links

- [Node.js LTS](https://nodejs.org/en/download)
- [Google Chrome](https://www.google.com/chrome/)
- [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
- [Spotify app setup instructions](https://developer.spotify.com/documentation/web-api/concepts/apps)
- [Discogs Developer settings](https://www.discogs.com/settings/developers)
- [Spotify account privacy: request listening history](https://www.spotify.com/account/privacy/)

Default callback addresses: `http://127.0.0.1:3000/auth/spotify/callback` and `http://127.0.0.1:3000/auth/discogs/callback`. Follow README.md and the in-app guide for a different port. Keep `.env`, app secrets, and `.data` private.

## Chapters and narration

### 0:00 · Meet RCRD

Welcome to RCRD: a home to listen, discover, and collect what matters. It brings Spotify listening and Discogs record collecting together in one local app. You can play music, browse what you have saved, discover records, and keep track of the exact editions you own or want. This tour uses example music, not a real account.

### 0:22 · Before your first launch

First, install Google Chrome and a current long-term-support version of Node.js, at least version eighteen. RCRD runs on this computer, not on a public website. You will also need Spotify and Discogs accounts. Spotify Premium is needed for playback inside RCRD, though some browsing features work without it. The README in the project folder has the official download links before RCRD is opened.

### 0:48 · Create app credentials

Next, create a developer application with Spotify and one with Discogs. This sounds technical, but each site gives you keys that allow your copy of RCRD to request access. They are not your account passwords. Use the official links in the README or setup guide. Write down the Spotify Client ID and Client Secret, and the Discogs Consumer Key and Consumer Secret. Keep both secrets private.

### 1:13 · Match the callback addresses

Each developer app needs a callback address. Think of it as the return address that sends you back to RCRD after approval. Copy the exact Spotify and Discogs addresses from the setup guide, including the numbers and slashes. Then copy dot env dot example to a new file named dot env in the RCRD folder, and enter your four app keys there. Never post or send that file to anyone.

### 1:38 · Open and connect

Now double-click Launch RCRD dot cmd. RCRD opens in its own Chrome app window; it is not pinned to your taskbar unless you pin it yourself. At the bottom left, select the profile picture. Choose Connect Spotify and approve the request in your browser. Do the same for Discogs. Creating app keys was setup; these approval screens connect your personal accounts.

### 2:02 · Find your way around

The left side is your main menu. Listening is the home page. Saved music is your Spotify library. The Discogs choices show your collection, wantlist, and catalog search. Select the RCRD logo at the top left whenever you want a fresh home page. The profile picture at the bottom left opens account status, Settings, Help, Restart, and About.

### 2:25 · Discover from listening

On Listening, For your ears brings together albums from your recent listening and saved library. Select Long-term favorites for another view based on older favorites. The first time, Spotify may ask for an extra permission. You can refresh the suggestions and move through pages of results. Select an album cover to open the album and its tracks, or use Find this on Discogs to look for a physical edition.

### 2:50 · Browse saved music

Saved music shows songs and albums you saved to Spotify. Use the search box to find a title or artist. Switch between Grid and List to choose the layout you prefer. The list separates title, album, and play count. Change the sort order or the number of items per page to browse a larger library. The playlist menu on the left shows playlists you own or help manage; other followed playlists are unavailable here. To find music beyond your library, change Search scope to Entire Spotify catalog, then enter your search.

### 3:24 · Open an album

When you open an album, its tracks appear beside the artwork. Select Play next to the song you want to hear first. The heart beside a track adds it to Liked Songs, and a filled heart shows it is already saved. RCRD highlights the current track while it plays. Scroll within the track list to see the rest of the album. Use the collection badge or Discogs link to move from listening toward the record edition.

### 3:48 · Control playback

The player stays at the bottom. It has play and pause, previous and next, shuffle and repeat, song progress, volume, mute, and Liked Songs. Space plays or pauses when you are not typing. Control plus left or right changes tracks, and Control plus up or down changes volume. If Spotify says connected but music will not play, open Playback health. Account connection, RCRD player readiness, and active device are separate checks. You can retry the player or choose another available device there.

### 4:21 · Find a record edition

To look for a physical record, enter an artist or album in the home search panel, or open Explore catalog. Filters can narrow results by format, year, catalog number, barcode, and more. Look closely at edition details. Two records with the same album cover may be different pressings. A possible match to your shelf is a clue to check, not a confirmation.

### 4:43 · Compare and keep track

If an album has several editions, choose Explore editions. Select two or three and use Compare editions to see details side by side. Once you have identified the right release, add it to My collection if you own it, or Wantlist if you are looking for it. RCRD does not buy records for you. Shop on Discogs opens Discogs separately so you can review any sale listings there.

### 5:07 · Your shelves

My collection is the shelf you own. Wantlist is for records you hope to find. Both sections support sorting, page size, and a manual refresh. A record in My collection can also lead you back to a matching Spotify album inside RCRD. Remember that the Spotify album and the specific Discogs pressing are related, but not always identical.

### 5:30 · Optional play counts

Play counts are optional. Request your Extended Streaming History from Spotify's account privacy page. When the ZIP arrives, open Settings, find Your listening history, and choose Import Spotify ZIP. Select the downloaded file and confirm it belongs to the connected account. The list here shows example imported counts. You can search, sort, scroll, and change pages. RCRD keeps the counts locally; your original download stays where you saved it. It counts music played for at least thirty seconds, and adds newer listening reported from your Spotify devices. There may be gaps, so these are not official Spotify totals.

### 6:10 · Try a related-music mix

RCRD Mix is an optional way to find more music related to the song playing now. Select Mix in the player to see a preview of one hundred tracks. It draws on related artists and styles from MusicBrainz, ListenBrainz, and Discogs, so check the preview before starting it. Nothing changes in your player until you choose Start mix. If RCRD cannot find one hundred suitable tracks, it explains that instead of filling the list with unrelated songs. You do not need another listener account.

### 6:41 · Read along with lyrics

Lyrics are optional too. If you want them, create a Genius API client and put its Client Access Token in your private dot env file. The steps are in Settings under Optional features. After restarting RCRD, choose Lyrics in the player. RCRD looks for the current song and shows a Genius-hosted view when one is available. You can always open the song directly on Genius if the in-app view does not load. Genius may receive your IP address when you open the view; RCRD does not keep the lyric text.

### 7:14 · Settings and privacy

Settings groups optional features together, including the ambient visualizer, Lyrics, and your listening-history counts. You can also check connections, switch accounts, and restart after an update. Sign out of RCRD before another person connects. This does not sign you out of the Spotify or Discogs websites. Read the descriptions before deleting imported counts or clearing all local RCRD data. Your developer keys are a separate file. Keep your dot env file, dot data folder, and Chrome profile private.

### 7:48 · When something does not work

If RCRD will not open, check that Chrome and Node.js are installed. RCRD dot cmd can show server status. If an account will not connect, compare the callback address in your developer app with the one in your dot env file, character for character. If Spotify connects but playback fails, check Premium, player readiness, and the chosen device. Use the in-app Help and setup guide for more detail. The README and Admin Guide are also in the project folder.

### 8:19 · Ready to explore

That is the full journey: set up your copy, connect your accounts, listen, discover, and choose the edition that belongs on your shelf. RCRD is an independent personal, non-commercial project. It uses third-party music services, but is not affiliated with Spotify, Discogs, or Genius. Start with Listening, and return to the guide or this video whenever you need a reminder.
