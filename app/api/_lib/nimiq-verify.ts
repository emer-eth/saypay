import { blake2b } from "blakejs";

// Signature verification without @nimiq/core.
//
// @nimiq/core/web constructs a Web Worker at import time and needs an async
// WASM init, so it cannot load in the Cloudflare Workers runtime at all — any
// call into it fails with "__wbindgen_malloc of undefined". Everything needed
// here is available natively: WebCrypto for SHA-256 and Ed25519, and a pure-JS
// Blake2b for deriving the address from the public key.

// Nimiq's own base32 alphabet. Note the omissions: I, O, W and Z.
const BASE32 = "0123456789ABCDEFGHJKLMNPQRSTUVXY";

// Canonical signed-message header used by Nimiq Keyguard / Nimiq Pay.
// 0x16 (22) is the length of "Nimiq Signed Message:\n" — there must be NO
// space between the length byte and the header text.
// (An earlier bug used "\x16 Nimiq…" with a space; that only verified against
// our own tests that used the same wrong prefix, not against the live wallet.)
const SIGNED_MESSAGE_HEADER = `\x16Nimiq Signed Message:\n`;

// Legacy mistaken prefix kept as a fallback for any early test signatures.
const LEGACY_SPACED_HEADER = `\x16 Nimiq Signed Message:\n`;

function hexToBytes(hex: string) {
  const clean = hex.trim().toLowerCase().replace(/^0x/i, "").replace(/\s+/g, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) throw new Error("Expected a hex string.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string) {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Nimiq Pay may return hex (with or without 0x), base64, or a nested { hex }.
 * Accept all of those so a valid wallet signature is not rejected on packaging.
 */
export function coerceToBytes(value: unknown, label: string): Uint8Array {
  if (value == null) throw new Error(`Missing ${label}.`);

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new Error(`Empty ${label}.`);
    // Prefer hex when it looks like hex.
    const hexish = trimmed.replace(/^0x/i, "").replace(/\s+/g, "");
    if (/^[0-9a-fA-F]+$/.test(hexish) && hexish.length % 2 === 0) {
      return hexToBytes(hexish);
    }
    // Otherwise try base64 / base64url.
    try {
      return base64ToBytes(trimmed);
    } catch {
      throw new Error(`Could not decode ${label} as hex or base64.`);
    }
  }

  if (Array.isArray(value) && value.every((n) => typeof n === "number")) {
    return Uint8Array.from(value);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.hex === "string") return coerceToBytes(record.hex, label);
    if (typeof record.signature === "string") return coerceToBytes(record.signature, label);
    if (typeof record.publicKey === "string") return coerceToBytes(record.publicKey, label);
    if (Array.isArray(record.data)) return coerceToBytes(record.data, label);
  }

  throw new Error(`Unsupported ${label} type.`);
}

// Nimiq packs the 20-byte address as 32 base32 characters, 5 bits at a time.
function toBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

// IBAN-style mod-97 check digits, computed over the payload followed by "NQ00".
function ibanCheck(payload: string) {
  const expanded = `${payload}NQ00`
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 48 && code <= 57 ? character : String(code - 55);
    })
    .join("");

  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 6) {
    remainder = Number(`${remainder}${expanded.slice(i, i + 6)}`) % 97;
  }
  return 98 - remainder;
}

/** Nimiq address = first 20 bytes of Blake2b-256 over the public key. */
export function addressFromPublicKey(publicKey: string | Uint8Array) {
  const keyBytes = typeof publicKey === "string" ? coerceToBytes(publicKey, "publicKey") : publicKey;
  const hash = blake2b(keyBytes, undefined, 32);
  const body = toBase32(hash.slice(0, 20));
  return `NQ${ibanCheck(body).toString().padStart(2, "0")}${body}`;
}

export function normaliseAddress(address: string) {
  return address.replace(/\s/g, "").toUpperCase();
}

async function sha256(bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bufferSource(bytes)));
}

function utf8(text: string) {
  return new TextEncoder().encode(text);
}

/**
 * WebCrypto takes a `BufferSource`, which must be backed by a plain
 * `ArrayBuffer`. Bytes arriving from callers or from blakejs are typed over
 * `ArrayBufferLike` (they may sit on a `SharedArrayBuffer`), so copy them into
 * a known-good view. The inputs here are keys, signatures and challenges — tens
 * of bytes — so the copy costs nothing.
 */
function bufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function framedPayloads(message: string): Array<{ name: string; data: Uint8Array }> {
  const charLen = String(message.length);
  const byteLen = String(utf8(message).length);
  return [
    // Canonical Nimiq Pay / Keyguard framing (fixed: no space after 0x16).
    { name: "canonical-header-charlen", data: utf8(SIGNED_MESSAGE_HEADER + charLen + message) },
    { name: "canonical-header-bytelen", data: utf8(SIGNED_MESSAGE_HEADER + byteLen + message) },
    // Legacy mistaken spaced header (older SayPay builds / local tests).
    { name: "legacy-spaced-charlen", data: utf8(LEGACY_SPACED_HEADER + charLen + message) },
    { name: "legacy-spaced-bytelen", data: utf8(LEGACY_SPACED_HEADER + byteLen + message) },
    // Wallet may sign the bare challenge string.
    { name: "raw-message", data: utf8(message) },
  ];
}

async function ed25519Verify(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array) {
  // workerd exposes Ed25519 under the standard name; older builds only accept
  // the NODE-ED25519 spelling, so try both before giving up.
  for (const algorithm of ["Ed25519", "NODE-ED25519"] as const) {
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        bufferSource(publicKey),
        { name: algorithm, namedCurve: "Ed25519" } as unknown as AlgorithmIdentifier,
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        { name: algorithm } as unknown as AlgorithmIdentifier,
        key,
        bufferSource(signature),
        bufferSource(message),
      );
    } catch {
      continue;
    }
  }
  throw new Error("This runtime cannot verify Ed25519 signatures.");
}

export type VerifyResult = {
  ok: boolean;
  method?: string;
  detail?: string;
  publicKeyHex?: string;
  signatureHex?: string;
};

/**
 * Verify a Nimiq Pay / Keyguard message signature.
 * Tries the canonical framing first, then known legacy and bare-message variants.
 */
export async function verifySignedMessageDetailed(
  message: string,
  signatureInput: unknown,
  publicKeyInput: unknown,
): Promise<VerifyResult> {
  let signature: Uint8Array;
  let publicKey: Uint8Array;
  try {
    signature = coerceToBytes(signatureInput, "signature");
    publicKey = coerceToBytes(publicKeyInput, "publicKey");
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  if (publicKey.length !== 32) {
    return {
      ok: false,
      detail: `publicKey must be 32 bytes (got ${publicKey.length}).`,
      publicKeyHex: bytesToHex(publicKey),
      signatureHex: bytesToHex(signature),
    };
  }
  if (signature.length !== 64) {
    return {
      ok: false,
      detail: `signature must be 64 bytes (got ${signature.length}).`,
      publicKeyHex: bytesToHex(publicKey),
      signatureHex: bytesToHex(signature),
    };
  }

  const payloads = framedPayloads(message);
  const tried: string[] = [];

  try {
    for (const payload of payloads) {
      // Path A: Ed25519 over SHA-256(framed) — Nimiq core Signature.create style.
      const digest = await sha256(payload.data);
      if (await ed25519Verify(publicKey, signature, digest)) {
        return {
          ok: true,
          method: `${payload.name}+sha256`,
          publicKeyHex: bytesToHex(publicKey),
          signatureHex: bytesToHex(signature),
        };
      }
      tried.push(`${payload.name}+sha256`);

      // Path B: pure Ed25519 over the framed bytes (no pre-hash).
      if (await ed25519Verify(publicKey, signature, payload.data)) {
        return {
          ok: true,
          method: `${payload.name}+raw`,
          publicKeyHex: bytesToHex(publicKey),
          signatureHex: bytesToHex(signature),
        };
      }
      tried.push(`${payload.name}+raw`);
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      publicKeyHex: bytesToHex(publicKey),
      signatureHex: bytesToHex(signature),
    };
  }

  return {
    ok: false,
    detail: `No framing matched (${tried.length} attempts).`,
    publicKeyHex: bytesToHex(publicKey),
    signatureHex: bytesToHex(signature),
  };
}

export async function verifySignedMessage(message: string, signatureHex: string, publicKeyHex: string) {
  const result = await verifySignedMessageDetailed(message, signatureHex, publicKeyHex);
  return result.ok;
}
