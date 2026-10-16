# Anatomy of a Sobamail app

The exact shape of each piece, distilled from the published apps. Read the section
you need before writing that piece. The UI side is in wire-and-ui.md.

1. Repository layout
2. The Mutator class
3. Module files and the namespace
4. Object (event) classes
5. Registering an object: the two maps
6. Declaring tables
7. The process() dispatch
8. Request / response objects
9. Reading data
10. Deleting rows
11. Shared instances: trusting the sender

## 1. Repository layout

```
Mutator.mjs                       # the app: default-exported class
sobamail.com/module/<name>/v1.mjs # the app's own module(s), imported by URL + hash
ui/                               # Svelte 5 + Vite + TypeScript, its own pnpm project
assets/                           # UI build output, gitignored
```

A repository can hold several apps, one such layout per directory. The backend has
no package.json and no package manager; only `ui/` is a pnpm project.

## 2. The Mutator class

The Application Manager generates `Mutator.mjs` (and `assets/index.html`) in the
develroot when the app is instantiated in developer mode; see dev-and-deploy.md.
Start from that file and never write a skeleton yourself. The runtime instantiates
the default export once per event, then calls `process()`.

| static | meaning | example |
|---|---|---|
| `id` | reverse-DNS app id, immutable once published | `contacts.app.sobamail.com` |
| `name` | human name | `"Contacts"` |
| `version` | 4-part string, must grow on every deploy | `"1.0.1.3"` |
| `objects` | Map of every object KEY the app accepts, value `false` | see section 5 |
| `handlers` | Map KEY to function(content), the app's own convention | see section 5 |

The first import of every backend file that touches the runtime is
`import "soba://computer/R2";`.

## 3. Module files and the namespace

An app's own types live in `sobamail.com/module/<path>/v1.mjs`. The file begins by
exporting its namespace, which is the URL it is served from, and importing the
runtime side effect:

```js
export const namespace = "https://sobamail.com/module/contacts/v1";

import "soba://computer/R2";
```

The namespace string is part of every object's identity (section 4), and it is what
a UI puts in the `namespace` field of a request. Keep the file path and the namespace
URL in agreement: in dev mode the runtime resolves the module from the path derived
from the namespace, so a mismatch is a module that cannot be found.

Importing a module, from the Mutator or from another module:

```js
import {
    AddPerson,
    GetPeople,
} from "https://sobamail.com/module/contacts/v1?sha224=U3CKN8BOGER4VSUTSFK5AMLIC9LKROFH4O064589PUGBE";
```

The `?sha224=` pin and how to keep it current: Hashes in dev-and-deploy.md. Import
groups wider than clang-format likes are wrapped in `/* clang-format off */` and
`/* clang-format on */`.

## 4. Object (event) classes

Everything the app receives or sends is an "object": a class with a static KEY built
from the namespace and the class name (Clark notation, braces included):

```js
export class SetPersonAttr {
    static KEY = `{${namespace}}${this.name}`;   // "{https://sobamail.com/module/contacts/v1}SetPersonAttr"

    constructor({person = null, key = null, value = null} = {}) {
        if (! person) {
            throw new MalformedObject("Missing SetPersonAttr.person");
        }
        if (! key) {
            throw new MalformedObject("Missing SetPersonAttr.key");
        }
        this.person = person;
        this.key = key;
        this.value = value;
    }

    process() {
        // throws if the person was never inserted, and aborts the pass (section 9)
        soba.data.find("person", {uuid : this.person});
        return soba.data.insert("person_attr_single", this);
    }

    asText(locale) { return `Set ${this.key} of person ${this.person} to '${this.value}'`; }
    toString() { return `SetPersonAttr(${this.person}, '${this.key}', '${this.value}')`; }
}
```

Conventions:

- Constructor takes one destructured object with defaults, so the class can be built
  straight from wire content: `new X(content)`.
- `process()` does the work. When the instance's own fields are the row,
  `soba.data.insert("table", this)` is the shortcut.
- Give events that land in a replicated table `asText(locale)` and `toString()`;
  the runtime can show them to the user.
- Validate in the constructor or at the top of `process()`. A plain throw out of
  `process()` is retried forever, so throw a dedicated class the module exports
  (`export class MalformedObject extends Error {}`) and have the dispatch log and drop
  it, rethrowing anything else (section 7).
- Naming: PascalCase verb plus noun. `Add*`/`Insert*` create rows, `Set*` upsert an
  attribute, `Unset*`/`Remove*`/`Delete*` remove, `*Get`/`*Put` are UI requests,
  `*Response` their answers.

## 5. Registering an object: the two maps

A new object is not live until it is in **both** static maps on the Mutator:

