"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatNim, formatNimiqAddress, isValidNimiqAddress, lunasToNim } from "./_lib/units";
import { api, ApiError, sessionKey } from "./lib/api";
import { canListen, listen } from "./lib/speech";
import { listAccounts, sendNim, signMessage, WalletError } from "./lib/wallet";
import { ChatPanel } from "./chat-panel";
import { confirmNimiqPayHost, isLocalDevHost } from "./lib/host";
import { OpenInNimiqPay } from "./open-in-pay";
import { WorkEscrow, type EscrowRow } from "./work-escrow";
import { Fold } from "./fold";
import { WorkPanel, type AgentRecord, type InvoiceRow, type WorkLedger } from "./work-panel";
import { type JobRow } from "./work-jobs";

type Tab = "work" | "talk" | "chat" | "you";
type Session = { token: string; address: string; handle: string };
type Intent = {
  kind: "send" | "request" | "split" | "invoice" | "protected_pay" | "ledger" | "timer";
  asset: "NIM";
  amount: number | null;
  recipientHint: string | null;
  participants: string[];
  note: string | null;
  remindAt: string | null;
  recurrence: "once" | "weekly";
  timerAction: "start" | "stop" | "bill" | null;
  confidence: "high" | "needs_clarification";
  question: string | null;
};
type Contact = { walletAddress: string; nickname: string; handle: string | null; verifiedAt: string | null };
type ActivityRow = { id: string; kind: string; title: string; amountLunas: number | null; status: string; createdAt: string };
type Schedule = {
  id: string; amountLunas: number; note: string; runAt: number; status: string;
  recipientHandle: string | null; recipientWallet: string; recurrence: string;
};
type Message =
  | { id: string; kind: "user"; text: string; image?: string }
  | { id: string; kind: "bot"; text: string; summary?: string }
  | { id: string; kind: "think" }
  | { id: string; kind: "plan"; text: string; intent: Intent; who?: { label: string; address?: string; handle?: string }; summary?: string }
  | { id: string; kind: "chat_preview"; handle: string; message: string; summary: string };

function err(error: unknown) {
  if (error instanceof WalletError && error.reason === "rejected") return "Cancelled in Nimiq Pay.";
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong.";
}

function compressImage(file: File) {
  return new Promise<{ mime: string; data: string; preview: string }>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image."));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const preview = canvas.toDataURL("image/jpeg", 0.72);
      URL.revokeObjectURL(url);
      resolve({ mime: "image/jpeg", data: preview.split(",")[1] ?? "", preview });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    image.src = url;
  });
}

function extractHandle(value: string | null | undefined) {
  if (!value) return "";
  const match = value.match(/@([a-z0-9][a-z0-9-]{2,23})/i);
  if (match) return match[1].toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{2,23}$/i.test(value.trim())) return value.trim().toLowerCase();
  return "";
}

function Icon({ d, label }: { d: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? "img" : undefined}>
      {label ? <title>{label}</title> : null}
      <path d={d} />
    </svg>
  );
}

const ICONS: Record<Tab, string> = {
  work: "M4 6h16v4H4zm0 6h7v6H4zm9 0h7v6h-7z",
  talk: "M4 6h16M4 12h10M4 18h14",
  chat: "M5 6h14v9H8l-3 3V6z",
  you: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 9a7 7 0 0 1 14 0",
};
const TAB_LABEL: Record<Tab, string> = { work: "Work", talk: "Ask", chat: "Chat", you: "You" };

function LogoMark() {
  return (
    <span className="logo" aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 8.5 6.5 12 13 4" />
      </svg>
    </span>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="stack" aria-hidden>
      <div className="skel" style={{ height: 120 }} />
      <div className="skel" style={{ height: 52 }} />
      <div className="skel" style={{ height: 52 }} />
      <div className="skel" style={{ height: 52 }} />
    </div>
  );
}

function statusTone(status: string) {
  if (/paid|confirmed|released|completed|verified/i.test(status)) return "ok";
  if (/fail|cancel|dispute|refund|unverified/i.test(status)) return "warn";
  return "info";
}

type WalletBalance = { nim: number; usd: number | null; lunas: number };

function formatUsd(usd: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(usd);
}

function WalletChip({ balance }: { balance: WalletBalance | null }) {
  if (!balance) {
    return <span className="chip nim" aria-live="polite">NIM…</span>;
  }
  const label = `${formatNim(balance.lunas)} NIM`;
  return (
    <span
      className="chip nim"
      title={balance.usd != null ? `${label} · ≈ ${formatUsd(balance.usd)}` : `${label} · live from the Nimiq node`}
      aria-label={`Wallet ${label}`}
    >
      <b>{formatNim(balance.lunas)}</b> NIM
    </span>
  );
}

