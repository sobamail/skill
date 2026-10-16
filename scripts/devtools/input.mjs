#!/usr/bin/env node
// Drive an app's page with real mouse and keyboard input: Chromium turns these into the
// same pointer, mouse, click and key events a user's hand makes.
//
//   node input.mjs <instid> '<steps as JSON array>' [--port 50134]
//
// Steps, run in order over one connection (x, y in viewport CSS px, as query.mjs
// reports rects):
//   {"click": [x, y]}                        press and release the left button
//   {"drag": [[x0, y0], [x1, y1]], "steps": 10, "hold": 30}
//                                            press, move in steps (hold ms apart), release
//   {"down": [x, y]} {"move": [x, y]} {"up": [x, y]}
//                                            a drag in pieces, e.g. to shoot it midway
//   {"wheel": [x, y, dy]}                    scroll by dy px over (x, y)
//   {"type": "text"}                         insert text into the focused element
//   {"key": "Escape"}                        press and release a key ("Enter", "Tab"…)
//   {"wait": ms}
//   {"shot": "out.png"}                      screenshot (only .png)
//
// Keep a press and its release in ONE call: between calls the real mouse may move over
// the window, and the page sees those moves (with no button down) in the middle of the
// drag.
//
// ACTS ON THE PAGE: clicks can create, move, delete and send; grant it as an "ask"
// rule so that every call asks first (references/devtools.md).

import { writeFileSync } from "node:fs";
import { connect, fail, page, parse, port, sleep } from "./lib.mjs";

const { args, opts } = parse();
const [match, json] = args;
if (!json) fail("usage: input.mjs <instid> '<steps as JSON array>'");
let steps;
try {
    steps = JSON.parse(json);
} catch (e) {
    fail(`steps aren't JSON: ${e.message}`);
}
if (!Array.isArray(steps)) fail("steps must be a JSON array");

const s = await connect(await page(port(opts), match));
const mouse = (type, [x, y], buttons, extra = {}) =>
    s.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        buttons,
        button: type === "mousePressed" || type === "mouseReleased" ? "left" : "none",
        clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
        ...extra,
    });

for (const step of steps) {
    if ("click" in step) {
        await mouse("mouseMoved", step.click, 0);
        await mouse("mousePressed", step.click, 1);
        await mouse("mouseReleased", step.click, 0);
    } else if ("drag" in step) {
        const [[x0, y0], [x1, y1]] = step.drag;
        const n = step.steps ?? 10;
        await mouse("mouseMoved", [x0, y0], 0);
        await mouse("mousePressed", [x0, y0], 1);
        for (let i = 1; i <= n; i++) {
            await sleep(step.hold ?? 30);
            await mouse("mouseMoved", [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n], 1);
        }
        await mouse("mouseReleased", [x1, y1], 0);
    } else if ("down" in step) {
        await mouse("mouseMoved", step.down, 0);
        await mouse("mousePressed", step.down, 1);
    } else if ("move" in step) {
        await mouse("mouseMoved", step.move, 1);
    } else if ("up" in step) {
        await mouse("mouseReleased", step.up, 0);
    } else if ("wheel" in step) {
        const [x, y, dy] = step.wheel;
        await mouse("mouseWheel", [x, y], 0, { deltaX: 0, deltaY: dy });
    } else if ("type" in step) {
        await s.send("Input.insertText", { text: String(step.type) });
    } else if ("key" in step) {
        for (const type of ["keyDown", "keyUp"])
            await s.send("Input.dispatchKeyEvent", { type, key: step.key, code: step.key });
    } else if ("wait" in step) {
        await sleep(step.wait);
    } else if ("shot" in step) {
        if (!String(step.shot).endsWith(".png")) fail("a shot must go to a .png file");
        const { data } = await s.send("Page.captureScreenshot");
        writeFileSync(step.shot, Buffer.from(data, "base64"));
        console.log(`shot: ${step.shot}`);
    } else {
        fail(`unknown step ${JSON.stringify(step)}`);
    }
}
s.close();
