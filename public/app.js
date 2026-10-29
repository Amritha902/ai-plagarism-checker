"use strict";

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const countWords = (t) => (t.match(/[\p{L}\p{N}]+/gu) || []).length;
const fmt = (n) => n.toLocaleString();
const pct = (n) => (n < 10 ? n.toFixed(1) : Math.round(n)) + "%";
const HUES = [355, 210, 140, 35, 275, 180, 60, 310, 20, 100];
const color = (i, a = 0.3) => `hsl(${HUES[i % HUES.length]} 75% 55% / ${a})`;
const level = (v, warn, bad) => (v >= bad ? "lvl-bad" : v >= warn ? "lvl-warn" : "lvl-good");
// Inline message, because some embedded viewers block browser pop-up dialogs.
function notify(msg, isError = true) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.hidden = true; }, 6000);
}
const BIG_TEXT = 1_500_000; // above this, keep file text out of the textarea so the page stays fast

// ---------- file reading (all in the browser) ----------
const scripts = {};
function loadScript(src) {
  return (scripts[src] ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Could not load " + src));
    document.head.appendChild(s);
  }));
}
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

async function readFile(file, onProgress = () => {}) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") {
    await loadScript(PDFJS);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      let line = "";
      for (const item of content.items) line += item.str + (item.hasEOL ? "\n" : " ");
      pages.push(line);
      onProgress(`Reading ${file.name}: page ${p} of ${pdf.numPages}`, p / pdf.numPages);
    }
    return pages.join("\n\n");
  }
  if (ext === "docx") {
    await loadScript(MAMMOTH);
    onProgress(`Reading ${file.name}`, 0.5);
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  const text = await file.text();
  if (ext === "html" || ext === "htm") return new DOMParser().parseFromString(text, "text/html").body.innerText || "";
  if (ext === "rtf") return text.replace(/\\par[d]?/g, "\n").replace(/\{\*?\\[^{}]+}|[{}]|\\\S+/g, "").trim();
  return text;
}

async function readFiles(files, progressEl) {
  const out = [];
  for (const f of files) {
    try {
      const text = await readFile(f, (label, frac) => showProgress(progressEl, label, frac));
      if (!text.trim()) throw new Error("no readable text (scanned image PDF?)");
      out.push({ name: f.name, text });
    } catch (e) {
      notify(`Could not read ${f.name}: ${e.message}`);
    }
  }
  hideProgress(progressEl);
  return out;
}

// ---------- worker ----------
const worker = new Worker("worker.js");
let jobId = 0;
const jobs = new Map();
worker.onmessage = (e) => {
  const job = jobs.get(e.data.id);
  if (!job) return;
  if (e.data.progress) return job.onProgress(e.data.progress.label, e.data.progress.frac);
  jobs.delete(e.data.id);
  e.data.error ? job.reject(new Error(e.data.error)) : job.resolve(e.data.result);
};
function run(task, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    jobs.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, task, payload });
  });
}

function showProgress(el, label, frac) {
  el.hidden = false;
  el.querySelector(".bar").style.width = Math.round(100 * frac) + "%";
  el.querySelector(".label").textContent = label;
}
function hideProgress(el) { el.hidden = true; }

function wireDrop(label, onFiles) {
  const input = label.querySelector("input[type=file]");
  input.addEventListener("change", () => { onFiles([...input.files]); input.value = ""; });
  label.addEventListener("dragover", (e) => { e.preventDefault(); label.classList.add("over"); });
  label.addEventListener("dragleave", () => label.classList.remove("over"));
  label.addEventListener("drop", (e) => { e.preventDefault(); label.classList.remove("over"); onFiles([...e.dataTransfer.files]); });
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $("tab-check").hidden = t.dataset.tab !== "check";
  $("tab-compare").hidden = t.dataset.tab !== "compare";
}));

// ---------- tab 1: document ----------
let bigDoc = null; // { name, text } when a large file is loaded outside the textarea

function updateDocCount() {
  const text = bigDoc ? bigDoc.text : $("docText").value;
  $("docCount").textContent = fmt(countWords(text)) + " words";
}
$("docText").addEventListener("input", () => {
  if (bigDoc) { bigDoc = null; $("docFileName").textContent = ""; }
  clearTimeout($("docText")._t);
  $("docText")._t = setTimeout(updateDocCount, 300);
});

