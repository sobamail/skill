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
