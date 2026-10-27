# Wire format (SMC) and the Svelte UI

## Structured Message Content

Pretty form (JSON, what you write in a UI and what `soba.task.respond` sends):

```json
{"namespace": "https://sobamail.com/module/contacts/v1", "name": "GetPerson", "content": {"uuid": "{...}"}}
```

Compact form (msgpack, what goes over `/api/v2/object` and into the mutation log):
string keys replaced by integers.

| int | string | meaning |
|---|---|---|
| 0 | namespace | module namespace URI |
| 1 | name | class name |
| 2 | error | set on failures |
| 3 | content | the object's fields |
| 4 | contentAux | auxiliary payload |
| 5 | contentParent | parent payload |
| 6 | wellKnownObject | runtime-emitted only: 1 = `{base/v1}DeleteRow`, 2 = `{base/v1}UpdateRow` |
| 7 | instanceId | app instance id |
| 8 | version | app version |
| 9 | digest | mutation digest |
| 10 | digestAlgo | |
| 11 | digestParent | |
| 12 | mutationId | int64 |
| 13 | mailbox | mailbox uuid |
| 14 | digestMutator | |
| 64 | format | Envelope: format |
| 65 | contentBytes | Envelope: raw content bytes |
| 66 | signature | Envelope: signature |
| 67 | sender | Envelope: signer address |

A DeleteRow mutation on the wire is just `{6: 1, 3: []}`. Object key =
`{namespace}name`. Inside an email, the `Message-Structure` or
`X-Message-Structure` header names the content-id of the attachment holding the SMC
(XML, JSON or msgpack). Signed or encrypted objects are wrapped in a
`{base/v1}Envelope` whose `content` is the real object; the runtime verifies the
signature against From before the app runs, so `envelope.sender` is trustworthy only
when `envelope.signature` is non-empty.

## The one endpoint

```
POST /api/v2/object
Content-Type: application/msgpack       (application/json also works)
body: msgpack(SMC)
```

Response: msgpack SMC in compact form, produced by whatever the backend passed to
`soba.task.respond`. Check `response.ok`; an empty body (`byteLength == 0`) means
nothing was responded. Content is under key `3`.

## Following changes: `GET /api/v2/event`

A page learns of its instance's mutations from a server-sent events stream and rereads
what changed through its own requests. The published reference is amp-mgui
`doc/pub/ref/app-events.md`; what follows was verified live on Sobamail 5.4.0.17052 with
amp-cef `f494769` (2026-10-22), the `replica` key on a later build of the same version.
Runtimes without that commit announce no mutation of a JS app at all (`main-debug.log`:
`Error 0x1005 deserializing mut=N` per mutation), and 5.4.0.17049 crashed on a JS app's
DeleteRow.

```ts
const events = new EventSource("/api/v2/event");
events.addEventListener("{https://sobamail.com/module/forms/v1}SetProjectState", (ev) => {
    // ev.lastEventId: the mutation id
    const {db, replica} = JSON.parse(ev.data);
    if (replica !== ownReplica) { // soba.app.replicaUuid(), asked of the backend
        rereadProjects();
    }
});
```

- The response is `200`, `text/event-stream`, `Cache-Control: no-cache`, and never ends.
  It opens with `: ok` and `retry: 2000`, then one event per mutation written to the
  instance, whoever wrote it (this page, another page, replication), in id order:

  ```
  event: {https://sobamail.com/module/forms/v1}AddSchemaNode
  id: 14
  data: {"db":"main","replica":"{b55b95e9-08fc-4df5-95b6-6a1e6eda2bfa}"}
  ```

  `event` is the mutation's object key, `id` its mutation id (`<db>:<id>` for a db other
  than `main`), `data` a one-line JSON object: `db`, the db it went to, and `replica`, the
  braced uuid of the replica that wrote it. No content, no table, no row: reread through
  your GetAll.
- `replica` is what `soba.app.replicaUuid()` [NR] answers on the replica that wrote the
  mutation, whichever of its pages made the request; a peer's mutation carries the peer's.
  A page gets its own from a request of its backend (formbuilder: `UserInfoGet`'s
  `replica`). Verified: two `NamespaceStatePut` from the page were announced under the
  uuid `UserInfoGet` answered. A store with no replica uuid answers the nil uuid,
  unbraced (`00000000-0000-0000-0000-000000000000`), which matches no event: production
  assigns it in `ReplicatorStore::post_init_hook` (librepl), and a test setup must call
  `ArskomStore::set_replica_uuid` before it instantiates any v8 job.
