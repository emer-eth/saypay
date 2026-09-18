"use client";

import { NIMIQ_PAY_ANDROID, NIMIQ_PAY_IOS, detectPlatform, nimiqPayLinks } from "../lib/host";

export default function GetNimiqPayPage() {
  const platform = typeof navigator === "undefined" ? "other" : detectPlatform();
  const links = nimiqPayLinks();
  return (
    <main className="hero">
      <section className="hero-card">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4" /></svg>
          </span>
          SayPay
        </div>
        <p className="kicker">Nimiq Pay</p>
        <h1>Choose your store.</h1>
        <p className="lead">
          {platform === "ios" ? "This looks like an iPhone." : platform === "android" ? "This looks like Android." : "Pick the store for your phone."}
          {" "}SayPay opens inside Nimiq Pay after you install it.
        </p>
        <a className="btn btn-primary btn-block" href={NIMIQ_PAY_IOS}>App Store (iPhone)</a>
        <a className="btn btn-secondary btn-block" href={NIMIQ_PAY_ANDROID}>Google Play (Android)</a>
        <a className="btn btn-ghost btn-block" href={links.openHttps}>I already have Nimiq Pay</a>
      </section>
    </main>
  );
}