wireDrop($("docDrop"), async (files) => {
  if (!files.length) return;
  const [doc] = await readFiles(files.slice(0, 1), $("checkProgress"));
  if (!doc) return;
  if (doc.text.length > BIG_TEXT) {
    bigDoc = doc;
    $("docText").value = "";
    $("docText").placeholder = `${doc.name} is loaded (${fmt(doc.text.length)} characters). It is kept out of this box so the page stays fast. Type here to replace it.`;
    $("docFileName").textContent = "Loaded: " + doc.name;
  } else {
    bigDoc = null;
    $("docText").value = doc.text;
    $("docFileName").textContent = "Loaded: " + doc.name;
  }
  updateDocCount();
});

// sources
const sources = [];
function renderSources() {
  $("srcList").innerHTML = sources.map((s, i) => `
    <li><span class="dot" style="background:${color(i, 1)}"></span>
      <span class="name" title="${esc(s.name)}">${esc(s.name)}</span>
      <span class="muted small">${fmt(countWords(s.text))} words</span>
      <button data-i="${i}" aria-label="Remove">×</button></li>`).join("");
  $("srcCount").textContent = sources.length + (sources.length === 1 ? " source" : " sources");
}
$("srcList").addEventListener("click", (e) => {
  if (e.target.dataset.i !== undefined) { sources.splice(+e.target.dataset.i, 1); renderSources(); }
});
wireDrop($("srcFiles").parentElement, async (files) => {
  sources.push(...await readFiles(files, $("checkProgress")));
  renderSources();
});
$("srcPasteBtn").onclick = () => { $("srcPasteBox").hidden = false; $("srcPasteText").focus(); };
$("srcPasteCancel").onclick = () => { $("srcPasteBox").hidden = true; };
$("srcPasteAdd").onclick = () => {
  const text = $("srcPasteText").value;
  if (!text.trim()) return;
  sources.push({ name: $("srcPasteName").value.trim() || `Pasted source ${sources.length + 1}`, text });
  $("srcPasteText").value = ""; $("srcPasteName").value = ""; $("srcPasteBox").hidden = true;
  renderSources();
};

// online check availability
let onlineAvailable = false;
fetch("api/status").then((r) => r.json()).then((s) => {
  onlineAvailable = s.ai;
  $("onlineNote").textContent = s.ai ? "(sends the text to Claude; takes ~1 minute)" : "(off: the server has no ANTHROPIC_API_KEY)";
  $("optOnline").checked = s.ai;
  $("optOnline").disabled = !s.ai;
}).catch(() => {
  $("onlineNote").textContent = "(off: no server)";
  $("optOnline").disabled = true;
});

$("runCheck").onclick = async () => {
  const text = bigDoc ? bigDoc.text : $("docText").value;
  if (!text.trim()) return notify("Paste some text or upload a file first.");
  const doc = { name: bigDoc ? bigDoc.name : "Your document", text };
  const opts = { paraphrase: $("optParaphrase").checked };
  $("runCheck").disabled = true;
  try {
    const result = await run("check", { doc, sources, opts }, (l, f) => showProgress($("checkProgress"), l, f));
    hideProgress($("checkProgress"));
    renderCheck(doc, result);
    if ($("optOnline").checked && onlineAvailable) runOnline(text, result.passages);
  } catch (e) {
    hideProgress($("checkProgress"));
    notify("Check failed: " + e.message);
  } finally {
    $("runCheck").disabled = false;
  }
};

function statTile(value, label, sub, cls = "") {
  return `<div class="stat"><div class="v ${cls}">${value}</div><div class="k">${label}</div>${sub ? `<div class="sub muted">${sub}</div>` : ""}</div>`;
}

