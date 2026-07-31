import { markDueSchedules } from "../mark-due";

// Internal hook for the Worker cron (header x-saypay-cron: 1).
export async function POST(request: Request) {
  if (request.headers.get("x-saypay-cron") !== "1") {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await markDueSchedules();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({
      error: "Could not mark due schedules.",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
