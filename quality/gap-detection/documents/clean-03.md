# Export queue requirements

## Purpose

Let a member download a large export without blocking the browser.

## Rules

1. A member starts an export and receives a job identifier immediately.
2. The system processes one export per workspace at a time, in the order the
   jobs were started.
3. A finished export is available for download for 7 days, measured from the
   time the job finished.
4. An expired export file is deleted and the job is marked expired.
5. A member may cancel their own queued export; a running export runs to
   completion.
6. A failed export records the failure reason and may be started again.

## Dependencies

Files are stored in the object store the product already uses for uploads.

## Out of scope

Scheduled exports.
