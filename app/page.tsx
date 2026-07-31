"use client";

import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ParsedIntent } from "./api/_lib/intent-schema";
import { lunasToNim, nimToLunas, truncateAddress } from "./_lib/units";

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
// Home, Activity and Protect are the bar. Profile sits behind the avatar and
// Contacts and Send money are reached from a flow, not navigated to.
type Tab = "home" | "activity" | "protect" | "profile" | "contacts" | "sendMoney";
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

type InboxRequest = { id: string; creatorWallet: string; kind: string; amountLunas: number; note: string; status: string };
type InboxSplit = { participant: { id: string; shareLunas: number; status: string }; split: { id: string; note: string; status: string } };
type ActivityItem = { id: string; kind: string; title: string; amountLunas: number | null; status: string };
type ContactRow = { walletAddress: string; nickname: string; handle: string | null };

// One fetch of everything the signed-in user needs to see, shared by the home
// screen and the inbox so they cannot drift apart or double-fetch.
function useInbox(sessionToken: string) {
  const [requests, setRequests] = useState<InboxRequest[]>([]);
  const [splits, setSplits] = useState<InboxSplit[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!sessionToken) return;
    const headers = { Authorization: `Bearer ${sessionToken}` };
    Promise.all([fetch("/api/requests", { headers }), fetch("/api/splits", { headers }), fetch("/api/activity", { headers }), fetch("/api/contacts", { headers })])
      .then(async ([requestResponse, splitResponse, activityResponse, contactResponse]) => {
        if (requestResponse.ok) setRequests((await requestResponse.json() as { requests: InboxRequest[] }).requests);
        if (splitResponse.ok) setSplits((await splitResponse.json() as { invited: InboxSplit[] }).invited);
        if (activityResponse.ok) setActivityItems((await activityResponse.json() as { activity: ActivityItem[] }).activity);
        if (contactResponse.ok) setContacts((await contactResponse.json() as { contacts: ContactRow[] }).contacts);
      })
      .catch(() => setStatus("Your inbox could not refresh right now."));
  }, [sessionToken]);

  return { requests, splits, activityItems, contacts, status };
}

// Requests someone else opened against you, still unpaid.
function incomingRequests(requests: InboxRequest[], walletAddress: string) {
  const me = walletAddress.replace(/\s/g, "").toUpperCase();
  return requests.filter((item) => item.creatorWallet !== me && item.status === "open");
}

function pendingSplits(splits: InboxSplit[]) {
  return splits.filter((item) => item.participant.status === "pending");
}

