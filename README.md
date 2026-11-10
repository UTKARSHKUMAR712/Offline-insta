# SuperInsta — offline reels

An Expo app that turns Instagram reels into an offline, TikTok-style library on your phone.
Browse Instagram in an embedded browser, and reels you open are downloaded to app storage, in
order, one at a time.

> Downloading someone else's video may violate Instagram's terms of service and the creator's
> rights. Use it for your own content, or content you have permission to keep. See
> [Legal & store risk](#legal--store-risk).

## Stack

| | |
|---|---|
| Framework | Expo SDK 58, React Native 0.88, React 19.3 |
| Routing | expo-router (typed routes), real bottom tabs |
| Media | expo-video (playback), expo-media-library (gallery export) |
| Storage | AsyncStorage catalog + `expo-file-system` files in the app document directory |
| Language | TypeScript 6, strict mode |
| Tests | Jest (`jest-expo`) — 37 unit tests over the pure pieces |

## Getting started

```bash
npm ci
npm start          # then scan the QR with Expo Go (SDK 58+), same Wi-Fi
```

Scripts:

| Command | What it does |
|---|---|
| `npm start` | Metro dev server |
| `npm run android` / `npm run ios` | Native build (needs a development build, not Expo Go) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npm test` | Jest unit tests |

### Pointing the app at a different extractor

The extractor is a separate deployment. Point the app at another one with an
`EXPO_PUBLIC_` variable (inlined at build time, also usable on EAS):

```bash
EXPO_PUBLIC_API_URL=https://my-extractor.example/api/extract npm start
```

The built-in default lives in `app.json` as `extra.apiUrl`.

`services/ConfigManager.ts` resolves the endpoint as: saved/remote override →
`EXPO_PUBLIC_API_URL` → `extra.apiUrl` → built-in default. Each candidate is health-probed (4 s) and a 404/5xx
or an unreachable host falls through to the next one, so one dead deployment does not brick
downloads.

## Architecture

```
app/
  _layout.tsx           root stack: (tabs), insta, url-downloader + global download tray
  (tabs)/_layout.tsx    bottom tabs: Home · Offline · Saved · Settings
  (tabs)/index.tsx      launchpad: browse, paste link, library stats, latest downloads
  (tabs)/explore.tsx    full-screen offline feed: search, sort, share, gallery, delete
  (tabs)/saved.tsx      saved-only feed (never auto-deleted)
  (tabs)/settings.tsx   auto-delete / pause / auto-scroll switches, storage usage
  insta.tsx             Instagram WebView, URL detection, clipboard bridge
  url-downloader.tsx    paste a link, preview, download

services/
  api.ts                URL parsing + extractor client (timeout, retries, typed errors)
  catalog.ts            AsyncStorage reel repository (dedupe, metadata migration, stats)
  queue.ts              generic serial queue (one download at a time, droppable on pause)
  events.ts             typed emitter consumed by the tray and the feeds
  autoScroll.ts         auto-scroll setting + injected feed-advance script
  download.ts           orchestration; the single public entry point for screens
  ConfigManager.ts      endpoint resolution + health probe + remote config
  types.ts              ReelData and event payload types

components/DownloadTray.tsx   per-item progress + success/failure toasts
utils/format.ts               byte and date formatting
docs/ANALYSIS.md              the audit and P0/P1/P2 plan this code follows
```

### Download flow

```
WebView navigation ──► parseInstagramUrl()  (canonical /reel/<shortcode> only)
        │
        ▼
DownloadService.downloadReel(url, { source })   ← deduped per shortcode
        │
        ├─ paused? (automatic jobs only) → resolve null
        ├─ already in catalog?           → resolve existing entry
        ▼
SerialQueue ──► extractVideoUrl() ──► createDownloadResumable() ──► documentDirectory/reel_<id>.mp4
        │                                        │
        │                                        └─ progress events → DownloadTray
        ▼
Catalog.upsert() → success event / error event → toast
```

Failed or aborted downloads delete their partial file; every reel stores its author (when the
URL carries one), byte size and media type, and older entries are migrated on first read.

### Auto-scroll

Settings → *Auto-Scroll Reels* advances the Instagram feed at a random 7–20 seconds per reel, so
a browsing session downloads reel after reel without touching the screen. The page script finds
the reel that is fully inside the viewport by geometry and calls `scrollIntoView()` on the next
`<video>` (the approach proven by
[Auto-Reels-Scroller](https://github.com/Tyson3101/Auto-Reels-Scroller)); when only one reel is
mounted it scrolls the nearest scrollable container by one viewport instead.

Each step also reports the on-screen reel's permalink read from the DOM, and the app downloads
from that link. Waiting for Instagram's address bar to change does not work here: a programmatic
scroll moves the feed without reliably updating the URL, so the feed advanced while nothing was
saved. React Native owns the clock, so a step is skipped while a download is in flight, an open
comments panel pauses it, and four steps that do not reach a new reel stop it for the session.

## Extractor API contract

The app expects one JSON endpoint. Values in the table are what the current deployment does
(verified live on 10 Nov 2026).

**Request**

```
GET {apiUrl}?postUrl=<encoded instagram reel/post url>
Accept: application/json
```

**Success**

```json
{ "data": { "videoUrl": "https://…/video.mp4" }, "meta": { "cached": true } }
```

**Failure**

```json
{ "success": false, "error": { "code": "INVALID_URL", "message": "…" } }
```

| Status | `error.code` | Client behaviour |
|---|---|---|
| 400 | `INVALID_URL`, `UNSUPPORTED_URL` | Not retried, clear user message |
| 404 | any | Not retried ("private, deleted, or unavailable") |
| 429 | any | Retried with backoff |
| 5xx | `EXTRACTION_FAILED` | Not retried — content problem, not a server hiccup |
| 5xx | other | Retried with backoff |
| 200 | body without `data.videoUrl` | Treated as a bad response, retried |

Client-side: 15 s timeout, 3 attempts, 0.5 s exponential backoff, `AbortController` throughout.
CDN URLs are signed and expire, so they are never persisted — only the downloaded file is.

**Known gaps (server side, not in this repo):** the endpoint is unversioned (`/api/extract`, no
`/v1`), `500 EXTRACTION_FAILED` really means 404/422, responses carry no caption/thumbnail/
duration, and there are no rate-limit headers.

## Testing

```bash
npm test
```

Covers URL parsing (including the `/reels/`, `/reels/audio/…`, profile and non-Instagram cases
that must be rejected), API error → message mapping, catalog dedupe/migration/stats and the
serial queue's ordering, failure isolation and pause-dropping. There is no device or UI test
suite; the video feeds, WebView bridge and download tray are exercised manually on a phone.

CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, lint and tests on every push to
`main` and every pull request.

## Release

1. `npm run typecheck && npm run lint && npm test`
2. Bump `version` in `app.json`.
3. `npx eas build --platform android --profile production` (EAS project
   `e32984b9-bfb1-48cb-9988-6dd4eab7a541`, owner `utkarsh712`).
4. `npx eas submit --platform android`.

A development build is required for anything that needs a native module not in Expo Go
(cookie clearing, custom native code).

## Legal & store risk

- The app downloads Instagram media. That can breach Instagram's Terms of Use and infringe
  creators' copyright. Keep the in-app disclaimer, do not advertise it as a way to save other
  people's content, and be prepared to remove content on request (DMCA / takedown contact in
  the store listing).
- Instagram branding is used only to describe the source. Do not use their logo in the store
  icon or screenshots — App Store guideline 5.2.1 and Play's impersonation policy both bite.
- Google Play requires a Data safety declaration covering the reel files and any analytics;
  the app currently stores files locally and sends only URLs to the extractor.
- Consider a "report/remove" path and a short privacy policy before shipping publicly.
