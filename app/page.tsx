"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Flow = "send" | "split" | "invoice" | "protect";

const flows: Record<
  Flow,
  { label: string; icon: string; prompt: string; title: string; detail: string; asset: string }
> = {
  send: {
    label: "Send money",
    icon: "↗",
    prompt: "Send 20 NIM to Mum for groceries",
    title: "Send 20 NIM",
    detail: "Mum · Groceries",
    asset: "NIM",
  },
  split: {
    label: "Split a bill",
    icon: "◌",
    prompt: "Split 120 NIM dinner with Ada and Tunde",
    title: "Split 120 NIM",
    detail: "You, Ada, Tunde · 40 NIM each",
    asset: "NIM",
  },
  invoice: {
    label: "Create invoice",
    icon: "□",
    prompt: "Create a 300 USDT invoice for website design",
    title: "Invoice for 300 USDT",
    detail: "Website design · Share when ready",
    asset: "USDT",
  },
  protect: {
    label: "Protected Pay",
    icon: "◇",
    prompt: "Pay Ada 80 USDT after logo delivery, with three arbiters",
    title: "Protect 80 USDT",
    detail: "Logo design · Release by Friday",
    asset: "USDT",
  },
};

export default function Home() {
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboarded, setOnboarded] = useState(false);
  const [language, setLanguage] = useState("English");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [walletAddress, setWalletAddress] = useState("");
  const [handle, setHandle] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [walletStatus, setWalletStatus] = useState("Connect Nimiq Pay to make secure payments.");
  const [contactName, setContactName] = useState("Mum");
  const [contactAddress, setContactAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [flow, setFlow] = useState<Flow>("send");
  const [message, setMessage] = useState(flows.send.prompt);
  const [reviewing, setReviewing] = useState(false);
  const [done, setDone] = useState(false);
  const [tab, setTab] = useState<"home" | "activity" | "protect" | "profile">("home");

  const active = useMemo(() => flows[flow], [flow]);
  const sayPayId = handle ? `@${handle}` : walletAddress ? `@nim-${walletAddress.replace(/\s/g, "").slice(-7).toLowerCase()}` : "@your-saypay";
  const paymentPage = walletAddress ? `https://saypay-payment-assistant.peacenft7.chatgpt.site/?payTo=${encodeURIComponent(walletAddress)}` : "";
  const paymentLink = paymentPage ? `nimiqpay://miniapp?url=${encodeURIComponent(paymentPage)}` : "";

  useEffect(() => {
    const recipient = new URLSearchParams(window.location.search).get("payTo");
    if (!recipient) return;
    setContactName("SayPay user");
    setContactAddress(recipient);
    setMessage("Send NIM to this SayPay user");
    setFlow("send");
    setOnboarded(true);
  }, []);

  async function connectWallet() {
    setConnecting(true);
    setWalletStatus("Looking for Nimiq Pay…");
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const accounts = await nimiq.listAccounts();
      if (!accounts[0]) throw new Error("No Nimiq account is available.");
      setWalletAddress(accounts[0]);
      setHandle((current) => current || `nim-${accounts[0].replace(/\s/g, "").slice(-7).toLowerCase()}`);
      const nimiqPay = (window as unknown as { nimiqPay?: { language?: string } }).nimiqPay;
      if (nimiqPay?.language) setLanguage(languageName(nimiqPay.language));
      setWalletStatus("Nimiq Pay connected. You will approve every payment.");
    } catch {
      setWalletStatus("Open SayPay inside Nimiq Pay to connect a real wallet. You can still explore the app here.");
    } finally {
      setConnecting(false);
    }
  }

  async function claimHandle() {
    if (!walletAddress) {
      setProfileStatus("Connect Nimiq Pay before claiming a SayPay ID.");
      return;
    }
    setClaiming(true);
    setProfileStatus("Preparing your signed profile claim…");
    try {
      const challengeResponse = await fetch("/api/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress, handle }) });
      const challenge = await challengeResponse.json() as { nonce?: string; message?: string; error?: string };
      if (!challengeResponse.ok || !challenge.nonce || !challenge.message) throw new Error(challenge.error ?? "Unable to start the profile claim.");
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const signed = await nimiq.sign(challenge.message);
      const verifyResponse = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: challenge.nonce, walletAddress, signature: signed.signature, publicKey: signed.publicKey, language }) });
      const verified = await verifyResponse.json() as { error?: string };
      if (!verifyResponse.ok) throw new Error(verified.error ?? "Unable to verify the wallet signature.");
      setProfileStatus(`@${handle} is now verified to your Nimiq wallet.`);
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : "The profile claim was not completed.");
    } finally {
      setClaiming(false);
    }
  }

  async function confirmAction() {
    if (flow !== "send") {
      setDone(true);
      return;
    }
    if (!walletAddress) {
      setWalletStatus("Connect Nimiq Pay before sending money.");
      return;
    }
    if (!contactAddress.trim()) {
      setWalletStatus(`Add ${contactName}'s Nimiq address in Contacts before sending.`);
      return;
    }
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const value = 20 * 100_000;
      await nimiq.sendBasicTransactionWithData({ recipient: contactAddress.trim(), value, data: "Groceries" });
      setDone(true);
      setWalletStatus("Payment sent through Nimiq Pay.");
    } catch {
      setWalletStatus("The payment was not sent. Check the recipient and approve the native Nimiq Pay prompt.");
    }
  }

  function pickFlow(next: Flow) {
    setFlow(next);
    setMessage(flows[next].prompt);
    setReviewing(false);
    setDone(false);
    setTab(next === "protect" ? "protect" : "home");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.toLowerCase();
    const next: Flow = text.includes("protect") || text.includes("delivery") || text.includes("arbiter")
      ? "protect"
      : text.includes("split")
        ? "split"
        : text.includes("invoice")
          ? "invoice"
          : "send";
    setFlow(next);
    setTab(next === "protect" ? "protect" : "home");
    setReviewing(true);
    setDone(false);
  }

  return (
    <main className="app-shell">
      <section className="app-frame" aria-label="SayPay payment assistant">
        {!onboarded ? <Onboarding step={onboardingStep} language={language} voiceEnabled={voiceEnabled} walletAddress={walletAddress} walletStatus={walletStatus} contactName={contactName} contactAddress={contactAddress} connecting={connecting} onLanguage={setLanguage} onVoice={setVoiceEnabled} onContactName={setContactName} onContactAddress={setContactAddress} onConnect={connectWallet} onBack={() => setOnboardingStep((current) => Math.max(0, current - 1))} onNext={() => setOnboardingStep((current) => Math.min(3, current + 1))} onFinish={() => setOnboarded(true)} /> : <>
          <header className="topbar">
            <div className="brand">SayPay</div>
            <button className="wallet-dot" onClick={() => walletAddress ? setTab("profile") : connectWallet()} aria-label="Open your payment identity">{walletAddress ? "● My ID" : "○ Connect"}</button>
          </header>

        {tab === "profile" ? (
          <Profile walletAddress={walletAddress} sayPayId={sayPayId} paymentLink={paymentLink} handle={handle} profileStatus={profileStatus} claiming={claiming} onHandle={setHandle} onClaim={claimHandle} onConnect={connectWallet} onHome={() => setTab("home")} />
        ) : tab === "activity" ? (
          <Activity onReturn={() => setTab("home")} />
        ) : tab === "protect" ? (
          <Protected active={active} reviewing={reviewing} done={done} onReview={() => setReviewing(true)} onConfirm={() => setDone(true)} />
        ) : (
          <section className="home-view">
            <div className="intro">
              <p className="eyebrow">PAYMENTS IN PLAIN LANGUAGE</p>
              <h1>What would you like to do?</h1>
              <p>Say it naturally. You always review before money moves.</p>
            </div>

            <div className="quick-grid" aria-label="Quick actions">
              {(Object.keys(flows) as Flow[]).map((key) => (
                <button className={`quick-action ${flow === key ? "selected" : ""}`} key={key} onClick={() => pickFlow(key)}>
                  <span className={`action-icon ${key}`}>{flows[key].icon}</span>
                  <span>{flows[key].label}</span>
                </button>
              ))}
            </div>

            <div className="conversation">
              <div className="assistant-line"><span className="spark">✦</span> I turned your words into a clear plan.</div>
              <div className="user-message">{message}</div>
              <ActionCard flow={flow} reviewing={reviewing} done={done} onReview={() => setReviewing(true)} onConfirm={confirmAction} />
            </div>

            <form className="composer" onSubmit={submit}>
              <input aria-label="Describe a payment" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Say something..." />
              <button type="button" className="mic" aria-label="Use voice input">⌁</button>
              <button type="submit" className="send" aria-label="Create payment plan">↑</button>
            </form>
          </section>
        )}

        <nav className="bottom-nav" aria-label="Main navigation">
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><span>⌂</span>Home</button>
          <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><span>☷</span>Activity</button>
          <button className={tab === "protect" ? "active" : ""} onClick={() => setTab("protect")}><span>◇</span>Protect</button>
        </nav>
        </>}
      </section>
    </main>
  );
}

