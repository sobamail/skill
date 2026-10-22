---
name: sobamail-app
description: How to build, extend, debug and review Sobamail apps - Mutator.mjs backends running in the soba runtime, their sobamail.com/module/*/v1.mjs object modules, and Svelte UIs that talk msgpack to /api/v2/object. Use it whenever the work touches a Mutator.mjs, the soba global, object keys like {namespace}Name, structured messages, sha224 import pins, instance databases under apps/data or the _soba_mut1 mutation log, including adding a table, an event, a request/response pair or a settings card, or when someone asks how a Sobamail app works, even if they do not say "Sobamail".
---

# Sobamail apps

A Sobamail app lives inside a user's mailbox. Its state is a log of content-addressed
mutations replicated between the user's devices and the server, and its backend is a
plain ES module, `Mutator.mjs`, that the runtime instantiates for every incoming event.
The UI is ordinary HTML/JS (Svelte 5 in the reference apps) that sends one structured
object per request to the backend. Get three things right and most tasks fall into
place: the object key, the two registration maps, and which runtime calls are allowed
in a replicated handler.

## How a click flows through the system

There is no server to call. Every event is ultimately an email message, and a UI
click is a barebones one delivered locally:

1. The UI encodes a small object and POSTs it to `/api/v2/object`.
2. The runtime calls the Mutator's `process()`, the single entry point. The handler
   validates the object and appends a mutation, or not.
3. The mutation updates the local SQLite state and lands in the `_soba_mut1` log.
4. It replicates to the mailbox's other replicas, where the same Mutator version
   replays the same handler to reach the same state.

Step 4 is why replicated handlers must be deterministic, and why deployment hashes
every component: all replicas must provably run the exact same code.

## Reference material

For live examples read a published app: Contacts (https://github.com/sobamail/contacts,
the cleanest one), Calendar or the Mailbox Manager, all under
https://github.com/sobamail. The base module every app imports is `model/Base.mjs`
in https://github.com/sobamail/base. The Sobamail developer docs are the
authoritative API text. A profile directory (Linux:
`~/.local/share/Soba/<profile>/m-<id>/`) holds the instance databases, deployed
code and develroots. A running Sobamail Desktop serves DevTools on
`127.0.0.1:50134`: `scripts/devtools/` (see `references/devtools.md`) reads its live
UI, console and object API traffic, and drives real input when allowed. Anything
outside the working directory needs `/add-dir` first.

## The recipe for any backend change

1. **Find the module.** Types live in `sobamail.com/module/<path>/v1.mjs` (or any
   URL-shaped path the author controls), which exports `namespace` and the object
   classes. The Mutator imports them by URL with a `?sha224=` pin.
2. **Write the object class.** `static KEY = \`{${namespace}}${this.name}\``, a
   constructor that destructures one object with defaults, a `process()` that does the
   work, and for replicated events `asText(locale)` and `toString()`.
3. **Register it twice** in the Mutator: `static objects` (`[X.KEY, false]`, the
   runtime's subscription list) and `static handlers` (`[X.KEY, (c) => (new X(c)).process()]`).
   In a shared app with gated objects, add it to that gate set as well. Forgetting
   `objects` means the runtime never delivers the event; forgetting `handlers` means it
   arrives and is dropped or thrown on.
4. **If it stores data, declare the table** in the constructor with
   `soba.schema.table({name, insertEvent, deleteEvent: DeleteRow, columns, checks})`.
   Every table has exactly one insert event. Attributes go in `<entity>_attr` tables
   keyed with `lww` over `[entity, key]`. Bump the app's schema version static if it
   has one.
5. **If the UI needs it, add a request/response pair**: `XGet`/`XPut` with
   `soba.task.respond(new XGetResponse({...}))`. Only the request goes in `objects`
   and `handlers`: a response is never delivered to the app. Then a
   `fetch("/api/v2/object", ...)` in the Svelte component.
6. **Check the context rules** (next section) for every runtime call you used.
7. **Update the hashes.** Changing a module makes every `?sha224=` pin that names it
   stale, and keeping pins current is your job: recompute with
   `scripts/gen-hash.py`, leaf modules first. The full rule is under Hashes in
   `references/dev-and-deploy.md`.
8. **Format** the way the surrounding code is formatted; the reference apps use
   clang-format (100 columns, 4 spaces, `! x`, double quotes). For the UI run
   `pnpm run check` in `ui/`.

Details and copyable shapes for each step: `references/app-anatomy.md`.

## Replicated vs non-replicated: the rule that bites

An object is **replicated** when it is some table's `insertEvent` or it is `DeleteRow`.
Its handler becomes a mutation that every replica replays, so it must be deterministic.
While one runs, the runtime **throws** on anything non-deterministic:
`soba.db.exec`, `soba.app.account`, `soba.app.peers`, `soba.type.uuid.v4`,
`soba.mail.send`, `soba.data.findLast`, the clocks, `soba.platform.version`. Use only
`soba.data.insert/find/delete/update`, the content you were given, and pure code.
`soba.task.emit` and `soba.task.respond` are silently no-ops there.

Everything else (a `*Get`, `*Put`, `*Request`, a plain `Message`) is non-replicated:
it may query SQLite read-only, mint uuids, read the account, send mail, and then
**emit** replicated events to change state. Two identical mutations collapse into one
(content addressing), so a non-replicated handler that must produce a distinct
mutation every time mints a uuid and passes it along (`extra` on `update`, or a uuid
column on insert). Tasks are not deduplicated: two identical requests both run, and a
handler that mints a uuid makes two rows.

Throwing from `process()` asks the runtime to retry the event later. Return instead
when the object is unknown, malformed or unauthorized; otherwise it is retried forever.
Constructors that validate should throw a dedicated error class that `process()`
catches, logs and drops (section 4 of `references/app-anatomy.md`).

Full API with signatures and the [NR] markers: `references/runtime-api.md`.

## Never persist a boolean

A boolean must **never** reach the database. The runtime can't store one: it throws
`Boolean types are not supported` (followed by `Error converting to object`, `Unable
to parse msgpack data`, `Error 578 processing mpdata: Invalid msgpack`). Booleans are fine in code; every flag that is persisted is an integer, 1 or
0. That covers a column value in `soba.data.insert` (an insert event's fields, an
attr's `value`), a constructor default that can end up there (`allDay = false` →
`allDay = 0`), and the objects handed to `soba.task.respond`/`emit`. Have the UI send
1/0 in its requests as well. Convert at the boundary (`flag ? 1 : 0`).

Reading a flag back needs care too: every declared column has `text` affinity
(`references/mutlog.md`), so a stored 1/0 comes back from `soba.db.exec` as the string
"1"/"0", and `!! "0"` is `true`. Turn flags back into numbers (`Number(v) ? 1 : 0`)
where a request handler reads them, before they go out in a response.

## Mail-driven apps

Subscribe with `[Message.KEY, false]`. In `process()`, `Message.extractObject(message, meta)`
returns the SMC object for structured messages and tasks, or null. A plain email is a
`Message` instance with `from`, `to`, `subject`, `bodyText`, `bodyHtml` and the
header accessors in Base.mjs. Reply by building a `new Message()`, setting
`from = [{address: soba.app.account()}]`, and `soba.mail.send(reply)` from a
non-replicated handler. To attach a file, see `soba.mail` in
`references/runtime-api.md`: the attachment's bytes are not encoded for you.

In a shared instance, the sender is only what a verified signature names; the From
header is data. See section 11 of `references/app-anatomy.md`.

## UI and wire format

The UI never touches the database. It POSTs msgpack SMC `{namespace, name, content}`
to `/api/v2/object` and decodes the compact reply (integer keys: 0 namespace, 1 name,
2 error, 3 content). To follow changes it holds `new EventSource("/api/v2/event")`, a
server-sent stream naming each mutation of the instance by its object key, and rereads
what changed (`references/wire-and-ui.md`, Following changes). `ui/src/lib/Response.ts` is shared between the reference apps
(the copies differ; see `references/wire-and-ui.md`). Svelte 5 runes, Vite, TypeScript, pnpm; the dev loop is `pnpm run dev-watch`
building into `../assets`, then reload the app in Sobamail (there is no dev server).
Chrome 117 compatibility is required (CEF). `references/wire-and-ui.md` has the key
tables, the component pattern and the Vite devel config.

## Debugging with the mutation log

Every instance database (`apps/data/<2 chars>/<rest of instance id>/main.db`) holds
the app's tables plus the runtime's `_soba_mut1` log: one row per mutation with
op (`i`/`d`/`u`), target table, row pk, msgpack SMC payload, its sha512, the parent
hashes it depends on, and a DAG depth. `scripts/mutlog.py <profile-dir> --app <appid>`
resolves the instance via apps.db and prints the log decoded. Read-only; safe on a
live profile. `references/mutlog.md` explains every column and the bookkeeping tables
(`_lww`, `_delcache`, `_parent`), which is also the fastest way to see what a schema
declaration really did.

## Watching a running app over DevTools

Sobamail Desktop serves Chromium's DevTools on `127.0.0.1:50134`. The scripts in
`scripts/devtools/` read an app's page (screenshots, DOM rects and text, console,
the object API's traffic decoded from msgpack) and, when the user allows it, act on
it (`eval`, real mouse and keyboard `input`, `reload`). Learn the app's **instance id**
first, from `pages.mjs`, which reads it out of the page URL
(`soba://app/<appid>/<account>/<instid>`): every other script takes it, never a title.
Grant the read-only scripts in the project's settings and have the acting ones ask
each time. `references/devtools.md` has the scripts, the grants, and recipes such as
watching what a click sends or testing a drag.

## Dev loop and deployment

A new app starts in the Application Manager: "Instantiate In Dev Mode" writes the
skeleton `Mutator.mjs` into the develroot. Edit that file, never create a skeleton
yourself; rebuild the UI into `assets/`, reload. Changing `objects` needs "Reload Objects".
Deploy freezes the app into an `AppInfo` object; it fails on a stale import pin, a
version not greater than every deployed one, or an `id` mismatch. `references/dev-and-deploy.md` has the checklist and the
tutorial sequence; `references/platform-concepts.md` has the vocabulary (mailbox,
replica, instance, mode, mutation graph, system apps).
