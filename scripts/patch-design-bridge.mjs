#!/usr/bin/env node
// Wire the supplied design artifact (public/saypay-ui.html) to the host page via
// postMessage. Replaces demo connect/pay/invoice/split/protect/submit handlers.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const path = "public/saypay-ui.html";
const backup = "public/saypay-ui.pre-bridge.html";

if (!existsSync(backup)) {
  copyFileSync(path, backup);
  console.log("backup →", backup);
}

// Always patch from the pre-bridge original so re-runs are idempotent.
let html = readFileSync(existsSync(backup) ? backup : path, "utf8");

const blocks = [
  { label: "componentDidMount", start: "componentDidMount(){\\n", end: "componentDidUpdate(){\\n" },
  { label: "connectNim", start: "connectNim = () => {\\n", end: "connectEvm = () => {\\n" },
  { label: "connectEvm", start: "connectEvm = () => {\\n", end: "disconnect = () => {" },
  { label: "saveContact", start: "saveContact = () => {\\n", end: "first(p){" },
  { label: "createInvoice", start: "createInvoice = () => {\\n", end: "connectNim = () => {\\n" },
  { label: "submitProtect", start: "submitProtect = () => {\\n", end: "openInvoice = () => this.setState" },
  { label: "submitSplit", start: "submitSplit = () => {\\n", end: "openProtect = () => {" },
  { label: "submit", start: "submit = (raw) => {\\n", end: "promptGo = (i) => {" },
  { label: "approve", start: "approve = () => {\\n", end: "startDemoDeal = () =>" },
];

for (const b of blocks) {
  const s = html.indexOf(b.start);
  const e = s >= 0 ? html.indexOf(b.end, s + 1) : -1;
  if (s < 0 || e < 0) {
    console.error("marker missing", b.label, { s, e });
    process.exit(1);
  }
  b.s = s;
  b.e = e;
  console.log("ok", b.label, e - s, "chars");
}

