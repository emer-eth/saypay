"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { isValidNimiqAddress, nimToLunas } from "./_lib/units";

/**
 * Host shell for the supplied design artifact (public/saypay-ui.html).
 * The design owns all visuals; this page owns Nimiq Pay + SayPay APIs.
 * Messages: design → parent { type:'saypay', action }, parent → design { type:'saypay-result', action }.
 */

type Session = { token: string; address: string; handle: string };

type DesignCard = {
  id?: string;
  kind?: string;
  type?: string;
  amount?: number;
  asset?: string;
  note?: string;
  to?: { name?: string; addr?: string; handle?: string; id?: string };
  people?: Array<{ name?: string; addr?: string; handle?: string; amt?: number }>;
  plain?: string;
};

function sessionKey(address: string) {
  return `saypay-session:${address.replace(/\s/g, "").toUpperCase()}`;
}

function reply(frame: HTMLIFrameElement | null, payload: Record<string, unknown>) {
  frame?.contentWindow?.postMessage({ type: "saypay-result", ...payload }, "*");
}

function extractHandle(value: string | undefined) {
  if (!value) return "";
  const match = value.match(/@([a-z0-9][a-z0-9-]{2,23})/i);
  if (match) return match[1].toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{2,23}$/i.test(value.trim())) return value.trim().toLowerCase();
  return "";
}

/** Seed addresses baked into the design artifact — never pay these. */
const DEMO_ADDR_FRAGMENTS = [
  "NQ34 8VLM 2K9T RQ7X 4B0J YHNS D5PC",
  "NQ71 6RJP 0XQ4 M2HD 9TVB S1KL 3EWA",
  "NQ19 P4KD 7T2M X8QR 3NEV 0C6H JB5Y",
  "NQ00 0000",
  "NQ07 0000 0000 0000 0000 0000 0000 0000 0000",
];

function isDemoAddress(address: string | undefined) {
  if (!address) return false;
  const n = address.replace(/\s/g, "").toUpperCase();
  return DEMO_ADDR_FRAGMENTS.some((demo) => {
    const d = demo.replace(/\s/g, "").toUpperCase();
    return n === d || n.includes(d) || (n.length >= 12 && d.includes(n));
  });
}

function isDemoName(name: string | undefined) {
  if (!name) return false;
  return /^(mum|ada|tunde|leah|marco|kwame|ada okafor|tunde bello|leah fischer)$/i.test(name.trim());
}

/** Reads through /api/balance so the RPC network stays a single server setting. */
async function loadNimBalance(session: Session) {
  if (!session.token) return null;
  try {
    const response = await fetch("/api/balance", { headers: { Authorization: `Bearer ${session.token}` } });
    if (!response.ok) return null;
    const payload = await response.json() as { nim?: number };
    return typeof payload.nim === "number" ? payload.nim : null;
  } catch {
    return null;
  }
}

async function resolveRecipient(to: DesignCard["to"], session: Session) {
  if (!to) throw new Error("Missing recipient.");
  if (isDemoAddress(to.addr) || isDemoName(to.name) || isDemoName(to.id)) {
    throw new Error("Demo contacts cannot receive real payments. Use a SayPay @handle or a real NQ address.");
  }
  const handle = extractHandle(to.handle) || extractHandle(to.name) || extractHandle(to.addr);
  if (handle) {
    const response = await fetch(`/api/profile?handle=${encodeURIComponent(handle)}`);
    const payload = await response.json() as { profile?: { walletAddress: string; handle: string }; error?: string };
    if (!response.ok || !payload.profile) throw new Error(payload.error ?? `@${handle} has not claimed a SayPay ID yet.`);
    if (isDemoAddress(payload.profile.walletAddress) || !isValidNimiqAddress(payload.profile.walletAddress)) {
      throw new Error("That profile is not payable.");
    }
    return { address: payload.profile.walletAddress, label: `@${payload.profile.handle}`, handle: payload.profile.handle };
  }
  if (to.addr && isValidNimiqAddress(to.addr) && !isDemoAddress(to.addr)) {
    return { address: to.addr, label: to.name || to.addr };
  }
  if (session.token && to.name) {
    const contactsResponse = await fetch("/api/contacts", { headers: { Authorization: `Bearer ${session.token}` } });
    if (contactsResponse.ok) {
      const payload = await contactsResponse.json() as { contacts: Array<{ nickname: string; walletAddress: string; handle: string | null }> };
      const match = payload.contacts.find((c) => c.nickname.toLowerCase() === to.name!.toLowerCase());
      if (match && !isDemoAddress(match.walletAddress)) {
        return {
          address: match.walletAddress,
          label: match.handle ? `@${match.handle}` : match.nickname,
          handle: match.handle ?? undefined,
        };
      }
    }
  }
  throw new Error("Use a real SayPay @handle, a saved contact, or a valid Nimiq address.");
}

async function loadContactsAsPeople(token: string) {
  if (!token) return [] as Array<Record<string, string>>;
  try {
    const response = await fetch("/api/contacts", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return [];
    const payload = await response.json() as {
      contacts: Array<{ nickname: string; walletAddress: string; handle: string | null }>;
    };
    const colors = ["#FC8702", "#21BCA5", "#265DD7", "#9B5FD0", "#E9B213", "#D94432"];
    return (payload.contacts ?? [])
      .filter((c) => !isDemoAddress(c.walletAddress))
      .map((c, i) => ({
        id: `c-${c.walletAddress.replace(/\s/g, "").slice(-8)}`,
        name: c.nickname,
        init: (c.nickname || "?").trim().slice(0, 1).toUpperCase(),
        color: colors[i % colors.length],
        addr: c.walletAddress,
        handle: c.handle || "",
        rel: c.handle ? `@${c.handle}` : "Contact",
      }));
  } catch {
    return [];
  }
}

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,23}$/;

