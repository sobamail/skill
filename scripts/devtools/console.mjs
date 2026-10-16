#!/usr/bin/env node
// Print an app page's console messages, uncaught exceptions and browser log entries
// (failed loads, blocked fonts, CSP) for a while.
//
//   node console.mjs <instid> [--seconds 5] [--port 50134]
//
// Read-only.

import { brief, connect, number, page, parse, port, sleep } from "./lib.mjs";

const { args, opts } = parse();
const seconds = number(opts, "seconds", 5, 0, 600);

// an object or array argument as Chromium previews it: {n: 1, s: "x", …}
const preview = (p) => {
    const more = p.overflow ? ", …" : "";
    if (p.subtype === "array") return `[${p.properties.map((x) => x.value).join(", ")}${more}]`;
    return `{${p.properties.map((x) => `${x.name}: ${x.value}`).join(", ")}${more}}`;
};
const arg = (o) =>
    o.value !== undefined ? brief(o.value, 300)
    : o.preview ? preview(o.preview)
    : o.description ?? o.type;

const s = await connect(await page(port(opts), args[0]));
s.on("Runtime.consoleAPICalled", (p) => console.log(`console.${p.type}: ${p.args.map(arg).join(" ")}`));
s.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
    console.log(`uncaught: ${d.exception?.description ?? d.text} (${d.url ?? ""}:${d.lineNumber})`));
s.on("Log.entryAdded", ({ entry: e }) =>
    console.log(`${e.source} ${e.level}: ${e.text}${e.url ? ` (${e.url})` : ""}`));
await s.send("Runtime.enable");
await s.send("Log.enable");
await sleep(seconds * 1000);
s.close();