function Onboarding({ step, language, voiceEnabled, walletAddress, walletStatus, contactName, contactAddress, connecting, onLanguage, onVoice, onContactName, onContactAddress, onConnect, onBack, onNext, onFinish }: { step: number; language: string; voiceEnabled: boolean; walletAddress: string; walletStatus: string; contactName: string; contactAddress: string; connecting: boolean; onLanguage: (value: string) => void; onVoice: (value: boolean) => void; onContactName: (value: string) => void; onContactAddress: (value: string) => void; onConnect: () => void; onBack: () => void; onNext: () => void; onFinish: () => void }) {
  const last = step === 3;
  return <section className="onboarding">
    <div className="onboarding-top"><div className="brand">SayPay</div><span>{step + 1} of 4</span></div>
    <div className="progress"><i style={{ width: `${(step + 1) * 25}%` }} /></div>
    {step === 0 && <div className="onboard-content"><span className="hero-mark">✦</span><p className="eyebrow">CLEAR PAYMENTS, ALWAYS</p><h1>Money should understand you.</h1><p>SayPay turns everyday words into clear payment plans. You review every detail before anything moves.</p><div className="promise"><span>✓</span><div><strong>Your wallet stays yours</strong><small>SayPay never sees your private keys.</small></div></div><div className="promise"><span>✓</span><div><strong>You stay in control</strong><small>Every payment uses Nimiq Pay’s native approval.</small></div></div></div>}
    {step === 1 && <div className="onboard-content"><p className="eyebrow">MAKE IT FEEL LIKE YOURS</p><h1>SayPay follows your Nimiq Pay language.</h1><p>When you connect, SayPay reads your selected Nimiq Pay language and uses it for the interface. You can still type or speak payment requests naturally.</p><label className="field-label">Preview language<select value={language} onChange={(event) => onLanguage(event.target.value)}><option>English</option><option>Nigerian Pidgin</option><option>German</option><option>Spanish</option></select></label><button className={`preference ${voiceEnabled ? "chosen" : ""}`} onClick={() => onVoice(!voiceEnabled)}><span className="choice-icon">⌁</span><div><strong>Voice input</strong><small>{voiceEnabled ? "On. Speak naturally to create a payment." : "Off. You can still type every request."}</small></div><b>{voiceEnabled ? "On" : "Off"}</b></button></div>}
    {step === 2 && <div className="onboard-content"><p className="eyebrow">CONNECT SECURELY</p><h1>Connect Nimiq Pay.</h1><p>SayPay asks Nimiq Pay for permission when you connect and every time you send money.</p><div className={`wallet-panel ${walletAddress ? "connected" : ""}`}><span className="choice-icon">◇</span><div><strong>{walletAddress ? "Wallet connected" : "Nimiq Pay"}</strong><small>{walletAddress ? `${walletAddress.slice(0, 11)}…${walletAddress.slice(-6)}` : walletStatus}</small></div></div><button className="primary" onClick={onConnect} disabled={connecting}>{connecting ? "Connecting…" : walletAddress ? "Connected" : "Connect Nimiq Pay"}</button><p className="onboard-note">You can explore the product outside Nimiq Pay, but real payments only work in the Nimiq Pay app.</p></div>}
    {step === 3 && <div className="onboard-content"><p className="eyebrow">SAFE RECIPIENTS</p><h1>Add your first contact.</h1><p>This lets SayPay understand a request such as “send money to Mum” without guessing an address.</p><label className="field-label">Name<input value={contactName} onChange={(event) => onContactName(event.target.value)} placeholder="Mum" /></label><label className="field-label">Nimiq address<input value={contactAddress} onChange={(event) => onContactAddress(event.target.value)} placeholder="NQ…" /></label><p className="onboard-note">You can skip this and add verified contacts later. SayPay will never invent an address.</p></div>}
    <div className="onboard-actions"><button className="back" onClick={onBack} disabled={step === 0}>Back</button><button className="primary" onClick={last ? onFinish : onNext}>{last ? "Start using SayPay" : "Continue"}</button></div>
  </section>;
}

