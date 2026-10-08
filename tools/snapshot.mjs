// Copies the library index + small WebP thumbnails from the Apps Script backend into data/.
// data/snapshot.json : { at, root, folders[{id,n,p}], items[{n,id,e,s,p,f}], labels }
// data/thumbs.json   : { fileId: "t/<fileId>.webp" | "" }   ("" = Drive has no thumbnail)
// data/t/*.webp|png|jpg
import fs from "node:fs";
import path from "node:path";

const API = "https://script.google.com/macros/s/AKfycbyN8_vX2Xi7tErx1LysAn2axU8NhZAq21UHRzkJBeF5dMgewt-dEq9xw0-BYHiPcM-q/exec";
const DIR = "data", TDIR = path.join(DIR, "t");
const MAX_NEW = 600, BATCH = 20, PAR = 3;

async function getJSON(qs, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API + "?" + qs, { redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, 3000 * (i + 1))); }
  }
}

fs.mkdirSync(TDIR, { recursive: true });
const snap = await getJSON("action=snapshot");
if (!snap || !snap.ok || !Array.isArray(snap.items) || snap.items.length < 50 || !Array.isArray(snap.folders)) {
  console.error("Snapshot looks wrong — keeping the previous one.", snap && (snap.error || snap.items?.length));
  process.exit(0);
}
const out = { at: snap.at, root: snap.root, folders: snap.folders, items: snap.items, labels: snap.labels || {} };
fs.writeFileSync(path.join(DIR, "snapshot.json"), JSON.stringify(out));
console.log(`snapshot: ${out.items.length} files, ${out.folders.length} folders`);

const manPath = path.join(DIR, "thumbs.json");
let man = {};
try { man = JSON.parse(fs.readFileSync(manPath, "utf8")); } catch {}
const live = new Set(out.items.map(x => x.id));
// drop thumbnails of files that no longer exist
for (const id of Object.keys(man)) {
  if (!live.has(id)) { if (man[id]) { try { fs.unlinkSync(path.join(DIR, man[id])); } catch {} } delete man[id]; }
}
const SKIP = /^(zip|rar|txt|json|stl|scad|ttf|otf|docx?|xlsx?)$/;
const todo = out.items.filter(x => !(x.id in man) && !SKIP.test(x.e || "")).map(x => x.id).slice(0, MAX_NEW);
out.items.forEach(x => { if (SKIP.test(x.e || "") && !(x.id in man)) man[x.id] = ""; });
console.log(`thumbnails: ${Object.keys(man).length} known, ${todo.length} to fetch`);

const batches = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let got = 0, none = 0, failed = 0;
async function worker() {
  while (batches.length) {
    const ids = batches.shift();
    let res;
    try { res = await getJSON("action=thumbs&ids=" + ids.join(",")); } catch (e) { failed += ids.length; continue; }
    const t = (res && res.thumbs) || {};
    for (const id of ids) {
      const u = t[id];
      if (u === undefined) { failed++; continue; }          // not answered — retry next run
      const m = /^data:image\/(webp|png|jpeg|gif);base64,(.*)$/.exec(u || "");
      if (!m) { man[id] = ""; none++; continue; }
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const rel = "t/" + id + "." + ext;
      fs.writeFileSync(path.join(DIR, rel), Buffer.from(m[2], "base64"));
      man[id] = rel; got++;
    }
  }
}
await Promise.all(Array.from({ length: PAR }, worker));
fs.writeFileSync(manPath, JSON.stringify(man));
console.log(`thumbnails: +${got} saved, ${none} without preview, ${failed} to retry`);
