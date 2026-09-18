export type PhonePlatform = "ios" | "android" | "other";

export const NIMIQ_PAY_IOS = "https://apps.apple.com/app/nimiq-pay/id6471844738";
export const NIMIQ_PAY_ANDROID = "https://play.google.com/store/apps/details?id=com.nimiq.pay";

export function detectPlatform(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): PhonePlatform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export function isLocalDevHost(hostname = typeof location === "undefined" ? "" : location.hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname.endsWith(".local")
    || /^192\.168\./.test(hostname)
    || /^10\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

export function looksLikeNimiqPayHost() {
  if (typeof window === "undefined") return false;
  const w = window as Window & { nimiq?: unknown; nimiqPay?: unknown };
  if (w.nimiq || w.nimiqPay) return true;
  return /NimiqPay|Nimiq Pay/i.test(navigator.userAgent);
}

export function saypayHost(origin = typeof location === "undefined" ? "" : location.origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").split("/")[0];
  }
}

export function nimiqPayLinks(origin = typeof location === "undefined" ? "" : location.origin) {
  const host = saypayHost(origin);
  return {
    ios: NIMIQ_PAY_IOS,
    android: NIMIQ_PAY_ANDROID,
    chooser: `${origin.replace(/\/$/, "")}/get-nimiq-pay`,
    openHttps: `https://nimpay.app/miniapps/open/${host}`,
    openScheme: `nimiqpay://miniapp?url=${host}`,
  };
}

export async function confirmNimiqPayHost(timeout = 1800) {
  if (looksLikeNimiqPayHost()) return true;
  if (typeof window === "undefined") return false;
  try {
    const { init, getHostLanguage } = await import("@nimiq/mini-app-sdk");
    if (getHostLanguage()) return true;
    await init({ timeout });
    return true;
  } catch {
    return false;
  }
}
