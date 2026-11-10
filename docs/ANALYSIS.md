# Offline-insta — audit report & priority plan

Reference document for this project. **Priority numbers below are canonical**: when the
user says "P0", "P1" or "P2", they mean exactly the items numbered in section 4.

- Audit date: 10 Nov 2026
- Audited revision: Expo SDK 54 / RN 0.81.5 (project has since been upgraded to SDK 58 / RN 0.88.1)
- Method: every source file read statically; API tested live with 20+ real requests
- At audit time no files were changed.

Status note: the P0 batch has since been implemented (API client with timeout/retries/typed
errors, URL encoding, canonical path detection, ConfigManager race, partial-file cleanup,
auto-delete via ref, manual vs automatic pause). Item 7's "separate flags" and item 6's
"per-feed persisted index" were partly covered there; re-check before redoing them.

P1 (items 8–12) has also been implemented: real bottom tabs with safe-area insets and a
light/dark palette, a dismissible download tray with per-item progress + toasts, media
metadata (`author`, `sizeBytes`, `mediaType`) with a migration for old entries, real
`MediaLibrary` gallery saving, and feed search / sort / storage indicator / share actions.
Caption and thumbnail remain unset until the extractor returns them.

SDK 58 note: `saveToLibraryAsync` now throws at runtime — use `MediaLibrary.Asset.create(uri)`
after `requestPermissionsAsync()`.

---

## 1. What the project actually is

| | |
|---|---|
| Stack | Expo SDK 54 / RN 0.81.5 / React 19.1, expo-router v6 (typed routes), New Architecture on, React Compiler on |
| Package name | `super-insta` (npm) vs app name `SuperInsta`, slug `SuperInsta`, owner `utkarsh712` |
| Screens | `index` (button menu), `insta` (WebView browser + auto-download), `url-downloader`, `explore` (offline reels feed), `saved`, `settings` |
| Core logic | `services/download.ts` (251 lines: serial download queue + AsyncStorage catalog + event emitter), `services/ConfigManager.ts` (remote-controlled API URL) |
| Backend | `https://api-insta-tawny.vercel.app/api/extract` (not in this repo), remote config at `https://apiinsta.pages.dev/app-config` |
| Tests / CI | none (no test files, no workflow, no lint/typecheck script beyond `expo lint`) |
| node_modules | absent — `npx tsc` could not run, so no compile/lint verification was possible |

**Data flow:** Instagram WebView → URL detection/clipboard bridge → `DownloadService.downloadReel()`
→ serial queue → `GET /api/extract` → CDN `.mp4` → `documentDirectory/reel_<id>.mp4` →
AsyncStorage JSON list → explore/saved feeds.

---

## 2. API test results (live, 10 Nov 2026)

**Verdict: the API itself is healthy and fast.** Every real reel returned a playable CDN URL.

| Case | Result |
|---|---|
| `?postUrl=…/reel/DU1KGbmElgC/` | 200, `data.videoUrl`, 0.25–1.3 s |
| 4 more real shortcodes | 200 each (2.0 s, 1.9 s, 0.98 s, 0.32 s) |
| `?url=` (the param `url-downloader.tsx` uses) | 200 ✅ both param names work today |
| POST JSON body | 200 |
| profile-prefixed `/<user>/reel/<id>/` | 200 |
| no trailing slash / `?igsh=…` / `/p/` / `/share/reel/` | 200 |
| no-www `instagram.com`, uppercase host | 200 |
| `instagr.am` short link | 400 `UNSUPPORTED_URL` |
| stories URL | 400 "Could not find a valid reel or post shortcode" |
| bare shortcode `?postUrl=ABC123` | 400 `INVALID_URL` |
| `example.com` | 400 `UNSUPPORTED_URL` |
| fake shortcode / deleted-reel style | 500 `EXTRACTION_FAILED` |
| no param | 400 `INVALID_URL` "URL parameter is required" |
| `/api` root | 200 `{"message":"Hello api!"}` |
| 8 concurrent requests | all 200 (0.25–0.48 s) — no rate-limit headers, no failures |
| returned CDN URL | 206 Partial Content, `video/mp4`, `Accept-Ranges: bytes`, `Content-Length: 2 716 359` → resumable download works |
| repeat call | `meta.cached: true` (server-side cache), but `X-Vercel-Cache: MISS`, `Cache-Control: max-age=0` |
| OPTIONS/CORS | `Allow-Origin: *` together with `Allow-Credentials: true` → invalid CORS combo, harmless for native, broken for web |