const replacements = {
  componentDidMount: `componentDidMount(){\\n    window.__saypayHost = this;\\n    if (!window.__saypayBridgeReady) {\\n      window.__saypayBridgeReady = true;\\n      window.addEventListener('message', function(ev) {\\n        var d = ev.data;\\n        if (!d || d.type !== 'saypay-result') return;\\n        var host = window.__saypayHost;\\n        if (host && typeof host.__saypayApply === 'function') host.__saypayApply(d);\\n      });\\n    }\\n    try { window.parent.postMessage({ type: 'saypay', action: 'ready' }, '*'); } catch (e) {}\\n`,

  connectNim: `connectNim = () => {\\n    window.__saypayHost = this;\\n    this.setState({nimConn:'busy'});\\n    try { window.parent.postMessage({ type: 'saypay', action: 'connect' }, '*'); } catch (e) { this.setState({nimConn:'out'}); this.toast('Bridge unavailable'); }\\n  };\\n  __saypayApply = (d) => {\\n    if (!d) return;\\n    if (d.action === 'connect') {\\n      if (d.ok) {\\n        var next = { nimConn:'in', ob:4 };\\n        if (d.nim != null) next.nim = d.nim;\\n        if (d.nimFiat) next.nimFiat = d.nimFiat;\\n        if (d.connLabel) next.connLabel = d.connLabel;\\n        this.setState(next);\\n        this.toast(d.toast || 'Nimiq Pay connected');\\n      } else {\\n        this.setState({ nimConn:'out' });\\n        this.toast(d.error || 'Could not connect');\\n      }\\n      return;\\n    }\\n    if (d.action === 'approve') {\\n      var sh = this.state.sheet;\\n      if (!sh || !sh.card) { this.setState({sheet:null}); return; }\\n      if (d.ok) {\\n        var card = sh.card;\\n        this.patch(card.id, { status:'done' });\\n        this.setState(function(s){ return { sheet:null, nim: d.nim != null ? d.nim : s.nim }; });\\n        this.push({ id:this.nid(), kind:'receipt', title:'Sent', amount:card.amount, asset:card.asset, to:card.to, hash:d.hash || 'submitted' });\\n        this.addActivity({ icon:card.to, title:card.note || 'Payment', sub:'Sent via Nimiq Pay', amount:'\\u2212' + this.fmt(card.amount) + ' ' + card.asset, status:'Sent', tone:'out', type:'send' });\\n        this.toast(d.toast || 'Payment sent');\\n      } else {\\n        this.patch(sh.card.id, { status:'failed' });\\n        this.setState({ sheet:null });\\n        this.toast(d.error || 'Payment failed');\\n      }\\n      return;\\n    }\\n    if (d.action === 'invoice') {\\n      if (d.ok) {\\n        this.setInv('link', d.link);\\n        this.addActivity({ icon:this.P.me, title:'Invoice · ' + (d.note || 'Work'), sub:d.sub || 'Link created', amount:d.amountLabel, status:'Awaiting', tone:'neutral', type:'request' });\\n        this.toast(d.toast || 'Invoice created');\\n      } else this.toast(d.error || 'Invoice failed');\\n      return;\\n    }\\n    if (d.action === 'split') {\\n      if (d.ok) {\\n        this.toast(d.toast || 'Split created');\\n        if (d.link) this.push({ id:this.nid(), kind:'dealLink', text:'Share: ' + d.link });\\n        this.setState({ screen:'home' });\\n      } else this.toast(d.error || 'Split failed');\\n      return;\\n    }\\n    if (d.action === 'protect') {\\n      if (d.ok) {\\n        this.toast(d.toast || 'Protected deal created (terms only)');\\n        this.setState({ screen:'home' });\\n      } else this.toast(d.error || 'Deal failed');\\n      return;\\n    }\\n    if (d.action === 'interpret') {\\n      this.setState(function(s){ return { msgs: (s.msgs||[]).filter(function(m){ return m.kind !== 'thinking'; }) }; });\\n      if (!d.ok) { this.push({ id:this.nid(), kind:'error', src:d.text, text:d.error || 'Could not read that.' }); return; }\\n      if (d.clarify) { this.push({ id:this.nid(), kind:'text', text:d.clarify }); return; }\\n      if (d.kind === 'send' && d.who) {\\n        var c1 = this.cardSend(d.text, d.amount, d.asset || 'NIM', d.who);\\n        if (d.note) c1.note = d.note;\\n        this.push(c1);\\n      } else if (d.kind === 'split') {\\n        this.push(this.cardSplit(d.text, d.amount || 0, d.people || [this.P.me]));\\n      } else if (d.kind === 'invoice' || d.kind === 'request') {\\n        this.push(this.cardInvoice(d.text, d.amount || 0, d.who || null));\\n      } else if (d.kind === 'protected_pay' || d.kind === 'protect') {\\n        var seller = d.who || (this.names()[0] || this.P.ada);\\n        this.push(this.cardProtected(d.text, d.amount || 0, seller));\\n      } else if (d.message) {\\n        this.push({ id:this.nid(), kind:'text', text:d.message });\\n      }\\n      return;\\n    }\\n    if (d.action === 'balance' && d.ok) {\\n      var b = {};\\n      if (d.nim != null) b.nim = d.nim;\\n      if (d.nimFiat) b.nimFiat = d.nimFiat;\\n      if (d.connLabel) b.connLabel = d.connLabel;\\n      this.setState(b);\\n      return;\\n    }\\n    if (d.action === 'contact') {\\n      if (d.ok) {\\n        if (d.person) {\\n          var person = d.person;\\n          this.setState(function(s){ return { people:[].concat(s.people || this.names(), [person]), sheet:null }; }.bind(this));\\n        } else this.setState({ sheet:null });\\n        this.toast(d.toast || 'Contact saved');\\n      } else this.toast(d.error || 'Could not save contact');\\n      return;\\n    }\\n    if (d.action === 'toast') this.toast(d.message || '');\\n  };\\n`,

  connectEvm: `connectEvm = () => {\\n    this.toast('USDT on Polygon is not live yet. Use NIM with Nimiq Pay.');\\n  };\\n`,

  saveContact: `saveContact = () => {\\n    var nm = this.state.cName.trim();\\n    if (!nm || !this.state.cChecked) return;\\n    window.__saypayHost = this;\\n    try { window.parent.postMessage({ type:'saypay', action:'contact', name:nm, addr:this.state.cAddr }, '*'); } catch(e) { this.toast('Could not save'); }\\n  };\\n`,

  createInvoice: `createInvoice = () => {\\n    if (!this.invValid()) return;\\n    window.__saypayHost = this;\\n    try { window.parent.postMessage({ type:'saypay', action:'invoice', inv: this.state.inv }, '*'); } catch(e) { this.toast('Could not create invoice'); }\\n  };\\n`,

  submitProtect: `submitProtect = () => {\\n    if (!this.protectValid()) return;\\n    var i = this.state.prt, pool = this.arbPool();\\n    var arbiters = i.arb.map(function(id){ return pool.filter(function(p){ return p.id === id; })[0]; }).filter(Boolean);\\n    window.__saypayHost = this;\\n    try { window.parent.postMessage({ type:'saypay', action:'protect', prt:i, to:i.to, arbiters: arbiters.map(function(a){ return { name:a.name, addr:a.addr||'', handle:a.handle||'' }; }) }, '*'); } catch(e) { this.toast('Could not create deal'); }\\n  };\\n`,

  submitSplit: `submitSplit = () => {\\n    if (!this.splitValid()) return;\\n    var i = this.state.spl;\\n    var chosen = this.splitPool().filter(function(p){ return i.sel.indexOf(p.id) >= 0; });\\n    window.__saypayHost = this;\\n    try { window.parent.postMessage({ type:'saypay', action:'split', spl:i, chosen: chosen.map(function(p){ return { name:p.name, addr:p.addr||'', handle:p.handle||'' }; }) }, '*'); } catch(e) { this.toast('Could not create split'); }\\n  };\\n`,

  submit: `submit = (raw) => {\\n    var text = (raw ?? this.state.input).trim();\\n    if (!text) return;\\n    var um = {id:this.nid(), kind:'user', text:text};\\n    var th = {id:this.nid(), kind:'thinking'};\\n    this.setState(function(s){ return { msgs:[].concat((s.msgs || this.baseMsgs()).filter(function(m){ return m.kind !== 'chips'; }), [um, th]), input:'' }; }.bind(this));\\n    window.__saypayHost = this;\\n    try { window.parent.postMessage({ type:'saypay', action:'interpret', text:text }, '*'); } catch(e) {\\n      this.setState(function(s){ return { msgs: (s.msgs||[]).filter(function(m){ return m.kind !== 'thinking'; }) }; });\\n      this.push({ id:this.nid(), kind:'error', src:text, text:'Could not reach SayPay.' });\\n    }\\n  };\\n`,

  approve: `approve = () => {\\n    var sh = this.state.sheet;\\n    if (!sh) return;\\n    this.setState({sheet:Object.assign({}, sh, {busy:true})});\\n    window.__saypayHost = this;\\n    try { window.parent.postMessage({ type:'saypay', action:'approve', card: sh.card }, '*'); } catch(e) {\\n      this.setState({sheet:null});\\n      this.toast('Could not reach wallet bridge');\\n    }\\n  };\\n`,
};

// Apply from end to start so indices remain valid.
const ordered = [...blocks].sort((a, b) => b.s - a.s);
for (const b of ordered) {
  const rep = replacements[b.label];
  if (!rep) continue;
  if (b.label === "componentDidMount") {
    const originalBody = html.slice(b.s + b.start.length, b.e);
    html = html.slice(0, b.s) + rep + originalBody + html.slice(b.e);
  } else {
    html = html.slice(0, b.s) + rep + html.slice(b.e);
  }
  console.log("patched", b.label);
}

writeFileSync(path, html);
console.log("wrote", path, html.length);
console.log("verify host", html.includes("__saypayHost"));
console.log("verify apply", html.includes("__saypayApply"));
console.log("verify result listener", html.includes("saypay-result"));
console.log("verify connect action", html.includes("action: 'connect'"));
