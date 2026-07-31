# SayPay

A multilingual, natural-language payment mini app for
[Nimiq Pay](https://nimiq.dev/mini-apps/).

> Say what you want to do with money. Review the exact plan. Confirm securely.

Most crypto payment flows ask you to think like a wallet: pick a network, paste
an address, count decimal places. SayPay asks you to say what you want.

The interpreter never moves funds, never chooses a recipient, and never resolves
a wallet address. It turns a sentence into a transparent, editable plan. Every
transfer is executed by Nimiq Pay's own confirmation dialog, which a mini app
cannot bypass.

## What works today

| Flow | State |
| --- | --- |
| Send NIM | Real payments through native confirmation |
| Payment requests and invoices | Created, shareable, settled in-app |
| Split a bill | Participants pay their own share |
| SayPay IDs (`@ada`) | Signed profiles resolving to wallet addresses |
| Inbox and activity | Requests, invitations, receipts |
| Natural-language input | Wired to the interpreter, **parse quality not yet verified** |
| Protected Pay | Escrow adapter written; no UI yet |

## How it fits together

```
app/
  page.tsx                  the app: onboarding, composer, review, inbox
  api/
    intent/route.ts         sentence -> validated payment plan
    _lib/intent-schema.ts   the intent contract and its guards
    _lib/auth.ts            session handling
    profile, contacts, requests, splits, activity
  _lib/
    units.ts                NIM <-> Luna, address validation
    htlc.ts                 Protected Pay on the NIM rail
db/schema.ts                profiles, contacts, requests, splits, activity
```

### The intent boundary

The model has exactly one job: turn a sentence into a `ParsedIntent`. It is
treated as untrusted input at every step.

- **It never sees a wallet address.** Contact *nicknames* are read server-side
  from the signed-in user's own contacts. Addresses stay in the database, so the
  model cannot leak or fabricate one.
- **It never resolves identity.** `recipientHint` is whatever the user said,
  copied verbatim. SayPay IDs are extracted by regex, not by the model — a
  handle is an exact token that resolves to a wallet, so a near-miss is worse
  than no match.
- **Guards outrank confidence.** If the amount, recipient, or split participants
  are missing, the plan is downgraded to a clarifying question no matter how
  certain the model claimed to be.
- **Output is re-validated after generation.** Schema conformance is not the
  same thing as being safe to act on.
- **User text is framed as data, never instructions.**

If the interpreter is unreachable, or the user has not verified their SayPay ID,
the original keyword-and-regex parser takes over. Typing a payment never stops
working.

### Amounts

The Nimiq provider takes **Lunas**: `1 NIM = 100_000 Luna`. Route conversions
through `app/_lib/units.ts` rather than inlining the multiplier — the difference
between a right and wrong factor here is five orders of magnitude.

### Protected Pay

Escrow targets Nimiq HTLCs, which offer three resolution paths: redeem with a
preimage, cooperative early release where both parties co-sign, and refund to
the sender after a timeout block.

**These five HTLC methods are not in the published `@nimiq/mini-app-sdk`
typings.** They exist on an unmerged branch of Nimiq's provider fork, so
`app/_lib/htlc.ts` feature-detects at runtime and reports what the host actually
exposes. Where HTLC is unavailable, the fallback rail is USDT on Polygon, which
works today but requires the user to hold POL for gas.

There is no on-chain arbiter vote. Arbiters act off-chain by releasing the
preimage or co-signing. The UI must say so plainly rather than implying the
chain enforces their decision.

## Running it

Requires Node `>=22.13.0`.

```bash
npm install
npm run dev
```

Create `.dev.vars` for local secrets (gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
```

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Talk to Anthropic directly |
| *(none)* | Fall through to a gateway-style model string |
| `SAYPAY_MODEL` | Override the model (default `claude-sonnet-5`) |

Secrets are read from the Cloudflare Workers binding, falling back to
`process.env` for local tooling. `process.env` does not exist in the Workers
runtime, so never read it directly.

### Testing inside Nimiq Pay

A mini app needs a public HTTPS origin. `localhost` and `http://192.168.x.x`
both fail, and the LAN address fails misleadingly, because `getUserMedia`
requires a secure context and will error for the wrong reason.

```
nimiqpay://miniapp?url=<your-https-host>
```

### The parse suite

```bash
SAYPAY_TOKEN=<session token> npm run test:parse
```

Twelve cases covering what a stranger actually types: missing amounts,
multilingual input, asset defaulting, literal addresses that must be copied
rather than repaired, unknown names that must not become fabricated addresses,
and a prompt-injection attempt that must be treated as data.

`/api/intent` requires a session like every other route. After signing in, copy
the token from DevTools → Application → Local Storage → `saypay-session:<WALLET>`.

## Platform notes

Runs on [vinext](https://github.com/cloudflare/vinext) on Cloudflare Workers
with D1 and Drizzle. There is no `wrangler.jsonc`; `.openai/hosting.json`
declares the bindings and `vite.config.ts` simulates them locally.

- `npm run build` — verify the build output
- `npm test` — build and check the rendered skeleton
- `npm run db:generate` — regenerate Drizzle migrations after schema changes

## Known gaps

- Parse quality is unverified — no model call has succeeded yet.
- `app/page.tsx` has unhandled `ErrorResponse` unions from the Nimiq SDK.
- `cloudflare:workers` types are unresolved repo-wide, including `db/index.ts`.
- `globals.css` styles `.review-layer`, `.review-sheet` and `.flow-invoice`,
  which no markup uses yet.

## License

MIT — see [LICENSE](./LICENSE).
