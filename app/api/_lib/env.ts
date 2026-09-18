import { env } from "cloudflare:workers";

export function readEnv(key: string) {
  const binding = (env as unknown as Record<string, string | undefined>)[key];
  if (binding) return binding;
  return typeof process === "undefined" ? undefined : process.env?.[key];
}
