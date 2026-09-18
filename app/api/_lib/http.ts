export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
    public detail?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonOk(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    const body: Record<string, unknown> = { error: error.message, code: error.code };
    if (error.detail) body.detail = error.detail;
    return Response.json(body, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", event: "unhandled", message }));
  return Response.json({ error: "Something went wrong.", code: "internal" }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON.", "bad_json");
  }
}

export function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}
