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

function hexToBytes(hex: string) {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) throw new Error("Expected a hex string.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
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

  // The number is far wider than a double, so reduce it in chunks.
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 6) {
    remainder = Number(`${remainder}${expanded.slice(i, i + 6)}`) % 97;
  }
  return 98 - remainder;
}

/** Nimiq address = first 20 bytes of Blake2b-256 over the public key. */
export function addressFromPublicKey(publicKeyHex: string) {
  const hash = blake2b(hexToBytes(publicKeyHex), undefined, 32);
  const body = toBase32(hash.slice(0, 20));
  return `NQ${ibanCheck(body).toString().padStart(2, "0")}${body}`;
}

export function normaliseAddress(address: string) {
  return address.replace(/\s/g, "").toUpperCase();
}

/**
 * A Nimiq signed message is Ed25519 over SHA-256 of the framed payload, where
 * the frame is the 0x16 prefix, the message length, then the message itself.
 */
export async function verifySignedMessage(message: string, signatureHex: string, publicKeyHex: string) {
  const framed = `\x16 Nimiq Signed Message:\n${message.length}${message}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(framed)));
  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(publicKeyHex);

  // workerd exposes Ed25519 under the standard name; older builds only accept
  // the NODE-ED25519 spelling, so try both before giving up.
  for (const algorithm of ["Ed25519", "NODE-ED25519"]) {
    try {
      const key = await crypto.subtle.importKey("raw", publicKey, { name: algorithm, namedCurve: "Ed25519" } as unknown as AlgorithmIdentifier, false, ["verify"]);
      return await crypto.subtle.verify({ name: algorithm } as unknown as AlgorithmIdentifier, key, signature, digest);
    } catch {
      continue;
    }
  }
  throw new Error("This runtime cannot verify Ed25519 signatures.");
}