function ActionCard({ flow, reviewing, done, onReview, onConfirm }: { flow: Flow; reviewing: boolean; done: boolean; onReview: () => void; onConfirm: () => void }) {
  const item = flows[flow];
  const primary = flow === "invoice" ? "Create invoice" : flow === "protect" ? "Review deal" : "Review payment";
  const confirmed = flow === "invoice" ? "Invoice link ready" : flow === "protect" ? "Deal ready to fund" : "Ready for Nimiq Pay";

  return (
    <article className={`action-card ${flow}`}>
      <div className="card-heading">
        <span className="card-symbol">{flow === "protect" ? "◇" : flow === "invoice" ? "□" : flow === "split" ? "◌" : "↗"}</span>
        <div><p>{flow === "protect" ? "Protected Pay" : "Payment plan"}</p><h2>{item.title}</h2></div>
      </div>
      <div className="card-row"><span>{flow === "split" ? "People" : flow === "invoice" ? "For" : flow === "protect" ? "Milestone" : "To"}</span><strong>{flow === "split" ? "Ada · Tunde" : flow === "invoice" ? "Website design" : flow === "protect" ? "Logo delivery" : "Mum"}</strong></div>
      <div className="card-row"><span>Note</span><strong>{item.detail}</strong></div>
      {flow === "protect" && <div className="arbiters"><span>Trusted arbiters</span><div className="faces"><i>AM</i><i>BK</i><i>CN</i></div></div>}
      {done ? (
        <div className="success"><span>✓</span>{confirmed}</div>
      ) : reviewing ? (
        <button className="primary" onClick={onConfirm}>{flow === "invoice" ? "Create secure link" : "Confirm in Nimiq Pay"}</button>
      ) : (
        <button className="primary" onClick={onReview}>{primary}</button>
      )}
      <p className="safety">⌁ You always confirm in Nimiq Pay.</p>
    </article>
  );
}