function initialsFor(name: string) {
  return name.replace(/^@/, "").slice(0, 2).toUpperCase();
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
  const [testingSignature, setTestingSignature] = useState(false);
  const [linkingWallet, setLinkingWallet] = useState(false);
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
  const [tab, setTab] = useState<Tab>("home");

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
      const response = await fetch("https://rpc.nimiqwatch.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "getAccountByAddress", params: [address], id: 1 }) });
      const payload = await response.json() as { result?: { data?: { balance?: number }; balance?: number } };
      const accountBalance = payload.result?.data?.balance ?? payload.result?.balance;
      if (typeof accountBalance === "number") setBalance((accountBalance / 100_000).toLocaleString(undefined, { maximumFractionDigits: 5 }));
      else setBalance("0");
    } catch {
      setBalance(null);
    }
  }

  async function connectWallet() {
    setConnecting(true);
    setWalletStatus("Waiting for Nimiq Pay…");
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const consensusReady = await nimiq.isConsensusEstablished();
      if (!consensusReady) throw new Error("Nimiq Pay is open, but its Nimiq network is still connecting. Wait a moment and try again.");
      setWalletStatus("Nimiq Pay found. Approve the account request in the native dialog.");
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
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown connection error.";
      setWalletStatus(`Nimiq Pay connection did not complete: ${reason}`);
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
      // Use the simplest documented call shape. The payload is one-line ASCII
      // and the wallet receives it as a normal text message.
      const signed = await nimiq.sign(challenge.message);
      if ("error" in signed) throw new Error(signed.error.message);
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

  async function testWalletSignature() {
    if (!walletAddress) {
      setProfileStatus("Connect Nimiq Pay before testing wallet signing.");
      return;
    }
    setTestingSignature(true);
    setProfileStatus("Requesting a short test signature from Nimiq Pay…");
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const signed = await nimiq.sign("SayPay");
      if ("error" in signed) throw new Error(signed.error.message);
      if (!signed.signature || !signed.publicKey) throw new Error("Nimiq Pay returned an incomplete test signature.");
      setProfileStatus("Nimiq Pay signing works. You can now verify your SayPay ID.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown signing error.";
      setProfileStatus(`Nimiq Pay could not sign a plain test message: ${reason}`);
    } finally {
      setTestingSignature(false);
    }
  }

  async function linkConnectedWallet() {
    if (!walletAddress) {
      setProfileStatus("Connect Nimiq Pay before linking your SayPay ID.");
      return;
    }
    setLinkingWallet(true);
    setProfileStatus("Reserving your SayPay ID for the connected Nimiq Pay account…");
    try {
      const challengeResponse = await fetch("/api/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress, handle }) });
      const challenge = await challengeResponse.json() as { nonce?: string; error?: string };
      if (!challengeResponse.ok || !challenge.nonce) throw new Error(challenge.error ?? "Unable to start the wallet link.");
      const linkResponse = await fetch("/api/auth/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: challenge.nonce, walletAddress, language }) });
      const linked = await linkResponse.json() as { error?: string; token?: string };
      if (!linkResponse.ok || !linked.token) throw new Error(linked.error ?? "Unable to link this wallet.");
      setSessionToken(linked.token);
      window.localStorage.setItem(`saypay-session:${walletAddress.replace(/\s/g, "").toUpperCase()}`, linked.token);
      setIsVerified(true);
      setProfileStatus(`@${handle} is linked to this Nimiq Pay account. Every payment still needs Nimiq Pay approval.`);
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : "The wallet link was not completed.");
    } finally {
      setLinkingWallet(false);
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
        {tab === "profile" ? (
          <Profile walletAddress={walletAddress} sayPayId={sayPayId} paymentLink={paymentLink} handle={handle} isVerified={isVerified} profileStatus={profileStatus} claiming={claiming} testingSignature={testingSignature} linkingWallet={linkingWallet} onHandle={setHandle} onClaim={claimHandle} onTestSignature={testWalletSignature} onLinkWallet={linkConnectedWallet} onConnect={connectWallet} onHome={() => setTab("home")} />
        ) : tab === "activity" ? (
          <Activity walletAddress={walletAddress} sessionToken={sessionToken} balance={balance} onReturn={() => setTab("home")} />
        ) : tab === "contacts" ? (
          <Contacts sessionToken={sessionToken} onBack={() => setTab("home")} onPay={(who) => { setMessage(`Send  NIM to ${who}`); setTab("sendMoney"); }} />
        ) : tab === "protect" ? (
          <Protected onBack={() => setTab("home")} />
        ) : reviewing ? (
          <PaymentReview flow={flow} plan={plan} message={message} done={done} onBack={() => setReviewing(false)} onConfirm={confirmAction} />
        ) : tab === "sendMoney" ? (
          <SendMoney
            sessionToken={sessionToken}
            balance={balance}
            message={message}
            interpreting={interpreting}
            onBack={() => setTab("home")}
            onSubmit={submit}
            onMessage={setMessage}
          />
        ) : (
          <HomeView
            walletAddress={walletAddress}
            sessionToken={sessionToken}
            message={message}
            interpreting={interpreting}
            listening={listening}
            walletStatus={walletStatus}
            onMessage={setMessage}
            onSubmit={submit}
            onVoice={startVoiceInput}
            onPickFlow={(next) => { pickFlow(next); if (next === "send") setTab("sendMoney"); else if (next === "protect") setTab("protect"); else setReviewing(true); }}
            onOpenProfile={() => setTab("profile")}
            onOpenActivity={() => setTab("activity")}
            onConnect={connectWallet}
          />
        )}

        {!reviewing && <nav className="tabbar" aria-label="Main navigation">
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><Icon name="home" className="tab-icon" />Home</button>
          <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}><Icon name="list" className="tab-icon" />Activity</button>
          <button className={tab === "protect" ? "active" : ""} onClick={() => setTab("protect")}><Icon name="shield" className="tab-icon" />Protect</button>
        </nav>}
        </>}
      </section>
    </main>
  );
}

