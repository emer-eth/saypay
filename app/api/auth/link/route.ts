// Unsigned wallet linking is intentionally disabled.
//
// Nimiq mini apps prove account access with listAccounts() (user approval) and
// prove message ownership with sign() — both require native confirmation and
// neither can be forged by a plain HTTP client. Sessions must only be minted
// after /api/auth/verify checks a signature against the claimed address.
//
// See https://nimiq.dev/mini-apps/ and the Nimiq Provider API (listAccounts, sign).

export async function POST() {
  return Response.json(
    {
      error: "Unsigned wallet linking is disabled. Verify your SayPay ID with a Nimiq Pay signature.",
      use: "POST /api/auth/challenge, then sign the message in Nimiq Pay, then POST /api/auth/verify.",
    },
    { status: 410 },
  );
}