function Protected({ active, reviewing, done, onReview, onConfirm }: { active: (typeof flows)[Flow]; reviewing: boolean; done: boolean; onReview: () => void; onConfirm: () => void }) {
  return <section className="protect-view"><div className="protect-title"><p className="eyebrow">PAY WITH CONFIDENCE</p><h1>Protected Pay</h1><p>Lock a deal, then release when both sides agree.</p></div><div className="funds-pill">✓ Funds protected by clear terms</div><ActionCard flow="protect" reviewing={reviewing} done={done} onReview={onReview} onConfirm={onConfirm} /><section className="timeline"><p>HOW IT WORKS</p><div><b>1</b><span>Both sides accept the terms</span></div><div><b>2</b><span>Funds are locked securely</span></div><div><b>3</b><span>Release, refund, or settle with arbiters</span></div></section></section>;
}

function Activity({ onReturn }: { onReturn: () => void }) {
  return <section className="activity-view"><div className="intro"><p className="eyebrow">YOUR MONEY, CLEARLY</p><h1>Activity</h1><p>Every payment, request, and agreement in one place.</p></div><div className="activity-list"><article><span className="activity-icon green">↗</span><div><strong>Groceries for Mum</strong><p>Completed today</p></div><b>20 NIM</b></article><article><span className="activity-icon blue">□</span><div><strong>Website design invoice</strong><p>Waiting for Ada</p></div><b>300 USDT</b></article><article><span className="activity-icon amber">◇</span><div><strong>Logo design deal</strong><p>Delivery pending</p></div><b>80 USDT</b></article></div><button className="outline" onClick={onReturn}>Create a payment</button></section>;
}

function Profile({ walletAddress, sayPayId, paymentLink, handle, profileStatus, claiming, onHandle, onClaim, onConnect, onHome }: { walletAddress: string; sayPayId: string; paymentLink: string; handle: string; profileStatus: string; claiming: boolean; onHandle: (value: string) => void; onClaim: () => void; onConnect: () => void; onHome: () => void }) {
  return <section className="profile-view"><button className="back-link" onClick={onHome}>← Back</button><p className="eyebrow">YOUR PAYMENT ID</p><h1>Get paid in seconds.</h1><p className="profile-copy">Share your QR code or payment link. It opens SayPay inside Nimiq Pay, so your payer has wallet access from the first screen.</p>{walletAddress ? <><div className="identity-card"><div className="identity-avatar">SP</div><div><strong>{sayPayId}</strong><small>Connected Nimiq wallet</small></div><span className="verified">✓</span></div><label className="handle-input">Your SayPay ID<span>@</span><input value={handle} onChange={(event) => onHandle(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={24} /></label><button className="outline claim" onClick={onClaim} disabled={claiming}>{claiming ? "Requesting wallet signature…" : "Verify this ID with Nimiq Pay"}</button>{profileStatus && <p className="profile-status">{profileStatus}</p>}<div className="qr-card"><QRCodeSVG value={paymentLink} size={178} bgColor="#fffdfa" fgColor="#10184d" level="M" includeMargin /><strong>Scan to pay {sayPayId}</strong><small>Opens SayPay in Nimiq Pay with your wallet already selected.</small></div><label className="share-link">Your Nimiq Pay payment link<input readOnly value={paymentLink} onFocus={(event) => event.target.select()} /></label><button className="primary" onClick={() => navigator.clipboard?.writeText(paymentLink)}>Copy payment link</button></> : <div className="empty-identity"><span>◇</span><h2>Connect your Nimiq wallet</h2><p>Your Nimiq wallet address becomes your verified SayPay payment identity.</p><button className="primary" onClick={onConnect}>Connect Nimiq Pay</button></div>}</section>;
}

function languageName(code: string) {
  return ({ en: "English", de: "German", es: "Spanish" } as Record<string, string>)[code] ?? "English";
}