function renderCheck(doc, r) {
  const el = $("checkResults");
  const s = r.sources;
  const ai = r.ai;
  let html = `<div class="stats">
    ${s ? statTile(pct(s.percent), "Matches your sources", `${fmt(s.matchedWords)} of ${fmt(s.words)} ${s.k === 4 ? "content " : ""}words`, level(s.percent, 15, 40))
        : statTile("—", "Matches your sources", "No sources added")}
    ${ai.score === null ? statTile("—", "AI-writing estimate", ai.reason)
        : statTile(ai.score + "%", "AI-writing estimate", "style heuristics", level(ai.score, 40, 70))}
    <div class="stat" id="onlineTile"><div class="v">—</div><div class="k">Found online</div><div class="sub muted">${$("optOnline").checked && onlineAvailable ? "searching…" : "web check off"}</div></div>
    ${statTile(pct(r.repetition.percent), "Repeated within itself", "copy-pasted padding", level(r.repetition.percent, 10, 25))}
  </div>
  <div id="onlineCard"></div>`;

  if (s) {
    html += `<div class="card"><h3>Similarity by source</h3><div class="table-wrap"><table>
      <tr><th>Source</th><th class="num">Words</th><th>Overlap</th><th class="num">%</th><th class="num">Passages</th></tr>
      ${s.perSource.map((p, i) => ({ ...p, i })).sort((a, b) => b.percent - a.percent).map((p) => `
        <tr><td><span class="dot" style="display:inline-block;background:${color(p.i, 1)}"></span> ${esc(p.name)}</td>
        <td class="num">${fmt(p.words)}</td>
        <td><div class="meter"><i style="width:${p.percent}%;background:${color(p.i, 1)}"></i></div></td>
        <td class="num">${pct(p.percent)}</td><td class="num">${p.passages}</td></tr>`).join("")}
    </table></div></div>`;
  }

  if (ai.score !== null) {
    const sg = ai.signals;
    html += `<div class="card"><h3>AI-writing signals</h3>
      <div class="signals">
        <div><b>${sg.sentenceLengthVariation}</b>sentence-length variation <span class="muted">(people ≈ 0.5+, AI ≈ 0.3)</span></div>
        <div><b>${sg.averageSentenceWords}</b>words per sentence</div>
        <div><b>${sg.stockPhrasesPer1000Words}</b>stock AI phrases per 1,000 words</div>
        <div><b>${sg.contractionsPer1000Words}</b>contractions per 1,000 words</div>
        <div><b>${sg.transitionSentenceShare}%</b>sentences opening with “Moreover/Furthermore…”</div>
        <div><b>${sg.vocabularyVariety}</b>vocabulary variety</div>
      </div>
      ${ai.topPhrases.length ? `<div class="muted small" style="margin-bottom:6px">Phrases typical of AI text:</div>
        <div class="chips">${ai.topPhrases.map(([p, c]) => `<span>${esc(p)} ×${c}</span>`).join("")}</div>` : ""}
    </div>`;
  }

  html += `<div class="card"><div class="card-head"><h3>Your document</h3>
      <div class="seg" id="viewSeg"><button class="on" data-v="src">Source matches</button><button data-v="ai">AI heat-map</button></div></div>
      <div class="legend" id="legend"></div>
      <div class="doc-view" id="docView"></div>
      <div class="row"><button class="btn ghost" id="moreDoc" hidden>Show more</button>
      <button class="btn ghost" id="dlReport">Download report</button>
      <button class="btn ghost" id="copyReport">Copy report</button></div></div>`;

  if (s && s.passages.length) {
    const top = [...s.passages].sort((a, b) => b.words - a.words).slice(0, 200);
    html += `<div class="card"><h3>Matched passages <span class="muted small">(${fmt(s.passages.length)}, longest first${s.passages.length > 200 ? ", top 200 shown" : ""})</span></h3>
      ${top.map((p) => `<div class="passage" data-start="${p.start}" data-end="${p.end}" title="Show in document">
        <span class="tag" style="background:${color(p.source)};color:inherit">${esc(s.perSource[p.source].name)}</span>
        <span class="muted small">${p.words} words</span>
        <div class="cols"><div><div class="lbl">Your document</div>${esc(p.text)}</div>
        <div><div class="lbl">Source</div>${esc(p.sourceText)}</div></div></div>`).join("")}</div>`;
  }

  el.innerHTML = html;
  el.hidden = false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });

  const views = {
    src: { spans: s ? s.passages.map((p) => ({ start: p.start, end: p.end, bg: color(p.source), title: s.perSource[p.source].name })) : [],
           legend: s ? s.perSource.map((p, i) => `<span><span class="dot" style="background:${color(i, 1)}"></span>${esc(p.name)}</span>`).join("") : `<span class="muted">Add sources to see matches highlighted.</span>` },
    ai: { spans: r.aiParagraphs.filter((p) => p.score !== null && p.score >= 30).map((p) => ({ start: p.start, end: p.end, bg: `hsl(${p.score >= 70 ? 0 : 35} 85% 55% / ${0.12 + p.score / 400})`, title: `AI estimate ${p.score}%` })),
          legend: `<span><span class="dot" style="background:hsl(35 85% 55%)"></span>Possibly AI (30–69%)</span><span><span class="dot" style="background:hsl(0 85% 55%)"></span>Likely AI (70%+)</span><span class="muted">Text is scored in blocks of ~120 words.</span>` },
  };
  let shown = 0, current = "src";
  const CHUNK = 300_000;
  function render(view) {
    current = view; shown = 0;
    $("legend").innerHTML = views[view].legend;
    $("docView").innerHTML = "";
    more();
  }
  function more() {
    const end = Math.min(doc.text.length, shown + CHUNK);
    $("docView").insertAdjacentHTML("beforeend", highlight(doc.text, views[current].spans, shown, end));
    shown = end;
    $("moreDoc").hidden = shown >= doc.text.length;
    $("moreDoc").textContent = `Show more (${fmt(doc.text.length - shown)} characters left)`;
  }
  $("moreDoc").onclick = more;
  $("viewSeg").onclick = (e) => {
    if (!e.target.dataset.v) return;
    $("viewSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
    render(e.target.dataset.v);
  };
  $("dlReport").onclick = () => downloadReport(doc, r);
  $("copyReport").onclick = () => navigator.clipboard.writeText(reportText(doc, r))
    .then(() => notify("Report copied to the clipboard.", false))
    .catch(() => notify("Copying is blocked here. Use Download report instead."));
  el.querySelectorAll(".passage").forEach((pEl) => pEl.addEventListener("click", () => {
    if (current !== "src") $("viewSeg").querySelector("[data-v=src]").click();
    while (shown < +pEl.dataset.end) more();
    const mark = [...$("docView").querySelectorAll("mark")].find((m) => +m.dataset.start <= +pEl.dataset.start && +m.dataset.end >= +pEl.dataset.start);
    if (!mark) return;
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.classList.add("flash");
    setTimeout(() => mark.classList.remove("flash"), 1500);
  }));
  render("src");
}

