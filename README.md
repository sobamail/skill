# sobamail-app

A [Claude Code](https://claude.com/claude-code) skill for building, extending and
debugging [Sobamail](https://sobamail.com/) apps: `Mutator.mjs` backends running in
the soba runtime, their `sobamail.com/module/*/v1.mjs` object modules, and the Svelte
UIs that talk to them over `/api/v2/object`.

## Install

Clone this repository into a skills directory and keep the folder name `sobamail-app`:

```sh
# for every project
git clone <this repo> ~/.claude/skills/sobamail-app

# or for one project
git clone <this repo> <project>/.claude/skills/sobamail-app
```

Claude Code picks it up on the next session. The skill triggers on its own when the
task mentions a Mutator, the `soba` global, object keys, structured messages, the
mutation log and similar; `/sobamail-app` loads it by hand.

## Contents

| path | what it is |
|---|---|
| `SKILL.md` | how a click flows from the UI to every replica, the recipe for any backend change, the replicated vs non-replicated rule, mail-driven apps, UI and wire format, debugging, dev and deploy |
| `references/app-anatomy.md` | copyable shapes: Mutator statics, modules and namespaces, object classes, the two registration maps, table declarations and every check operator, dispatch, request/response pairs, deletes, the shared-app sender and gating rules |
| `references/runtime-api.md` | every `soba.*` call with signature and non-deterministic markers, plus the base module exports |
| `references/platform-concepts.md` | vocabulary: mailbox, replica, app, instance, mode, computer, object key, mutation graph, system apps |
| `references/wire-and-ui.md` | the SMC key table, the single endpoint, the shared `Response.ts`, the Svelte component pattern, the Vite devel build |
| `references/dev-and-deploy.md` | developer mode, the tutorial sequence, hashes, deployment, where instance data lives |
| `references/mutlog.md` | the `_soba_mut1` mutation log and its bookkeeping tables, column by column |
| `scripts/mutlog.py` | lists instances from a profile's `apps.db` and prints an instance's mutation log decoded (read-only) |
| `scripts/gen-hash.py` | prints the `?sha224=` import pin of a module file |

## Scripts

Both need Python 3. `mutlog.py` decodes payloads with the `msgpack` package when it is
installed and prints hex otherwise.

```sh
python3 scripts/mutlog.py ~/.local/share/Soba/<profile>/m-<id>            # list instances
python3 scripts/mutlog.py <profile> --app contacts.app.sobamail.com --summary
python3 scripts/mutlog.py <profile> --app contacts.app.sobamail.com --tail --limit 20 --parents
python3 scripts/gen-hash.py sobamail.com/module/myapp/v1.mjs
```

## License

BSD 3-Clause, see `LICENSE`.

## Sources

Distilled from the Sobamail developer documentation, the runtime's skeleton and base
module, the open-source Contacts, Calendar and Mailbox Manager apps, and live
instance databases. Where a mutation-log column meaning is
inferred rather than documented, `references/mutlog.md` says so.

Example apps to read alongside this skill:

- Runtime skeleton and base module: https://github.com/sobamail/base
- Mailbox Manager: https://github.com/sobamail/mbmgr
- Contacts (address book): https://github.com/sobamail/contacts
- Calendar: https://github.com/sobamail/calendar