### API-level problems worth fixing (server side)

- **500 for "this reel isn't extractable"** — semantically a 404/422. The client treats it as a
  server crash and cannot distinguish private/deleted reel from API broken. Single biggest
  contract flaw.
- **Two response envelopes**: success `{data:{videoUrl}, meta:{…}}`, failure
  `{success:false, error:{code,message}}`. The app never reads `error.code`.
- **Response carries only `videoUrl`** — no thumbnail, caption, author, duration, shortcode,
  mediaType. That's why the UI can only show "Downloaded: <date>".
- **No Cache-Control/rate-limit headers, no auth, no versioning** (`/api/extract` unversioned),
  no documented contract. A silent server change breaks the app.
- **CDN URLs are signed and expire** (`oe=…`), so they must never be persisted — the app
  correctly doesn't. Worth keeping documented.
- **Single-endpoint SPOF**: the whole app depends on one personal Vercel deployment with no
  fallback and no health check.

### App-side API bugs found

- `download.ts` calls `${apiUrl}?postUrl=${postUrl}` without `encodeURIComponent` — a copied
  link containing `&utm_source=…` gets truncated at the `&`. `url-downloader.tsx` does it
  correctly, so the two paths disagree.
- `url-downloader.tsx` uses `?url=`, `download.ts` uses `?postUrl=`. Both work today by luck,
  not by contract.
- `fetchVideoInfo` has no timeout / AbortController — a hanging socket stalls the whole serial
  queue forever (`isProcessing` never resets). `ConfigManager` does have a 5 s timeout; the
  extraction call doesn't.
- No retry/backoff; a transient 500 just logs `❌ No video URL from API` and drops the reel.

---

## 3. App findings, by severity

### 🔴 High — real bugs / crash-level

1. **`explore.tsx` auto-delete can silently stop working.** `onViewableItemsChanged` is a
   `useCallback` with `[autoDelete]`, but RN's ViewabilityHelper captures the callback at
   mount. Toggling the setting mid-session doesn't reliably re-bind (and mutating viewability
   props on the fly is explicitly unsupported). Auto-delete should read a ref, not a dependency.
2. **Saved scroll position is stored stale and globally.** `useFocusEffect(…, [])` closes over
   `activeVideoIndex = 0` forever, so the cleanup writes 0 on leave. The key
   `@last_viewed_reel_index` is shared across feeds and independent of list contents — restore
   lands on a wrong/blank position after deletions.
3. **Auto-delete deletes the file of an item still mounted in the list.** `deleteReel` unlinks
   the `.mp4` immediately while the FlatList keeps the item (by design, to avoid scroll jumps)
   → `VideoView` points at a missing file (black frame / native error) until reload.
4. **"Pause Automatic Downloads" also blocks manual downloads.** The check lives in
   `downloadReel()`, so the URL downloader and the paste-modal silently no-op with only a green
   log line.
5. **Failed/aborted downloads leave partial `.mp4` files** in `documentDirectory` forever, with
   no catalog entry to delete them — invisible storage leak.
6. **`insta.tsx` fires on the initial page.** The URL check `includes('/reels/')` matches the
   WebView's start URL `instagram.com/reels/` → `Cannot extract ID from:` on every load, plus a
   duplicate download attempt for every `/p/` photo post (no video). Also matches
   `/reels/audio/<id>` and would use audio as the ID.
