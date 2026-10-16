#!/usr/bin/env node
// Reload an app's page, bypassing the cache, and wait for it to load: picks up a new UI
// build (pnpm run dev-watch writes it to assets/). Prints the scripts it loaded.
//
//   node reload.mjs <instid> [--port 50134]
//
// ACTS ON THE PAGE: whatever the user had open in it (a half-filled form) is lost; the
// project's settings make every reload.mjs call ask first.

import { connect, evaluate, page, parse, port, sleep } from "./lib.mjs";

const { args, opts } = parse();
const p = port(opts);
const target = await page(p, args[0]);
const s = await connect(target);
await s.send("Page.enable");
const loaded = new Promise((ok) => s.on("Page.loadEventFired", ok));
await s.send("Page.reload", { ignoreCache: true });
await Promise.race([loaded, sleep(15000)]);
const scripts = await evaluate(s, "[...document.scripts].map((e) => e.src).filter(Boolean)");
s.close();
console.log(`${target.title}: reloaded\n${scripts.join("\n")}`);
