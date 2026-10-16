#!/usr/bin/env node
// Screenshot a Sobamail page, or one element of it, as PNG; prints where it went.
//
//   node shot.mjs <instid> [out.png] [--selector <css>] [--scale 2] [--port 50134]
//
// <instid> is the app's instance id (pages.mjs). Without out.png the file goes to the
// system temp dir. --selector clips to the first element it matches; --scale
// zooms (1 to 4), to check a glyph or a pixel-level alignment.
//
// Read-only on the page; writes nothing but a .png file.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, evaluate, fail, number, page, parse, port } from "./lib.mjs";

const { args, opts } = parse();
const [match, out = join(tmpdir(), `sobamail-${Date.now()}.png`)] = args;
if (!out.endsWith(".png")) fail("the output must be a .png file");
const scale = number(opts, "scale", 1, 1, 4);

const target = await page(port(opts), match);
const s = await connect(target);
let clip;
if (opts.selector) {
    const r = await evaluate(s, `(() => {
        const e = document.querySelector(${JSON.stringify(String(opts.selector))});
        return e && e.getBoundingClientRect().toJSON();
    })()`);
    if (!r) fail(`nothing matches '${opts.selector}'`);
    clip = { x: r.x, y: r.y, width: r.width, height: r.height, scale };
} else if (scale !== 1) {
    const { cssVisualViewport: v } = await s.send("Page.getLayoutMetrics");
    clip = { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale };
}
const { data } = await s.send("Page.captureScreenshot", clip ? { clip } : {});
s.close();
writeFileSync(out, Buffer.from(data, "base64"));
console.log(`${target.title}: ${out}`);