7. **Masked logout.** Logging out via a 0-height WebView loading `/accounts/logout/` (which
   normally needs POST + CSRF) will not clear cookies; the app alerts "Logged Out" even in
   `onError`. There is no real cookie/session clear.
8. **ConfigManager init race.** `isInitialized = true` is set before the `await` on
   AsyncStorage, so a second concurrent caller gets `DEFAULT_API_URL` immediately. The
   remote-config fetch is fire-and-forget and never applied to the request already in flight.

### 🟠 Medium — correctness, resilience, UX

- `downloadReel()` returns after enqueueing, not after downloading. Both screens await it and
  immediately show "Saving to Device…"/reset `isDownloading` → the button lies. Failures are
  invisible (only `processOne`'s log).
- No error taxonomy in UI: private/deleted/rate-limited/offline all render as
  `API error: HTTP 500` or nothing.
- Progress overlay emits `setState` on every downloader callback (same percentage repeatedly)
  and is mounted on two screens at once. No throttle to integer-percent changes.
- `DownloadProgressOverlay` is a permanent, always-visible debug log ("Ready to download",
  green monospace error strings) in a shipped UI; logs never clear.
- Progress overlay `bottom: 100` assumes a tab bar that doesn't exist —
  `app/(tabs)/_layout.tsx` uses a `Stack`, not `Tabs`, so `(tabs)` is a misleading folder name
  and all navigation is manual `router.push`.
- No `onScrollToIndexFailed` on any FlatList → `scrollToIndex` to a stale index can blank the feed.
- `expo-media-library` is installed and configured with broad permissions but never imported —
  "Gallery" actually opens the share sheet (`Sharing.shareAsync`). So: should be
  `MediaLibrary.saveToLibraryAsync`, or drop the dependency and the `READ_MEDIA_*` /
  `ACCESS_MEDIA_LOCATION` permissions that will slow Play Store review.
- `app.json` asks for `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_AUDIO`, and lists several
  permissions twice — all unneeded for this feature set.
- Safe-area/status-bar: `edgeToEdgeEnabled: true` + hardcoded `paddingTop: 50`, RN's deprecated
  `SafeAreaView`, no `SafeAreaProvider`, `StatusBar style="auto"` over hardcoded `#111` screens
  → invisible status-bar icons in light mode, WebView under the notch.
- Clipboard injection is `injectedJavaScript` only (fires once) — Instagram's SPA navigations
  can restore the original `navigator.clipboard.writeText`, breaking "Copy Link" again. Also no
  `sharedCookiesEnabled`/`thirdPartyCookiesEnabled` for Android login persistence.
- Splash colours contradict each other: `app.json` `splash.backgroundColor: #100000` vs plugin
  `#ffffff`/dark `#000000`.
- `adaptiveIcon.monochromeImage` points at a full-colour icon (should be a monochrome
  silhouette); `backgroundImage` reuses the icon.

### 🟡 Low — hygiene, repo quality

- Dead template code: `hello-wave`, `parallax-scroll-view`, `collapsible`, `external-link`,
  `haptic-tab`, `icon-symbol*`, `themed-text/view`, `use-theme-color`, `constants/theme`,
  `app/modal.tsx`.
- Unused deps: `expo-font`, `expo-constants`, `expo-linking`, `expo-system-ui`, `expo-image`,
  `expo-media-library`, `expo-haptics`, `expo-web-browser`, `expo-symbols`.
- `services/download.ts` uses `Function` as a listener type and `any` liberally under
  `strict: true`; no shared `types.ts`.
- Placeholder copy on Home ("made by Utkarsh Kumar / For / Utkarsh Kumar").
- `README.md` is still the create-expo-app boilerplate with a UTF-16 "Offline-insta" line
  appended — no architecture, no API contract, no setup beyond `npm install`.
- Lowercase-slug rule: `"slug": "SuperInsta"` — Expo slugs should be lowercase; also
  `web.output: "static"` while the app depends on WebView and expo-video (web build will be
  broken/pointless).
- No accessibility labels on icon-only buttons (back, floating download), no
  `accessibilityRole`.
- `originalUrl` is stored on every reel and never used — free upgrade: "Open original",
  "Copy link", "Share link".
- No tests anywhere; no typecheck script; nothing runs in CI.
- Legal/Store risk: downloading Instagram media, Instagram branding in a paid-app-store
  context (App Store 5.2.1 / Play policy), no disclaimer, no DMCA/takedown stance.

---

## 4. Upgrade plan

### P0 — fix what is broken (small, high value)

1. `encodeURIComponent` every URL sent to the API; standardise on one param name (`postUrl`) in
   a single `services/api.ts` with timeout + 2 retries with backoff and typed error codes
   (`INVALID_URL | PRIVATE | NOT_FOUND | RATE_LIMITED | NETWORK | SERVER`).
2. Make `downloadReel()` return a real Promise (resolve per-job) or add
   `DownloadEvents.on('jobDone')` so buttons/screens reflect true state; surface failures as a
   toast + actionable message.
3. Detect only canonical post paths
   (`/^\/(?:[^/]+\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]{5,})/`), ignore `/reels/`,
   `/reels/audio/*`, `/explore/*`, `/p/` non-video posts.
4. Fix `ConfigManager` race (single shared promise, await before setting the flag) and only
   apply remote config to new requests.
5. Clean up partial files on failure/cancel; add `deleteAllDownloads()` for the settings screen.
6. Auto-delete via ref; reset `hasInitializedScroll`; per-feed persisted index; delete only
   items that are unmounted (windowSize/index distance check).
7. Separate "pause automatic" from "manual download" (two flags), and actually stop the queue
   when pausing.

### P1 — make it feel like a product  ← **"P1" means items 8–12**

8. Real bottom tabs (`Tabs` layout) instead of a 5-button menu; safe-area insets everywhere;
   correct light/dark tokens instead of hardcoded `#111`.
9. Replace the debug overlay with a dismissible download tray + per-item progress +
   success/failure toasts; throttle events to percent change.
10. Store and show media metadata (caption, author, thumbnail, duration) — requires the API to
    return them (small server change) and `ReelData` to gain fields with a migration for
    existing entries.
11. Real "Save to Gallery" via `MediaLibrary.saveToLibraryAsync` + runtime permission request;
    drop the extra manifest permissions either way.
12. Extend the feed: search by author/caption, sort by date/size, storage-usage indicator,
    "open original", share/copy link.

### P2 — robustness & engineering

13. `services/` split: `api.ts`, `catalog.ts` (repository over AsyncStorage, or SQLite for large
    libraries), `queue.ts`, `events.ts`; add unit tests (Jest + `@testing-library/react-native`)
    for ID extraction, queue serialisation, catalog dedupe, and API error mapping — those are
    pure functions and cheap to test.
14. Add typecheck + lint scripts, a GitHub Actions job, and remove dead template files/deps.
15. Real config: `app.config.ts` reading `EXPO_PUBLIC_API_URL`, endpoint fallback list + health
    probe, signed/versioned API (`/v1/extract`), and a proper 4xx error contract.
16. Proper Instagram session clear (cookie store / `@react-native-cookies/cookies` or WebView
    data clear), or remove the logout feature.
17. Write the README the project deserves (architecture diagram, API contract, build/release
    steps) and add a legal disclaimer + a plan for store policy risk.

---

## 5. Verification notes / limitations (as of the audit)

- **API**: 20+ live requests, including concurrency and byte-range checks — results above. No
  real device/APK test was possible.
- **App code** was reviewed statically; `tsc`, `eslint`, and Metro were not run because
  `node_modules` was missing, so the project was not known to compile cleanly — no type errors
  were found by inspection, but that is not a substitute.
- Nothing was edited, installed, or committed at audit time.
