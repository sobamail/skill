# Observing and driving a running app over DevTools

Sobamail Desktop (5.x, Chromium 117 through CEF) serves Chromium's DevTools on
`127.0.0.1:50134`. `scripts/devtools/` holds small Node scripts (Node >= 22: `fetch` and
`WebSocket` are built in; no packages) that read an app's page, watch its console and
its `/api/v2/object` traffic, and, when allowed, act on it. Together with
`scripts/mutlog.py` they cover both ends of an app.

## First: the instance id

Every script but `pages.mjs` takes the app's **instance id**: 26 base32hex digits (a
system app's is longer: the App Store's `5K2OAGTONP2DNBDI133IMSSJ2OZ1` has 28), the
last segment of the page's URL, `soba://app/<appid>/<account>/<instid>`. Learn it
before anything else, from `pages.mjs`, which reads it out of each page's URL. Never go
by a page's title: two accounts' windows of one app share it.
DevTools' own page and browser ids change whenever Sobamail restarts; the instance id
doesn't, and it ties everything together: the instance's database is
`apps/data/<first 2>/<other 24>/main.db`, and `mutlog.py <profile> --instance
<instid>` reads its mutation log.

## The scripts

Run them from the project root, exactly as `node
.claude/skills/sobamail-app/scripts/devtools/<script>.mjs …`, one command per call (no
`;`, `&&` or `VAR=` prefix), so the permission rules below match. `--port N` (or
`SOBA_DEVTOOLS_PORT`) picks another port; the host is always 127.0.0.1.

| script | does | tier |
|---|---|---|
| `pages.mjs` | the Sobamail version, and the open pages by instance id, app id and account | read |
| `shot.mjs <instid> [out.png] [--selector css] [--scale 1-4]` | a PNG of the page or of one element, zoomed; read it back to look | read |
| `query.mjs <instid> <css> [--limit N]` | per element: tag, text, rect `[x, y, w, h]`, class, role, aria-label, disabled, cursor | read |
| `console.mjs <instid> [--seconds N]` | console messages, uncaught exceptions, browser log entries (failed loads, fonts, CSP) | read |
| `network.mjs <instid> [--seconds N] [--api] [--full]` | every request with status and size; `/api/v2/object` requests and replies decoded from msgpack to their SMC object | read |
| `eval.mjs <instid> '<expression>'` | a JS expression's value, promises awaited | acts |
| `input.mjs <instid> '<steps>'` | real mouse, wheel and keyboard input: click, drag, down/move/up, wheel, type, key, wait, shot | acts |
| `reload.mjs <instid>` | reload bypassing the cache, wait for load, list the scripts loaded | acts |

The read tier can't change anything: the scripts run fixed code in the page (a
selector goes in as a JSON string, never as code), talk to 127.0.0.1 only, and write
nothing but a `.png`. The acting tier can: `eval` runs as the app and can call the
object API, `input` clicks what a user could (create, move, delete, send), `reload`
throws away whatever the user had open.

## Grants

In the project's `.claude/settings.json`, let the read tier run unasked and make the
acting tier ask every time (under `dontAsk` mode an `ask` rule means denied: the user
runs or grants those case by case):

```json
"allow": [
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/pages.mjs *)",
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/shot.mjs *)",
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/query.mjs *)",
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/console.mjs *)",
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/network.mjs *)"
],
"ask": [
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/eval.mjs *)",
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/input.mjs *)",
  "Bash(node .claude/skills/sobamail-app/scripts/devtools/reload.mjs *)"
]
```

Before acting on a page, say what the action will do to the user's data; drive tests
with throwaway records that mail no one, and delete them afterwards.

## Recipes

- **See a UI change.** `pnpm run dev-watch` rebuilds `assets/`; `reload.mjs` (asks)
  loads the new build and lists its script, so a stale page shows; then `shot.mjs`.
- **Watch what a click sends.** Start `network.mjs <instid> --api --seconds 20` in the
  background, act (the user, or `input.mjs`), read its output: each request's SMC
  object and the reply's (an error under key 2). Same for `console.mjs`, which only
  sees what happens after it attached.
- **Find where to click.** `query.mjs` gives rects in viewport CSS px, the coordinates
  `input.mjs` takes (the device scale factor is 1 here).
- **Drag.** One `input.mjs` call per press and release (`drag`, or `down`/`move`…/`up`
  with a `shot` in between to see the preview). Between calls the user's real mouse
  can move over the window, and the page gets those moves, button up, mid-drag.
- **Check a glyph or an alignment.** `shot.mjs <instid> x.png --selector '<css>'
  --scale 3`.
- **Confirm on the backend.** After an action, `mutlog.py <profile> --instance <instid>
  --tail` shows the mutations it wrote.

## Observed

- `Input.dispatchMouseEvent` reaches the page as pointer, mouse and click events, like
  a hand; `Input.insertText` fires `input` events, so Svelte's `bind:value` updates.
- Several DevTools clients can attach to one page at once (`network.mjs` kept
  receiving while `reload.mjs` reloaded).
- `soba://` requests show in the Network domain like any other: the page, CSS, JS,
  icons, fonts, and the object API as `Fetch` POSTs whose bodies are readable
  (`postDataEntries`, `Network.getResponseBody`).