export default function DesignShell() {
  const frame = useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef<Session>({ token: "", address: "", handle: "" });
  const [status, setStatus] = useState("Loading SayPay…");
  /** After listAccounts, first-time users pick a SayPay ID before signing. */
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimAddress, setClaimAddress] = useState("");
  const [claimHandle, setClaimHandle] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [signedHandle, setSignedHandle] = useState("");
  const [walletForDeals, setWalletForDeals] = useState("");
  const [panel, setPanel] = useState<"none" | "schedule" | "deals" | "due">("none");
  const [schedules, setSchedules] = useState<Array<{
    id: string;
    amountLunas: number;
    note: string;
    runAt: number;
    status: string;
    recipientHandle: string | null;
    recipientWallet: string;
    recurrence: string;
  }>>([]);
  const [deals, setDeals] = useState<Array<{
    id: string;
    description: string;
    amountLunas: number;
    currency: string;
    status: string;
    creatorWallet: string;
    counterpartyWallet: string;
  }>>([]);
  const [scheduleHandle, setScheduleHandle] = useState("");
  const [scheduleAmount, setScheduleAmount] = useState("20");
  const [scheduleNote, setScheduleNote] = useState("");
  const [scheduleWhen, setScheduleWhen] = useState("");
  const [scheduleWeekly, setScheduleWeekly] = useState(false);
  const [panelBusy, setPanelBusy] = useState(false);
  const [panelError, setPanelError] = useState("");

  function prepareMobile() {
    const document = frame.current?.contentDocument;
    if (!document) return;
    if (!document.getElementById("saypay-mobile-layout")) {
      const style = document.createElement("style");
      style.id = "saypay-mobile-layout";
      style.textContent = `
        @media (max-width: 600px) {
          html, body, x-dc { width: 100% !important; min-height: 100dvh !important; margin: 0 !important; overflow: hidden !important; }
          body > div, x-dc > div { width: 100% !important; min-height: 100dvh !important; padding: 0 !important; display: block !important; }
          body > div > div, x-dc > div > div { width: 100% !important; height: 100dvh !important; min-height: 100dvh !important; border-radius: 0 !important; box-shadow: none !important; }
        }
      `;
      document.head.append(style);
    }
    if (window.matchMedia("(max-width: 600px)").matches) {
      const panels = Array.from(document.querySelectorAll<HTMLDivElement>("div"));
      const phoneShell = panels.find((panel) => panel.style.width === "390px" && panel.style.height === "844px");
      if (phoneShell) {
        const parent = phoneShell.parentElement as HTMLDivElement | null;
        if (parent) {
          parent.style.width = "100%";
          parent.style.minHeight = "100dvh";
          parent.style.padding = "0";
          parent.style.display = "block";
        }
        phoneShell.style.width = "100%";
        phoneShell.style.height = "100dvh";
        phoneShell.style.minHeight = "100dvh";
        phoneShell.style.borderRadius = "0";
        phoneShell.style.boxShadow = "none";
      }
      panels.find((panel) => panel.style.height === "46px" && panel.textContent?.includes("9:41"))?.remove();
    }
  }

  async function tryRestoreSession(address: string): Promise<Session | null> {
    const stored = window.localStorage.getItem(sessionKey(address));
    if (!stored) return null;
    const check = await fetch("/api/activity", { headers: { Authorization: `Bearer ${stored}` } });
    if (!check.ok) {
      window.localStorage.removeItem(sessionKey(address));
      return null;
    }
    const profile = await fetch(`/api/profile?wallet=${encodeURIComponent(address)}`);
    if (!profile.ok) {
      window.localStorage.removeItem(sessionKey(address));
      return null;
    }
    const handle = ((await profile.json()) as { profile: { handle: string } }).profile.handle;
    const session = { token: stored, address, handle };
    sessionRef.current = session;
    return session;
  }

  /** Challenge → Nimiq sign → verify. Requires an explicit handle the user chose or already owns. */
  async function claimHandleWithSignature(address: string, handle: string): Promise<Session> {
    const normalized = handle.replace(/^@/, "").trim().toLowerCase();
    if (!HANDLE_PATTERN.test(normalized)) {
      throw new Error("SayPay ID must be 3–24 characters: letters, numbers, hyphens.");
    }

    const challengeResponse = await fetch("/api/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address, handle: normalized }),
    });
    const challenge = await challengeResponse.json() as { nonce?: string; message?: string; error?: string };
    if (!challengeResponse.ok || !challenge.nonce || !challenge.message) {
      throw new Error(challenge.error ?? "Could not start SayPay ID claim.");
    }

    const { init } = await import("@nimiq/mini-app-sdk");
    const nimiq = await init();
    setStatus("Approve the SayPay ID signature in Nimiq Pay…");
    const signed = await nimiq.sign(challenge.message);
    if ("error" in signed) throw new Error(signed.error.message);
    const signature = typeof signed.signature === "string"
      ? signed.signature
      : signed.signature != null
        ? String(signed.signature)
        : "";
    const publicKey = typeof signed.publicKey === "string"
      ? signed.publicKey
      : signed.publicKey != null
        ? String(signed.publicKey)
        : "";
    if (!signature || !publicKey) throw new Error("Nimiq Pay returned an incomplete signature.");

    const verifyResponse = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nonce: challenge.nonce,
        walletAddress: address,
        message: challenge.message,
        signature,
        publicKey,
        language: (window as unknown as { nimiqPay?: { language?: string } }).nimiqPay?.language ?? "en",
      }),
    });
    const verified = await verifyResponse.json() as {
      error?: string;
      detail?: string;
      debug?: { publicKeyBytes?: number; signatureBytes?: number };
      token?: string;
      profile?: { handle?: string };
    };
    if (!verifyResponse.ok || !verified.token) {
      const hint = verified.debug
        ? ` (key ${verified.debug.publicKeyBytes ?? "?"}B, sig ${verified.debug.signatureBytes ?? "?"}B)`
        : "";
      throw new Error((verified.error ?? "Signature could not be verified.") + (verified.detail ? ` — ${verified.detail}` : "") + hint);
    }

    window.localStorage.setItem(sessionKey(address), verified.token);
    const session = {
      token: verified.token,
      address,
      handle: verified.profile?.handle ?? normalized,
    };
    sessionRef.current = session;
    return session;
  }

  async function refreshSchedules(token: string) {
    try {
      const response = await fetch("/api/schedules", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const payload = await response.json() as { schedules: typeof schedules };
      setSchedules(payload.schedules ?? []);
    } catch {
      // ignore
    }
  }

  async function refreshDeals(token: string) {
    try {
      const response = await fetch("/api/deals", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const payload = await response.json() as { deals: typeof deals };
      setDeals(payload.deals ?? []);
    } catch {
      // ignore
    }
  }

  async function finishConnected(session: Session) {
    const nim = await loadNimBalance(session);
    const people = await loadContactsAsPeople(session.token);
    await Promise.all([refreshSchedules(session.token), refreshDeals(session.token)]);
    reply(frame.current, {
      action: "connect",
      ok: true,
      nim: nim ?? undefined,
      nimFiat: nim != null ? "Live NIM balance" : "Balance unavailable",
      connLabel: `Connected · @${session.handle}`,
      toast: `Signed in as @${session.handle}`,
      people,
      handle: session.handle,
      address: session.address,
    });
    setStatus(`Signed in as @${session.handle}`);
    setClaimOpen(false);
    setClaimBusy(false);
    setClaimError("");
    setSignedIn(true);
    setSignedHandle(session.handle);
    setWalletForDeals(session.address);
  }

  async function handleConnect() {
    setStatus("Waiting for Nimiq Pay…");
    setClaimError("");
    try {
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const accounts = await nimiq.listAccounts();
      if (!Array.isArray(accounts) || !accounts[0]) {
        const message = typeof accounts === "object" && accounts && "error" in accounts
          ? String((accounts as { error?: { message?: string } }).error?.message ?? "No account returned.")
          : "No Nimiq account is available.";
        throw new Error(message);
      }
      const address = accounts[0];

      // 1) Resume existing session if still valid.
      const restored = await tryRestoreSession(address);
      if (restored) {
        await finishConnected(restored);
        return;
      }

      // 2) Known profile → re-verify that same handle with a signature.
      const existing = await fetch(`/api/profile?wallet=${encodeURIComponent(address)}`);
      if (existing.ok) {
        const handle = ((await existing.json()) as { profile: { handle: string } }).profile.handle;
        setStatus(`Re-verify @${handle} with Nimiq Pay…`);
        const session = await claimHandleWithSignature(address, handle);
        await finishConnected(session);
        return;
      }

      // 3) First time: user must choose a SayPay ID, then sign to claim it.
      setClaimAddress(address);
      setClaimHandle("");
      setClaimOpen(true);
      setStatus("Choose a SayPay ID, then sign in Nimiq Pay to claim it.");
      // Reset design connect button; claim overlay handles the next step.
      reply(frame.current, {
        action: "connect",
        ok: false,
        error: "Choose your SayPay ID to finish sign-in.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not connect.";
      reply(frame.current, { action: "connect", ok: false, error: message });
      setStatus(message);
      setClaimOpen(false);
    }
  }

  async function submitClaim(event: FormEvent) {
    event.preventDefault();
    if (!claimAddress) return;
    setClaimBusy(true);
    setClaimError("");
    try {
      const session = await claimHandleWithSignature(claimAddress, claimHandle);
      await finishConnected(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not claim SayPay ID.";
      setClaimError(message);
      setStatus(message);
      setClaimBusy(false);
    }
  }

  async function handleApprove(card: DesignCard) {
    try {
      const session = sessionRef.current;
      if (!session.address) throw new Error("Connect Nimiq Pay first.");

      // Only `type: "send"` is a live wallet payment. Split / invoice / protect
      // cards must not fall through into sendBasicTransaction.
      if (!card || card.type !== "send") {
        if (card?.type === "split") {
          throw new Error("Use Split a bill to create real split invitations.");
        }
        if (card?.type === "invoice" || card?.type === "request") {
          throw new Error("Use New invoice to create a real shareable invoice.");
        }
        if (card?.type === "protected" || card?.type === "protect") {
          throw new Error("Use Protected deal to create real terms (no custody yet).");
        }
        reply(frame.current, { action: "approve", ok: true, toast: "Confirmed" });
        return;
      }

      if (card.asset && card.asset !== "NIM") throw new Error("Only NIM payments are live right now.");
      const amount = Number(card.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Missing payment amount.");
      const recipient = await resolveRecipient(card.to, session);
      const value = nimToLunas(amount);
      setStatus("Approve the payment in Nimiq Pay…");
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const transaction = await nimiq.sendBasicTransaction({ recipient: recipient.address, value });
      if (typeof transaction !== "string") throw new Error("Nimiq Pay did not return a transaction.");
      if (session.token) {
        await fetch("/api/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({
            kind: "payment",
            title: `Sent to ${recipient.label}`,
            amountLunas: value,
            transactionReference: transaction,
          }),
        });
        void fetch("/api/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({
            contactWallet: recipient.address,
            handle: recipient.handle || extractHandle(recipient.label) || undefined,
            nickname: (card.to?.name || recipient.label).replace(/^@/, "").slice(0, 48),
          }),
        }).catch(() => undefined);
      }
      const nim = await loadNimBalance(session);
      reply(frame.current, {
        action: "approve",
        ok: true,
        hash: transaction.slice(0, 18) + "…",
        nim: nim ?? undefined,
        toast: "Payment sent through Nimiq Pay",
      });
      setStatus("Payment sent.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment failed.";
      reply(frame.current, { action: "approve", ok: false, error: message });
      setStatus(message);
    }
  }

  /** Validate send form before the design opens the confirm sheet. */
  async function handlePrepareSend(snd: {
    mode?: string;
    to?: { name?: string; handle?: string; addr?: string; id?: string };
    addr?: string;
    amount?: string;
    asset?: string;
    note?: string;
    scheduleAt?: string;
    recurrence?: string;
  }) {
    try {
      const session = sessionRef.current;
      if (!session.address) throw new Error("Connect Nimiq Pay first.");
      if (snd.asset && snd.asset !== "NIM") throw new Error("Only NIM payments are live right now.");
      const amount = Number(snd.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount in NIM.");

      let to = snd.to;
      if (snd.mode === "address" || (!to && snd.addr)) {
        const addr = (snd.addr || "").trim();
        if (!isValidNimiqAddress(addr) || isDemoAddress(addr)) {
          throw new Error("Paste a valid Nimiq address (not a demo placeholder).");
        }
        to = { name: addr.slice(0, 12) + "…", addr, handle: "" };
      }
      if (snd.mode === "contact" && to && isDemoName(to.name)) {
        throw new Error("Demo contacts are disabled. Add a real contact with a SayPay @handle.");
      }

      const recipient = await resolveRecipient(to, session);

      // Scheduled path: create a reminder row (no money moves until user confirms later).
      if (snd.scheduleAt) {
        if (!session.token) throw new Error("Claim your SayPay ID before scheduling.");
        const runAt = Date.parse(snd.scheduleAt);
        const response = await fetch("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({
            recipientHandle: recipient.handle,
            recipientWallet: recipient.address,
            amount,
            note: (snd.note || "").trim() || "Scheduled payment",
            runAt,
            recurrence: snd.recurrence === "weekly" ? "weekly" : "once",
          }),
        });
        const result = await response.json() as { error?: string; schedule?: { id: string; runAt: number } };
        if (!response.ok || !result.schedule) throw new Error(result.error ?? "Could not schedule payment.");
        await refreshSchedules(session.token);
        reply(frame.current, {
          action: "schedule",
          ok: true,
          toast: `Scheduled ${amount} NIM for ${new Date(result.schedule.runAt).toLocaleString()}`,
          note: (snd.note || "").trim() || "Scheduled payment",
          amountLabel: `${amount} NIM`,
          when: new Date(result.schedule.runAt).toLocaleString(),
        });
        setStatus("Payment scheduled — you will confirm in Nimiq Pay when it is due.");
        return;
      }

      const person = {
        id: `pay-${recipient.address.replace(/\s/g, "").slice(-8)}`,
        name: to?.name && !isDemoName(to.name) ? to.name : recipient.label,
        init: (recipient.label.replace(/^@/, "") || "?").slice(0, 1).toUpperCase(),
        color: "#21BCA5",
        addr: recipient.address,
        handle: recipient.handle || extractHandle(recipient.label) || "",
      };
      reply(frame.current, {
        action: "prepareSend",
        ok: true,
        person,
        amount,
        asset: "NIM",
        note: (snd.note || "").trim() || "No note",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot prepare payment.";
      reply(frame.current, { action: "prepareSend", ok: false, error: message });
      setStatus(message);
    }
  }

  async function submitScheduleForm(event: FormEvent) {
    event.preventDefault();
    const session = sessionRef.current;
    if (!session.token) {
      setPanelError("Connect and claim your SayPay ID first.");
      return;
    }
    setPanelBusy(true);
    setPanelError("");
    try {
      const amount = Number(scheduleAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount in NIM.");
      const runAt = Date.parse(scheduleWhen);
      const skewMs = 60_000;
      if (!Number.isFinite(runAt)) {
        throw new Error("Pick a future date and time.");
      }
      // Allow ~1 minute of clock skew; reject clearly past times.
      if (runAt + skewMs < new Date().getTime()) {
        throw new Error("Pick a future date and time.");
      }
      const handle = scheduleHandle.replace(/^@/, "").trim().toLowerCase();
      if (!handle) throw new Error("Enter the recipient’s SayPay @handle.");
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          recipientHandle: handle,
          amount,
          note: scheduleNote.trim() || "Scheduled payment",
          runAt,
          recurrence: scheduleWeekly ? "weekly" : "once",
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not schedule.");
      await refreshSchedules(session.token);
      reply(frame.current, {
        action: "schedule",
        ok: true,
        toast: `Scheduled ${amount} NIM to @${handle}`,
        note: scheduleNote.trim() || "Scheduled payment",
        amountLabel: `${amount} NIM`,
        when: new Date(runAt).toLocaleString(),
      });
      setStatus(`Scheduled ${amount} NIM to @${handle}`);
      setPanel("none");
      setScheduleHandle("");
      setScheduleNote("");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Could not schedule.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function payDueSchedule(row: (typeof schedules)[0]) {
    const session = sessionRef.current;
    if (!session.address || !session.token) throw new Error("Connect first.");
    setPanelBusy(true);
    setPanelError("");
    try {
      setStatus("Approve the scheduled payment in Nimiq Pay…");
      const { init } = await import("@nimiq/mini-app-sdk");
      const nimiq = await init();
      const transaction = await nimiq.sendBasicTransaction({
        recipient: row.recipientWallet,
        value: row.amountLunas,
      });
      if (typeof transaction !== "string") throw new Error("Nimiq Pay did not return a transaction.");
      const response = await fetch("/api/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ id: row.id, action: "complete", transactionReference: transaction }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not complete schedule.");
      await refreshSchedules(session.token);
      const nim = await loadNimBalance(session);
      reply(frame.current, {
        action: "balance",
        ok: true,
        nim: nim ?? undefined,
        toast: "Scheduled payment sent",
      });
      setStatus("Scheduled payment sent.");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Payment failed.");
      setStatus(error instanceof Error ? error.message : "Payment failed.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function cancelSchedule(id: string) {
    const session = sessionRef.current;
    if (!session.token) return;
    setPanelBusy(true);
    try {
      await fetch("/api/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ id, action: "cancel" }),
      });
      await refreshSchedules(session.token);
    } finally {
      setPanelBusy(false);
    }
  }

  async function dealAction(dealId: string, action: "accept" | "open_dispute" | "vote", vote?: "release" | "refund") {
    const session = sessionRef.current;
    if (!session.token) {
      setPanelError("Connect first.");
      return;
    }
    setPanelBusy(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action, vote }),
      });
      const result = await response.json() as { error?: string; funding?: string; recommendation?: string; status?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update deal.");
      await refreshDeals(session.token);
      setStatus(result.funding ?? result.recommendation ?? result.status ?? "Deal updated.");
      reply(frame.current, {
        action: "toast",
        message: result.funding ?? "Protected deal updated",
      });
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Deal action failed.");
    } finally {
      setPanelBusy(false);
    }
  }

  async function handleInvoice(inv: {
    mode?: string;
    to?: { name?: string; handle?: string; addr?: string };
    addr?: string;
    amount?: string;
    note?: string;
    asset?: string;
  }) {
    try {
      const session = sessionRef.current;
      if (!session.token) throw new Error("Connect and verify Nimiq Pay first.");
      if (inv.asset && inv.asset !== "NIM") throw new Error("Invoices are NIM-only for now.");
      const amount = Number(inv.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an invoice amount.");
      const handle = extractHandle(inv.to?.handle) || extractHandle(inv.to?.name) || extractHandle(inv.addr);
      if (!handle) throw new Error("Invoices need a recipient with a SayPay @handle.");
      const note = inv.note?.trim() || "Invoice";
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ recipientHandle: handle, amount, note, kind: "invoice" }),
      });
      const result = await response.json() as { error?: string; request?: { id: string } };
      if (!response.ok || !result.request) throw new Error(result.error ?? "Could not create invoice.");
      const link = `${window.location.origin}/request/${result.request.id}`;
      reply(frame.current, {
        action: "invoice",
        ok: true,
        link,
        note,
        sub: `Sent to @${handle}`,
        amountLabel: `${amount} NIM`,
        toast: "Invoice created — share the link",
      });
      setStatus("Invoice created.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invoice failed.";
      reply(frame.current, { action: "invoice", ok: false, error: message });
      setStatus(message);
    }
  }

  async function handleSplit(payload: {
    spl?: { total?: string; note?: string };
    chosen?: Array<{ name?: string; addr?: string; handle?: string }>;
  }) {
    try {
      const session = sessionRef.current;
      if (!session.token) throw new Error("Connect and verify Nimiq Pay first.");
      const amount = Number(payload.spl?.total);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a split total.");
      const handles = (payload.chosen ?? [])
        .map((person) => extractHandle(person.handle) || extractHandle(person.name) || extractHandle(person.addr))
        .filter(Boolean);
      if (!handles.length) throw new Error("Every split participant needs a claimed SayPay @handle.");
      const note = payload.spl?.note?.trim() || "Shared bill";
      const response = await fetch("/api/splits", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ participantHandles: handles, amount, note }),
      });
      const result = await response.json() as { error?: string; split?: { id: string } };
      if (!response.ok || !result.split) throw new Error(result.error ?? "Could not create split.");
      const link = `${window.location.origin}/split/${result.split.id}`;
      reply(frame.current, {
        action: "split",
        ok: true,
        link,
        toast: "Split invitations created",
      });
      setStatus("Split created.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Split failed.";
      reply(frame.current, { action: "split", ok: false, error: message });
      setStatus(message);
    }
  }

  async function handleProtect(payload: {
    prt?: { amount?: string; terms?: string };
    to?: { name?: string; handle?: string; addr?: string };
    arbiters?: Array<{ name?: string; handle?: string; addr?: string }>;
  }) {
    try {
      const session = sessionRef.current;
      if (!session.token) throw new Error("Connect and verify Nimiq Pay first.");
      const amount = Number(payload.prt?.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a deal amount.");
      const counterpartyHandle = extractHandle(payload.to?.handle) || extractHandle(payload.to?.name) || extractHandle(payload.to?.addr);
      if (!counterpartyHandle) throw new Error("Counterparty needs a SayPay @handle.");
      const arbiterHandles = (payload.arbiters ?? [])
        .map((a) => extractHandle(a.handle) || extractHandle(a.name) || extractHandle(a.addr))
        .filter(Boolean);
      if (![1, 3].includes(arbiterHandles.length)) throw new Error("Choose one or three arbiters with @handles.");
      const description = payload.prt?.terms?.trim() || `Protected deal with @${counterpartyHandle}`;
      const response = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          counterpartyHandle,
          arbiterHandles,
          amount,
          currency: "NIM",
          description: description.slice(0, 240),
        }),
      });
      const result = await response.json() as { error?: string; deal?: { id: string } };
      if (!response.ok || !result.deal) throw new Error(result.error ?? "Could not create deal.");
      if (session.token) await refreshDeals(session.token);
      reply(frame.current, {
        action: "protect",
        ok: true,
        toast: "Deal terms created — escrow not live; funds stay in your wallet",
        dealId: result.deal.id,
      });
      setStatus("Protected deal terms created. Open Protect for accept / dispute / vote.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deal failed.";
      reply(frame.current, { action: "protect", ok: false, error: message });
      setStatus(message);
    }
  }

  async function handleContact(name: string, addr: string) {
    try {
      const session = sessionRef.current;
      if (!session.token) throw new Error("Connect and verify Nimiq Pay first.");
      const handle = extractHandle(name) || extractHandle(addr);
      const body = handle
        ? { handle, nickname: name.replace(/^@/, "").slice(0, 48) || handle }
        : { contactWallet: addr, nickname: name.slice(0, 48) };
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(body),
      });
      const result = await response.json() as {
        error?: string;
        contact?: { walletAddress: string; nickname: string; handle?: string | null };
      };
      if (!response.ok || !result.contact) throw new Error(result.error ?? "Could not save contact.");
      const person = {
        id: `c-${result.contact.walletAddress.slice(-6)}`,
        name: result.contact.nickname,
        init: result.contact.nickname.slice(0, 1).toUpperCase(),
        color: "#0582CA",
        addr: result.contact.walletAddress,
        handle: result.contact.handle || handle || "",
      };
      reply(frame.current, {
        action: "contact",
        ok: true,
        person,
        toast: `${result.contact.nickname} saved`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save contact.";
      reply(frame.current, { action: "contact", ok: false, error: message });
    }
  }

  async function handleInterpret(text: string) {
    try {
      const session = sessionRef.current;
      let intent: {
        kind: string;
        amount: number | null;
        asset: string;
        recipientHint: string | null;
        participants: string[];
        note: string | null;
        confidence: string;
        question: string | null;
      } | null = null;

      if (session.token) {
        const response = await fetch("/api/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ message: text }),
        });
        if (response.ok) {
          const payload = await response.json() as { intent?: typeof intent };
          intent = payload.intent ?? null;
        }
      }

      if (!intent) {
        // Offline local parse (mirrors server fallback roughly)
        const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(NIM|USDT)?/i);
        const handles = [...text.matchAll(/@([a-z0-9][a-z0-9-]{2,23})/gi)].map((m) => m[1].toLowerCase());
        const lower = text.toLowerCase();
        const kind = /protect|arbiter|escrow/.test(lower)
          ? "protected_pay"
          : /split/.test(lower)
            ? "split"
            : /invoice|request/.test(lower)
              ? "invoice"
              : "send";
        intent = {
          kind,
          amount: amountMatch ? Number(amountMatch[1]) : null,
          asset: amountMatch?.[2]?.toUpperCase() === "USDT" ? "USDT" : "NIM",
          recipientHint: handles[0] ? `@${handles[0]}` : null,
          participants: handles.map((h) => `@${h}`),
          note: null,
          confidence: amountMatch ? "high" : "needs_clarification",
          question: amountMatch ? null : "How much should it be?",
        };
      }

      if (intent.confidence === "needs_clarification") {
        reply(frame.current, {
          action: "interpret",
          ok: true,
          clarify: intent.question || "Could you add a bit more detail?",
          text,
        });
        return;
      }

      const handle = extractHandle(intent.recipientHint ?? undefined) || extractHandle(intent.participants[0]);
      let who: { id: string; name: string; init: string; color: string; addr: string; handle?: string } | null = null;
      if (handle) {
        who = {
          id: handle,
          name: `@${handle}`,
          init: handle.slice(0, 1).toUpperCase(),
          color: "#21BCA5",
          addr: "",
          handle,
        };
        // Best-effort resolve for address display
        try {
          const profile = await fetch(`/api/profile?handle=${encodeURIComponent(handle)}`);
          if (profile.ok) {
            const payload = await profile.json() as { profile: { walletAddress: string; handle: string } };
            who.addr = payload.profile.walletAddress;
            who.name = `@${payload.profile.handle}`;
            who.handle = payload.profile.handle;
          }
        } catch {
          // ignore
        }
      }

      reply(frame.current, {
        action: "interpret",
        ok: true,
        text,
        kind: intent.kind,
        amount: intent.amount,
        asset: intent.asset,
        note: intent.note,
        who,
        people: intent.kind === "split"
          ? [
              { id: "me", name: "You", init: "Y", color: "#0582CA", addr: session.address },
              ...intent.participants.map((p) => ({
                id: extractHandle(p) || p,
                name: p,
                init: p.replace(/^@/, "").slice(0, 1).toUpperCase(),
                color: "#9B5FD0",
                addr: "",
                handle: extractHandle(p),
              })),
            ]
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read that.";
      reply(frame.current, { action: "interpret", ok: false, error: message, text });
    }
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; action?: string; [key: string]: unknown } | null;
      if (!data || data.type !== "saypay") return;
      // Only accept messages from our iframe
      if (frame.current && event.source && event.source !== frame.current.contentWindow) return;

      switch (data.action) {
        case "ready":
          setStatus("SayPay ready");
          prepareMobile();
          break;
        case "connect":
          void handleConnect();
          break;
        case "approve":
          void handleApprove(data.card as DesignCard);
          break;
        case "prepareSend":
          void handlePrepareSend(data.snd as Parameters<typeof handlePrepareSend>[0]);
          break;
        case "toast":
          setStatus(String(data.message ?? ""));
          break;
        case "dealAction":
          void dealAction(
            String(data.dealId ?? ""),
            data.dealAction as "accept" | "open_dispute" | "vote",
            data.vote as "release" | "refund" | undefined,
          );
          break;
        case "invoice":
          void handleInvoice(data.inv as Parameters<typeof handleInvoice>[0]);
          break;
        case "split":
          void handleSplit(data as Parameters<typeof handleSplit>[0]);
          break;
        case "protect":
          void handleProtect(data as Parameters<typeof handleProtect>[0]);
          break;
        case "contact":
          void handleContact(String(data.name ?? ""), String(data.addr ?? ""));
          break;
        case "interpret":
          void handleInterpret(String(data.text ?? ""));
          break;
        default:
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // Handlers close over refs + setState; rebinding on every render is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReady = claimHandle.replace(/^@/, "").trim().toLowerCase();
  const handleValid = HANDLE_PATTERN.test(handleReady);

  return (
    <main className="supplied-ui-shell">
      <iframe
        ref={frame}
        title="SayPay"
        src="/saypay-ui"
        onLoad={() => {
          prepareMobile();
          window.setTimeout(prepareMobile, 300);
          window.setTimeout(prepareMobile, 1200);
          setStatus("Design loaded — connect Nimiq Pay to continue");
        }}
      />

      {claimOpen && (
        <div className="saypay-claim-overlay" role="dialog" aria-modal="true" aria-labelledby="saypay-claim-title">
          <form className="saypay-claim-card" onSubmit={submitClaim}>
            <p className="saypay-claim-eyebrow">SAYPAY ID</p>
            <h2 id="saypay-claim-title">Claim your @handle</h2>
            <p className="saypay-claim-copy">
              This is how people pay and find you. You&rsquo;ll sign once in Nimiq Pay to prove this wallet owns it.
            </p>
            <label className="saypay-claim-label" htmlFor="saypay-handle">Your SayPay ID</label>
            <div className="saypay-claim-input-row">
              <span>@</span>
              <input
                id="saypay-handle"
                value={claimHandle}
                onChange={(event) => setClaimHandle(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                maxLength={24}
                placeholder="your-name"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                disabled={claimBusy}
              />
            </div>
            <p className="saypay-claim-hint">3–24 characters · letters, numbers, hyphens</p>
            {claimAddress && (
              <p className="saypay-claim-wallet">
                Wallet {claimAddress.slice(0, 11)}…{claimAddress.slice(-6)}
              </p>
            )}
            {claimError && <p className="saypay-claim-error">{claimError}</p>}
            <button className="saypay-claim-cta" type="submit" disabled={claimBusy || !handleValid}>
              {claimBusy ? "Waiting for Nimiq Pay…" : handleValid ? `Claim @${handleReady}` : "Enter a SayPay ID"}
            </button>
            <button
              className="saypay-claim-cancel"
              type="button"
              disabled={claimBusy}
              onClick={() => {
                setClaimOpen(false);
                setClaimBusy(false);
                setClaimError("");
                setStatus("Connect cancelled. Tap Connect wallet to try again.");
              }}
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {signedIn && !claimOpen && (
        <div className="saypay-tool-rail" aria-label="SayPay tools">
          <span className="saypay-id-chip" title="Your SayPay ID">@{signedHandle || "…"}</span>
          <button type="button" onClick={() => { setPanelError(""); setPanel("schedule"); }}>Schedule</button>
          <button type="button" onClick={() => { setPanelError(""); void refreshDeals(sessionRef.current.token); setPanel("deals"); }}>Protect</button>
          <button type="button" onClick={() => { setPanelError(""); void refreshSchedules(sessionRef.current.token); setPanel("due"); }}>
            Due{schedules.some((s) => s.status === "due") ? ` · ${schedules.filter((s) => s.status === "due").length}` : ""}
          </button>
        </div>
      )}

      {panel === "schedule" && (
        <div className="saypay-claim-overlay" role="dialog" aria-modal="true">
          <form className="saypay-claim-card" onSubmit={submitScheduleForm}>
            <p className="saypay-claim-eyebrow">SCHEDULED SEND</p>
            <h2>Schedule a payment</h2>
            <p className="saypay-claim-copy">
              SayPay reminds you when it&rsquo;s due. You still confirm in Nimiq Pay — nothing sends unattended.
            </p>
            <label className="saypay-claim-label" htmlFor="sched-handle">To (@handle)</label>
            <div className="saypay-claim-input-row">
              <span>@</span>
              <input id="sched-handle" value={scheduleHandle} onChange={(e) => setScheduleHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="ada" disabled={panelBusy} />
            </div>
            <label className="saypay-claim-label" htmlFor="sched-amt" style={{ marginTop: 14 }}>Amount (NIM)</label>
            <div className="saypay-claim-input-row">
              <input id="sched-amt" value={scheduleAmount} onChange={(e) => setScheduleAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" disabled={panelBusy} />
            </div>
            <label className="saypay-claim-label" htmlFor="sched-when" style={{ marginTop: 14 }}>When</label>
            <div className="saypay-claim-input-row">
              <input id="sched-when" type="datetime-local" value={scheduleWhen} onChange={(e) => setScheduleWhen(e.target.value)} disabled={panelBusy} style={{ padding: "14px 0" }} />
            </div>
            <label className="saypay-claim-label" style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={scheduleWeekly} onChange={(e) => setScheduleWeekly(e.target.checked)} disabled={panelBusy} />
              Repeat weekly after I pay
            </label>
            <label className="saypay-claim-label" htmlFor="sched-note" style={{ marginTop: 14 }}>Note</label>
            <div className="saypay-claim-input-row">
              <input id="sched-note" value={scheduleNote} onChange={(e) => setScheduleNote(e.target.value)} placeholder="Rent" disabled={panelBusy} />
            </div>
            {panelError && <p className="saypay-claim-error">{panelError}</p>}
            <button className="saypay-claim-cta" type="submit" disabled={panelBusy}>{panelBusy ? "Saving…" : "Schedule payment"}</button>
            <button className="saypay-claim-cancel" type="button" onClick={() => setPanel("none")}>Close</button>
          </form>
        </div>
      )}

      {panel === "due" && (
        <div className="saypay-claim-overlay" role="dialog" aria-modal="true">
          <div className="saypay-claim-card">
            <p className="saypay-claim-eyebrow">SCHEDULES</p>
            <h2>Due & upcoming</h2>
            <p className="saypay-claim-copy">Due items need your Nimiq Pay confirmation. Nothing auto-sends.</p>
            {schedules.length === 0 && <p className="saypay-claim-hint">No schedules yet. Use Schedule to create one.</p>}
            <div className="saypay-list">
              {schedules.map((row) => (
                <div key={row.id} className="saypay-list-row">
                  <div>
                    <strong>{row.amountLunas / 100_000} NIM{row.recipientHandle ? ` → @${row.recipientHandle}` : ""}</strong>
                    <p>{row.status} · {new Date(row.runAt).toLocaleString()}{row.recurrence === "weekly" ? " · weekly" : ""}</p>
                    <p>{row.note}</p>
                  </div>
                  <div className="saypay-list-actions">
                    {(row.status === "due" || row.status === "scheduled") && (
                      <button type="button" disabled={panelBusy} onClick={() => void payDueSchedule(row)}>Pay now</button>
                    )}
                    {(row.status === "due" || row.status === "scheduled") && (
                      <button type="button" disabled={panelBusy} onClick={() => void cancelSchedule(row.id)}>Cancel</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {panelError && <p className="saypay-claim-error">{panelError}</p>}
            <button className="saypay-claim-cancel" type="button" onClick={() => setPanel("none")}>Close</button>
          </div>
        </div>
      )}

      {panel === "deals" && (
        <div className="saypay-claim-overlay" role="dialog" aria-modal="true">
          <div className="saypay-claim-card">
            <p className="saypay-claim-eyebrow">PROTECTED PAY</p>
            <h2>Your deals</h2>
            <p className="saypay-claim-copy">
              Terms + trusted arbiters are live. Escrow funding is not — funds stay in your wallet until the contract ships.
            </p>
            {deals.length === 0 && (
              <p className="saypay-claim-hint">No deals yet. In the app, open Protected deal and submit terms with @handles.</p>
            )}
            <div className="saypay-list">
              {deals.map((deal) => {
                const me = walletForDeals.replace(/\s/g, "").toUpperCase();
                const isCounterparty = deal.counterpartyWallet === me;
                const isParty = deal.creatorWallet === me || isCounterparty;
                return (
                  <div key={deal.id} className="saypay-list-row">
                    <div>
                      <strong>{deal.description}</strong>
                      <p>{deal.status.replaceAll("_", " ")} · {deal.amountLunas / 100_000} {deal.currency}</p>
                    </div>
                    <div className="saypay-list-actions">
                      {isCounterparty && deal.status === "offered" && (
                        <button type="button" disabled={panelBusy} onClick={() => void dealAction(deal.id, "accept")}>Accept</button>
                      )}
                      {isParty && (deal.status === "offered" || deal.status === "terms_accepted") && (
                        <button type="button" disabled={panelBusy} onClick={() => void dealAction(deal.id, "open_dispute")}>Dispute</button>
                      )}
                      {deal.status === "disputed" && (
                        <>
                          <button type="button" disabled={panelBusy} onClick={() => void dealAction(deal.id, "vote", "release")}>Vote release</button>
                          <button type="button" disabled={panelBusy} onClick={() => void dealAction(deal.id, "vote", "refund")}>Vote refund</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {panelError && <p className="saypay-claim-error">{panelError}</p>}
            <button className="saypay-claim-cancel" type="button" onClick={() => setPanel("none")}>Close</button>
          </div>
        </div>
      )}

      <p className="design-bridge-status" aria-live="polite">{status}</p>
    </main>
  );
}
