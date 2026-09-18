export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(path, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string } & T;
  if (!response.ok) throw new ApiError(response.status, payload.error ?? `Request failed (${response.status})`, payload.code);
  return payload;
}

export function sessionKey(address: string) {
  return `saypay-session:${address.replace(/\s/g, "").toUpperCase()}`;
}
