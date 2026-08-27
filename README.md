# SayPay

> Say what you want to do with money. Review the exact plan. Confirm securely.

A natural-language payment mini-app for Nimiq Pay. You describe an intent ("send 50 USDC to Alice tomorrow if ETH is above $3000") and SayPay parses it into a concrete, reviewable plan before any money moves.

## What it does

- Natural language to payment plan: describe intent, get structured plan
- Human-in-the-loop: confirm the plan before signing
- Conditions: supports time, price, and event triggers
- Nimiq Pay rails for instant, feeless settlement

## Stack

- HTML / JS (frontend)
- Nimiq Pay API
- Plain text intent parsing (no LLM dependency for safety)

## Demo

Demo link: TBD

## Status

- Hackathon prototype
- Intent parser functional
- Not production-deployed

## Use case

Anyone who wants to send money but does not want to fill out forms, set up conditions manually, or risk sending to the wrong address.

Built for Nimiq Pay ecosystem.
