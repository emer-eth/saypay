#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const path = "public/saypay-ui.html";
let html = readFileSync(path, "utf8");

function replaceBetween(startMark, endMark, replacement, label) {
  const s = html.indexOf(startMark);
  const e = s >= 0 ? html.indexOf(endMark, s + startMark.length) : -1;
  if (s < 0 || e < 0) {
    console.error("FAIL", label, { s, e, startMark: startMark.slice(0, 60) });
    process.exit(1);
  }
  html = html.slice(0, s) + replacement + html.slice(e);
  console.log("ok", label);
}

// 1) names() — no demo Mum/Ada/Tunde fallback
replaceBetween(
  "names(){\\n    if (this.state.people) return this.state.people;\\n    return ['mum','ada','tunde'].slice(0, Math.max(0, this.props.contactCount ?? 3)).map(id => this.P[id]);\\n  }",
  "newPerson(name, addr){",
  "names(){\\n    if (Array.isArray(this.state.people)) return this.state.people;\\n    return [];\\n  }\\n  ",
  "names",
);

// 2) submitSend → host prepareSend
// Find exact block by start/end
{
  const start = "submitSend = () => {\\n";
  const end = "openSplit = () => {";
  const s = html.indexOf(start);
  // openSplit may use different quote style after prior patches
  let e = html.indexOf(end, s);
  if (e < 0) e = html.indexOf("openSplit = () =>", s);
  if (s < 0 || e < 0) {
    console.error("FAIL submitSend", { s, e });
    process.exit(1);
  }
  const rep =
    "submitSend = () => {\\n" +
    "    if (!this.sendValid()) return;\\n" +
    "    window.__saypayHost = this;\\n" +
    "    try { window.parent.postMessage({ type:'saypay', action:'prepareSend', snd: this.state.snd }, '*'); } catch (e) { this.toast('Could not prepare payment'); }\\n" +
    "  };\\n\\n  ";
  html = html.slice(0, s) + rep + html.slice(e);
  console.log("ok submitSend");
}

// 3) On connect, set people from host (clears demo roster)
{
  const old =
    "if (d.ok) {\\n        var next = { nimConn:'in', ob:4 };\\n        if (d.nim != null) next.nim = d.nim;\\n        if (d.nimFiat) next.nimFiat = d.nimFiat;\\n        if (d.connLabel) next.connLabel = d.connLabel;\\n        this.setState(next);\\n        this.toast(d.toast || 'Nimiq Pay connected');";
  const neu =
    "if (d.ok) {\\n        var next = { nimConn:'in', ob:4, people: Array.isArray(d.people) ? d.people : [] };\\n        if (d.nim != null) next.nim = d.nim;\\n        if (d.nimFiat) next.nimFiat = d.nimFiat;\\n        if (d.connLabel) next.connLabel = d.connLabel;\\n        this.setState(next);\\n        this.toast(d.toast || 'Nimiq Pay connected');";
  if (!html.includes(old)) {
    console.error("FAIL connect people branch");
    const i = html.indexOf("nimConn:'in', ob:4");
    console.log(html.slice(Math.max(0, i - 40), i + 180));
    process.exit(1);
  }
  html = html.replace(old, neu);
  console.log("ok connect people");
}

// 4) prepareSend result handler
{
  const approveHook = "if (d.action === 'approve') {";
  if (!html.includes(approveHook)) {
    console.error("FAIL approve hook");
    process.exit(1);
  }
  if (!html.includes("d.action === 'prepareSend'")) {
    const prepareHook =
      "if (d.action === 'prepareSend') {\\n" +
      "      if (d.ok) {\\n" +
      "        var person = d.person;\\n" +
      "        var card = this.cardSend('Send ' + d.amount + ' ' + (d.asset || 'NIM') + ' to ' + person.name, d.amount, d.asset || 'NIM', person);\\n" +
      "        card.note = d.note || 'No note';\\n" +
      "        this.fromPage = true;\\n" +
      "        this.push(card);\\n" +
      "        this.later(function(){ this.commit(card.id); }.bind(this), 60);\\n" +
      "      } else {\\n" +
      "        this.toast(d.error || 'Cannot prepare payment');\\n" +
      "      }\\n" +
      "      return;\\n" +
      "    }\\n    " +
      approveHook;
    html = html.replace(approveHook, prepareHook);
    console.log("ok prepareSend apply");
  } else {
    console.log("prepareSend already present");
  }
}

// 5) Soften demo chips: when no contacts, empty chips instead of fake people
// promptRunnable already uses names().length — with empty names chips become empty-path. Good.

writeFileSync(path, html);
console.log("wrote", path, html.length);
console.log({
  namesEmpty: html.includes("Array.isArray(this.state.people)"),
  prepareSend: html.includes("prepareSend"),
  peopleOnConnect: html.includes("Array.isArray(d.people)"),
});
