#!/usr/bin/env node
// The elements a CSS selector matches on an app's page, one JSON line each: tag, text,
// rect [x, y, width, height] (viewport CSS px, what input.mjs takes), classes, role and
// aria-label, disabled, cursor. Rects tell input.mjs where to click and drag.
//
//   node query.mjs <instid> <css selector> [--limit 20] [--port 50134]
//
// Read-only: the selector is passed to fixed code as a string, never run as code.

import { connect, evaluate, fail, number, page, parse, port } from "./lib.mjs";

const { args, opts } = parse();
const [match, selector] = args;
if (!selector) fail("usage: query.mjs <instid> <css selector> [--limit 20]");
const limit = number(opts, "limit", 20, 1, 1000);

const read = (sel, max) =>
    [...document.querySelectorAll(sel)].slice(0, max).map((e) => {
        const r = e.getBoundingClientRect();
        return {
            tag: e.tagName.toLowerCase(),
            text: e.textContent.trim().replace(/\s+/g, " ").slice(0, 120),
            rect: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10),
            class: e.getAttribute("class") ?? "",
            role: e.getAttribute("role") ?? undefined,
            label: e.getAttribute("aria-label") ?? undefined,
            disabled: e.disabled || undefined,
            cursor: getComputedStyle(e).cursor,
        };
    });

const s = await connect(await page(port(opts), match));
const found = await evaluate(s, `(${read})(${JSON.stringify(selector)}, ${limit})`);
s.close();
if (!found.length) fail(`nothing matches '${selector}'`);
for (const e of found) console.log(JSON.stringify(e));
