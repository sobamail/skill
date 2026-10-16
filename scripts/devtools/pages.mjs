#!/usr/bin/env node
// List Sobamail's pages over DevTools, app pages first by instance id. Every other script
// takes that instance id: learn it here (or from mutlog.py <profile>) before anything
// else. An app's page is soba://app/<appid>/<account>/<instid>; titles ("Sobamail —
// Calendar") don't tell two accounts' windows of one app apart, instance ids do.
//
//   node pages.mjs [--port 50134]
//
// Read-only.

import { pages, parse, port, version } from "./lib.mjs";

const { opts } = parse();
const p = port(opts);
const v = await version(p);
console.log(`${v["User-Agent"]} (${v.Browser}) on 127.0.0.1:${p}`);
const all = await pages(p);
for (const t of all.filter((t) => t.app))
    console.log(`${t.app.instid}  ${t.app.appid}  ${t.app.account}  ${t.title}`);
for (const t of all.filter((t) => !t.app)) console.log(`-  ${t.url}  ${t.title}`);
