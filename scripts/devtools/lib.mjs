// Shared plumbing of the DevTools scripts. Sobamail Desktop serves Chromium's DevTools
// on 127.0.0.1, port 50134 unless --port (or SOBA_DEVTOOLS_PORT) says otherwise. Only
// that host is ever reached. Node >= 22 (fetch and WebSocket built in), no packages.

export const HOST = "127.0.0.1";

export function fail(message) {
    console.error(message);
    process.exit(1);
}

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** argv after the script: positional args, and --name value / --flag options. */
export function parse(argv = process.argv.slice(2)) {
    const args = [];
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith("--")) {
            args.push(argv[i]);
            continue;
        }
        const name = argv[i].slice(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts[name] = argv[++i];
        else opts[name] = true;
    }
    return { args, opts };
}

/** A whole number option within [min, max], or `fallback` when it isn't given. */
export function number(opts, name, fallback, min, max) {
    if (opts[name] === undefined) return fallback;
    const n = Number(opts[name]);
    if (!Number.isFinite(n) || n < min || n > max) fail(`--${name} must be in [${min}, ${max}]`);
    return n;
}

export function port(opts) {
    const p = Number(opts.port ?? process.env.SOBA_DEVTOOLS_PORT ?? 50134);
    if (!Number.isInteger(p) || p < 1 || p > 65535) fail(`bad DevTools port '${opts.port}'`);
    return p;
}

async function get(port, path) {
    const res = await fetch(`http://${HOST}:${port}${path}`).catch(() => null);
    if (!res) fail(`nothing answers on ${HOST}:${port}; is Sobamail running?`);
    return res.json();
}

export const version = (port) => get(port, "/json/version");

/**
 * An instance id: an app's is a uuid in base32hex, 26 digits; a system app's is longer
 * and leaves base32hex (the App Store's 5K2OAGTONP2DNBDI133IMSSJ2OZ1, 28).
 */
export const INSTID = /^[0-9A-Z]{26,}$/i;

/** What an app page's URL, soba://app/<appid>/<account>/<instid>[#…], names; else null. */
export function app(url) {
    const m = /^soba:\/\/app\/([^/]+)\/([^/]+)\/([0-9A-Za-z]{26,})(?:[/?#]|$)/.exec(url);
    return m && { appid: m[1], account: m[2], instid: m[3].toUpperCase() };
}

/**
 * The pages (apps, the launcher, blanks), each with what its URL names. DevTools' own
 * page ids change whenever Sobamail restarts; an app's instance id doesn't.
 */
export async function pages(port) {
    return (await get(port, "/json/list"))
        .filter((t) => t.type === "page")
        .map((t) => ({ ...t, app: app(t.url) }));
}

/**
 * The page of app instance `instid` (pages.mjs lists them, mutlog.py lists a profile's).
 * Never a title: two accounts' windows of one app have the same one.
 */
export async function page(port, instid) {
    if (!INSTID.test(instid ?? "")) {
        fail(`give the app's instance id (26 or more letters and digits), not '${instid ?? ""}'; ` +
            "pages.mjs lists the open ones");
    }
    const all = await pages(port);
    const hits = all.filter((t) => t.app?.instid === instid.toUpperCase());
    if (hits.length === 1) return hits[0];
    fail(`${hits.length ? `${hits.length} pages show` : "no page shows"} instance ${instid}:\n` +
        all.map((t) => `  ${t.app?.instid ?? "-"}  ${t.title}  ${t.url}`).join("\n"));
}

/** A DevTools session on `target`: send(method, params), on(event, fn), close(). */
export async function connect(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, no) => {
        ws.onopen = ok;
        ws.onerror = () => no(new Error(`can't connect to '${target.title}'`));
    });
    let seq = 0;
    let closing = false;
    const pending = new Map();
    const handlers = new Map();
    ws.onclose = () => {
        if (!closing) fail(`DevTools dropped the connection to '${target.title}'`);
    };
    ws.onmessage = (m) => {
        const data = JSON.parse(m.data);
        if (data.id === undefined) {
            for (const fn of handlers.get(data.method) ?? []) fn(data.params);
            return;
        }
        const p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        if (data.error) p.no(new Error(`${p.method}: ${data.error.message}`));
        else p.ok(data.result);
    };
    return {
        send: (method, params = {}) =>
            new Promise((ok, no) => {
                const id = ++seq;
                pending.set(id, { ok, no, method });
                ws.send(JSON.stringify({ id, method, params }));
            }),
        on(method, fn) {
            handlers.set(method, [...(handlers.get(method) ?? []), fn]);
        },
        close() {
            closing = true;
            ws.close();
        },
    };
}