// One drawn icon set. Text glyphs took emoji presentation on iOS, so the bar
// came out as a mix of line art and colour emoji.
const ICONS: Record<string, string> = {
  home: "M3 10.4 12 3.2l9 7.2M5.6 9.3V20h12.8V9.3",
  list: "M4 7h16M4 12h16M4 17h11",
  shield: "M12 3.2 5 6v5.6c0 4.3 3 8.2 7 9.2 4-1 7-4.9 7-9.2V6z",
  person: "M12 12.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4M4.6 21a7.4 7.4 0 0 1 14.8 0",
  send: "M5 19 20 12 5 5l2.2 7z",
  arrow: "M7 17 17 7M9 7h8v8",
  people: "M2.5 20c0-2.6 2.4-4.3 6-4.3S14.5 17.4 14.5 20M8.5 13.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8M17 20c0-2.1-1-3.5-2.6-4.2M16 12.8a3 3 0 0 0 0-6",
  doc: "M14 3H7a1.6 1.6 0 0 0-1.6 1.6v14.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6V7.6zM14 3v4.6h4.6M9 13h6M9 17h4",
  wallet: "M3.5 8.5A1.5 1.5 0 0 1 5 7h13a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 18 18H5a1.5 1.5 0 0 1-1.5-1.5zM3.5 10.5h17M16 14h1.5",
  mic: "M12 3.5a2.8 2.8 0 0 0-2.8 2.8v5a2.8 2.8 0 0 0 5.6 0v-5A2.8 2.8 0 0 0 12 3.5M5.8 11a6.2 6.2 0 0 0 12.4 0M12 17.4V21M8.8 21h6.4",
  check: "m5 12.5 4.5 4.5L19 7",
  lock: "M6.6 10.5h10.8V20H6.6zM8.8 10.5V7.6a3.2 3.2 0 0 1 6.4 0v2.9",
  clock: "M12 6.6V12l3.4 2M20.4 12a8.4 8.4 0 1 1-16.8 0 8.4 8.4 0 0 1 16.8 0",
  calendar: "M7.5 3.5v3M16.5 3.5v3M4 9.2h16M4.8 5.5h14.4V20H4.8z",
  image: "M4.5 5.5h15v13h-15zM4.5 15l4-3.6 3.4 2.8 3.2-3.2 4.4 4M9 10.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4",
  plus: "M12 5.5v13M5.5 12h13",
};

function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

// Activity is recorded from the payer's side, so anything not explicitly
// received is money leaving. Never infer a credit — a "+" on a debit is the one
// mistake a payments list must not make.
function isCredit(item: ActivityItem) {
  return item.kind === "received" || /^from\b/i.test(item.title);
}

function avatarTone(kind: string) {
  if (kind === "split") return "violet";
  if (kind === "received") return "green";
  return "";
}

const FLOW_META: Record<Flow, { label: string; icon: keyof typeof ICONS }> = {
  send: { label: "Send money", icon: "arrow" },
  split: { label: "Split a bill", icon: "people" },
  invoice: { label: "Create invoice", icon: "doc" },
  protect: { label: "Protected Pay", icon: "shield" },
};

