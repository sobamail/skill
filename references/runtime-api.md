# The soba runtime API

Condensed from the Sobamail developer reference and the base module source
(model/Base.mjs in https://github.com/sobamail/base). Functions marked **[NR]** are non-deterministic and
throw when called while a replicated mutation is being processed or replayed.
Determine the context with `soba.app.isReplicated()`.

Contents: imports and the base module; special values; soba.app; soba.data;
soba.schema; soba.db; soba.task; soba.mail; soba.log; soba.pack / text / binary;
soba.blob; soba.clock; soba.platform; soba.type.

## Imports and the base module

```js
import "soba://computer/R2";                                   // must be the first import
import {DeleteRow, Message, NotFoundError}
    from "https://sobamail.com/module/base/v1?sha224=FT31A9Ojcmu_lm2HSbwlKpw5FDVqfP2ESNjmrg";
```

Every import carries a `?sha224=` pin (Hashes in dev-and-deploy.md). Deployed
modules form one shared, content-addressed codebase; the current base-module pin is
published in https://github.com/sobamail/base.

Base module exports (`https://sobamail.com/module/base/v1`), from Base.mjs:

| export | use |
|---|---|
| `DeleteRow` | KEY only; the mandatory `deleteEvent`; well-known object 1 |
| `UpdateRow` | `{column, op, value}`; well-known object 2 |
| `Message` | email object. `static extractObject(message, meta)` returns the SMC object `{namespace, name, content}` or null (limbo, unstructured, malformed). Instances: `uuid`, `headers` (array of `[name, value]`), `from`/`to`/`cc`/`bcc` (arrays of `EmailAddress`), `sender`, `subject`, `messageId`, `dateMsec`, `bodyText`, `bodyHtml`, `bodyObject`, `attachments`, plus `hasHeader`, `getHeader*`/`setHeader*`/`addHeader*` families, `addTo/addCc/addBcc`, `genUuid()`, `validate()` |
| `EmailAddress` | `{name, address}` |
| `MessageBodyText`, `MessageBodyHtml`, `MessageBodyData` | body parts; string content is UTF-8 encoded for you |
| `MessageAttachment` | `{name, type, blobs, contentId}`; the bytes go in `blobs`, and a string is NOT encoded for you (see soba.mail) |
| `Blob`, `BlobTransform*` | blob descriptors (id, sizes, digests, transforms); `Blob.MAX_SIZE` is 1 GiB; digest ids Sha1=1, Sha224=2, Sha256=3, Sha512=4, Sha384=5 |
| `NamedDigest` | `{algo, value}` |
| `NotFoundError`, `BlobDataReadError` | thrown by `soba.data.find` and blob reads |
| `namespace` | the base namespace string |

Note the incoming `message.from` shape in the responder tutorial is array-of-pairs
(`message.from[0][0]` name, `[0][1]` address) while outgoing uses `{name, address}`
objects; Base.mjs setters accept both.

## Special values

`ArrayBuffer (Tagged)`: returned by `soba.data.*` as a mutation handle. Pass it back
to `delete`/`update` as `parent`. Any ArrayBuffer is accepted there, but a tagged one
is what establishes the causal link.

## soba.app

| call | returns | notes |
|---|---|---|
| `soba.app.account()` [NR] | `String` | this mailbox's email address |
| `soba.app.instanceId()` | `String` | base32hex uuid of the instance |
| `soba.app.isReplicated()` | `Boolean` | true while running a replicated object |
| `soba.app.objectKey()` | `String` | the key of the object being processed |
| `soba.app.peers()` [NR] | `String[]` | addresses sharing this instance |
| `soba.app.replicaUuid()` [NR] | `String` | braced uuid of this replica, as the event stream's `replica` names it; the nil uuid, unbraced, on a store without one (wire-and-ui.md) |

## soba.data

Deterministic data layer; the only writes allowed in replicated handlers.

- `soba.data.insert(table, data)` where `data` maps column to
  `String|Number|ArrayBuffer|null` (an instance with matching fields works). **Never a
  boolean**: it throws `Boolean types are not supported`; store flags as 1/0. Returns
  `{hash}`; `inserted`/`applied` are reserved, do not rely on them. Passing an
  instance of the insert event is the common shortcut (`soba.data.insert("person", this)`).
- `soba.data.find(table, object)`: `object` holds exactly the columns of one lww
  constraint (all of them, any order), so that it matches one row; a partial key is
  refused. Returns the live row's
  `{object: Record, hash: ArrayBuffer (Tagged), deleted: Boolean}`. Deterministic,
  allowed when replicated. When no matching insert ever existed it throws, and every
  later `soba.data.*` call in the same pass fails ("Execution was aborted
  previously"): check with `soba.db.exec` first where you can.
- `soba.data.findLast(table, object)` [NR]: same shape, the latest match.
- `soba.data.delete(table, hash)`: emits a `DeleteRow` mutation that depends on the
  insert named by `hash`.
- `soba.data.update(table, {parent, column, op, value}, extra)`: commutative ops only
  (`"+"`, `"*"`); `extra` fields are merged into the mutation but not written to the
  table. Use `extra: {uuid: soba.type.uuid.v4()}` from a non-replicated handler to
  defeat deduplication of identical updates.

## soba.schema

`soba.schema.table(defn)`: callable only from the Mutator constructor.

```
defn = {
  name: String,
  insertEvent: Class,          // the table is identified by this object's KEY
  deleteEvent: DeleteRow,      // required, always the base module's DeleteRow
  columns: [{name, checks: [{op, value?, table?, column?}]}],
  checks:  [{op: "lww", columns: [..], value: true} | {op: "fk", table, columns: {local: remote}}],
}
```

The check operators, the lww semantics and the generated table shape are under
Declaring tables in app-anatomy.md.

## soba.db

`soba.db.exec(query, ...params)` [NR]: read-only SQLite. `?` placeholders only.
Params: `null|true|false|Number|String|ArrayBuffer` (booleans are fine here: nothing
is persisted). Returns `{code: Number, data: any[][]}`, `code` 0 on success. Table
names are the declared ones; runtime tables start with `_soba_`. Declared columns have
`text` affinity, so a stored number reads back as a string: a flag stored as 0 comes
back `"0"`, which is truthy. The SQLite (3.53.3) has the JSON functions built in
(`json_each`, `json_group_array`). `exec` reads its own snapshot: a row that
`soba.data.delete` removed earlier in the same pass is still visible to it.

## soba.task

- `soba.task.emit(object)`: persistent response to the current event (a task the
  runtime delivers back, also to other apps). No-op in replicated context.
- `soba.task.respond(object)`: ephemeral response, what the UI receives for its
  request. No-op in replicated context.

`object` must be msgpack-serializable; a class instance with a static KEY is
serialized as SMC with its namespace and name, so the UI can switch on `name`. It must
hold no boolean anywhere, nested objects included: the runtime throws `Boolean types
are not supported`. Flags are 1/0.

## soba.mail

`soba.mail.send(message: Message)` [NR].

A message with an attachment:

```js
const message = new Message();
message.genUuid();                                  // else the all-zero uuid
message.from = [ {address : soba.app.account()} ];
message.to = addresses.map((address) => ({address}));
message.subject = subject;                          // a non-empty String
message.bodyText = text;                            // a String is encoded for you
message.attachments = [ new MessageAttachment({
    name : "notes.txt",
    type : "text/plain",
    blobs : [ soba.text.encode(notes).buffer ],     // raw ArrayBuffer: NOT encoded for you
}) ];
soba.mail.send(message);
```

There is no `addAttachment`: assign the array. Keep blobs raw ArrayBuffers: a string
blob becomes an invalid `Blob`, and `Blob.toMsgpack`'s inline branch calls
`new Uint8Array.from(...)`, which throws. A module that the UI bundles too can't
import the base module, so have the Mutator pass `Message` and `MessageAttachment`
to the object's `process()`.

## soba.log

`soba.log.debug|info|warning|error(message: String)`.

## soba.pack, soba.text, soba.binary

- `soba.pack.msgpack(object)` returns a raw ArrayBuffer. Encoding is insertion-order
  sensitive, so `{a,b}` and `{b,a}` hash differently; numeric-string keys sort first.
- `soba.text.encode(string)` returns the UTF-8 bytes as a typed array: take `.buffer`
  for an ArrayBuffer, as Base.mjs does. `soba.text.decode(buffer)` goes back.
- `soba.binary.equals(a, b)`, `soba.binary.b64Encode(buffer)` (standard base64 with
  padding, not url-safe), `soba.binary.b64Decode(string)`.

## soba.blob

`soba.blob.create(data: ArrayBuffer)` returns a `Blob` whose id is derived from the
content and matches `soba.type.blobId.pattern`. There is no runtime call to read a
blob back by id yet.

## soba.clock

- `soba.clock.logical.id()` [NR] returns a String; `soba.clock.logical.digest()` [NR]
  returns a tagged ArrayBuffer summarizing this replica's causal frontier. Usable as a
  dependency handle but coarse: it can stall convergence on replicas that are behind.
  Prefer a specific handle from `find()`.
- `soba.clock.physical.secs()|msecs()|usecs()` [NR].

## soba.platform

`soba.platform.isTest()`, `soba.platform.releaseChannel()` (`"Stable"` in production),
`soba.platform.version()` [NR] (array of integers).

## soba.type

- `soba.type.{uuid,address,blobId,domainName,userName,folderName,namespace}.pattern`:
  regex source strings for `regexp` checks and `new RegExp(...)`.
- `soba.type.{blobId,userName,domainName,folderName}.isValid(s)`: pure validators.
  `isValid` is not implemented for uuid, address and namespace; use `.pattern`.
- `soba.type.uuid.v4()` [NR]: braced uuid string.
