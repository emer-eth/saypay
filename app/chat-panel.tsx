"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import {
  CHAT_WRAP_MESSAGE,
  decryptChat,
  encryptChat,
  exportPublicJwk,
  generateChatKeypair,
  importPublicJwk,
  unwrapPrivateKey,
  wrapPrivateKey,
} from "./lib/chat-crypto";
import { signMessage } from "./lib/wallet";

type Conversation = { id: string; peerHandle: string | null; peerWallet: string; lastMessageAt: number };
type ChatRequest = { id: string; peerHandle: string | null; peerWallet: string; draft: string; status: string; createdAt: string };
type CipherMessage = { id: string; senderWallet: string; ciphertext: string; iv: string; createdAt: number };
type PlainMessage = CipherMessage & { text: string };

function cacheKey(address: string) {
  return `saypay-chat-priv:${address.replace(/\s/g, "").toUpperCase()}`;
}

export function ChatPanel({
  session,
  notice,
}: {
  session: { token: string; address: string; handle: string };
  notice: (text: string, tone?: "ok" | "error") => void;
}) {
  const [ready, setReady] = useState(false);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [peerPublic, setPeerPublic] = useState<CryptoKey | null>(null);
  const [peerReady, setPeerReady] = useState(true);
  const [messages, setMessages] = useState<PlainMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [handle, setHandle] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [incoming, setIncoming] = useState<ChatRequest[]>([]);
  const [outgoing, setOutgoing] = useState<ChatRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  async function unlockKeys() {
    setBusy(true);
    try {
      const cached = window.sessionStorage.getItem(cacheKey(session.address));
      const own = await api<{ key: { publicJwk: string; wrappedPrivate: string; wrapIv: string } | null }>("/api/chat/keys", { token: session.token });
      const signed = await signMessage(CHAT_WRAP_MESSAGE);
      if (own.key) {
        const key = await unwrapPrivateKey(own.key.wrappedPrivate, own.key.wrapIv, signed.signature);
        setPrivateKey(key);
      } else {
        const pair = await generateChatKeypair();
        const wrapped = await wrapPrivateKey(pair.privateKey, signed.signature);
        await api("/api/chat/keys", {
          token: session.token,
          method: "PUT",
          body: { publicJwk: await exportPublicJwk(pair.publicKey), ...wrapped },
        });
        setPrivateKey(pair.privateKey);
      }
      if (!cached) window.sessionStorage.setItem(cacheKey(session.address), "1");
      const [list, reqs] = await Promise.all([
        api<{ conversations: Conversation[] }>("/api/chat/conversations", { token: session.token }),
        api<{ incoming: ChatRequest[]; outgoing: ChatRequest[] }>("/api/chat/requests", { token: session.token }),
      ]);
      setConversations(list.conversations);
      setIncoming(reqs.incoming);
      setOutgoing(reqs.outgoing);
      setReady(true);
    } catch (error) {
      notice(error instanceof Error ? error.message : "Chat keys could not be unlocked.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function openThread(row: Conversation, key = privateKey) {
    if (!key) return;
    setActive(row);
    setMessages([]);
    setPeerPublic(null);
    try {
      const peer = await api<{ publicJwk: string }>(`/api/chat/keys?handle=${encodeURIComponent(row.peerHandle ?? "")}`);
      const theirKey = await importPublicJwk(peer.publicJwk);
      setPeerPublic(theirKey);
      setPeerReady(true);
      const payload = await api<{ messages: CipherMessage[] }>(`/api/chat/conversations/${row.id}`, { token: session.token });
      const decoded: PlainMessage[] = [];
      for (const item of payload.messages) {
        try {
          decoded.push({ ...item, text: await decryptChat(item.ciphertext, item.iv, key, theirKey) });
        } catch {
          decoded.push({ ...item, text: "(Could not decrypt this message on this device.)" });
        }
      }
      setMessages(decoded);
    } catch (error) {
      setPeerReady(false);
      notice(error instanceof Error ? error.message : "This person has not opened Chat yet.", "error");
    }
  }

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{
        already?: boolean;
        conversation?: Conversation;
        request?: { id: string; peerHandle: string; status: string };
      }>("/api/chat/requests", {
        token: session.token,
        body: { handle, draft: requestNote },
      });
      setHandle("");
      setRequestNote("");
      if (result.already && result.conversation) {
        notice("You already have a chat with them.");
        await openThread({ ...result.conversation, lastMessageAt: Date.now() });
      } else {
        notice(`Request sent to @${result.request?.peerHandle}. Nothing starts until they accept.`);
        const reqs = await api<{ incoming: ChatRequest[]; outgoing: ChatRequest[] }>("/api/chat/requests", { token: session.token });
        setIncoming(reqs.incoming);
        setOutgoing(reqs.outgoing);
      }
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not send the request.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, action: "accept" | "decline") {
    setBusy(true);
    try {
      const result = await api<{
        status: string;
        conversation?: Conversation;
        draft?: string;
      }>(`/api/chat/requests/${id}`, { token: session.token, method: "PATCH", body: { action } });
      const reqs = await api<{ incoming: ChatRequest[]; outgoing: ChatRequest[] }>("/api/chat/requests", { token: session.token });
      setIncoming(reqs.incoming);
      setOutgoing(reqs.outgoing);
      if (action === "accept" && result.conversation) {
        const row = { ...result.conversation, lastMessageAt: Date.now() };
        setConversations((list) => [row, ...list.filter((item) => item.id !== row.id)]);
        await openThread(row);
        if (result.draft && privateKey) {
          setDraft(result.draft);
        }
        notice("Accepted. Chat is open.");
      } else {
        notice("Declined.");
      }
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not update the request.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!active || !privateKey || !peerPublic || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    try {
      const encrypted = await encryptChat(text, privateKey, peerPublic);
      const result = await api<{ message: CipherMessage }>(`/api/chat/conversations/${active.id}`, {
        token: session.token,
        body: encrypted,
      });
      setMessages((list) => [...list, { ...result.message, text }]);
    } catch (error) {
      notice(error instanceof Error ? error.message : "Message was not sent.", "error");
    }
  }

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!active || !privateKey || !peerPublic) return;
    const timer = window.setInterval(() => { void openThread(active, privateKey); }, 5000);
    return () => window.clearInterval(timer);
  }, [active?.id, privateKey, peerPublic]);

  if (!ready) {
    return (
      <section className="screen">
        <div className="page-head">
          <div>
            <p className="kicker">Chat</p>
            <h1>Talk to a SayPay ID.</h1>
          </div>
        </div>
        <p className="muted">Private messages. Ask never reads this. Unlock with Nimiq Pay once.</p>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void unlockKeys()}>
          {busy ? "Waiting for Nimiq Pay…" : "Unlock Chat"}
        </button>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="page-head">
        <div>
          <p className="kicker">Chat</p>
          <h1>{active ? `@${active.peerHandle}` : "Request a chat."}</h1>
        </div>
        {active && <button className="btn btn-ghost btn-sm" onClick={() => setActive(null)}>All chats</button>}
      </div>
      {!active && <p className="muted">Search a SayPay ID. They accept or decline. Nothing starts until they do. Ask cannot read these messages.</p>}
      {!active && (
        <>
          {incoming.length > 0 && (
            <div className="stack">
              <p className="kicker">Pending requests</p>
              {incoming.map((row) => (
                <article key={row.id} className="card stack">
                  <strong>@{row.peerHandle ?? "unknown"} wants to chat</strong>
                  {row.draft ? <p className="small">“{row.draft}”</p> : <p className="small">No first message.</p>}
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide(row.id, "accept")}>Accept</button>
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void decide(row.id, "decline")}>Decline</button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {outgoing.length > 0 && (
            <div className="stack">
              <p className="kicker">Waiting</p>
              {outgoing.map((row) => (
                <div key={row.id} className="item">
                  <div className="grow">
                    <strong>@{row.peerHandle}</strong>
                    <p className="small">Waiting for them to accept{row.draft ? ` · “${row.draft}”` : ""}</p>
                  </div>
                  <span className="pill info">Pending</span>
                </div>
              ))}
            </div>
          )}
          <form className="card stack" onSubmit={(event) => void sendRequest(event)}>
            <label className="label" htmlFor="chat-handle">SayPay ID</label>
            <div className="field"><span className="muted">@</span><input id="chat-handle" value={handle} onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))} placeholder="maya" required /></div>
            <label className="label" htmlFor="chat-note">Optional first message</label>
            <div className="field"><input id="chat-note" value={requestNote} onChange={(e) => setRequestNote(e.target.value)} placeholder="They see this on the request" /></div>
            <button className="btn btn-primary btn-block" disabled={busy || !handle.trim()}>Send request</button>
          </form>
          {conversations.length === 0 ? (
            <div className="empty"><strong>No chats yet</strong><p>Accepted requests show up here. Private, encrypted, not visible to Ask.</p></div>
          ) : (
            <div className="list">
              {conversations.map((row) => (
                <button key={row.id} className="item" onClick={() => void openThread(row)}>
                  <div className="avatar">{(row.peerHandle ?? "?").slice(0, 1).toUpperCase()}</div>
                  <div className="grow">
                    <strong>@{row.peerHandle ?? "unknown"}</strong>
                    <p className="small">{new Date(row.lastMessageAt).toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {active && (
        <>
          {!peerReady && (
            <div className="banner" role="status">@{active.peerHandle} needs to open Chat once in Nimiq Pay so you can encrypt to them.</div>
          )}
          <div className="thread" ref={threadRef} aria-live="polite">
            {messages.map((msg) => (
              <div key={msg.id} className={`bubble ${msg.senderWallet.replace(/\s/g, "").toUpperCase() === session.address.replace(/\s/g, "").toUpperCase() ? "user" : "bot"}`}>{msg.text}</div>
            ))}
          </div>
          <form className="composer" onSubmit={(event) => void send(event)}>
            <div className="field">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message" disabled={!peerReady} aria-label="Message" />
            </div>
            <button type="submit" className="icon-btn primary" disabled={!draft.trim() || !peerReady} aria-label="Send">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </>
      )}
    </section>
  );
}
