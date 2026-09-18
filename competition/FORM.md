# Cycle II submit pack — SayPay

Deadline: **18 September 2026, 23:59 UTC**. After that, Cycle III opens 5 October.

Submit at https://miniappscompetition.com/submit  
Sign in with GitHub. The form opens a PR to `nimiq/miniappscompetition-submissions` under `cycle2/<your-github-login>/`.

The `/submit` page itself is an auth wall (“Checking your submission status…”). Requirements below are from the official rules, FAQ, scoring page, and the submissions CI schema (`scripts/lib/schema.mjs`).

## Paste into the form

| Field | Value | Notes |
|---|---|---|
| App name | SayPay | max 80 |
| Category | **Productivity** | Must be this exact enum |
| Tagline | Ask understands. You organizes. Confirm in Nimiq Pay. | 53 / 120 chars |
| Description | See `submission.yaml` | **280 characters max**, not 250 words. The rules page says 250 words; CI will reject anything over 280 chars. |
| Pricing | Free | |
| Repo | https://github.com/emer-eth/saypay | Must stay public + MIT |
| Demo | https://saypay-payment-assistant.emerxch.workers.dev | Must return HTTP 200 |
| Video | **You must upload `saypay-demo.mp4` to YouTube, Loom, Vimeo, or an X post and paste the URL** | CI requires `video_url`. Rules say optional; the validator does not. |
| Contact email | **your email** | Required |
| Team name | leave empty unless you want one | optional |
| Team members | leave empty for solo | max 5 |
| X account | **your X handle, no @** | optional but scores marketing |
| Builder story | See `submission.yaml` | max 4000 chars |
| Skool post | paste after you post | optional, scores the 5-pt promotion checklist |
| Social post | paste X/LinkedIn URL | optional |
| Heard about | pick from the form | required on many entries |
| Icon | `icon.png` | png/jpg/webp, ≤2 MB |
| Thumbnail | `thumbnail.png` | png/jpg/webp/gif, ≤2 MB |
| Screenshots | `screenshot-1.png` … `screenshot-5.png` | 3–5 required, ≤2 MB each, 14 MB total |
| GitHub login | whatever account you sign the form with | folder name must match |

Payout Nimiq wallet is required by the rules. It is **not** a field on `submission.yaml`. Have a wallet at https://wallet.nimiq.com ready for winner KYC/payout.

## Images in this folder

Upload these five screenshots plus icon and thumbnail. They match the live product UI (Inter, one blue hue, Ask / Work / Chat / You). Signed-in screens are faithful reconstructions because Nimiq Pay is required for a real wallet session.

1. Landing / open-in-Nimiq-Pay gate
2. Ask with an invoice confirm card
3. Work: overview, running timer, invoice
4. Chat: accept/decline pending request
5. You: tasks, reminders, receipts, activity

## What still blocks a valid PR

1. **Sign in and submit the form yourself.** I cannot complete GitHub OAuth.
2. **Video URL.** File is `saypay-demo.mp4`. Upload unlisted to YouTube (fastest) and paste the link.
3. **Email, X handle, heard-about.** I do not have those.
4. **Push the live app to GitHub.** Public repo `emer-eth/saypay` is MIT and reachable, but it still has the old pre-Ask tree. Local `main` has the production app uncommitted. Current `gh` login is **Peacenft**, which **cannot push** to `emer-eth/saypay`. Sign in as **emer-eth** (or add Peacenft as a collaborator), then commit and push before judges clone the repo.
5. **Skool + X posts.** 5 scoring points. Copy is in `POSTS.md`. Post in [Promote Your Work](https://www.skool.com/miniappscompetition) and on X, then paste the URLs into the form.
6. **Use the GitHub user you want as the folder name.** If you sign in as Peacenft, the folder is `cycle2/Peacenft`. The repo URL can still be `emer-eth/saypay`.

## Already passing

- Live demo HTTP 200, health `{ok:true}`
- Public GitHub repo
- MIT LICENSE
- Nimiq Pay Mini Apps Framework (`@nimiq/mini-app-sdk`)
- NIM-only payments (counts for the NIM integration bonus)
- No secrets in git (Gemini key is Wrangler secret + gitignored `.dev.vars`)
- Product is a finished Mini App, not a mock

## Do not put in the form or repo

Gemini API key. It stays in `wrangler secret put GEMINI_API_KEY`.
