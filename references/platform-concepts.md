# Platform concepts and vocabulary

From the Sobamail developer docs (concepts, intro, dev environment) and the user
manual. Use the docs' own words when talking to the app's owner.

**Sobamail.** A normal email system (SMTP, IMAP, POP3, webmail) with an
application platform built on top. Apps are not web services: they have no server
anyone calls, only a Mutator that wakes up for events.

**Mailbox.** "Your mailbox is your database, and apps live inside it." One mailbox
per user, identified by the email address, and it is that user's one and only data
store. It holds the folder tree of message threads, the application instances (each
keeping its data in its own folder alongside the email archive), and blobs
(immutable data up to 1 GB each).

**Replica.** One copy of the mailbox per device, plus the one on the Sobamail
servers. Identified by a UUIDv4 (`soba.app.replicaUuid()`). Replicas converge by
shipping mutations to each other; one that was offline catches up automatically in
the background when it comes back. Within one mailbox an optimized real-time
protocol is used, through the Sobamail cloud or peer-to-peer over the local network.
The protocol is also email-compatible: an event can travel as a structured message,
an ordinary email with a machine-readable attachment.

**App.** Two pieces: a **Mutator** (the backend module, reacts to events) and a
**UI** (regular HTML/CSS/JS, shipped as a zip of `assets/`). Identified by an
**application id** shaped like a domain name. A user `alice@example.com` controls
`alice.user.app.example.com` and all its subdomains, so a personal app is
`tutorial1.alice.user.app.example.com`. The id cannot change after publishing.

**Instance.** An app must be instantiated to hold data. The instance id is a UUIDv4
encoded as base32hex (26 chars; a system app's is longer, 28 in the profiles seen) and
names the folder where the instance's data lives
(`apps/data/<first two chars>/<rest>/`). Each instance has an independent data store
per replica. Modes: **developer** (a single local instance, no replication, a
stale import pin is logged instead of thrown),
**private** (synced across the mailbox's replicas), **shared** (synced across several
mailboxes; collaborators can be added or removed later). No data sharing between
instances yet.

**Computer.** The versioned runtime an app targets. Only **Replicated-2** exists,
selected by `import "soba://computer/R2";` as the first import. Still experimental.

**Event, object, object key.** Apps are reactive: they run only when an event
arrives. Every event is an object identified by a key in Clark notation
`{namespace}Name`, braces included; the namespace follows the XML Namespaces rules
and Name is a valid JS class name. Every event is ultimately an email message;
clicking a button in an app sends a barebones one to the backend. Two base kinds:
`{...base/v1}Message` (a regular
email) and `{...base/v1}SMessage` (a structured message: an email whose
`Message-Structure` header points at the attachment carrying the SMC). Incoming
email is broadcast to every app; an app subscribes by listing keys in `objects`.
UI requests are delivered to the backend the same way, locally.

**Mutation, mutation graph.** App state is a log of mutations. A replicated event's
handler is a mutation: SMC serialized as msgpack, hashed, placed in a DAG with
happens-before edges to the inserts it depends on (fk targets, lww predecessors, the
row a delete removes). Content-addressed and deduplicated: byte-identical mutations
collapse. Processing one yields INSERT or DELETE on app tables plus runtime
bookkeeping in tables whose names start with `_`. UPDATE exists only for commutative
operations. Mutations are replayed by the exact app version that produced them; old
Mutator versions are kept as long as an instance holds their mutations. An instance
has a **primary version** that produces new mutations.

**Schema.** Declared with `soba.schema.table()` in the constructor. "Every Sobamail
table is identified by the object key of its insertEvent." Backward compatibility
of the schema across versions is the developer's job; divergence prevention is work
in progress.

**Modules and namespaces.** By convention events live in a separate module whose
namespace is a versioned URI (`https://sobamail.com/module/contacts/v1`). In dev
mode modules resolve by path derived from the namespace, relative to the develroot
(`sobamail.com/module/contacts/v1.mjs` next to `Mutator.mjs`). Every module declares
`export const namespace = "..."` equal to its import URL minus the query string.

**Structured Message Content (SMC).** The self-describing envelope
`{namespace, name, content}` (pretty, JSON) or `{0, 1, 3}` (compact, msgpack) that
every object travels in. See wire-and-ui.md.

**System apps.** The **Application Manager** (app lifetime: modules, assets,
instances, deploy), the **Mailbox Manager** (folders, messages and their metadata)
and the **Certificate Manager** are ordinary Sobamail apps. Only their deployment
differs: one private instance per mailbox, not deletable.

**Accounts and roles.** `soba.app.account()` is the mailbox address,
`soba.app.peers()` the collaborators on a shared instance. Roles and permissions are
app-level logic, not a runtime feature.
