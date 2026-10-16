#!/usr/bin/env node
// Evaluate a JavaScript expression in an app's page and print its value as JSON
// (promises are awaited).
//
//   node eval.mjs <instid> '<expression>' [--port 50134]
//
// ACTS ON THE PAGE: the expression runs as the app, so it can call /api/v2/object and
// change the user's data. Prefer query.mjs, console.mjs and network.mjs for reading;
// grant it as an "ask" rule so that every call asks first (references/devtools.md).

import { connect, evaluate, fail, page, parse, port } from "./lib.mjs";

const { args, opts } = parse();
const [match, expression] = args;
if (!expression) fail("usage: eval.mjs <instid> '<expression>'");

const s = await connect(await page(port(opts), match));
try {
    console.log(JSON.stringify(await evaluate(s, expression), null, 1) ?? "undefined");
} catch (e) {
    fail(`threw: ${e.message}`);
} finally {
    s.close();
}