```js
static objects = new Map([
    [ DeleteRow.KEY, false ],
    [ AddPerson.KEY, false ],
    [ GetPerson.KEY, false ],
]);

static handlers = new Map([
    [ AddPerson.KEY, (content) => (new AddPerson(content)).process() ],
    [ GetPerson.KEY, (content) => (new GetPerson(content)).process() ],
]);
```

`objects` is the subscription list the runtime reads: which keys to deliver to this
app at all (the value must be `false`; the map must not be empty). `handlers` is
the app's own dispatch table. Base objects such as `Message.KEY` and `DeleteRow.KEY`
appear in `objects` only.

In dev mode, after changing `objects`, use Application Manager, Instances, select
the instance, "Reload Objects". Deployed instances pick it up on instantiation, and
on upgrade: an instance upgrade re-runs the walk over `objects` and rewrites the
routing for the new version.

## 6. Declaring tables

Tables are declared in the Mutator constructor and nowhere else (the runtime throws
otherwise). Every table names the event that inserts into it and the event that
deletes from it (always the base module's `DeleteRow`):

```js
soba.schema.table({
    name : "person_attr_single",
    insertEvent : SetPersonAttr,
    deleteEvent : DeleteRow,
    columns : [
        {
            name : "person",
            checks : [
                {op : "!=", value : null},
                {op : "fk", table : "person", column : "uuid"},
            ],
        },
        {
            name : "key",
            checks : [
                {op : "!=", value : null},
                {op : "!=", value : ""},
                {op : "typeof", value : "text"},
            ],
        },
        { name : "value", checks : [] },
    ],
    checks : [
        { columns : [ "person", "key" ], op : "lww", value : true },
    ],
});
```

Check operators:

| op | where | meaning |
|---|---|---|
| `==`, `!=` | column | compare with constant `value` (used with `null` and `""`) |
| `typeof` | column | SQLite type: `"text"`, `"integer"`, `"real"`, `"blob"`, `"null"` |
| `regexp` | column | must match (V8 regex); prefer `soba.type.uuid.pattern`, `soba.type.userName.pattern`, `soba.type.domainName.pattern`, `soba.type.address.pattern` over retyping |
| `in` | column | value in list |
| `lww` | column or table | last-write-wins, and the only way to get a UNIQUE constraint. On insert: no row with that key yet, no causal link; an identical row, the insert is ignored; a different row, a DeleteRow for the old one is generated and the new insert depends on it. On a table check, `columns` is the composite key |
| `fk` | column | `{op:"fk", table, column}`: FOREIGN KEY ON DELETE CASCADE, and the referenced insert becomes a causal parent |
| `fk` | table | `{op:"fk", columns:{local:remote,...}, table}` composite foreign key |

What the runtime generates (observed in live instance databases): a table with
`id INTEGER PRIMARY KEY AUTOINCREMENT`, the declared columns in alphabetical order
with `text` affinity, one `CHECK` per check (`!= null` becomes `IS NOT NULL`),
`UNIQUE(...)` for each `lww`, and `FOREIGN KEY ... ON DELETE CASCADE` for each `fk`.
Instance databases run with `PRAGMA foreign_keys=ON`, so the cascades do fire; a
cascade deletes rows without `DeleteRow` mutations of their own.

Each init creates the declared tables that are missing from the instance database
(a lookup in `sqlite_schema`, then `CREATE TABLE`), so a table first declared in a
later version appears when an existing instance upgrades. An existing table is never
altered: a changed column set needs a table of its own.

Patterns worth copying:

- **Entity plus attribute tables.** A thin entity table (`person`: uuid) plus an
  `<entity>_attr` table (entity fk, key, value) with `lww` over `[entity, key]`.
  It keeps every mutation small and makes attribute updates commutative.
- **Multi-valued attributes.** Contacts uses `person_attr_multi` (container row)
  plus `person_attr_multi_value` with a composite fk back to the container.
- **A column that another table's fk names must be unique**, which in this schema
  language means it carries `lww` itself.
- `null` is a legitimate value wherever the column has no `!= null` check; say in a
  comment what null means.

## 7. The process() dispatch

`process(message, meta)` receives every delivery. The return value is discarded.
`meta.type` is one of:

- `"task"`: a local task. The UI's requests are transient tasks; tasks the native
  client queues for the app are task rows.
- `"task-replay"`: a mutation from another replica being replayed (the runtime calls
  the app with `sender = null`). A `DeleteRow` never reaches JS.
- `"message"`: mail, a structured message included. `meta.location` can be
  `"limbo"` (not yet delivered).

An app that takes nothing by mail can refuse everything but `"task"` and
`"task-replay"` before dispatching; that keeps strangers from writing to it with a
structured message (a shared instance, which syncs by mail, can't).

```js
process(message, metadata) {
    const object = Message.extractObject(message, metadata);   // null when there is nothing to do
    if (! object) {
        soba.log.debug("Unrecognized content");
        return;
    }

    const key = `{${object.namespace}}${object.name}`;
    const handler = Application.handlers.get(key);
    if (! handler) {
        soba.log.warning(`No handler found for objkey='${key}', ignored`);
        return;
    }

    handler(object.content);
}
```

`Message.extractObject` returns null for limbo, returns the message itself for
tasks, and for structured messages digs into `bodyObject.content`, unwraps a signed
or encrypted `Envelope`, and validates namespace and name.

Throw only when a later retry could succeed (a parent row that replication has not
brought yet); log and return for anything unknown, malformed or unauthorized. With a
dedicated class for malformed content (section 4), the last line of the dispatch
becomes:

```js
try {
    handler(object.content);
}
catch (e) {
    if (e instanceof MalformedObject) {
        soba.log.error(`Dropped malformed objkey='${key}': ${e.message}`);
        return;
    }
    throw e;
}
```

## 8. Request / response objects

The UI POSTs one object and receives one object. The request is delivered to
`process()` like any other event, locally, and answers with `soba.task.respond(...)`:

```js
export class LimitsGet {
    static KEY = `{${namespace}}${this.name}`;
    process() {
        soba.task.respond(new LimitsGetResponse({
            inbound : LimitsGet.read_limit("inbound_limit"),
            outbound : LimitsGet.read_limit("outbound_limit"),
        }));
    }
}

export class LimitsGetResponse {
    static KEY = `{${namespace}}${this.name}`;
    constructor({inbound = null, outbound = null} = {}) {
        this.inbound = inbound;
        this.outbound = outbound;
    }
}
```

`*Put` requests write with `soba.data.insert` and then respond. Only the request goes
in `objects` and `handlers`: a response class is a KEY that `soba.task.respond`
serializes, and it is never delivered to the app. The UI side is in wire-and-ui.md.

Tasks are not deduplicated: two identical requests both run (only byte-identical
mutations collapse). A request that mints a uuid for a new row makes one row per run.

## 9. Reading data

- `soba.data.find(table, {col: val, ...})` is the deterministic lookup, allowed in
  replicated handlers. The object must hold exactly the columns of one lww
  constraint, all of them, in any order, so that it matches a single row; a partial
  key is refused ("Query does not contain unique columns"). It returns the live
  (latest) row's `{object, hash, deleted}`. Use it to assert existence before a
  dependent insert, and to obtain the hash for a delete.
- A `find` that matches no insert throws, AND every later `soba.data.*` call in the
  same pass fails with "Execution was aborted previously"; catching the error doesn't
  help, and a task that throws is retried forever. In a non-replicated handler, check
  with `soba.db.exec` first and only `find` what exists.
- `soba.data.findLast(table, {...})` returns the latest matching mutation;
  non-replicated only.
- `soba.db.exec(sql, ...params)` runs read-only SQLite; non-replicated only. Result
  has `.code` (0 is success) and `.data` (array of positional row arrays).
  Parameters are `?` placeholders. Check `ret.code != 0` and throw a descriptive
  error.
- `soba.db.exec` reads its own snapshot: a row removed by `soba.data.delete` (or by
  the cascade it triggers) is still visible to it later in the same pass. Read
  everything you need first, then write.

## 10. Deleting rows

Deletion is two steps: find the row, delete by hash.

```js
let parent = soba.data.find("attr", {key : this.key}).hash;
return soba.data.delete("attr", parent);
```

To delete a tree, collect the children with a `WITH RECURSIVE` query via
`soba.db.exec` in a non-replicated handler, then delete leaf-first.

## 11. Shared instances: trusting the sender

In a shared instance, collaborators' objects arrive by mail, so who sent one can
matter.

- The From header is whatever the sender's client wrote. Only a verified signature
  identifies the sender. A signed object arrives wrapped in a `{base/v1}Envelope`;
  the runtime rejects one whose signature does not verify against From before the
  app runs, so `envelope.sender` is trustworthy when `envelope.signature` is
  non-empty. An unsigned object has no sender.
- `Message.extractObject` unwraps the Envelope and drops the sender, so an app that
  authorizes by sender unwraps it itself in `process()` (Envelope fields:
  wire-and-ui.md).
- Authorize only non-replicated (request) objects. While a replicated object runs,
  the runtime refuses `soba.db.exec` and `soba.app.account`, so the handler cannot
  read a roles table, and every replica must replay it to the same state anyway.
- The pattern: a static Set of gated keys next to the two maps, checked against the
  app's roles table in the dispatch before the handler runs. Refuse by logging and
  returning, not by throwing.
