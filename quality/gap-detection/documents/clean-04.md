# Audit log requirements

## Purpose

Record who changed what, so an administrator can answer a question later.

## Rules

1. Every change to a workspace setting writes one audit entry.
2. An entry records the member who made the change, the setting, the previous
   value, the new value, and the time in UTC.
3. Audit entries are append-only and cannot be edited or deleted through the
   product.
4. Only workspace administrators may read the audit log.
5. Entries are kept for 24 months and then deleted.
6. An administrator may export the log for one date range as a file.

## Dependencies

None beyond the existing settings store.

## Out of scope

Audit entries for content changes, which are covered by the version history
document.
