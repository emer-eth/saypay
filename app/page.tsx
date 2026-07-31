"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ParsedIntent } from "./api/_lib/intent-schema";
import { nimToLunas } from "./_lib/units";

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

type Flow = "send" | "split" | "invoice" | "protect";
// `amount` is set when the interpreter gave us a number outright. Prefer it over
// re-reading the digits out of `title`, which only holds for the phrasings we
// happen to generate.
type ParsedPlan = { title: string; recipient: string; note: string; handles: string[]; currency: "NIM" | "USDT"; amount?: number };

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
    prompt: "Split 120 NIM dinner with @ada and @tunde",
    title: "Split 120 NIM",
    detail: "You, Ada, Tunde · 40 NIM each",
    asset: "NIM",
  },
  invoice: {
    label: "Create invoice",
    icon: "□",
    prompt: "Create a 300 NIM invoice for @ada for website design",
    title: "Invoice for 300 NIM",
    detail: "Website design · Share when ready",
    asset: "NIM",
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

function parsePlan(input: string, flow: Flow): ParsedPlan {
  const amount = input.match(/(\d+(?:\.\d+)?)\s*(NIM|USDT)/i);
  const handles = [...new Set(Array.from(input.matchAll(/@([a-z0-9][a-z0-9-]{2,23})/gi)).map((match) => match[1].toLowerCase()))];
  const title = amount ? `${flow === "invoice" ? "Invoice for" : flow === "split" ? "Split" : flow === "protect" ? "Protect" : "Send"} ${amount[1]} ${amount[2].toUpperCase()}` : flows[flow].title;
  const to = input.match(/\b(?:to|for|with)\s+([A-Za-z][A-Za-z0-9' -]{1,30}?)(?:\s+(?:for|after|by|with)\b|$)/i);
  const recipient = to?.[1]?.trim() || (flow === "split" ? "Add participants" : flow === "invoice" ? "Your client" : flow === "protect" ? "Delivery milestone" : "Tell me who");
  const addressedReason = input.match(/\bfor\s+@[a-z0-9-]{3,24}\s+(?:for\s+)?(.+)$/i)?.[1]?.trim();
  const reason = addressedReason ?? input.match(/\b(?:for|after)\s+(.+)$/i)?.[1]?.replace(/\s+(?:with|by)\s+.*$/i, "").trim();
  return { title, recipient: handles.length ? handles.map((handle) => `@${handle}`).join(" · ") : recipient, note: reason || flows[flow].detail, handles, currency: amount?.[2]?.toUpperCase() === "USDT" ? "USDT" : "NIM" };
}

const FLOW_FOR_KIND: Record<ParsedIntent["kind"], Flow> = { send: "send", split: "split", invoice: "invoice", request: "invoice", protected_pay: "protect" };
const VERB_FOR_FLOW: Record<Flow, string> = { send: "Send", split: "Split", invoice: "Invoice for", protect: "Protect" };

// SayPay IDs still come from the message via the existing regex rather than
// from the model. Handles are exact tokens that resolve to a wallet, so a
// near-miss is worse than no match, and this pattern is already proven here.
function handlesIn(input: string) {
  return [...new Set(Array.from(input.matchAll(/@([a-z0-9][a-z0-9-]{2,23})/gi)).map((match) => match[1].toLowerCase()))];
}

function planFromIntent(intent: ParsedIntent, original: string): { plan: ParsedPlan; flow: Flow } {
  const flow = FLOW_FOR_KIND[intent.kind];
  const handles = handlesIn(original);
  const amount = intent.amount ?? undefined;
  const title = amount ? `${VERB_FOR_FLOW[flow]} ${amount} ${intent.asset}` : flows[flow].title;
  const named = intent.kind === "split" ? intent.participants.join(", ") : intent.recipientHint ?? "";
  return {
    flow,
    plan: {
      title,
      recipient: handles.length ? handles.map((handle) => `@${handle}`).join(" · ") : named || flows[flow].detail,
      note: intent.note ?? flows[flow].detail,
      handles,
      currency: intent.asset,
      amount,
    },
  };
}

export default function Home() {
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboarded, setOnboarded] = useState(false);
  const [language, setLanguage] = useState("English");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [walletStatus, setWalletStatus] = useState("Connect Nimiq Pay to make secure payments.");
  const [contactName, setContactName] = useState("Mum");
  const [contactAddress, setContactAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [flow, setFlow] = useState<Flow>("send");
  const [message, setMessage] = useState(flows.send.prompt);
  const [plan, setPlan] = useState<ParsedPlan>(() => parsePlan(flows.send.prompt, "send"));
  const [interpreting, setInterpreting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [done, setDone] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [tab, setTab] = useState<"home" | "activity" | "protect" | "profile">("home");

  const active = useMemo(() => flows[flow], [flow]);
  const sayPayId = handle ? `@${handle}` : walletAddress ? `@nim-${walletAddress.replace(/\s/g, "").slice(-7).toLowerCase()}` : "@your-saypay";
  const paymentPage = isVerified && handle ? `https://saypay-payment-assistant.peacenft7.chatgpt.site/?pay=${encodeURIComponent(handle)}` : "";
  const paymentLink = paymentPage ? `nimiqpay://miniapp?url=${encodeURIComponent(paymentPage)}` : "";

  useEffect(() => {
    const recipient = new URLSearchParams(window.location.search).get("pay");
    if (!recipient) return;
    fetch(`/api/profile?handle=${encodeURIComponent(recipient.replace(/^@/, ""))}`).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { profile: { handle: string; walletAddress: string } };
      setContactName(`@${payload.profile.handle}`);
      setContactAddress(payload.profile.walletAddress);
      setMessage(`Send NIM to @${payload.profile.handle}`);
      setPlan(parsePlan(`Send NIM to @${payload.profile.handle}`, "send"));
      setFlow("send");
      setOnboarded(true);
    }).catch(() => undefined);
  }, []);

  async function loadBalance(address: string) {
    try {
      const response = await fetch("https://rpc.nimiqwatch.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "getAccount", params: [address], id: 1 }) });
      const payload = await response.json() as { result?: { balance?: number } };
      if (typeof payload.result?.balance === "number") setBalance((payload.result.balance / 100_000).toLocaleString(undefined, { maximumFractionDigits: 5 }));
      else setBalance("0");
    } catch {
      setBalance(null);
    }
  }

  async function connectWallet() {
    setConnecting(true);
    setWalletStatus("Looking for Nimiq Pay…");
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const accounts = await nimiq.listAccounts();
      if (!accounts[0]) throw new Error("No Nimiq account is available.");
      setWalletAddress(accounts[0]);
      const storedSession = window.localStorage.getItem(`saypay-session:${accounts[0].replace(/\s/g, "").toUpperCase()}`);
      if (storedSession) setSessionToken(storedSession);
      void loadBalance(accounts[0]);
      fetch(`/api/profile?wallet=${encodeURIComponent(accounts[0])}`).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { profile: { handle: string } };
        setHandle(payload.profile.handle);
        setIsVerified(true);
      }).catch(() => undefined);
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
      const verified = await verifyResponse.json() as { error?: string; token?: string };
      if (!verifyResponse.ok) throw new Error(verified.error ?? "Unable to verify the wallet signature.");
      if (verified.token) {
        setSessionToken(verified.token);
        window.localStorage.setItem(`saypay-session:${walletAddress.replace(/\s/g, "").toUpperCase()}`, verified.token);
      }
      setIsVerified(true);
      setProfileStatus(`@${handle} is now verified to your Nimiq wallet.`);
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : "The profile claim was not completed.");
    } finally {
      setClaiming(false);
    }
  }

  async function confirmAction() {
    if (flow === "invoice" || flow === "split") {
      if (!sessionToken) {
        setWalletStatus("Verify your SayPay ID in Nimiq Pay before creating inbox items.");
        return;
      }
      if (plan.currency !== "NIM") {
        setWalletStatus("USDT requests and splits are next. Create this NIM flow first.");
        return;
      }
      if (!plan.handles.length) {
        setWalletStatus(`Add a SayPay ID such as @ada in your ${flow === "split" ? "split" : "invoice"} message.`);
        return;
      }
      const amount = plan.amount ?? Number(plan.title.match(/(\d+(?:\.\d+)?)/)?.[1]);
      if (!amount) {
        setWalletStatus("Add an amount in NIM before continuing.");
        return;
      }
      try {
        const endpoint = flow === "split" ? "/api/splits" : "/api/requests";
        const body = flow === "split" ? { participantHandles: plan.handles, amount, note: plan.note } : { recipientHandle: plan.handles[0], amount, note: plan.note, kind: "invoice" };
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify(body) });
        const result = await response.json() as { error?: string; request?: { id: string }; split?: { id: string } };
        if (!response.ok) throw new Error(result.error ?? "Unable to create this item.");
        setDone(true);
        setShareUrl(flow === "invoice" && result.request?.id ? `${window.location.origin}/request/${result.request.id}` : flow === "split" && result.split?.id ? `${window.location.origin}/split/${result.split.id}` : "");
        setWalletStatus(flow === "split" ? "Split invitations are in your friends’ SayPay inboxes." : "Your invoice has been created and is ready to share.");
      } catch (error) {
        setWalletStatus(error instanceof Error ? error.message : "Unable to create this item.");
      }
      return;
    }
    if (!walletAddress) {
      setWalletStatus("Connect Nimiq Pay before sending money.");
      return;
    }
    try {
      let recipientAddress = contactAddress.trim();
      let recipientLabel = contactName;
      if (plan.handles[0]) {
        const profileResponse = await fetch(`/api/profile?handle=${encodeURIComponent(plan.handles[0])}`);
        const profile = await profileResponse.json() as { profile?: { walletAddress: string; handle: string }; error?: string };
        if (!profileResponse.ok || !profile.profile) throw new Error(profile.error ?? "That SayPay ID was not found.");
        recipientAddress = profile.profile.walletAddress;
        recipientLabel = `@${profile.profile.handle}`;
      }
      if (!recipientAddress) throw new Error(`Add ${contactName}'s Nimiq address or use a verified SayPay ID such as @ada.`);
      if (!plan.handles.length && plan.recipient.toLowerCase() !== contactName.toLowerCase()) throw new Error(`Use a verified SayPay ID such as @ada, or choose ${contactName} from Contacts.`);
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const amount = plan.amount ?? Number(plan.title.match(/(\d+(?:\.\d+)?)/)?.[1]);
      if (!amount) throw new Error("Missing payment amount");
      const value = nimToLunas(amount);
      const transaction = await nimiq.sendBasicTransactionWithData({ recipient: recipientAddress, value, data: plan.note.slice(0, 64) });
      if (typeof transaction !== "string") throw new Error("Nimiq Pay did not return a transaction result.");
      if (sessionToken) {
        await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ kind: "payment", title: `Sent to ${recipientLabel}`, amountLunas: value, transactionReference: transaction }) });
      }
      setDone(true);
      setWalletStatus("Payment sent through Nimiq Pay.");
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : "The payment was not sent. Check the recipient and approve the native Nimiq Pay prompt.");
    }
  }

  function pickFlow(next: Flow) {
    setFlow(next);
    setMessage(flows[next].prompt);
    setPlan(parsePlan(flows[next].prompt, next));
    setReviewing(false);
    setDone(false);
    setShareUrl("");
    setTab(next === "protect" ? "protect" : "home");
  }

  // Keyword matching and regex. Still the path when the interpreter is
  // unreachable or the user has not verified their SayPay ID, so typing a
  // payment never stops working.
  function submitLocally() {
    const text = message.toLowerCase();
    const next: Flow = text.includes("protect") || text.includes("delivery") || text.includes("arbiter")
      ? "protect"
      : text.includes("split")
        ? "split"
        : text.includes("invoice")
          ? "invoice"
          : "send";
    setFlow(next);
    setPlan(parsePlan(message, next));
    setTab(next === "protect" ? "protect" : "home");
    setReviewing(true);
    setDone(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || interpreting) return;
    setDone(false);

    if (!sessionToken) {
      submitLocally();
      return;
    }

    setInterpreting(true);
    try {
      const response = await fetch("/api/intent", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ message }) });
      const result = await response.json() as { intent?: ParsedIntent; error?: string };
      if (!response.ok || !result.intent) throw new Error(result.error ?? "Could not read that.");

      // One thing is missing or ambiguous. Ask rather than guess, and leave the
      // message in place so the user can edit instead of retyping.
      if (result.intent.confidence === "needs_clarification") {
        setWalletStatus(result.intent.question ?? "Could you say that a different way?");
        setReviewing(false);
        return;
      }

      const { plan: next, flow: nextFlow } = planFromIntent(result.intent, message);
      setFlow(nextFlow);
      setPlan(next);
      setTab(nextFlow === "protect" ? "protect" : "home");
      setReviewing(true);
      setWalletStatus("Review the plan, then confirm in Nimiq Pay.");
    } catch {
      // A failed interpretation must never block a payment.
      submitLocally();
      setWalletStatus("Read that offline. Check the plan carefully before confirming.");
    } finally {
      setInterpreting(false);
    }
  }

  function startVoiceInput() {
    if (!voiceEnabled) {
      setWalletStatus("Turn voice input on during onboarding to use the microphone.");
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setWalletStatus("Voice input is unavailable in this browser. You can still type every payment request.");
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = speechLanguage(language);
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim().replace(/\bat\s+([a-z0-9][a-z0-9-]{2,23})\b/gi, "@$1");
      if (transcript) {
        setMessage(transcript);
        setPlan(parsePlan(transcript, flow));
        setReviewing(false);
        setDone(false);
        setWalletStatus("Voice note captured. Review the plan before confirming.");
      }
    };
    recognition.onerror = (event) => {
      setWalletStatus(event.error === "not-allowed" ? "Microphone access was not allowed. You can still type your request." : "Voice input could not understand that. Please try again or type it.");
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return (
    <main className="app-shell">
      <section className="app-frame" aria-label="SayPay payment assistant">
        {!onboarded ? <Onboarding step={onboardingStep} walletAddress={walletAddress} walletStatus={walletStatus} connecting={connecting} onConnect={connectWallet} onBack={() => setOnboardingStep((current) => Math.max(0, current - 1))} onNext={() => setOnboardingStep((current) => Math.min(1, current + 1))} onFinish={() => setOnboarded(true)} /> : <>
          {!reviewing && <header className={`topbar ${tab === "home" ? "home-topbar" : ""}`}>
            {tab === "home" ? <span /> : <div className="brand">SayPay</div>}
            <button className="wallet-dot" onClick={() => walletAddress ? setTab("profile") : connectWallet()} aria-label="Open your payment identity">{walletAddress ? "●" : "○"}</button>
          </header>}

        {tab === "profile" ? (
          <Profile walletAddress={walletAddress} sayPayId={sayPayId} paymentLink={paymentLink} handle={handle} isVerified={isVerified} profileStatus={profileStatus} claiming={claiming} onHandle={setHandle} onClaim={claimHandle} onConnect={connectWallet} onHome={() => setTab("home")} />
        ) : tab === "activity" ? (
          <Activity walletAddress={walletAddress} sessionToken={sessionToken} balance={balance} onReturn={() => setTab("home")} />
        ) : tab === "protect" ? (
          <Protected active={active} reviewing={reviewing} done={done} onReview={() => setReviewing(true)} onConfirm={() => setDone(true)} />
        ) : reviewing ? (
          <PaymentReview flow={flow} plan={plan} message={message} done={done} onBack={() => setReviewing(false)} onConfirm={confirmAction} />
        ) : (
          <section className="home-view">
            <div className="home-hero">
              <div><h1>SayPay</h1><p>What would you like to do?</p></div>
              <button className="scan-button" onClick={() => setTab("profile")} aria-label="Show your payment QR">⌘</button>
            </div>

            <form className="composer" onSubmit={submit}>
              <input aria-label="Describe a payment" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Say something…" />
              <button type="button" className={`mic ${listening ? "listening" : ""}`} onClick={startVoiceInput} aria-label={listening ? "Listening for a payment request" : "Use voice input"}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" /></svg>
              </button>
              <button type="submit" className="send" disabled={interpreting || !message.trim()} aria-label="Create payment plan">{interpreting ? "…" : "→"}</button>
            </form>
            <p className="composer-hint"><span>⌁</span> {interpreting ? "Reading what you said…" : "Type or speak naturally."}</p>
            <div className="quick-grid" aria-label="Quick actions">
              {(Object.keys(flows) as Flow[]).map((key) => (
                <button className={`quick-action ${flow === key ? "selected" : ""}`} key={key} onClick={() => pickFlow(key)}>
                  <span className={`action-icon ${key}`}>{flows[key].icon}</span>
                  <span>{flows[key].label}</span>
                </button>
              ))}
            </div>
            {walletStatus && <p className={`action-status ${walletAddress ? "" : "quiet"}`}>{walletStatus}</p>}
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

function Onboarding({ step, walletAddress, walletStatus, connecting, onConnect, onBack, onNext, onFinish }: { step: number; walletAddress: string; walletStatus: string; connecting: boolean; onConnect: () => void; onBack: () => void; onNext: () => void; onFinish: () => void }) {
  const last = step === 1;
  return <section className="onboarding">
    <div className="onboarding-top"><div className="brand">SayPay</div><span>{step + 1} of 2</span></div>
    <div className="progress"><i style={{ width: `${(step + 1) * 50}%` }} /></div>
    {step === 0 && <div className="onboard-content"><span className="hero-mark">✦</span><p className="eyebrow">CLEAR PAYMENTS, ALWAYS</p><h1>Money should understand you.</h1><p>Type or speak what you need. SayPay turns it into a payment, split, or invoice that you can review before approval.</p><div className="promise"><span>✓</span><div><strong>Your wallet stays yours</strong><small>Nimiq Pay keeps your keys and approves every payment.</small></div></div><div className="promise"><span>✓</span><div><strong>Your SayPay ID stays simple</strong><small>Claim one verified ID to receive requests and payments.</small></div></div></div>}
    {step === 1 && <div className="onboard-content"><span className="hero-mark">◇</span><p className="eyebrow">YOUR SECURE PAYMENT LAYER</p><h1>Continue with Nimiq Pay.</h1><p>Nimiq Pay creates and protects the wallet. SayPay uses it to show your balance, verify your ID, and request payment approval.</p><div className={`wallet-panel ${walletAddress ? "connected" : ""}`}><span className="choice-icon">◇</span><div><strong>{walletAddress ? "Wallet connected" : "Nimiq Pay wallet"}</strong><small>{walletAddress ? `${walletAddress.slice(0, 11)}…${walletAddress.slice(-6)}` : walletStatus}</small></div></div><button className="primary" onClick={onConnect} disabled={connecting}>{connecting ? "Opening Nimiq Pay…" : walletAddress ? "Connected" : "Connect Nimiq Pay"}</button><p className="onboard-note">Outside Nimiq Pay, you can explore SayPay. Sending, wallet balance, and ID verification require Nimiq Pay.</p></div>}
    <div className={`onboard-actions ${step === 0 ? "first-step" : ""}`}>{step === 0 ? <><button className="back" onClick={onFinish}>Explore first</button><button className="primary" onClick={onNext}>Continue</button></> : <><button className="back" onClick={onBack}>Back</button><button className="primary" onClick={onFinish}>{walletAddress ? "Start using SayPay" : "Explore SayPay"}</button></>}</div>
  </section>;
}

function PaymentReview({ flow, plan, message, done, onBack, onConfirm }: { flow: Flow; plan: ParsedPlan; message: string; done: boolean; onBack: () => void; onConfirm: () => void }) {
  return <section className="payment-review-view">
    <button className="review-back" onClick={onBack} aria-label="Return to SayPay">←</button>
    <h1>SayPay</h1>
    <div className="review-message"><p>{message}</p><span>Now</span></div>
    <ActionCard flow={flow} plan={plan} reviewing done={done} onReview={() => undefined} onConfirm={onConfirm} />
  </section>;
}

function ActionCard({ flow, plan, reviewing, done, onReview, onConfirm }: { flow: Flow; plan?: ParsedPlan; reviewing: boolean; done: boolean; onReview: () => void; onConfirm: () => void }) {
  const item = flows[flow];
  const primary = flow === "invoice" ? "Create invoice" : flow === "protect" ? "Review deal" : "Review payment";
  const confirmed = flow === "invoice" ? "Invoice link ready" : flow === "protect" ? "Deal ready to fund" : "Ready for Nimiq Pay";

  return (
    <article className={`action-card flow-${flow}`}>
      <div className="card-heading">
        <span className="card-symbol">{flow === "protect" ? "◇" : flow === "invoice" ? "□" : flow === "split" ? "◌" : "↗"}</span>
        <div><p>{flow === "protect" ? "Protected Pay" : "Payment plan"}</p><h2>{plan?.title ?? item.title}</h2></div>
      </div>
      <div className="card-row"><span>{flow === "split" ? "People" : flow === "invoice" ? "For" : flow === "protect" ? "Milestone" : "To"}</span><strong>{plan?.recipient ?? (flow === "split" ? "Ada · Tunde" : flow === "invoice" ? "Website design" : flow === "protect" ? "Logo delivery" : "Mum")}</strong></div>
      <div className="card-row"><span>Note</span><strong>{plan?.note ?? item.detail}</strong></div>
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

function Activity({ walletAddress, sessionToken, balance, onReturn }: { walletAddress: string; sessionToken: string; balance: string | null; onReturn: () => void }) {
  const [requests, setRequests] = useState<Array<{ id: string; creatorWallet: string; kind: string; amountLunas: number; note: string; status: string }>>([]);
  const [splits, setSplits] = useState<Array<{ participant: { id: string; shareLunas: number; status: string }; split: { id: string; note: string; status: string } }>>([]);
  const [activityItems, setActivityItems] = useState<Array<{ id: string; kind: string; title: string; amountLunas: number | null; status: string }>>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!sessionToken) return;
    const headers = { Authorization: `Bearer ${sessionToken}` };
    Promise.all([fetch("/api/requests", { headers }), fetch("/api/splits", { headers }), fetch("/api/activity", { headers })]).then(async ([requestResponse, splitResponse, activityResponse]) => {
      if (requestResponse.ok) setRequests((await requestResponse.json() as { requests: Array<{ id: string; creatorWallet: string; kind: string; amountLunas: number; note: string; status: string }> }).requests);
      if (splitResponse.ok) setSplits((await splitResponse.json() as { invited: Array<{ participant: { id: string; shareLunas: number; status: string }; split: { id: string; note: string; status: string } }> }).invited);
      if (activityResponse.ok) setActivityItems((await activityResponse.json() as { activity: Array<{ id: string; kind: string; title: string; amountLunas: number | null; status: string }> }).activity);
    }).catch(() => setStatus("Your inbox could not refresh right now."));
  }, [sessionToken]);

  return <section className="activity-view"><div className="intro"><p className="eyebrow">YOUR MONEY, CLEARLY</p><h1>Your Inbox</h1><p>Requests, split invitations, and completed payment activity.</p></div>{walletAddress && <div className="inbox-balance"><span>Wallet balance</span><strong>{balance === null ? "Loading NIM…" : `${balance} NIM`}</strong></div>}{!sessionToken ? <div className="inbox-empty"><span>◇</span><strong>Verify your SayPay ID</strong><p>Sign once in Nimiq Pay to receive requests and split invitations here.</p></div> : <><h2 className="section-label">NEEDS YOUR ACTION</h2><div className="activity-list">{requests.filter((item) => item.creatorWallet !== walletAddress.replace(/\s/g, "").toUpperCase() && item.status === "open").map((item) => <article key={item.id}><span className="activity-icon blue">□</span><div><strong>{item.kind === "invoice" ? "Invoice" : "Payment request"}</strong><p>{item.note}</p></div><b>{item.amountLunas / 100_000} NIM</b></article>)}{splits.filter((item) => item.participant.status === "pending").map((item) => <article key={item.participant.id}><span className="activity-icon amber">◌</span><div><strong>Split invitation</strong><p>{item.split.note}</p></div><b>{item.participant.shareLunas / 100_000} NIM</b></article>)}{!requests.some((item) => item.creatorWallet !== walletAddress.replace(/\s/g, "").toUpperCase() && item.status === "open") && !splits.some((item) => item.participant.status === "pending") && <div className="inbox-empty"><span>✓</span><strong>You’re all caught up</strong><p>New requests and split invitations will appear here.</p></div>}</div>{activityItems.length > 0 && <><h2 className="section-label">RECENT ACTIVITY</h2><div className="activity-list">{activityItems.map((item) => <article key={item.id}><span className={`activity-icon ${item.kind === "split" ? "amber" : item.kind === "invoice" ? "blue" : "green"}`}>{item.kind === "split" ? "◌" : item.kind === "invoice" ? "□" : "↗"}</span><div><strong>{item.title}</strong><p>{item.status === "submitted" ? "Sent to Nimiq Pay" : item.status}</p></div>{item.amountLunas && <b>{item.amountLunas / 100_000} NIM</b>}</article>)}</div></>}{status && <p className="profile-status">{status}</p>}</>}<button className="outline" onClick={onReturn}>Create a payment</button></section>;
}

function Profile({ walletAddress, sayPayId, paymentLink, handle, isVerified, profileStatus, claiming, onHandle, onClaim, onConnect, onHome }: { walletAddress: string; sayPayId: string; paymentLink: string; handle: string; isVerified: boolean; profileStatus: string; claiming: boolean; onHandle: (value: string) => void; onClaim: () => void; onConnect: () => void; onHome: () => void }) {
  return <section className="profile-view"><button className="back-link" onClick={onHome}>← Back</button><p className="eyebrow">YOUR PAYMENT ID</p><h1>Get paid in seconds.</h1><p className="profile-copy">Claim a SayPay ID once, then share it as a QR or payment link. Your wallet address stays in the secure payment layer.</p>{walletAddress ? <><div className="identity-card"><div className="identity-avatar">SP</div><div><strong>{sayPayId}</strong><small>{isVerified ? "Verified Nimiq wallet" : "Choose and verify your ID"}</small></div>{isVerified && <span className="verified">✓</span>}</div><label className="handle-input">Your SayPay ID<span>@</span><input value={handle} onChange={(event) => onHandle(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={24} disabled={isVerified} /></label>{!isVerified && <button className="outline claim" onClick={onClaim} disabled={claiming}>{claiming ? "Requesting wallet signature…" : "Verify this ID with Nimiq Pay"}</button>}{profileStatus && <p className="profile-status">{profileStatus}</p>}{isVerified && <><div className="qr-card"><QRCodeSVG value={paymentLink} size={178} bgColor="#fffdfa" fgColor="#10184d" level="M" includeMargin /><strong>Scan to pay {sayPayId}</strong><small>Opens SayPay in Nimiq Pay, ready to pay your verified ID.</small></div><label className="share-link">Your Nimiq Pay payment link<input readOnly value={paymentLink} onFocus={(event) => event.target.select()} /></label><button className="primary" onClick={() => navigator.clipboard?.writeText(paymentLink)}>Copy payment link</button></>}</> : <div className="empty-identity"><span>◇</span><h2>Continue with Nimiq Pay</h2><p>Your Nimiq wallet becomes the secure foundation for your SayPay ID.</p><button className="primary" onClick={onConnect}>Continue with Nimiq Pay</button></div>}</section>;
}

function languageName(code: string) {
  return ({ en: "English", de: "German", es: "Spanish" } as Record<string, string>)[code] ?? "English";
}

function speechLanguage(language: string) {
  return ({ English: "en-US", "Nigerian Pidgin": "en-NG", German: "de-DE", Spanish: "es-ES" } as Record<string, string>)[language] ?? "en-US";
}
