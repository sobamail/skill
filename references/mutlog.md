# The mutation log (`_soba_mut1`)

Observed in live instance databases under `<profile>/apps/data/` (Linux profiles
live in `~/.local/share/Soba/<profile>/m-<id>/`). Not covered by the developer docs;
the column meanings below come from the schema, its triggers, and decoded rows. Where
a meaning is inferred rather than stated it says so.

## Finding an instance

`apps.db` in the profile has `instances(instid, owner, appid, appname, rhash, ahash,
icon, blobs, mode)`. The instance directory is
`apps/data/<instid[0:2]>/<instid[2:]>/main.db`. Open databases read-only
(`sqlite3 -readonly`, or `file:...?mode=ro` from Python); the app may be running.
`scripts/mutlog.py` does the lookup and the decoding. A `_main.db` next to
`main.db` in some instance directories is a database the runtime keeps for itself,
not app state.

## Tables in an instance database

| table | purpose |
|---|---|
| app tables (`person`, `folders`, `attr`, ...) | materialized state, generated from `soba.schema.table` |
| `_soba_mut1` | the mutation log, one row per mutation |
| `_soba_mut1_parent` | normalized parent edges `(m, n, psha512)` split out of `psha512` by trigger |
| `_soba_mut1_lww` | `(m, t, c, v)`: the lww key each mutation claims; `c` is a column name or JSON array of columns, `v` the value or JSON array; UNIQUE over `(t, c, v)` is how last-write-wins and dedup are enforced |
| `_soba_mut1_delcache` | `(m, pk, t, c, v)`: lww keys of deleted rows, so a later insert can link to the delete |
| `_soba_mut1_seq` | integers 0..N used by the triggers to slice `psha512` |
| `_soba_attr` | `(k, v)` instance attributes (empty on the instances inspected) |
| `_soba_peers` | `(addr)` collaborators of a shared instance |

## `_soba_mut1` columns

| column | meaning |
|---|---|
| `id` | local insertion order |
| `l` | depth in the DAG: max parent `l` + 1, 0 for roots. Set and frozen by triggers |
| `op` | `i` insert, `d` delete, `u` update |
| `status` | bitfield. Trigger `_soba_mut1_check_i` requires that a mutation with odd status has only odd-status parents, so bit 0 reads as "applied". Values seen: 5 on a dev-only instance, 7 on replicated ones; the higher bits are not documented (inferred: replication state) |
| `pk` | rowid of the row in table `t` that this mutation inserted or deleted. UNIQUE over `(t, pk, op)` for `i`/`d` |
| `t` | target app table |
| `o` | 16-byte grouping id, required and fixed-length. Every mutation produced by one processing run shares it: an app instance has one value per request, a mailbox instance a handful across thousands of message mutations. It is neither the replica uuid nor the uuid of the message named in the payload. Undocumented; treat as "which run produced this" |
| `rhash` | msgpack `[2, <28 bytes>]`, i.e. `[Sha224, digest]` of the Mutator that produced the mutation; `scripts/gen-hash.py Mutator.mjs` gives the same value for the matching version. NULL for runtime-internal apps (appmanager) |
| `sha512` | the mutation's content address: `sha512(data)` for roots, `sha512(psha512 || data)` otherwise (enforced by CHECK) |
| `psha512` | concatenated parent hashes, 64 bytes each, slot 0 first then the rest in canonical sorted order; NULL for roots; required for `d` and `u`. For a delete, slot 0 must be the insert it removes |
| `data` | msgpack compact SMC: `{0: namespace, 1: name, 3: content}` for inserts, `{6: 1, 3: []}` for deletes (well-known object 1 = DeleteRow) |
| `p0`, `np` | generated: first parent hash and parent count |

Example rows, decoded:

```
id=13  l=0 op=i status=5 pk=1 t=person
       {0: 'https://sobamail.com/module/contacts/v1', 1: 'AddPerson', 3: {'uuid': '{<uuid>}'}}
id=15  l=1 op=i status=5 pk=1 t=person_attr_single  np=1 (parent = id 13, via the fk on person)
       {0: '.../contacts/v1', 1: 'SetPersonAttr', 3: {'person': '{<uuid>}', 'key': 'firstName', 'value': 'test'}}
id=4724 l=1 op=d status=7 pk=1 t=attr  np=1 (parent = the SetAttr insert it removes)
       {6: 1, 3: []}
```

Causal edges come from: the fk target's insert, the previous row under the same lww
key (through its delete), and for `d`/`u` the row being changed. That is exactly what
`soba.schema.table` checks declare, so reading a log is the quickest way to verify a
schema does what you meant.

## Generated app tables

Their shape is described under Declaring tables in app-anatomy.md. A table dropped
from the declarations stays in the file, so an unknown table in a live database is
not necessarily a bug.
