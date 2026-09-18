import { HttpError } from "./http";
import { LUNAS_PER_NIM } from "../../_lib/units";

export function toLunas(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * LUNAS_PER_NIM);
}

export function requireLunas(value: unknown, message = "Enter a NIM amount greater than zero.") {
  const lunas = toLunas(value);
  if (!lunas) throw new HttpError(400, message, "invalid_amount");
  return lunas;
}

export function handleOf(value: string) {
  return value.replace(/^@/, "").trim().toLowerCase();
}
