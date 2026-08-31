# Atomic plugin installation

`scripts/install-plugin.mjs` installs or updates one temporary Kratos host
package through a sibling staging directory. It verifies the source manifest,
embedded core digest, runtime source-tree digest, and host-assets digest before
publication. An existing target is renamed to one rollback backup, then the
verified staging directory is renamed into place.

Every operation requires the host explicitly:

```bash
node scripts/install-plugin.mjs install \
  --host codex \
  --source /absolute/temporary/path/kratos-plugin-build \
  --target /absolute/host/plugin/directory/kratos
node scripts/install-plugin.mjs update \
  --host codex \
  --source /absolute/temporary/path/new-kratos-plugin-build \
  --target /absolute/host/plugin/directory/kratos
node scripts/install-plugin.mjs rollback \
  --host codex \
  --target /absolute/host/plugin/directory/kratos
node scripts/install-plugin.mjs commit \
  --host codex \
  --target /absolute/host/plugin/directory/kratos
node scripts/install-plugin.mjs uninstall \
  --host codex \
  --target /absolute/host/plugin/directory/kratos
```

The `--source` directory contains the `codex/`, `claude-code/`, and `antigravity/` packages;
only the package selected by `--host` is installed. An update refuses while an
earlier rollback backup exists. `commit` removes that backup only after the
operator accepts the installed version. `rollback` keeps the rejected version
in a `.failed` quarantine. `uninstall` renames the installation into an
`.uninstalled` quarantine instead of deleting project state. None of these
operations touches a project's `.brain` directory.