function WalletCard({ balance, compact = false }: { balance: WalletBalance | null; compact?: boolean }) {
  return (
    <article className={compact ? "rail-bal" : "balance"}>
      <p className="kicker">Wallet</p>
      {balance ? (
        <>
          <div className="figure">{formatNim(balance.lunas)} <span>NIM</span></div>
          <p className="small">
            Live from the Nimiq node
            {balance.usd != null ? ` · ≈ ${formatUsd(balance.usd)}` : ""}
          </p>
        </>
      ) : (
        <div className="skel" style={{ height: compact ? 36 : 48 }} />
      )}
    </article>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("talk");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [claim, setClaim] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [balance, setBalance] = useState<{ nim: number; usd: number | null; lunas: number } | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [work, setWork] = useState<WorkLedger | null>(null);
  const [escrows, setEscrows] = useState<EscrowRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [records, setRecords] = useState<AgentRecord[]>([]);
  const [host, setHost] = useState<"checking" | "in" | "out">("checking");
  const [attach, setAttach] = useState<{ mime: string; data: string; preview: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [listening, setListening] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactAddr, setContactAddr] = useState("");
  const [contactChecked, setContactChecked] = useState(false);
  const [dark, setDark] = useState(true);
  const listenRef = useRef<{ stop: () => void } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  function notice(text: string, tone: "ok" | "error" = "ok") {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "error" ? 8000 : 4200);
  }

  function setTheme(next: boolean) {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("saypay-theme", next ? "dark" : "light");
  }

  async function refresh(next = session) {
    if (!next?.token) return;
    setLoadError(null);
    try {
      const [bal, people, feed, schedulePayload, ledger, escrowPayload, jobPayload, recordPayload] = await Promise.all([
        api<{ nim: number; usd: number | null; lunas: number }>("/api/balance", { token: next.token }),
        api<{ contacts: Contact[] }>("/api/contacts", { token: next.token }),
        api<{ activity: ActivityRow[] }>("/api/activity", { token: next.token }),
        api<{ schedules: Schedule[] }>("/api/schedules", { token: next.token }),
        api<WorkLedger>("/api/work", { token: next.token }),
        api<{ escrows: EscrowRow[] }>("/api/escrows", { token: next.token }),
        api<{ jobs: JobRow[] }>("/api/jobs", { token: next.token }),
        api<{ records: AgentRecord[] }>("/api/records", { token: next.token }),
      ]);
      setBalance({ nim: bal.nim, usd: bal.usd, lunas: bal.lunas });
      setContacts(people.contacts ?? []);
      setActivity(feed.activity ?? []);
      setSchedules(schedulePayload.schedules ?? []);
      setWork(ledger);
      setEscrows(escrowPayload.escrows ?? []);
      setJobs(jobPayload.jobs ?? []);
      setRecords(recordPayload.records ?? []);
      setReady(true);
    } catch (error) {
      setLoadError(err(error));
      setReady(true);
    }
  }

  async function restore(address: string) {
    const stored = window.localStorage.getItem(sessionKey(address));
    if (!stored) return null;
    try {
      await api("/api/activity", { token: stored });
      const profile = await api<{ profile: { handle: string } }>(`/api/profile?wallet=${encodeURIComponent(address)}`);
      const next = { token: stored, address, handle: profile.profile.handle };
      setSession(next);
      await refresh(next);
      return next;
    } catch {
      window.localStorage.removeItem(sessionKey(address));
      return null;
    }
  }

  async function connect() {
    setBusy(true);
    notice("Waiting for Nimiq Pay…");
    try {
      const accounts = await listAccounts();
      const address = accounts[0];
      const restored = await restore(address);
      if (restored) {
        notice(`Signed in as @${restored.handle}`);
        return;
      }
      const existing = await fetch(`/api/profile?wallet=${encodeURIComponent(address)}`);
      if (existing.ok) {
        const handle = ((await existing.json()) as { profile: { handle: string } }).profile.handle;
        await claimHandle(address, handle);
        return;
      }
      setSession({ token: "", address, handle: "" });
      notice("Choose a SayPay ID, then sign to claim it.");
    } catch (error) {
      notice(err(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function claimHandle(address: string, handle: string) {
    const normalized = handle.replace(/^@/, "").trim().toLowerCase();
    setBusy(true);
    notice("Approve the signature in Nimiq Pay…");
    try {
      const challenge = await api<{ nonce: string; message: string }>("/api/auth/challenge", {
        body: { walletAddress: address, handle: normalized },
      });
      const signed = await signMessage(challenge.message);
      const verified = await api<{ token: string; profile: { handle: string } }>("/api/auth/verify", {
        body: {
          nonce: challenge.nonce,
          walletAddress: address,
          message: challenge.message,
          signature: signed.signature,
          publicKey: signed.publicKey,
        },
      });
      window.localStorage.setItem(sessionKey(address), verified.token);
      const next = { token: verified.token, address, handle: verified.profile.handle };
      setSession(next);
      notice(`Signed in as @${next.handle}`);
      await refresh(next);
    } catch (error) {
      notice(err(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function resolveHint(hint: string | null) {
    if (!hint || !session) return null;
    const handle = extractHandle(hint);
    if (handle) {
      const payload = await api<{ profile: { walletAddress: string; handle: string } }>(`/api/profile?handle=${encodeURIComponent(handle)}`);
      return { label: `@${payload.profile.handle}`, address: payload.profile.walletAddress, handle: payload.profile.handle };
    }
    if (isValidNimiqAddress(hint)) return { label: formatNimiqAddress(hint), address: hint };
    const match = contacts.find((c) => c.nickname.toLowerCase() === hint.toLowerCase());
    if (match?.verifiedAt) {
      return { label: match.handle ? `@${match.handle}` : match.nickname, address: match.walletAddress, handle: match.handle ?? undefined };
    }
    throw new Error(`No verified contact named “${hint}”. Save them under You first.`);
  }

  async function pickImage(file: File) {
    try {
      const next = await compressImage(file);
      setAttach(next);
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not read that image.", "error");
    }
  }

  async function interpret(text: string) {
    if (!session?.token) {
      notice("Connect Nimiq Pay first.", "error");
      return;
    }
    if (!text.trim() && !attach) return;
    const user: Message = { id: crypto.randomUUID(), kind: "user", text: text.trim() || "Photo", image: attach?.preview };
    const thinkId = crypto.randomUUID();
    const image = attach ? { mime: attach.mime, data: attach.data } : undefined;
    setMessages((msgs) => [...msgs, user, { id: thinkId, kind: "think" }]);
    setInput("");
    setAttach(null);
    try {
      const history = messages
        .filter((m): m is Extract<Message, { kind: "user" | "bot" }> => m.kind === "user" || m.kind === "bot")
        .slice(-6)
        .map((m) => ({ role: m.kind === "user" ? "user" : "assistant", text: m.text }));
      const payload = await api<{
        reply: string;
        summary: string;
        file: { id: string; section: string; kind: string; title: string } | null;
        chat: { handle: string; message: string } | null;
        money: Intent | null;
        confirm: boolean;
        source: string;
      }>("/api/ask", {
        token: session.token,
        body: { message: text.trim(), image, history },
      });
      setMessages((msgs) => msgs.filter((m) => m.id !== thinkId));
      setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: payload.reply, summary: payload.summary }]);
      if (payload.file) await refresh();
      if (payload.chat) {
        setMessages((msgs) => [...msgs, {
          id: crypto.randomUUID(),
          kind: "chat_preview",
          handle: payload.chat!.handle,
          message: payload.chat!.message,
          summary: payload.summary || `Chat request · @${payload.chat!.handle}`,
        }]);
        return;
      }
      const intent = payload.money;
      if (!intent || intent.kind === "ledger") return;
      if (!payload.confirm) return;
      const skipWho = intent.kind === "timer" && intent.timerAction !== "start";
      let who: { label: string; address?: string; handle?: string } | undefined;
      if (!skipWho) {
        try {
          who = await resolveHint(intent.kind === "split" ? intent.participants[0] : intent.recipientHint) ?? undefined;
        } catch (error) {
          setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: err(error) }]);
          return;
        }
      }
      setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "plan", text: text.trim() || "Photo", intent, who, summary: payload.summary }]);
    } catch (error) {
      setMessages((msgs) => [...msgs.filter((m) => m.id !== thinkId), { id: crypto.randomUUID(), kind: "bot", text: err(error) }]);
      notice(err(error), "error");
    }
  }

  async function sendChatRequest(message: Extract<Message, { kind: "chat_preview" }>) {
    if (!session?.token) return;
    setBusy(true);
    try {
      const result = await api<{ already?: boolean; request?: { peerHandle: string } }>("/api/chat/requests", {
        token: session.token,
        body: { handle: message.handle, draft: message.message },
      });
      setMessages((msgs) => [...msgs, {
        id: crypto.randomUUID(),
        kind: "bot",
        text: result.already
          ? `You already have a chat with @${message.handle}. Open Chat to continue.`
          : `I sent a chat request to @${result.request?.peerHandle ?? message.handle}. Nothing starts until they accept.`,
        summary: `Chat request · @${message.handle}`,
      }]);
      notice("Chat request sent.");
      await refresh();
    } catch (error) {
      notice(err(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function payPlan(message: Extract<Message, { kind: "plan" }>) {
    if (!session?.token) return;
    const intent = message.intent;
    setBusy(true);
    try {
      if (intent.kind === "send") {
        const who = message.who;
        if (!who?.address || intent.amount == null) throw new Error("Missing recipient or amount.");
        if (intent.remindAt) {
          await api("/api/schedules", {
            token: session.token,
            body: {
              recipientHandle: who.handle,
              recipientWallet: who.address,
              amount: intent.amount,
              note: intent.note || "Scheduled payment",
              runAt: intent.remindAt,
              recurrence: intent.recurrence,
            },
          });
          setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: `Scheduled ${intent.amount} NIM to ${who.label}. You still sign in Nimiq Pay when it is due.` }]);
          notice("Scheduled. Nothing sent yet.");
          await refresh();
          return;
        }
        notice("Approve the payment in Nimiq Pay…");
        const hint = await sendNim({ recipient: who.address, nim: intent.amount, note: intent.note ?? undefined });
        const paid = await api<{ payment: { txHash: string; confirmations: number } }>("/api/payments", {
          token: session.token,
          body: {
            recipientWallet: who.address,
            recipientHandle: who.handle,
            amount: intent.amount,
            note: intent.note,
            transactionHint: hint,
            sourceUtterance: message.text,
          },
        });
        setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: `Sent ${intent.amount} NIM to ${who.label}. Confirmed on-chain.` }]);
        notice(`Confirmed · ${paid.payment.txHash.slice(0, 10)}…`);
      } else if (intent.kind === "invoice" || intent.kind === "request") {
        const handle = extractHandle(intent.recipientHint ?? "") || message.who?.handle;
        if (!handle || intent.amount == null) throw new Error("Invoices need a SayPay @handle and amount.");
        const created = await api<{ request: { id: string; invoiceNumber: string | null } }>("/api/requests", {
          token: session.token,
          body: {
            recipientHandle: handle,
            amount: intent.amount,
            note: intent.note || "Invoice",
            kind: intent.kind === "invoice" ? "invoice" : "request",
            dueAt: intent.remindAt,
          },
        });
        const link = `${window.location.origin}/request/${created.request.id}`;
        await navigator.clipboard.writeText(link).catch(() => undefined);
        setTab("work");
        setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: `${created.request.invoiceNumber ?? "Invoice"} ready. Link copied.` }]);
        notice("Invoice link copied.");
      } else if (intent.kind === "timer") {
        const action = intent.timerAction === "stop" ? "stop" : intent.timerAction === "bill" ? "invoice" : "start";
        const handle = extractHandle(intent.recipientHint ?? "") || message.who?.handle;
        if (action === "start" && (!handle || intent.amount == null)) throw new Error("A timer needs a client @handle and an hourly rate in NIM.");
        const result = await api<{ invoice?: { id: string; invoiceNumber: string | null } }>("/api/time", {
          token: session.token,
          body: action === "start"
            ? { action, clientHandle: handle, rateNimPerHour: intent.amount, description: intent.note }
            : { action },
        });
        if (result.invoice) {
          const link = `${window.location.origin}/request/${result.invoice.id}`;
          await navigator.clipboard.writeText(link).catch(() => undefined);
          setTab("work");
          setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: `${result.invoice?.invoiceNumber ?? "Invoice"} from time. Link copied.` }]);
          notice("Invoice from time. Link copied.");
        } else {
          setTab("work");
          setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: action === "stop" ? "Timer stopped." : "Timer running." }]);
          notice(action === "stop" ? "Timer stopped." : "Timer running.");
        }
      } else if (intent.kind === "split") {
        const handles = intent.participants.map(extractHandle).filter(Boolean);
        if (!handles.length || intent.amount == null) throw new Error("Every split participant needs a claimed @handle.");
        const created = await api<{ split: { id: string } }>("/api/splits", {
          token: session.token,
          body: { participantHandles: handles, amount: intent.amount, note: intent.note || "Shared bill" },
        });
        const link = `${window.location.origin}/split/${created.split.id}`;
        await navigator.clipboard.writeText(link).catch(() => undefined);
        setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), kind: "bot", text: `Split ready. Invitation copied.` }]);
        notice("Split invitation copied.");
      } else if (intent.kind === "protected_pay") {
        setTab("work");
        notice("On Work, create a job (invoice by default) or an escrow if you need protection.");
      }
      await refresh();
    } catch (error) {
      notice(err(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!session?.token) return;
    setBusy(true);
    try {
      await api("/api/contacts", {
        token: session.token,
        body: {
          nickname: contactName.trim(),
          handle: extractHandle(contactName) || extractHandle(contactAddr) || undefined,
          contactWallet: contactAddr.trim() || undefined,
          verified: contactChecked,
        },
      });
      setContactName("");
      setContactAddr("");
      setContactChecked(false);
      notice("Contact saved.");
      await refresh();
    } catch (error) {
      notice(err(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (listening) {
      listenRef.current?.stop();
      listenRef.current = null;
      setListening(false);
      if (input.trim()) void interpret(input.trim());
      return;
    }
    try {
      listenRef.current = listen({ lang: "en-US", onText: (text) => setInput(text) });
      setListening(true);
      notice("Listening… tap again to send.");
    } catch (error) {
      notice(err(error), "error");
    }
  }

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    let cancelled = false;
    void confirmNimiqPayHost().then((ok) => { if (!cancelled) setHost(ok ? "in" : "out"); });
    return () => {
      cancelled = true;
      listenRef.current?.stop();
    };
  }, []);

  const nav = (
    <nav className="tabs" aria-label="Primary">
      {(["talk", "work", "chat", "you"] as Tab[]).map((id) => (
        <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
          <Icon d={ICONS[id]} />
          {TAB_LABEL[id]}
        </button>
      ))}
    </nav>
  );

  if (!session || !session.token) {
    const outside = host === "out" && !isLocalDevHost();
    return (
      <main className="hero">
        <section className="hero-card">
          <div className="brand"><LogoMark />SayPay</div>
          {host === "checking" && !session?.address ? (
            <>
              <p className="kicker">Nimiq Pay</p>
              <h1>Looking for the wallet…</h1>
              <p className="lead">SayPay only connects inside Nimiq Pay.</p>
              <div className="skel" style={{ height: 44 }} />
            </>
          ) : outside && !session?.address ? (
            <>
              <OpenInNimiqPay />
              <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => void connect()}>
                {busy ? "Waiting for Nimiq Pay…" : "Try connect anyway"}
              </button>
            </>
          ) : !session?.address ? (
            <>
              {host === "out" && <div className="banner" role="status">This browser is not Nimiq Pay. Connect still tries the wallet; on a phone, download the app first.</div>}
              <h1>Ask understands. You organizes.</h1>
              <p className="lead">Work is what you’re doing. Chat stays private. Nothing moves until you confirm in Nimiq Pay.</p>
              <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void connect()}>
                {busy ? "Waiting for Nimiq Pay…" : "Connect Nimiq Pay"}
              </button>
              {host === "out" && <OpenInNimiqPay compact body="Download Nimiq Pay for your phone, or pick a store." />}
            </>
          ) : (
            <>
              <p className="kicker">SayPay ID</p>
              <h1>Claim your handle</h1>
              <p className="lead">You will sign once in Nimiq Pay to prove this wallet owns it.</p>
              <div>
                <label className="label" htmlFor="handle">Your SayPay ID</label>
                <div className="field"><span className="muted">@</span>
                  <input id="handle" value={claim} maxLength={24} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    onChange={(e) => setClaim(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="your-name" />
                </div>
                <p className="small" style={{ marginTop: 8 }}>{formatNimiqAddress(session.address)}</p>
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || claim.length < 3}
                onClick={() => void claimHandle(session.address, claim)}>
                {busy ? "Waiting for Nimiq Pay…" : `Claim @${claim || "handle"}`}
              </button>
            </>
          )}
        </section>
        {toast && <div className={`toast${toast.tone === "error" ? " error" : ""}`} role="status">{toast.text}</div>}
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><LogoMark />SayPay</div>
        <span className="grow" />
        <WalletChip balance={balance} />
        <span className="chip">@{session.handle}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setTheme(!dark)} aria-label="Toggle theme">{dark ? "Light" : "Dark"}</button>
      </header>
      <aside className="rail">
        <div className="brand"><LogoMark />SayPay</div>
        {nav}
        <div className="rail-foot">
          <WalletCard balance={balance} compact />
          <span className="chip">@{session.handle}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setTheme(!dark)}>{dark ? "Light" : "Dark"} theme</button>
        </div>
      </aside>

      {tab === "work" && (
        <WorkPanel
          session={session}
          ledger={work}
          balance={balance}
          ready={ready}
          loadError={loadError}
          busy={busy}
          onRetry={() => void refresh()}
          onTalk={() => setTab("talk")}
          onCopy={async (text) => { await navigator.clipboard.writeText(text).catch(() => undefined); notice("Link copied."); }}
          notice={notice}
          refresh={refresh}
          escrows={escrows}
          jobs={jobs}
          setBusy={setBusy}
          onPayInvoice={async (row: InvoiceRow) => {
            setBusy(true);
            try {
              notice("Approve the invoice in Nimiq Pay…");
              const hint = await sendNim({ recipient: row.creatorWallet, nim: lunasToNim(row.amountLunas), note: row.note });
              const paid = await api<{ txHash: string }>(`/api/requests/${row.id}`, { method: "PATCH", token: session.token, body: { transactionHint: hint } });
              notice(`Paid · ${paid.txHash.slice(0, 10)}…`);
              await refresh();
            } catch (error) {
              notice(err(error), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {tab === "talk" && (
        <section className="screen">
          <div className="page-head">
            <div>
              <p className="kicker">Ask</p>
              <h1>Say it.</h1>
            </div>
          </div>
          <p className="muted">I file tasks, reminders, and receipts in You. Money and chat requests wait for you.</p>
          {loadError && <div className="banner error" role="alert">{loadError} <button className="btn btn-ghost btn-sm" onClick={() => void refresh()}>Retry</button></div>}
          <div className="thread" ref={threadRef} aria-live="polite">
            {messages.length === 0 && !loadError && (
              <p className="small">Type, speak, or attach a photo. Work stays for jobs and timers.</p>
            )}
            {messages.map((msg) => {
              if (msg.kind === "user") {
                return (
                  <div key={msg.id} className="bubble user">
                    {msg.image && <img src={msg.image} alt="" className="thumb" style={{ marginBottom: 8, display: "block" }} />}
                    {msg.text}
                  </div>
                );
              }
              if (msg.kind === "bot") {
                return (
                  <div key={msg.id} className="bubble bot">
                    {msg.summary && <p className="kicker" style={{ margin: "0 0 6px" }}>Understood · {msg.summary}</p>}
                    {msg.text}
                  </div>
                );
              }
              if (msg.kind === "chat_preview") {
                return (
                  <article key={msg.id} className="card">
                    <div className="row">
                      <span className="kicker" style={{ margin: 0 }}>Chat request</span>
                      <span className="grow" />
                      <span className="pill info">Confirm</span>
                    </div>
                    <p className="small">Understood · {msg.summary}</p>
                    <div className="kv"><span>To</span><b>@{msg.handle}</b></div>
                    <div className="kv"><span>Message</span><b>{msg.message}</b></div>
                    <p className="small">They will accept or decline. Ask never reads the private thread.</p>
                    <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy} onClick={() => void sendChatRequest(msg)}>
                      Send chat request
                    </button>
                  </article>
                );
              }
              if (msg.kind === "think") {
                return (
                  <div key={msg.id} className="bubble bot" aria-label="Reading">
                    <span className="dots"><i /><i /><i /></span>
                  </div>
                );
              }
              return (
                <article key={msg.id} className="card">
                  <div className="row">
                    <span className="kicker" style={{ margin: 0 }}>{msg.intent.kind.replace("_", " ")}</span>
                    <span className="grow" />
                    <span className="pill info">Confirm</span>
                  </div>
                  {msg.summary && <p className="small">Understood · {msg.summary}</p>}
                  <div className="said"><span>You said</span>“{msg.text}”</div>
                  {msg.intent.kind === "timer" && msg.intent.timerAction === "start" && (
                    <div className="kv"><span>Rate</span><b>{msg.intent.amount} NIM/h</b></div>
                  )}
                  {msg.intent.kind !== "timer" && msg.intent.amount != null && (
                    <div className="kv"><span>Amount</span><b>{msg.intent.amount} NIM</b></div>
                  )}
                  {(msg.who || msg.intent.recipientHint || msg.intent.participants.length > 0) && (
                    <div className="kv"><span>To</span><b>{msg.who?.label ?? msg.intent.recipientHint ?? msg.intent.participants.join(", ")}</b></div>
                  )}
                  {msg.who?.address && <div className="kv"><span>Address</span><b className="mono">{formatNimiqAddress(msg.who.address)}</b></div>}
                  {msg.intent.note && <div className="kv"><span>Note</span><b>{msg.intent.note}</b></div>}
                  <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy} onClick={() => void payPlan(msg)}>
                    {msg.intent.kind === "timer"
                      ? msg.intent.timerAction === "stop" ? "Stop timer" : msg.intent.timerAction === "bill" ? "Invoice time" : "Start timer"
                      : msg.intent.kind === "invoice" || msg.intent.kind === "request" ? "Create invoice"
                      : msg.intent.kind === "split" ? "Create split"
                      : msg.intent.kind === "protected_pay" ? "Open Work"
                      : "Confirm in Nimiq Pay"}
                  </button>
                </article>
              );
            })}
          </div>
          <div className="dock">
            {attach && (
              <div className="attach-preview">
                <img src={attach.preview} alt="" />
                <span className="small grow">Photo attached</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttach(null)}>Remove</button>
              </div>
            )}
            <form className="composer" onSubmit={(e) => { e.preventDefault(); if (input.trim() || attach) void interpret(input); }}>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void pickImage(file);
              }} />
              <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach photo">
                <Icon d="M4 7h4l2-2h4l2 2h4v12H4V7zm8 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />
              </button>
              <div className="field">
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Remind me, save a receipt, invoice @maya…" aria-label="Ask" autoFocus />
              </div>
              <button type="submit" className="icon-btn primary" disabled={(!input.trim() && !attach) || busy} aria-label="Send">
                <Icon d="M5 12h14M13 6l6 6-6 6" />
              </button>
              <button type="button" className={`icon-btn${listening ? " live" : ""}`} onClick={toggleMic}
                aria-label={listening ? "Stop listening" : "Speak"}
                aria-pressed={listening}
                disabled={!canListen() && !listening}>
                <Icon d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm7 9a7 7 0 0 1-14 0m7 7v3" />
              </button>
            </form>
            <p className="small" style={{ textAlign: "center", marginTop: 8 }}>
              Ask understands. You organizes. Confirm before money or chat.
            </p>
          </div>
        </section>
      )}

      {tab === "chat" && (
        <ChatPanel session={session} notice={notice} />
      )}

      {tab === "you" && (
        <YouTab
          session={session}
          balance={balance}
          schedules={schedules}
          activity={activity}
          records={records}
          contacts={contacts}
          ready={ready}
          busy={busy}
          contactName={contactName}
          contactAddr={contactAddr}
          contactChecked={contactChecked}
          setContactName={setContactName}
          setContactAddr={setContactAddr}
          setContactChecked={setContactChecked}
          saveContact={saveContact}
          onRecordsChange={() => void refresh()}
          paySchedule={async (row) => {
            setBusy(true);
            try {
              notice("Approve the scheduled payment in Nimiq Pay…");
              const hint = await sendNim({ recipient: row.recipientWallet, nim: lunasToNim(row.amountLunas), note: row.note });
              await api("/api/schedules", { token: session.token, method: "PATCH", body: { id: row.id, action: "complete", transactionHint: hint } });
              notice("Scheduled payment confirmed on-chain.");
              await refresh();
            } catch (error) {
              notice(err(error), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {toast && <div className={`toast${toast.tone === "error" ? " error" : ""}`} role="status">{toast.text}</div>}
    </main>
  );
}

function RecordList({ token, rows, empty, onChange }: { token: string; rows: AgentRecord[]; empty: string; onChange: () => void }) {
  if (!rows.length) return <Empty title={empty} body="Ask files these. Edit freely if the agent missed." />;
  return (
    <div className="stack">
      {rows.map((row) => <RecordCard key={row.id} token={token} row={row} onChange={onChange} />)}
    </div>
  );
}

function RecordCard({ token, row, onChange }: { token: string; row: AgentRecord; onChange: () => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  const [dueAt, setDueAt] = useState(row.dueAt ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!row.hasImage) return;
    let cancelled = false;
    void api<{ record: { image: string | null } }>(`/api/records/${row.id}`, { token }).then((payload) => {
      if (!cancelled) setImage(payload.record.image);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [row.hasImage, row.id, token]);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/records/${row.id}`, { token, method: "PATCH", body: { title, body, dueAt: dueAt || null } });
      setEditing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "open" | "done") {
    setBusy(true);
    try {
      await api(`/api/records/${row.id}`, { token, method: "PATCH", body: { status } });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/records/${row.id}`, { token, method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card stack">
      <div className="row" style={{ alignItems: "flex-start" }}>
        {image && <img src={image} alt="" className="thumb" />}
        <div className="grow">
          {editing ? (
            <div className="stack">
              <div className="field"><input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" /></div>
              <div className="field"><input value={body} onChange={(e) => setBody(e.target.value)} aria-label="Details" /></div>
              <div className="field"><input type="date" value={dueAt.slice(0, 10)} onChange={(e) => setDueAt(e.target.value)} aria-label="Due" /></div>
            </div>
          ) : (
            <>
              <strong>{row.title}</strong>
              <p className="small">{row.body || row.kind}{row.dueAt ? ` · due ${row.dueAt}` : ""} · {new Date(row.createdAt).toLocaleString()}</p>
            </>
          )}
        </div>
        <span className={`pill ${row.status === "done" ? "ok" : "info"}`}>{row.status === "done" ? "Done" : row.kind.replaceAll("_", " ")}</span>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {editing ? (
          <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>Save</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
            {row.status !== "done" && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void setStatus("done")}>Mark done</button>}
            {row.status === "done" && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void setStatus("open")}>Reopen</button>}
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove()}>Delete</button>
          </>
        )}
      </div>
    </article>
  );
}

function ActivityChart({ rows }: { rows: ActivityRow[] }) {
  const max = Math.max(...rows.map((r) => r.amountLunas ?? 0), 1);
  return (
    <div className="list">
      {rows.map((row) => {
        const pct = Math.max(6, Math.round(((row.amountLunas ?? 0) / max) * 100));
        return (
          <article key={row.id} className="item" style={{ alignItems: "flex-start" }}>
            <div className="avatar">{row.kind.slice(0, 1).toUpperCase()}</div>
            <div className="grow">
              <div className="row">
                <strong>{row.title}</strong>
                <span className="grow" />
                <span className={`pill ${statusTone(row.status)}`}>{row.status.replaceAll("_", " ")}</span>
              </div>
              <p className="small">{new Date(row.createdAt).toLocaleString()}</p>
              {row.amountLunas != null && (
                <>
                  <div className="amt-bar" aria-hidden><span style={{ width: `${pct}%` }} /></div>
                  <p className="small" style={{ marginTop: 6 }}>{formatNim(row.amountLunas)} NIM</p>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function YouTab({ session, balance, schedules, activity, records, contacts, ready, busy, contactName, contactAddr, contactChecked, setContactName, setContactAddr, setContactChecked, saveContact, onRecordsChange, paySchedule }: {
  session: Session;
  balance: WalletBalance | null;
  schedules: Schedule[];
  activity: ActivityRow[];
  records: AgentRecord[];
  contacts: Contact[];
  ready: boolean;
  busy: boolean;
  contactName: string;
  contactAddr: string;
  contactChecked: boolean;
  setContactName: (v: string) => void;
  setContactAddr: (v: string) => void;
  setContactChecked: (v: boolean) => void;
  saveContact: (e: FormEvent) => void;
  onRecordsChange: () => void;
  paySchedule: (row: Schedule) => void;
}) {
  const receive = `saypay:@${session.handle}`;
  return (
    <section className="screen wide">
      <div className="page-head">
        <div>
          <p className="kicker">You</p>
          <h1>@{session.handle}</h1>
        </div>
      </div>
      <p className="muted">Your records. Edit anything Ask got wrong. Work is for jobs and timers.</p>
      {!ready ? <SkeletonBlock /> : (
        <>
          <Fold title="Identity" defaultOpen>
            <WalletCard balance={balance} />
            <div className="card" style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center" }}>
              <QRCodeSVG value={receive} size={148} bgColor="transparent" fgColor="currentColor" />
              <p className="small">Others can pay @{session.handle}</p>
              <p className="mono">{formatNimiqAddress(session.address)}</p>
            </div>
          </Fold>
          <Fold title="Tasks" count={records.filter((row) => row.kind === "task").length} defaultOpen={records.some((row) => row.kind === "task" && row.status !== "done")}>
            <RecordList token={session.token} rows={records.filter((row) => row.kind === "task")} empty="Ask can save a task here. You can edit it." onChange={onRecordsChange} />
          </Fold>
          <Fold title="Reminders" count={records.filter((row) => row.kind === "reminder" || row.kind === "schedule_note").length} defaultOpen={records.some((row) => row.kind === "reminder")}>
            <RecordList token={session.token} rows={records.filter((row) => row.kind === "reminder" || row.kind === "schedule_note")} empty="Reminders Ask files for you." onChange={onRecordsChange} />
          </Fold>
          <Fold title="Receipts & expenses" count={records.filter((row) => row.kind === "receipt" || row.kind === "expense").length} defaultOpen={records.some((row) => row.kind === "receipt" || row.kind === "expense")}>
            <RecordList token={session.token} rows={records.filter((row) => row.kind === "receipt" || row.kind === "expense")} empty="Upload a photo in Ask. Correct it here if Gemini missed." onChange={onRecordsChange} />
          </Fold>
          <Fold title="Notes" count={records.filter((row) => row.kind === "note" || row.kind === "upload").length}>
            <RecordList token={session.token} rows={records.filter((row) => row.kind === "note" || row.kind === "upload")} empty="Notes and leftover uploads." onChange={onRecordsChange} />
          </Fold>
          <Fold title="Activity log" count={activity.length} defaultOpen>
            {activity.length === 0 ? (
              <Empty title="No activity yet" body="Ask filings, reminders, chat requests, and confirmed payments show up here." />
            ) : <ActivityChart rows={activity} />}
          </Fold>
          <Fold title="Scheduled payments" count={schedules.length} defaultOpen={schedules.some((row) => row.status === "due")}>
            {schedules.length === 0 ? (
              <Empty title="No reminders" body="Ask can file a reminder. A scheduled send still waits for you to sign in Nimiq Pay." />
            ) : schedules.map((row) => (
              <div key={row.id} className="item">
                <div className="grow">
                  <strong>{lunasToNim(row.amountLunas)} NIM {row.recipientHandle ? `→ @${row.recipientHandle}` : ""}</strong>
                  <p className="small">{new Date(row.runAt).toLocaleString()} · {row.note}</p>
                </div>
                <span className={`pill ${statusTone(row.status)}`}>{row.status}</span>
                {(row.status === "due" || row.status === "scheduled") && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => paySchedule(row)}>Pay</button>
                )}
              </div>
            ))}
          </Fold>
          <Fold title="People" count={contacts.length}>
            {contacts.length === 0 ? (
              <Empty title="No one saved yet" body="Ask can pay a name only after you confirm their address here." />
            ) : contacts.map((c) => (
              <div key={c.walletAddress} className="item">
                <div className="avatar">{c.nickname.slice(0, 1).toUpperCase()}</div>
                <div className="grow">
                  <strong>{c.nickname}{c.handle ? ` · @${c.handle}` : ""}</strong>
                  <p className="mono">{formatNimiqAddress(c.walletAddress)}</p>
                </div>
                <span className={`pill ${c.verifiedAt ? "ok" : "warn"}`}>{c.verifiedAt ? "Verified" : "Unverified"}</span>
              </div>
            ))}
            <form onSubmit={saveContact} className="card stack">
              <p className="kicker">Add a person</p>
              <div>
                <label className="label" htmlFor="cname">Name or @handle</label>
                <div className="field"><input id="cname" value={contactName} onChange={(e) => setContactName(e.target.value)} required /></div>
              </div>
              <div>
                <label className="label" htmlFor="caddr">Nimiq address (if they have no SayPay ID)</label>
                <div className="field"><input id="caddr" className="mono" value={contactAddr} onChange={(e) => setContactAddr(e.target.value.toUpperCase())} placeholder="NQ…" /></div>
              </div>
              {contactAddr && isValidNimiqAddress(contactAddr) && (
                <div className="said"><span>Check every character</span><p className="mono">{formatNimiqAddress(contactAddr)}</p></div>
              )}
              <label className="check">
                <input type="checkbox" checked={contactChecked} onChange={(e) => setContactChecked(e.target.checked)} />
                I compared this address with the person I intend to pay.
              </label>
              <button className="btn btn-primary btn-block" disabled={busy || !contactChecked}>Save contact</button>
            </form>
          </Fold>
        </>
      )}
    </section>
  );
}

