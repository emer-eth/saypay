import { requireSession } from "../_lib/auth";
import { getAccountBalanceLunas } from "../_lib/nimiq-rpc";

// The balance the UI shows comes from here rather than a direct browser call to
// a public RPC, so the network is configured in exactly one place (server-side)
// and the WebView never talks to a third-party node on its own.
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return Response.json({ error: "Sign in with Nimiq Pay first." }, { status: 401 });

  const lunas = await getAccountBalanceLunas(session.walletAddress);
  if (lunas === null) return Response.json({ error: "Balance unavailable." }, { status: 502 });

  return Response.json({ lunas, nim: Number((lunas / 100_000).toFixed(5)) });
}
