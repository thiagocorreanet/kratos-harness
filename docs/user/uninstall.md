# Uninstall and state preservation

Uninstalling a host package and deleting project state are separate decisions.
The atomic installer removes only the selected host package and its retained
rollback version.

Before uninstalling:

1. Run `kratos audit` and resolve any integrity failure.
2. Export an evidence bundle if the trail must remain independently reviewable.
3. Back up `.brain`, `AGENTS.md`, `.claude`, and `.codex` according to project
   retention policy.
4. Record the installed package version and checksum.

Remove the package with the installer `uninstall` operation. Keep `.brain` by
default. Managed host sections may be removed only after reviewing the diff;
unmanaged user content must remain byte-for-byte unchanged.

Delete preserved state only through the project's normal retention process.
Kratos never performs automatic legacy cleanup or recursive state deletion.
