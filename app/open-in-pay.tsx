"use client";

import { QRCodeSVG } from "qrcode.react";
import { detectPlatform, nimiqPayLinks, type PhonePlatform } from "./lib/host";

export function OpenInNimiqPay({
  title = "Open SayPay in Nimiq Pay",
  body = "Ask understands. You organizes. Work is what you’re doing. Chat stays private. Download Nimiq Pay, then open SayPay from Mini Apps.",
  compact = false,
}: {
  title?: string;
  body?: string;
  compact?: boolean;
}) {
  const platform: PhonePlatform = typeof navigator === "undefined" ? "other" : detectPlatform();
  const links = nimiqPayLinks();
  const primaryHref = platform === "ios" ? links.ios : platform === "android" ? links.android : links.chooser;
  const primaryLabel = platform === "ios"
    ? "Download on the App Store"
    : platform === "android"
      ? "Get it on Google Play"
      : "Choose App Store or Google Play";

  return (
    <div className={compact ? "stack" : "stack"} style={compact ? { gap: 12 } : undefined}>
      {!compact && (
        <>
          <h1>{title}</h1>
          <p className="lead">{body}</p>
        </>
      )}
      {compact && <p className="small">{body}</p>}
      <a className="btn btn-primary btn-block" href={primaryHref}>{primaryLabel}</a>
      <a className="btn btn-secondary btn-block" href={links.openHttps}>I already have Nimiq Pay</a>
      {platform !== "other" && (
        <a className="btn btn-ghost btn-block" href={links.chooser}>Need a different store?</a>
      )}
      {platform === "other" && !compact && (
        <div className="card" style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
          <QRCodeSVG value={links.openHttps} size={132} bgColor="transparent" fgColor="currentColor" />
          <p className="small">Scan on your phone to open SayPay in Nimiq Pay after you install it.</p>
        </div>
      )}
    </div>
  );
}
