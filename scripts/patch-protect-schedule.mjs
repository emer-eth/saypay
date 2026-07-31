#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const path = "public/saypay-ui.html";
let html = readFileSync(path, "utf8");

function replaceBetween(startMark, endMark, replacement, label) {
  const s = html.indexOf(startMark);
  const e = s >= 0 ? html.indexOf(endMark, s + startMark.length) : -1;
  if (s < 0 || e < 0) {
    console.error("FAIL", label, { s, e });
    process.exit(1);
  }
  html = html.slice(0, s) + replacement + html.slice(e);
  console.log("ok", label);
}

// lockFunds — never fake custody
replaceBetween(
  "lockFunds = () => {\\n",
  "dispute = () => {",
  "lockFunds = () => {\\n    window.__saypayHost = this;\\n    try { window.parent.postMessage({ type:'saypay', action:'toast', message:'Escrow funding is not live yet. Terms and arbiters are recorded; funds stay in your wallet.' }, '*'); } catch(e) {}\\n    this.toast('Escrow not live — funds stay in your wallet');\\n  };\\n\\n  ",
  "lockFunds",
);

// dispute — bridge when we have a real deal id on state
replaceBetween(
  "dispute = () => {\\n",
  "addEvidence = () => {",
  "dispute = () => {\\n    window.__saypayHost = this;\\n    var id = this.state.deal && this.state.deal.apiId;\\n    if (id) {\\n      try { window.parent.postMessage({ type:'saypay', action:'dealAction', dealId:id, dealAction:'open_dispute' }, '*'); } catch(e) {}\\n      this.toast('Opening dispute…');\\n      return;\\n    }\\n    this.setState(s => ({deal:{...s.deal, disputed:true, step:3}}));\\n    this.toast('Dispute noted (local demo deal — create a real deal with @handles)');\\n  };\\n\\n  ",
  "dispute",
);

// schedule result + toast in __saypayApply
if (!html.includes("d.action === 'schedule'")) {
  const hook = "if (d.action === 'approve') {";
  const inject =
    "if (d.action === 'schedule') {\\n" +
    "      if (d.ok) {\\n" +
    "        this.addActivity({ icon:this.P.me, title:d.note || 'Scheduled payment', sub:d.when || 'Scheduled', amount:d.amountLabel || '', status:'Scheduled', tone:'neutral', type:'send' });\\n" +
    "        this.toast(d.toast || 'Payment scheduled');\\n" +
    "        this.setState({ screen:'home' });\\n" +
    "      } else this.toast(d.error || 'Could not schedule');\\n" +
    "      return;\\n" +
    "    }\\n    " +
    "if (d.action === 'toast') { this.toast(d.message || ''); return; }\\n    " +
    hook;
  if (!html.includes(hook)) {
    console.error("approve hook missing for schedule inject");
    process.exit(1);
  }
  html = html.replace(hook, inject);
  console.log("ok schedule apply");
}

// protect success already sets home — enhance toast is host-side

writeFileSync(path, html);
console.log("wrote", path, html.length);
