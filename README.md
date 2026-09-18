# SayPay

> Ask understands. You organizes. Confirm in Nimiq Pay.

A work-money Mini App for [Nimiq Pay](https://nimiq.dev/mini-apps/). Type or upload in **Ask**. Gemini files tasks, reminders, and receipts in **You**. **Work** is jobs, timers, invoices, and optional two-party escrow. **Chat** is request-gated and encrypted. **Only the wallet moves NIM.** There is no simulated balance, no fake transaction, and no second rail.

**Live:** https://saypay-payment-assistant.emerxch.workers.dev

Open it **inside Nimiq Pay**. In a normal browser, SayPay detects iPhone vs Android and sends you to the App Store, Play Store, or a chooser. Deeplink: `https://nimpay.app/miniapps/open/<host>`.

## What is live

| Capability | How it is real |
|---|---|
| Identity | Nimiq Pay `sign()` of a one-time challenge; Ed25519 verify on Workers; session bound to the derived address |
| NIM send | `sendBasicTransaction` / `sendBasicTransactionWithData` in the host wallet |
| Settlement | Server looks the tx up on Nimiq JSON-RPC (`from`, `to`, `value`) before writing `payments` |
| Balance | Live NIM from `getAccountByAddress`, shown in the header, Work, and You. Not a simulated ledger |
| Browser gate | If you open SayPay outside Nimiq Pay, it detects iPhone vs Android and offers App Store, Play Store, or a chooser. Deeplink: `https://nimpay.app/miniapps/open/<host>` |
| Work home | Owed / owe / due today / overdue. Jobs (stages, invoice by default). Escrow optional. |
| Jobs | Named work with stages on Work. No separate Jobs tab. Invoice a stage, or escrow it if you need protection. |
| Work escrow | Each party names one escrow. If those two disagree, SayPay AI recommends release or refund. **NIM still only moves with HTLC or a signed payment.** |
| Chat | Encrypted messages between two SayPay IDs. Ciphertext in D1; keys stay on device, wrapped with a Nimiq Pay signature |
| Invoices | Numbered (`SAY-2026-001`), line items, due date, shareable page, paid stamp + tx hash after on-chain confirm |
| Time | One running timer per wallet; stop or invoice duration × hourly rate as a real invoice |
| Splits | Shareable UUID pages; payer signs a real NIM transfer; server confirms it |
| Scheduled send | Reminder only. Cron marks `due`. User still signs in Nimiq Pay; server confirms the tx |
| Jobs | Terms + arbiters in D1. **Locking NIM requires HTLC methods on the host.** If they are missing, pay the stage or invoice it — never a fake escrow |
| Voice | Web Speech API transcription. If the WebView cannot transcribe, the mic is disabled |
| Ask | Type or upload. Gemini (`GEMINI_API_KEY`) classifies and files receipts/notes. **Money always needs a confirm card, then Nimiq Pay.** Local parser if no key. |

SayPay does **not** pay USDT or Polygon. If you say `$` or `USDT`, it asks for a NIM amount.

## Stack

- Next.js (vinext) on Cloudflare Workers + D1
- `@nimiq/mini-app-sdk` for signing and sending
- Nimiq JSON-RPC for reads and confirmation
- Gemini (`GEMINI_API_KEY`) for Ask. Local parser if the key is missing.
- Optional `ANTHROPIC_API_KEY` for the legacy `/api/intent` route

## Setup

Node 22.13+.

```bash
npm install
cp .env.example .dev.vars   # then fill secrets
npm run dev
```

Open the mini-app **inside Nimiq Pay**. Browser-only mode can claim nothing and send nothing, because there is no wallet.

### Database

```bash
npm run db:migrate:remote
```

Applies `drizzle/` to the `saypay-production` D1 database, including `0004_production_hardening.sql` (payments, event log, verified contacts, HTLC fields).

### Secrets (Wrangler / `.dev.vars`)

See `.env.example`. Without `ANTHROPIC_API_KEY` the local parser still runs. Without `CRON_SECRET`, `POST /api/schedules/due` is 404; the Worker cron trigger still marks due schedules.

### Tests

```bash
npm test              # units, intent parser, signature framing
npm run test:parse    # the stranger-input suite
npm run test:signature -- http://localhost:3000   # needs D1 + RPC
SAYPAY_LIVE=1 npm run test:live                   # live Worker health + auth gates
```

## API surface

Authenticated routes take `Authorization: Bearer <session>`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | RPC + D1 probe |
| POST | `/api/auth/challenge` | Start SayPay ID claim |
| POST | `/api/auth/verify` | Check signature, mint session |
| GET | `/api/balance` | Live NIM (+ USD if CoinGecko answers) |
| GET/POST/DELETE | `/api/contacts` | `verified: true` required to save |
| POST | `/api/ask` | Type or upload → Gemini classify/file. Money is a confirmable plan, never sent |
| POST | `/api/intent` | Utterance → plan. Never sends |
| GET | `/api/records` | What Ask filed under Work or You |
| GET/POST | `/api/payments` | POST only after a wallet result; confirms on-chain |
| GET | `/api/activity` | Derived from confirmed events |
| GET | `/api/work` | Owed / owe / due / overdue + running timer |
| GET/POST/PATCH | `/api/jobs` | Jobs with stages. Invoice is default; escrow is opt-in |
| GET/POST/PATCH | `/api/escrows` | Work escrow. Votes never move NIM |
| GET/PUT | `/api/chat/keys` | Own wrapped chat key; public key by handle |
| GET/POST | `/api/chat/conversations` | Threads between SayPay IDs |
| GET/POST | `/api/time` | Start / stop / invoice a timer |
| GET/POST/PATCH | `/api/requests`, `/api/splits`, `/api/schedules`, `/api/deals` | Same confirmation rule |

Unsigned `POST /api/auth/link` is gone (410). Client-reported activity is gone (410).

## Safety

- No private keys in this app. The host wallet signs.
- The model never sees or returns wallet addresses.
- Demo names/addresses are not in the product UI.
- Arbiter votes do not move NIM. A funded HTLC is released or refunded only by a wallet transaction.

## Deploy

```bash
npm run db:migrate:remote
npm run deploy
```
