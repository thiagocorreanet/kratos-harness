# Member removal requirements

## Purpose

Let an administrator remove a member from a workspace.

## Rules

1. Only a workspace administrator may remove a member.
2. An administrator cannot remove the last remaining administrator.
3. Removing a member ends their sessions for that workspace within one minute.
4. Content the removed member created stays in the workspace and keeps their
   name.
5. Work assigned to the removed member becomes unassigned, and the workspace
   administrators receive one notification listing it.
6. A removed member may be invited again, and the new membership starts empty.

## Dependencies

None beyond the existing membership and session stores.

## Out of scope

Deleting a member account across every workspace.
