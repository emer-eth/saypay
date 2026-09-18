export const CHAT_WRAP_MESSAGE = "SayPay chat wrap v1";

function bytesFromSignature(signature: string) {
  const hex = signature.replace(/^0x/i, "").replace(/\s/g, "");
  if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const binary = atob(signature);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bufToB64(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function b64ToBuf(value: string) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function wrapKeyFromSignature(signature: string) {
  const bits = bytesFromSignature(signature);
  const base = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("saypay-chat-wrap"), info: new TextEncoder().encode("v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function generateChatKeypair() {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}

export async function exportPublicJwk(key: CryptoKey) {
  return JSON.stringify(await crypto.subtle.exportKey("jwk", key));
}

export async function importPublicJwk(jwk: string) {
  return crypto.subtle.importKey("jwk", JSON.parse(jwk) as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

export async function wrapPrivateKey(privateKey: CryptoKey, signature: string) {
  const wrapKey = await wrapKeyFromSignature(signature);
  const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", privateKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, new TextEncoder().encode(jwk));
  return { wrappedPrivate: bufToB64(wrapped), wrapIv: bufToB64(iv) };
}

export async function unwrapPrivateKey(wrappedPrivate: string, wrapIv: string, signature: string) {
  const wrapKey = await wrapKeyFromSignature(signature);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBuf(wrapIv) },
    wrapKey,
    b64ToBuf(wrappedPrivate),
  );
  const jwk = JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}

async function messageKey(privateKey: CryptoKey, publicKey: CryptoKey) {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptChat(text: string, privateKey: CryptoKey, theirPublic: CryptoKey) {
  const key = await messageKey(privateKey, theirPublic);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return { ciphertext: bufToB64(ciphertext), iv: bufToB64(iv) };
}

export async function decryptChat(ciphertext: string, iv: string, privateKey: CryptoKey, theirPublic: CryptoKey) {
  const key = await messageKey(privateKey, theirPublic);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(iv) }, key, b64ToBuf(ciphertext));
  return new TextDecoder().decode(plain);
}
