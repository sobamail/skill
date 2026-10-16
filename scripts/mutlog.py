#!/usr/bin/env python3
"""Dump a Sobamail app instance's mutation log (_soba_mut1), decoded.

Usage:
  mutlog.py <profile-dir>                         list instances from apps.db
  mutlog.py <profile-dir> --app <appid> [opts]    log of that app's instance
  mutlog.py <profile-dir> --instance <instid> [opts]
  mutlog.py <instance-dir-or-main.db> [opts]      log of a database directly

Options:
  --table T      only mutations on app table T
  --op i|d|u     only that operation
  --limit N      at most N rows (default 50; 0 = all)
  --since N      only rows with id > N
  --tail         show the newest rows instead of the oldest
  --parents      also print each parent hash (short) and whether it is present
  --summary      per table/op/status counts instead of rows

Databases are opened read-only. Needs the `msgpack` Python module to decode
payloads; without it the payload is shown as hex.
"""

import argparse
import base64
import os
import sqlite3
import sys

try:
    import msgpack
except ImportError:  # pragma: no cover
    msgpack = None


def open_ro(path):
    return sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)


def instance_dir(profile, instid):
    return os.path.join(profile, "apps", "data", instid[:2], instid[2:])


def list_instances(profile):
    db = open_ro(os.path.join(profile, "apps.db"))
    rows = db.execute("select instid, owner, appid, appname, mode from instances order by id").fetchall()
    print(f"{'instid':28} {'appid':42} {'owner':24} name")
    for instid, owner, appid, appname, mode in rows:
        d = instance_dir(profile, instid)
        flag = "" if os.path.exists(os.path.join(d, "main.db")) else "  (no main.db)"
        print(f"{instid:28} {appid:42} {owner:24} {appname}{flag}")


def resolve(profile, app=None, instid=None):
    db = open_ro(os.path.join(profile, "apps.db"))
    if instid:
        row = db.execute("select instid from instances where instid=?", (instid,)).fetchone()
    else:
        rows = db.execute("select instid, owner from instances where appid=? order by id", (app,)).fetchall()
        if len(rows) > 1:
            print(f"{len(rows)} instances of {app}; pick one with --instance:", file=sys.stderr)
            for r in rows:
                print(f"  {r[0]}  {r[1]}", file=sys.stderr)
            sys.exit(2)
        row = rows[0] if rows else None
    if not row:
        print("no such instance", file=sys.stderr)
        sys.exit(2)
    return os.path.join(instance_dir(profile, row[0]), "main.db")


def b64us(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def decode(data):
    if msgpack is None:
        return "hex:" + data.hex()
    try:
        obj = msgpack.unpackb(data, raw=False, strict_map_key=False)
    except Exception:
        try:
            obj = msgpack.unpackb(data, raw=True, strict_map_key=False)
        except Exception:
            return "hex:" + data.hex()
    if isinstance(obj, dict):
        if obj.get(6) == 1:
            return "DeleteRow " + repr(obj.get(3))
        if obj.get(6) == 2:
            return "UpdateRow " + repr(obj.get(3))
        ns, name, content = obj.get(0), obj.get(1), obj.get(3)
        return f"{name}  {content!r}  ns={ns}"
    return repr(obj)


def decode_rhash(b):
    if not b or msgpack is None:
        return None
    try:
        algo, digest = msgpack.unpackb(b, raw=True)   # the digest is a non-UTF-8 str
    except Exception:
        return b.hex()
    names = {1: "sha1", 2: "sha224", 3: "sha256", 4: "sha512", 5: "sha384"}
    return f"{names.get(algo, algo)}:{b64us(digest)}"


def summary(db):
    q = ("select t, op, status, count(*), min(l), max(l), max(np) from _soba_mut1 "
         "group by t, op, status order by t, op, status")
    print(f"{'table':28} op status   n   l(min..max) parents(max)")
    for t, op, st, n, lmin, lmax, npmax in db.execute(q):
        print(f"{t:28} {op}  {st:<6} {n:5}   {lmin}..{lmax}        {npmax or 0}")


def rows(db, a):
    where, params = [], []
    if a.table:
        where.append("t=?"); params.append(a.table)
    if a.op:
        where.append("op=?"); params.append(a.op)
    if a.since:
        where.append("id>?"); params.append(a.since)
    w = ("where " + " and ".join(where)) if where else ""
    order = "desc" if a.tail else "asc"
    lim = f"limit {a.limit}" if a.limit else ""
    q = (f"select id, l, op, status, pk, t, hex(o), rhash, sha512, psha512, data "
         f"from _soba_mut1 {w} order by id {order} {lim}")
    out = db.execute(q, params).fetchall()
    if a.tail:
        out.reverse()
    seen_rhash = {}
    for id_, l, op, st, pk, t, o, rhash, sha, psha, data in out:
        rh = decode_rhash(rhash)
        if rh and rh not in seen_rhash:
            seen_rhash[rh] = f"m{len(seen_rhash) + 1}"
        tag = seen_rhash.get(rh, "-")
        print(f"#{id_:<6} l={l} {op} st={st} {t}[{pk}] o={o[:8]} mut={tag} sha={sha.hex()[:12]}")
        print(f"        {decode(data)}")
        if a.parents and psha:
            for n in range(len(psha) // 64):
                p = psha[n * 64:(n + 1) * 64]
                hit = db.execute("select id, op, t, pk from _soba_mut1 where sha512=?", (p,)).fetchone()
                desc = f"#{hit[0]} {hit[1]} {hit[2]}[{hit[3]}]" if hit else "missing locally"
                print(f"        parent{n}: {p.hex()[:12]}  {desc}")
    if seen_rhash:
        print("\nmutator versions (rhash):")
        for rh, tag in seen_rhash.items():
            print(f"  {tag} = {rh}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--app")
    ap.add_argument("--instance")
    ap.add_argument("--table")
    ap.add_argument("--op", choices=["i", "d", "u"])
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--since", type=int)
    ap.add_argument("--tail", action="store_true")
    ap.add_argument("--parents", action="store_true")
    ap.add_argument("--summary", action="store_true")
    a = ap.parse_args()

    p = a.path
    # A profile dir has both apps.db and its own main.db, so test for the profile first.
    if os.path.isfile(p):
        dbpath = p
    elif os.path.exists(os.path.join(p, "apps.db")):
        if not (a.app or a.instance):
            list_instances(p)
            return
        dbpath = resolve(p, a.app, a.instance)
    elif os.path.exists(os.path.join(p, "main.db")):
        dbpath = os.path.join(p, "main.db")
    else:
        print("path is neither a profile, an instance dir nor a database", file=sys.stderr)
        sys.exit(2)

    db = open_ro(dbpath)
    print(f"db: {dbpath}")
    if a.summary:
        summary(db)
    else:
        rows(db, a)


if __name__ == "__main__":
    main()