/** HTML for text[from, to) with the given spans wrapped in <mark>. */
function highlight(text, spans, from, to) {
  let out = "", pos = from;
  for (const sp of spans) {
    if (sp.end <= pos || sp.start >= to) continue;
    const a = Math.max(sp.start, pos), b = Math.min(sp.end, to);
    out += esc(text.slice(pos, a)) + `<mark style="background:${sp.bg}" title="${esc(sp.title)}" data-start="${a}" data-end="${b}">${esc(text.slice(a, b))}</mark>`;
    pos = b;
  }
  return out + esc(text.slice(pos, to));
}

let lastOnline = null;
async function runOnline(text, passages) {
  const card = $("onlineCard");
  card.innerHTML = `<div class="card"><h3>Web search + AI review</h3><p class="muted">Claude is searching the web for ${passages.length} sampled passages and reading the document… this usually takes under a minute.</p></div>`;
  lastOnline = null;
  try {
    const res = await fetch("api/ai-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 400_000), passages }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    lastOnline = data;
    const matches = (data.matches || []).filter((m) => m.url);
    const real = matches.filter((m) => m.match !== "same topic only");
    $("onlineTile").innerHTML = `<div class="v ${level(real.length ? 100 * real.length / passages.length : 0, 10, 30)}">${real.length}/${passages.length}</div>
      <div class="k">Passages found online</div><div class="sub muted">AI review: ${data.ai_likelihood ?? "—"}% AI</div>`;
    card.innerHTML = `<div class="card"><h3>Web search + AI review</h3>
      <p>${esc(String(data.summary || ""))}</p>
      ${data.ai_verdict ? `<p><b>AI verdict:</b> ${esc(data.ai_verdict)} (${data.ai_likelihood}%)</p>` : ""}
      ${(data.ai_reasons || []).length ? `<ul>${data.ai_reasons.map((x) => `<li>${esc(String(x))}</li>`).join("")}</ul>` : ""}
      ${matches.length ? `<div class="table-wrap"><table><tr><th>#</th><th>Passage</th><th>Found at</th><th>Match</th></tr>
        ${matches.map((m) => `<tr><td>${m.passage}</td><td>${esc(passages[m.passage - 1] || "")}…</td>
          <td><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.title || m.url)}</a>${m.evidence ? `<div class="muted small">“${esc(String(m.evidence))}”</div>` : ""}</td>
          <td><span class="tag">${esc(String(m.match || ""))}</span></td></tr>`).join("")}</table></div>`
        : `<p class="muted">No sampled passage was found on the web.</p>`}
      ${data.charsTotal > data.charsAnalysed ? `<p class="muted small">The AI review read the first ${fmt(data.charsAnalysed)} of ${fmt(data.charsTotal)} characters; the web search used passages from the whole document.</p>` : ""}
    </div>`;
  } catch (e) {
    $("onlineTile").querySelector(".sub").textContent = "failed";
    card.innerHTML = `<div class="card"><h3>Web search + AI review</h3><p class="error">${esc(e.message)}</p></div>`;
  }
}

function reportText(doc, r) {
  const L = [];
  L.push("PLAGIARISM & AI-WRITING REPORT", "Generated " + new Date().toLocaleString(), "Document: " + doc.name, "");
  if (r.sources) {
    L.push(`Similarity to sources: ${pct(r.sources.percent)} (${r.sources.matchedWords} of ${r.sources.words} words)`);
    for (const p of r.sources.perSource) L.push(`  - ${p.name}: ${pct(p.percent)} (${p.passages} passages)`);
  }
  L.push(`AI-writing estimate (heuristic): ${r.ai.score === null ? "n/a" : r.ai.score + "%"}`);
  L.push(`Repeated within itself: ${pct(r.repetition.percent)}`, "");
  if (lastOnline) {
    L.push("WEB SEARCH + AI REVIEW", String(lastOnline.summary || ""), `AI likelihood: ${lastOnline.ai_likelihood}% (${lastOnline.ai_verdict})`);
    for (const m of lastOnline.matches || []) L.push(`  - passage ${m.passage}: ${m.match} — ${m.url}`);
    L.push("");
  }
  if (r.sources) {
    L.push("MATCHED PASSAGES");
    for (const p of r.sources.passages) L.push("", `[${r.sources.perSource[p.source].name}, ${p.words} words]`, p.text);
  }
  return L.join("\n");
}

function downloadReport(doc, r) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([reportText(doc, r)], { type: "text/plain" }));
  a.download = "plagiarism-report.txt";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- tab 2: compare many ----------
