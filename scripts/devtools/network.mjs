#!/usr/bin/env node
// List an app page's requests for a while: method, path, status, size. The object API
// (/api/v2/object) is msgpack both ways; its requests and replies are decoded to the SMC
// object they carry (request: {namespace, name, content}; reply: 0 namespace, 1 name,
// 2 error, 3 content).
//
//   node network.mjs <instid> [--seconds 5] [--api] [--full] [--port 50134]
//
// --api lists the object API's traffic only; --full doesn't cut long objects.
// Read-only: it watches what the app does; act in the app (or input.mjs) meanwhile.

import { brief, connect, number, page, parse, port, sleep, unpack } from "./lib.mjs";

const { args, opts } = parse();
const seconds = number(opts, "seconds", 5, 0, 600);
const max = opts.full ? Infinity : 400;
const API = "/api/v2/object";

const smc = (bytes) => {
    try {
        const o = unpack(bytes);
        if (o && typeof o === "object" && ("name" in o || 1 in o)) {
            const name = o.name ?? o[1];
            if (o[2] !== undefined) return `${name} ERROR ${brief(o[2], max)}`;
            return `${name} ${brief(o.content ?? o[3], max)}`;
        }
        return brief(o, max);
    } catch (e) {
        return `(${bytes.length} bytes, not msgpack: ${e.message})`;
    }
};
const b64 = (s) => Buffer.from(s, "base64");

const s = await connect(await page(port(opts), args[0]));
const requests = new Map();
s.on("Network.requestWillBeSent", ({ requestId, request }) =>
    requests.set(requestId, { request, status: 0 }));
s.on("Network.responseReceived", ({ requestId, response }) => {
    const r = requests.get(requestId);
    if (r) r.status = response.status;
});
s.on("Network.loadingFailed", ({ requestId, errorText }) => {
    const r = requests.get(requestId);
    if (r && (!opts.api || r.request.url.includes(API)))
        console.log(`${r.request.method} ${r.request.url} FAILED ${errorText}`);
});
s.on("Network.loadingFinished", async ({ requestId, encodedDataLength }) => {
    const r = requests.get(requestId);
    if (!r) return;
    const { request, status } = r;
    const api = request.url.includes(API);
    if (opts.api && !api) return;
    const path = request.url.replace(/^soba:\/\/app/, "");
    if (!api) {
        console.log(`${request.method} ${path} ${status} ${encodedDataLength}B`);
        return;
    }
    let sent = "?";
    const entry = request.postDataEntries?.[0]?.bytes;
    if (entry) sent = smc(b64(entry));
    else if (request.hasPostData) {
        const { postData } = await s.send("Network.getRequestPostData", { requestId }).catch(() => ({}));
        if (postData) sent = smc(Buffer.from(postData, "latin1"));
    }
    let got = "(empty)";
    const body = await s.send("Network.getResponseBody", { requestId }).catch(() => null);
    if (body?.body) got = smc(body.base64Encoded ? b64(body.body) : Buffer.from(body.body, "latin1"));
    console.log(`${request.method} ${path} ${status}\n  > ${sent}\n  < ${got}`);
});
await s.send("Network.enable");
await sleep(seconds * 1000);
s.close();