/** The value of `expression` in the page; throws what the page threw. */
export async function evaluate(session, expression) {
    const r = await session.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
}

/** A value as one line, cut at `max` characters. */
export function brief(value, max = 400) {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s === undefined ? String(value) : s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Decode msgpack (the SMC wire format of /api/v2/object). Binary and ext values come
 * back as "<N bytes>" / "<ext>" placeholders: this is for reading traffic, not for data.
 */
export function unpack(bytes) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let i = 0;
    const take = (n) => {
        const at = i;
        i += n;
        return at;
    };
    const str = (n) => new TextDecoder().decode(buf.subarray(take(n), i));
    const arr = (n) => Array.from({ length: n }, () => read());
    const map = (n) => {
        const o = {};
        for (let k = 0; k < n; k++) {
            const key = read();
            o[key] = read();
        }
        return o;
    };
    const blob = (n) => (take(n), `<${n} bytes>`);
    const ext = (n) => (take(n + 1), "<ext>");
    function read() {
        const b = buf[take(1)];
        if (b <= 0x7f) return b;
        if (b >= 0xe0) return b - 0x100;
        if ((b & 0xf0) === 0x80) return map(b & 0x0f);
        if ((b & 0xf0) === 0x90) return arr(b & 0x0f);
        if ((b & 0xe0) === 0xa0) return str(b & 0x1f);
        switch (b) {
            case 0xc0: return null;
            case 0xc2: return false;
            case 0xc3: return true;
            case 0xc4: return blob(buf[take(1)]);
            case 0xc5: return blob(dv.getUint16(take(2)));
            case 0xc6: return blob(dv.getUint32(take(4)));
            case 0xc7: return ext(buf[take(1)]);
            case 0xc8: return ext(dv.getUint16(take(2)));
            case 0xc9: return ext(dv.getUint32(take(4)));
            case 0xca: return dv.getFloat32(take(4));
            case 0xcb: return dv.getFloat64(take(8));
            case 0xcc: return buf[take(1)];
            case 0xcd: return dv.getUint16(take(2));
            case 0xce: return dv.getUint32(take(4));
            case 0xcf: return Number(dv.getBigUint64(take(8)));
            case 0xd0: return dv.getInt8(take(1));
            case 0xd1: return dv.getInt16(take(2));
            case 0xd2: return dv.getInt32(take(4));
            case 0xd3: return Number(dv.getBigInt64(take(8)));
            case 0xd4: return ext(1);
            case 0xd5: return ext(2);
            case 0xd6: return ext(4);
            case 0xd7: return ext(8);
            case 0xd8: return ext(16);
            case 0xd9: return str(buf[take(1)]);
            case 0xda: return str(dv.getUint16(take(2)));
            case 0xdb: return str(dv.getUint32(take(4)));
            case 0xdc: return arr(dv.getUint16(take(2)));
            case 0xdd: return arr(dv.getUint32(take(4)));
            case 0xde: return map(dv.getUint16(take(2)));
            case 0xdf: return map(dv.getUint32(take(4)));
        }
        throw new Error(`msgpack: byte 0x${b.toString(16)} at ${i - 1}`);
    }
    return read();
}