// Home leads with the composer because saying it is the product. The four
// shortcuts sit underneath for the times you would rather just tap.
function HomeView({ walletAddress, sessionToken, message, interpreting, listening, walletStatus, onMessage, onSubmit, onVoice, onPickFlow, onOpenProfile, onOpenActivity, onConnect }: {
  walletAddress: string; sessionToken: string; message: string; interpreting: boolean; listening: boolean; walletStatus: string;
  onMessage: (value: string) => void; onSubmit: (event: FormEvent) => void; onVoice: () => void; onPickFlow: (flow: Flow) => void; onOpenProfile: () => void; onOpenActivity: () => void; onConnect: () => void;
}) {
  const { requests, splits, activityItems } = useInbox(sessionToken);
  const waiting = incomingRequests(requests, walletAddress).length + pendingSplits(splits).length;
  const recent = activityItems.slice(0, 3);

  return (
    <section className="home-view">
      <div className="home-top">
        <button className="avatar-btn" onClick={() => (walletAddress ? onOpenProfile() : onConnect())} aria-label="Your profile">
          <Icon name="person" />
        </button>
      </div>

      <h1 className="wordmark">SayPay</h1>
      <p className="home-sub">What would you like to do?</p>

      <form className="say-box" onSubmit={onSubmit}>
        <input aria-label="Say what you want to do" value={message} onChange={(event) => onMessage(event.target.value)} placeholder="Say something…" />
        {message.trim() ? (
          <button type="submit" className="say-go" disabled={interpreting} aria-label="Read this">{interpreting ? "…" : "→"}</button>
        ) : (
          <button type="button" className={`say-mic ${listening ? "listening" : ""}`} onClick={onVoice} aria-label="Use voice input"><Icon name="mic" /></button>
        )}
      </form>

      <div className="flow-grid">
        {(Object.keys(FLOW_META) as Flow[]).map((key) => (
          <button className="flow-card" key={key} onClick={() => onPickFlow(key)}>
            <span className={`flow-mark ${key}`}><Icon name={FLOW_META[key].icon} /></span>
            {FLOW_META[key].label}
          </button>
        ))}
      </div>

      {waiting > 0 && (
        <>
          <div className="section-head"><h2>Needs you</h2><button onClick={onOpenActivity}>View all</button></div>
          <div className="list-card">
            {incomingRequests(requests, walletAddress).map((item) => (
              <button key={item.id} className="list-row" onClick={onOpenActivity}>
                <span className="avatar"><Icon name="doc" className="tab-icon" /></span>
                <div><strong>{item.kind === "invoice" ? "Invoice" : "Payment request"}</strong><p>{item.note}</p></div>
                <span className="list-amount"><b>{lunasToNim(item.amountLunas)} NIM</b></span>
              </button>
            ))}
            {pendingSplits(splits).map((item) => (
              <button key={item.participant.id} className="list-row" onClick={onOpenActivity}>
                <span className="avatar violet"><Icon name="people" className="tab-icon" /></span>
                <div><strong>Split invitation</strong><p>{item.split.note}</p></div>
                <span className="list-amount"><b>{lunasToNim(item.participant.shareLunas)} NIM</b></span>
              </button>
            ))}
          </div>
        </>
      )}

      {recent.length > 0 && (
        <>
          <div className="section-head"><h2>Recent</h2><button onClick={onOpenActivity}>View all</button></div>
          <div className="list-card">
            {recent.map((item) => (
              <div key={item.id} className="list-row">
                <span className={`avatar ${avatarTone(item.kind)}`}>{initialsFor(item.title.replace(/^(to|from)\s+/i, ""))}</span>
                <div><strong>{item.title}</strong><p>{item.status === "submitted" ? "Sent to Nimiq Pay" : item.status}</p></div>
                <span className="list-amount">{item.amountLunas !== null && <b className={isCredit(item) ? "credit" : ""}>{isCredit(item) ? "+" : "−"} {lunasToNim(item.amountLunas)} NIM</b>}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {walletStatus && <p className="action-status">{walletStatus}</p>}
    </section>
  );
}

function seedFromMessage(message: string) {
  const parsed = message.match(/^Send\s+([\d.]*)\s*(NIM|USDT)?\s*to\s+(.+?)(?:\s+for\s+(.+))?$/i);
  if (!parsed) return { amount: "", asset: "NIM" as const, recipient: "", note: "" };
  return {
    amount: parsed[1] ?? "",
    asset: (parsed[2]?.toUpperCase() === "USDT" ? "USDT" : "NIM") as "NIM" | "USDT",
    recipient: parsed[3].trim(),
    note: parsed[4]?.trim() ?? "",
  };
}

// The explicit form, for when someone knows exactly what they want. It composes
// the same sentence the interpreter would read and hands off to the same review
// step, so both entry paths converge rather than forking the logic.
function SendMoney({ sessionToken, balance, message, interpreting, onBack, onSubmit, onMessage }: {
  sessionToken: string; balance: string | null; message: string; interpreting: boolean;
  onBack: () => void; onSubmit: (event: FormEvent) => void; onMessage: (value: string) => void;
}) {
  const { contacts } = useInbox(sessionToken);
  // Seeded once at mount. The screen remounts on every entry, so there is
  // nothing to keep in sync afterwards, and a syncing effect could yank a field
  // out from under someone mid-edit.
  const [seed] = useState(() => seedFromMessage(message));
  const [recipient, setRecipient] = useState(seed.recipient);
  const [amount, setAmount] = useState(seed.amount);
  const [note, setNote] = useState(seed.note);
  const [asset, setAsset] = useState<"NIM" | "USDT">(seed.asset);

  const chosen = contacts.find((contact) => (contact.handle ? `@${contact.handle}` : contact.nickname).toLowerCase() === recipient.trim().toLowerCase());
  const ready = recipient.trim() !== "" && Number(amount) > 0;

  function review(event: FormEvent) {
    event.preventDefault();
    onMessage(`Send ${amount} ${asset} to ${recipient.trim()}${note.trim() ? ` for ${note.trim()}` : ""}`);
    onSubmit(event);
  }

  return (
    <form className="send-view" onSubmit={review}>
      <div className="screen-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">‹</button>
        <h1>Send money</h1>
      </div>

      <div className="field-block">
        <span className="field-title">Who are you sending to?</span>
        <div className="pick">
          <span className="avatar">{recipient.trim() ? initialsFor(recipient) : "?"}</span>
          <div>
            <input className="pick-input" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Name, @handle or NQ address" aria-label="Recipient" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <small>{chosen ? truncateAddress(chosen.walletAddress) : recipient.trim() ? "Not in your contacts yet" : "Pick someone or paste an address"}</small>
          </div>
        </div>
        {contacts.length > 0 && (
          <div className="pick-row">
            {contacts.slice(0, 6).map((contact) => (
              <button type="button" key={contact.walletAddress} className="pick-chip" onClick={() => setRecipient(contact.handle ? `@${contact.handle}` : contact.nickname)}>
                <span className="avatar">{initialsFor(contact.handle ?? contact.nickname)}</span>{contact.nickname}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field-block">
        <span className="field-title">How much?</span>
        <div className="amount-field">
          <input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" inputMode="decimal" aria-label="Amount" />
          <button type="button" className="asset-pill" onClick={() => setAsset(asset === "NIM" ? "USDT" : "NIM")}>{asset} ⌄</button>
        </div>
      </div>

      <div className="field-block">
        <span className="field-title">What&rsquo;s it for? <em>(Optional)</em></span>
        <input className="text-field" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Groceries" aria-label="Note" />
      </div>

      <div className="field-block">
        <span className="field-title">Payment method</span>
        <div className="pick">
          <span className="avatar green"><Icon name="wallet" className="tab-icon" /></span>
          <div><strong>Nimiq balance</strong><small>{balance === null ? "Connect Nimiq Pay" : `${balance} NIM`}</small></div>
          <i>›</i>
        </div>
      </div>

      <button className="cta" type="submit" disabled={!ready || interpreting}>{interpreting ? "Reading…" : "Review payment"}</button>
      <p className="confirm-note"><Icon name="lock" className="tab-icon" /> You always confirm in Nimiq Pay.</p>
    </form>
  );
}

function Contacts({ sessionToken, onBack, onPay }: { sessionToken: string; onBack: () => void; onPay: (who: string) => void }) {
  const { contacts } = useInbox(sessionToken);
  return (
    <section className="contacts-view">
      <div className="screen-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">‹</button>
        <h1>Contacts</h1>
      </div>
      {contacts.length === 0 ? (
        <div className="empty-state">
          <span className="empty-mark"><Icon name="people" /></span>
          <h2>No contacts yet</h2>
          <p>{sessionToken ? "People you pay will appear here." : "Verify your SayPay ID to save contacts."}</p>
        </div>
      ) : (
        <div className="list-card">
          {contacts.map((contact) => (
            <button key={contact.walletAddress} className="list-row" onClick={() => onPay(contact.handle ? `@${contact.handle}` : contact.nickname)}>
              <span className="avatar">{initialsFor(contact.handle ?? contact.nickname)}</span>
              <div><strong>{contact.nickname}</strong><p>{contact.handle ? `@${contact.handle}` : truncateAddress(contact.walletAddress)}</p></div>
              <i className="row-chevron">›</i>
            </button>
          ))}
        </div>
      )}
    </section>
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

const CONFIRM_LABEL: Record<Flow, string> = {
  send: "Confirm in Nimiq Pay",
  split: "Send split invitations",
  invoice: "Create invoice",
  protect: "Set up Protected Pay",
};

// Review keeps what you said directly above what SayPay understood, so a
// misread is caught by eye before anything is signed.
function PaymentReview({ flow, plan, message, done, onBack, onConfirm }: { flow: Flow; plan: ParsedPlan; message: string; done: boolean; onBack: () => void; onConfirm: () => void }) {
  const [sentAt] = useState(() => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  const amount = plan.amount ?? Number(plan.title.match(/(\d+(?:\.\d+)?)/)?.[1]);

  return (
    <section className="review-view">
      <div className="screen-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">‹</button>
        <h1 className="wordmark">SayPay</h1>
      </div>

      <p className="said-bubble">{message}</p>
      <p className="said-meta">{sentAt} <b>✓✓</b></p>

      <div className="plan-card">
        <div className="plan-head">
          <span className="plan-mark"><Icon name={FLOW_META[flow].icon} /></span>
          <h2 className="plan-title">{plan.title}</h2>
        </div>

        <div className="plan-row">
          <span className="plan-icon"><Icon name="person" /></span>
          <span className="plan-label">To</span>
          <span className="plan-value">{plan.recipient}</span>
        </div>
        <div className="plan-row">
          <span className="plan-icon"><Icon name="doc" /></span>
          <span className="plan-label">Note</span>
          <span className="plan-value">{plan.note}</span>
        </div>
        <div className="plan-row">
          <span className="plan-icon"><Icon name="wallet" /></span>
          <span className="plan-label">Amount</span>
          <span className="plan-value">{Number.isFinite(amount) ? `${amount} ${plan.currency}` : plan.currency}</span>
        </div>

        {done ? (
          <p className="done-note"><Icon name="check" className="tab-icon" /> Sent through Nimiq Pay.</p>
        ) : (
          <button className="cta" onClick={onConfirm}>{CONFIRM_LABEL[flow]}</button>
        )}
      </div>

      <p className="confirm-note"><Icon name="lock" className="tab-icon" /> You always confirm in Nimiq Pay.</p>
    </section>
  );
}

// Protected Pay as a live deal: state, then who is trusted, then where the
// money actually is. The escrow is not chain-wired yet, so the footnote says so
// rather than letting the timeline imply funds are held.
function Protected({ onBack }: { onBack: () => void }) {
  const steps = [
    { icon: "check" as const, label: "Terms accepted", at: "May 12, 9:15 AM", done: true },
    { icon: "lock" as const, label: "Funds locked", at: "May 12, 9:16 AM", done: true },
    { icon: "clock" as const, label: "Delivery pending", at: "—", done: false },
  ];

  return (
    <section className="protect-view">
      <div className="screen-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">‹</button>
        <h1>Protected Pay</h1>
      </div>

      <div className="state-pill"><Icon name="shield" /> Funds protected</div>

      <div className="deal-card">
        <span className="deal-mark"><Icon name="image" /></span>
        <div>
          <h2>Logo design</h2>
          <span className="deal-amount">80 USDT</span>
          <p className="deal-when"><Icon name="calendar" /> Release by Friday</p>
        </div>
      </div>

      <p className="arbiters-label">Trusted arbiters</p>
      <div className="arbiters-row">
        {["AD", "TU", "KE"].map((who) => <span key={who} className="arbiter">{who}</span>)}
      </div>

      <div className="timeline">
        {steps.map((step) => (
          <div key={step.label} className={`timeline-step ${step.done ? "done" : ""}`}>
            <span><Icon name={step.icon} /></span>
            <strong>{step.label}</strong>
            <small>{step.at}</small>
          </div>
        ))}
      </div>

      <button className="cta">View deal</button>
      <p className="fine-print">Escrow execution is not wired to a chain yet — this deal is illustrative.</p>
    </section>
  );
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

function Profile({ walletAddress, sayPayId, paymentLink, handle, isVerified, profileStatus, claiming, testingSignature, linkingWallet, onHandle, onClaim, onTestSignature, onLinkWallet, onConnect, onHome }: { walletAddress: string; sayPayId: string; paymentLink: string; handle: string; isVerified: boolean; profileStatus: string; claiming: boolean; testingSignature: boolean; linkingWallet: boolean; onHandle: (value: string) => void; onClaim: () => void; onTestSignature: () => void; onLinkWallet: () => void; onConnect: () => void; onHome: () => void }) {
  const busy = claiming || testingSignature || linkingWallet;

  if (!walletAddress) {
    return (
      <section className="profile-view">
        <div className="screen-head">
          <button className="appbar-icon" onClick={onHome} aria-label="Back">‹</button>
          <h1>Profile</h1>
        </div>
        <div className="empty-state">
          <span className="empty-mark">◈</span>
          <h2>Continue with Nimiq Pay</h2>
          <p>Your Nimiq wallet becomes the secure foundation for your SayPay ID.</p>
          <button className="cta" onClick={onConnect}>Continue with Nimiq Pay</button>
        </div>
      </section>
    );
  }

  return (
    <section className="profile-view">
      <div className="screen-head">
        <button className="appbar-icon" onClick={onHome} aria-label="Back">‹</button>
        <h1>Profile</h1>
      </div>

      <div className="id-card">
        <span className="id-avatar">{initialsFor(handle || "SP")}</span>
        <div>
          <strong>{sayPayId}</strong>
          <small>{isVerified ? "Linked Nimiq Pay account" : "Choose and link your ID"}</small>
        </div>
        {isVerified && <span className="id-check">✓</span>}
      </div>

      <div className="field-block">
        <span className="field-title">Your SayPay ID</span>
        <div className="handle-field">
          <span>@</span>
          <input value={handle} onChange={(event) => onHandle(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={24} disabled={isVerified} aria-label="Your SayPay ID" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </div>
      </div>

      {!isVerified && (
        <>
          {/* Linking is the primary path while Nimiq Pay's signing response is
              unreliable on device. Signature verification stays available and
              is still the stronger proof when it works. */}
          <button className="cta" onClick={onLinkWallet} disabled={busy}>{linkingWallet ? "Linking your wallet…" : "Link connected wallet"}</button>
          <button className="cta-secondary" onClick={onClaim} disabled={busy}>{claiming ? "Requesting wallet signature…" : "Verify this ID with Nimiq Pay"}</button>
          <button className="ghost-btn" onClick={onTestSignature} disabled={busy}>{testingSignature ? "Testing Nimiq Pay signing…" : "Test Nimiq Pay signing first"}</button>
          <p className="fine-print">Linking uses the account you already approved in Nimiq Pay. Every payment still needs a native Nimiq Pay confirmation.</p>
        </>
      )}

      {profileStatus && <p className="profile-status">{profileStatus}</p>}

      {isVerified && (
        <>
          <div className="qr-panel">
            <QRCodeSVG value={paymentLink} size={172} bgColor="#ffffff" fgColor="#0f172a" level="M" includeMargin />
            <strong>Scan to pay {sayPayId}</strong>
            <small>Opens SayPay in Nimiq Pay, ready to pay your linked ID.</small>
          </div>
          <div className="field-block">
            <span className="field-title">Your payment link</span>
            <input className="text-field" readOnly value={paymentLink} onFocus={(event) => event.target.select()} aria-label="Your payment link" />
          </div>
          <button className="cta" onClick={() => navigator.clipboard?.writeText(paymentLink)}>Copy payment link</button>
        </>
      )}
    </section>
  );
}

function languageName(code: string) {
  return ({ en: "English", de: "German", es: "Spanish" } as Record<string, string>)[code] ?? "English";
}

function speechLanguage(language: string) {
  return ({ English: "en-US", "Nigerian Pidgin": "en-NG", German: "de-DE", Spanish: "es-ES" } as Record<string, string>)[language] ?? "en-US";
}
