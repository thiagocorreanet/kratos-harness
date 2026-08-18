# Password reset requirements

## Purpose

Let a member who forgot their password sign in again.

## Rules

1. A member requests a reset by submitting the email address on their account.
2. The system sends a reset link to that address whether or not an account
   exists, and the response text is identical in both cases.
3. A reset link is valid for 60 minutes from the moment it is sent.
4. Using a reset link consumes it; a second use is refused.
5. A completed reset ends every other active session for that member.
6. The support team cannot read or set a member password.

## Dependencies

Reset messages are sent through the transactional email service already used
for receipts, under the contract signed on 2026-02-10.

## Out of scope

Password strength rules, which are specified in the account security document.