const batch = [];
function renderBatch() {
  $("cmpList").innerHTML = batch.map((d, i) => `<li><span class="name">${esc(d.name)}</span>
    <span class="muted small">${fmt(countWords(d.text))} words</span><button data-i="${i}" aria-label="Remove">×</button></li>`).join("");
  $("cmpCount").textContent = batch.length + (batch.length === 1 ? " file" : " files");
}
$("cmpList").addEventListener("click", (e) => {
  if (e.target.dataset.i !== undefined) { batch.splice(+e.target.dataset.i, 1); renderBatch(); }
});
wireDrop($("cmpDrop"), async (files) => { batch.push(...await readFiles(files, $("cmpProgress"))); renderBatch(); });

$("runCompare").onclick = async () => {
  if (batch.length < 2) return notify("Add at least two files.");
  $("runCompare").disabled = true;
  try {
    const r = await run("compareAll", { docs: batch, opts: { paraphrase: $("cmpParaphrase").checked } }, (l, f) => showProgress($("cmpProgress"), l, f));
    hideProgress($("cmpProgress"));
    renderCompare(r);
  } catch (e) {
    hideProgress($("cmpProgress"));
    notify("Compare failed: " + e.message);
  } finally {
    $("runCompare").disabled = false;
  }
};

function renderCompare(r) {
  const ranked = [...r.pairs].sort((a, b) => Math.max(b.aInB, b.bInA) - Math.max(a.aInB, a.bInA));
  const n = r.names.length;
  const cellOf = (i, j) => {
    const p = r.pairs.find((q) => (q.a === i && q.b === j) || (q.a === j && q.b === i));
    return p.a === i ? p.aInB : p.bInA; // share of row-file found in column-file
  };
  let html = `<div class="card"><h3>Most similar pairs</h3><div class="table-wrap"><table>
    <tr><th>File A</th><th>File B</th><th class="num">A found in B</th><th class="num">B found in A</th><th class="num">Overall overlap</th></tr>
    ${ranked.slice(0, 100).map((p) => `<tr><td>${esc(r.names[p.a])}</td><td>${esc(r.names[p.b])}</td>
      <td class="num ${level(p.aInB, 15, 40)}">${pct(p.aInB)}</td><td class="num ${level(p.bInA, 15, 40)}">${pct(p.bInA)}</td>
      <td class="num">${pct(p.jaccard)}</td></tr>`).join("")}
    </table></div>${r.sampled ? `<p class="muted small">Very large batch: percentages are estimated from a sample of word sequences.</p>` : ""}</div>`;
  if (n <= 40) {
    html += `<div class="card"><h3>Matrix <span class="muted small">(row file's text found in column file)</span></h3><div class="table-wrap"><table class="heat">
      <tr><th></th>${r.names.map((x, j) => `<th title="${esc(x)}">${j + 1}</th>`).join("")}</tr>
      ${r.names.map((x, i) => `<tr><th>${i + 1}. ${esc(x)}</th>${r.names.map((_, j) => {
        if (i === j) return `<td class="cell muted">—</td>`;
        const v = cellOf(i, j);
        return `<td class="cell" style="background:hsl(0 80% 55% / ${Math.min(0.85, v / 100)})">${Math.round(v)}</td>`;
      }).join("")}</tr>`).join("")}
    </table></div></div>`;
  }
  $("cmpResults").innerHTML = html;
  $("cmpResults").hidden = false;
}