- `EventSource` dispatches each event under its key, so a listener per key you follow;
  `onmessage` never fires. A batch (one request's mutations) comes as consecutive events
  in one chunk, delivered to the listeners in the same millisecond, a few ms after the
  request's own response.
- A deletion is announced as `{https://sobamail.com/module/base/v1}DeleteRow` whatever
  table it left; the event does not say which. An lww replacement writes a DeleteRow and
  then the new insert, whose key names the table; a DeleteRow that comes alone is a
  `soba.data.delete()`. Map DeleteRow to what your backend deletes.
- Only mutations ride it: a request that writes nothing leaves no event. An insert event
  is announced under the namespace its class declares, which need not be the app's main
  one (formbuilder's `form` table: `{https://sobamail.com/module/forms/fill/v1}AddForm`).
- The browser reconnects by itself and sends `Last-Event-ID`; the stream then opens with
  every applied mutation since that id, in order, before anything new.
  `Last-Event-ID: 0` replays the whole log. A malformed id answers `400`, an id naming a
  db the instance lacks opens an empty stream, `POST` answers `405`, and a page gets its
  own instance's stream only (another instance's URL: `403`). Delivery is at least once:
  an event means "reread", never count them.
- `main-debug.log` logs each open as `Event stream open for <account>, N streams`.

The pattern formbuilder uses (`ui/src/api/sync.ts`, `MutationFollower`):

- A map from the keys the page follows to the list each one rereads; the events that
  arrive together reread each list once (a `setTimeout(0)` after the first), and a list
  is never reread twice at once, so an older answer cannot land after a newer one.
- Open the stream *before* the start-up reads and hold the rereads until they are done:
  a write that lands while they run is announced and reread after them. Close it in
  `onDestroy`. Mock mode (no runtime) opens none.
- An event its own replica wrote rereads nothing when the page shows what its requests
  wrote without a reread (formbuilder's Puts update the page in place, the schema tab
  refetches after its save). Keys a mail handler writes too (formbuilder's
  `AddFilledDocument`, `SetFormSend`) are reread whoever wrote them: the mail may be
  processed on this replica. Until the page knows its replica, and for data naming none,
  every event rereads; compare uuids unbraced and lowercase. The cost: a second page of
  the instance on the same replica sees the first one's writes only at its next reread.
- jsdom has no `EventSource`: tests stub one (`vi.stubGlobal("EventSource", ...)`,
  formbuilder's `ui/src/api/__mocks__/eventsource.ts`) and play the runtime with
  `emit(objkey, mutid, replica?, db?)`, another replica's by default, or `emitData` for
  raw data.
- A smaller example is the Calendar app's `ui/src/lib/store.svelte.ts` (`listen()`,
  `markStale()`): the event tables' keys reread the window, the calendar tables' the
  calendars, DeleteRow and the stream's `open` both, one reread per burst on a 50ms
  timer; its explicit reread after a save stays, since the save then opens the saved
  event. Its `App.test.ts` "realtime updates" stubs `EventSource` as an `EventTarget`.
- To see the raw stream without writing anything, run in the page (devtools `eval.mjs`)
  `fetch("/api/v2/event", {headers: {"Last-Event-ID": "0"}, signal})` and read its body
  for a second or two, then abort: it replays the log.

## ui/src/lib/Response.ts

Shared between the published apps. It exports `KeyMsgpack` (the integer enum above),
`KeyJson` (the string names), `SmcCompact` and `SmcPretty` types, and
`ResponseCompact`, a class that decodes an ArrayBuffer with `@msgpack/msgpack` and
exposes `namespace`, `name`, `content`, `contentAux` and the rest as getters. Copy it
into a new UI rather than rewriting it. The copies differ: take one that has an
`error` getter and doesn't `console.log` every response (responses carry user data).

## Component pattern (Svelte 5)

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { encode } from "@msgpack/msgpack";
    import { ResponseCompact } from "../lib/Response";

    let inboundLimit: number | null = $state(null);

    type LimitsGetResponseType = { inbound: number | null; outbound: number | null };

    async function fetchLimits() {
        let buffer;
        try {
            const response = await fetch("/api/v2/object", {
                method: "POST",
                headers: { "Content-Type": "application/msgpack" },
                body: encode({
                    namespace: "https://sobamail.com/module/mailboxmanager/v1",
                    name: "LimitsGet",
                    content: [],
                }) as BodyInit,
            });
            buffer = await response.arrayBuffer();
        } catch (error) {
            console.error("Failed to fetch limits:", error);
        }
        if (buffer) {
            const object = new ResponseCompact(buffer);
            if (object.content) {
                inboundLimit = (object.content as LimitsGetResponseType).inbound;
            }
        }
    }

    export async function saveLimits() { /* same shape with name: "LimitsPut" */ }

    onMount(fetchLimits);
</script>

<div class="card-content">
    <h2>Per-message Limits</h2>
    ...
</div>
```

Conventions seen across the apps:

- One `.svelte` card per backend concern, each exporting its `save*()` so
  `App.svelte` can call them from one Save button.
- `$state` for fields, `onMount` for the initial fetch, errors to `console.error`.
- Shared styles in `src/design/*.css`, shared `app.css`, `main.ts` mounting
  `App.svelte`. These files are identical across the apps.
- `@msgpack/msgpack` is the only runtime dependency.

## Build setup

`ui/` is its own pnpm project (no root workspace). `package.json` scripts:

```
dev        vite                                   (not usable: the app must be served by Sobamail)
dev-watch  vite build --watch --config ./vite.config.devel.ts
build      vite build
check      svelte-check --tsconfig ./tsconfig.json
```

`vite.config.devel.ts`:

```ts
export default defineConfig({
    plugins: [svelte()],
    build: { minify: false, outDir: "../assets", emptyOutDir: true },
});
```

`assets/` is the live directory the runtime serves and is gitignored. Debug the
page via Chrome `chrome://inspect`, Devices, Configure, add `localhost:50134`, or the
Inspect button in Sobamail's About dialog. Larger UIs (the app store) add `vitest`
(`pnpm run test`, `src/**/*.test.ts`) and a `check` script that also runs a
`tsconfig.node.json` pass; prefer `pnpm run check` over raw tsc. A pattern worth
copying: run the module's request objects in vitest on a stand-in `soba` runtime over
sql.js, and render `App.svelte` against it with `fetch` stubbed.

What Sobamail Desktop lets an app page do: a user-clicked `mailto:` link opens
Sobamail's composer (older versions hand it to the OS mail client); a file download
is cancelled for now (no `blob:` requests, no download handler); `<input type="file">`
works.
