import { jsonOk } from "../../_lib/http";

export async function POST() {
  return jsonOk(
    {
      error: "Unsigned wallet linking is disabled. Verify your SayPay ID with a Nimiq Pay signature.",
      use: "POST /api/auth/challenge, then sign the message in Nimiq Pay, then POST /api/auth/verify.",
      code: "gone",
    },
    410,
  );
}
