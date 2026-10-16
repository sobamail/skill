# Dev environment, tutorial sequence, deployment

From the Sobamail developer docs (dev environment, counter tutorial, responder
tutorial, deployment) plus the conventions of the reference apps.

## Dev mode

- In Sobamail: Apps folder, Application Manager, "Instantiate In Dev Mode", enter
  the app id (`<name>.<user>.user.app.<domain>`) and a name, Submit. Click the
  instance under Apps to open its UI.
- The Hello page shows the **develroot**, e.g.
  `apps/devel/<appid>` under the profile folder. It contains `GITINIT.md`,
  `Mutator.mjs`, `README.md`, `assets/index.html`. `Mutator.mjs` and
  `assets/index.html` are hardcoded entry points.
- Dev mode: single local instance, no replication, a stale import pin is logged
  instead of thrown (see Hashes), modules resolve from the develroot by
  namespace-derived path.
- After editing `static objects`: Application Manager, Instances, select the
  instance (devmode icon), "Reload Objects".

## Starting a new app (the tutorial sequence)

1. Instantiate in dev mode (above). The Application Manager writes the skeleton
   `Mutator.mjs` and `assets/index.html` into the develroot; start from those and
   never write a skeleton yourself.
2. `git init -b main`, commit `Mutator.mjs` before editing (the skeleton's header
   says so).
3. UI: `pnpm create vite ui --template svelte-ts`, `rm -rf assets`,
   `echo /assets > .gitignore`, add `ui/vite.config.devel.ts` and the `dev-watch`
   script (see wire-and-ui.md), `pnpm i`, `pnpm add @msgpack/msgpack`,
   `pnpm run dev-watch`. Reload the app in Sobamail after each build.
4. Create the model module `sobamail.com/module/<name>/v1.mjs` (or any URL-shaped
   path you own) with `export const namespace = "https://..."` and the event classes.
5. Declare tables in the constructor; register keys in `objects` (and `handlers`).
6. Implement `process()`: extract, dispatch, respond.
7. For a mail-driven app add `[Message.KEY, false]`, build a reply `Message` and
   `soba.mail.send` it from the non-replicated handler.

## Conventions

- Each `ui/` is a pnpm project of its own; the backend (`Mutator.mjs` and everything
  it imports) has no package manager.
- `assets/` is build output from `pnpm run dev-watch`; leave it out of reviews and
  diffs.

## Hashes

Every `?sha224=` pin is the SHA-224 of the imported module file, as url-safe base64
without padding or as base32hex. Keeping pins current is the app developer's job;
the runtime never rewrites an import.

- When you change a module, run `scripts/gen-hash.py <file>` and put the value into
  every import of it, in the encoding that import already uses. A pin is part of
  the importer's content, so the importer's own hash changes too: work from the
  leaf modules up to `Mutator.mjs`.
- In developer mode a missing or stale pin only logs a warning, one per import. The
  URL after "must be:" is the other way to get the value. Never guess a hash.

  ```
  W| Module 'https://sobamail.com/module/calendar/v1' import URL must be: https://sobamail.com/module/calendar/v1?sha224=<hash>
  ```

- Deploying with a stale pin fails, with the same message.
- In review, pin churn is expected noise, but a module change without the matching
  pin updates is a defect.

## Deployment ("freezing")

1. Stop `dev-watch`; in `ui/` run `pnpm run build` (release build into `assets/`).
2. Application Manager, Instances, select the dev-mode instance, Deploy. The runtime
   builds an `{https://sobamail.com/module/appmanager/v1}AppInfo` object with the
   digests of every component (root module, imports, assets, icon) and stores it in
   the Application Manager's `appinfo` table; modules are copied into the shared
   `apps/code/` store, assets into `apps/assets/<digest>/`.
3. The app appears under "Known Apps"; instantiate it (private or shared) to get a
   data store. Unlimited instances.

Deploy fails when: an import pin is stale (see Hashes), the `version` is not greater than every deployed version of the app id, or the
Mutator `id` differs from the id on the Instances screen.

## Instance data on disk

```
<profile>/apps.db                      instances(instid, owner, appid, appname, rhash, ahash, mode)
<profile>/apps/data/XX/YYYY.../main.db one SQLite database per instance: app tables + _soba_* log
<profile>/apps/code/XX/<digest>.mjs    content-addressed deployed modules
<profile>/apps/assets/XX/<digest>/     deployed UI bundles
```

`XX` is the first two characters of the instance id or digest. See mutlog.md for
the log tables and `scripts/mutlog.py` to read them.
