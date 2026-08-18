# Sign-in requirements

## Purpose

Let a member sign in to the workspace from a browser or the mobile client.

## Rules

1. A member signs in with an email address and a password.
2. A member may instead sign in through the company directory or through the
   public identity provider. Both routes create the same session.
3. When the same email address exists in the directory and in the public
   identity provider, the two accounts belong to one member.
4. A member with two-factor authentication enabled receives a one-time code
   by text message and enters it within five minutes.
5. Three failed attempts in ten minutes lock the account for one hour.

## Delivery

The one-time code is delivered through an external text message service. The
requirement assumes that service can deliver to every country the product is
sold in.

## Out of scope

Single sign-on administration screens.
