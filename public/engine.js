/*
 * Plagiarism + AI-writing engine. Pure JavaScript, no dependencies.
 * Runs in a Web Worker in the browser (importScripts) and in Node (require) for tests.
 *
 * Similarity works on word n-grams ("shingles"): two texts that share a run of
 * k consecutive words share a shingle. Every word is turned into an integer id,
 * every shingle into a hash, so documents with millions of words fit in memory.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlagEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STOPWORDS = new Set((
    "a an the and or but if then else of to in on at by for with from into onto over under " +
    "is am are was were be been being do does did have has had having it its this that these those " +
    "i me my we our you your he him his she her they them their there here as so than too very " +
    "can could will would shall should may might must not no nor only own same such just also " +
    "what which who whom whose when where why how all any both each few more most other some"
  ).split(" "));

  /** Shared vocabulary: word -> small integer id. */
  function Vocab() { this.map = new Map(); }
  Vocab.prototype.ids = function (words) {
    const out = new Int32Array(words.length);
    for (let i = 0; i < words.length; i++) {
      let id = this.map.get(words[i]);
      if (id === undefined) { id = this.map.size + 1; this.map.set(words[i], id); }
      out[i] = id;
    }
    return out;
  };

  // Word groups that mean the same thing; reworded copies swap words within a group.
  const SYNONYM_GROUPS = [
    "show demonstrate illustrate reveal indicate display", "use utilize utilise employ apply",
    "big large huge vast enormous massive", "small little tiny minor",
    "important significant crucial vital essential critical", "help assist aid support",
    "begin start commence initiate", "end finish conclude terminate",
    "get obtain acquire gain receive", "make create produce generate build construct",
    "change alter modify transform adjust", "increase rise grow expand boost raise",
    "decrease reduce decline lower diminish drop", "quick fast rapid swift",
    "many numerous several various multiple", "often frequently commonly regularly",
    "whole entire total", "main primary principal chief major",
    "need require necessitate", "think believe consider", "study research investigation analysis examination",
    "result outcome consequence", "cause trigger induce", "method approach technique procedure",
    "problem issue difficulty challenge", "idea concept notion", "area region zone",
    "world globe planet", "people individuals persons humans", "child kid youngster",
    "buy purchase", "try attempt", "allow permit enable", "keep retain maintain preserve",
    "give provide offer supply", "find discover identify detect", "choose select pick",
    "answer response reply", "however nevertheless nonetheless", "therefore thus hence consequently",
    "additionally furthermore moreover", "because since", "approximately roughly around",
    "enough sufficient adequate", "clear evident obvious apparent", "hard difficult tough",
    "easy simple straightforward", "old ancient aged", "new novel recent modern",
    "rich wealthy affluent", "poor impoverished", "happy glad pleased joyful", "sad unhappy sorrowful",
    "danger risk hazard threat", "benefit advantage", "weakness drawback disadvantage",
    "goal aim objective purpose", "part portion section segment component", "example instance",
    "explain describe clarify", "discuss examine explore", "suggest propose recommend",
    "affect influence impact", "occur happen arise", "travel move proceed",
    "say state claim assert mention", "city town", "car vehicle automobile",
    "job occupation employment profession", "evaporate vaporize", "precipitation rainfall",
    "climb ascend", "cool chill", "fall descend", "earth ground land", "power energy",
    "drive propel", "rise ascend", "pupil student learner", "teacher instructor educator",
  ];

  // Light suffix stripping so "analysed / analyses / analysing" collapse together.
  function stem(w) {
    if (w.length <= 4) return w;
    for (const suf of ["ational", "ization", "fulness", "iveness", "ations", "ation", "ments", "ment",
      "ingly", "edly", "ings", "ing", "ies", "ied", "ers", "est", "ly", "ed", "es", "er", "s"]) {
      if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length);
    }
    return w;
  }

  const SYNONYMS = new Map();
  for (const g of SYNONYM_GROUPS) {
    const words = g.split(" ");
    const canon = stem(words[0]);
    for (const w of words) { if (!SYNONYMS.has(w)) SYNONYMS.set(w, canon); if (!SYNONYMS.has(stem(w))) SYNONYMS.set(stem(w), canon); }
  }
  function canonical(w) { return SYNONYMS.get(w) || SYNONYMS.get(stem(w)) || stem(w); }

  // Letters from other alphabets that look like Latin ones. Swapping them in is a known
  // trick to make copied text invisible to checkers; they are mapped back before matching.
  // Keys are Cyrillic (\u04xx, \u05xx), Greek (\u03xx) and IPA (\u0261) letters.
  const HOMOGLYPHS = new Map(Object.entries({
    "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u0455": "s",
    "\u0501": "d", "\u0261": "g", "\u04CF": "l", "\u04BB": "h", "\u051B": "q", "\u051D": "w", "\u03BF": "o", "\u03B1": "a", "\u03BD": "v", "\u03C1": "p",
    "\u03B9": "i", "\u03BA": "k", "\u03C5": "u", "\u03B5": "e",
  }));
  const LATIN = /[a-z]/;
  const INVISIBLE = /[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g;

  // Words may contain invisible characters (another trick); they are kept inside the
  // word here and removed from its normalized form, so offsets stay exact.
  const WORD_RE = /[\p{L}\p{N}\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]+(?:['’][\p{L}]+)?/gu;

  function normalizeWord(raw) {
    let w = raw.replace(INVISIBLE, "").toLowerCase().normalize("NFKC");
    if (LATIN.test(w)) {
      let out = "";
      for (const ch of w) out += HOMOGLYPHS.get(ch) || ch;
      w = out;
    }
    return w.normalize("NFKD").replace(/[\u0300-\u036F]/g, "").replace(/['’]/g, "");
  }

  /**
   * Split text into words, keeping each word's character offsets so matches can be
   * highlighted in the original text. In paraphrase mode filler words are dropped and
   * each word is reduced to its stem and synonym group, so light rewording still matches.
   */
  function tokenize(text, opts) {
    const paraphrase = !!(opts && opts.paraphrase);
    const words = [];
    const starts = [];
    const ends = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text)) !== null) {
      let w = normalizeWord(m[0]);
      if (!w) continue;
      if (paraphrase) {
        if (STOPWORDS.has(w)) continue;
        w = canonical(w);
      }
      words.push(w);
      starts.push(m.index);
      ends.push(m.index + m[0].length);
    }
    return { words, starts, ends };
  }

  /** Invisible characters and look-alike letters hidden in the text. */
  function disguiseScan(text) {
    const invisible = (text.match(INVISIBLE) || []).length;
    let lookalikes = 0;
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text)) !== null) {
      const w = m[0].toLowerCase();
      if (!LATIN.test(w)) continue;
      for (const ch of w) if (HOMOGLYPHS.has(ch)) lookalikes++;
    }
    return { invisible, lookalikes };
  }

  /** Character ranges the user chose to leave out: quotations and the reference list. */
  function excludedRanges(text, opts) {
    const ranges = [];
    if (opts.excludeQuotes) {
      const re = /"[^"\n]{15,}?"|“[^”]{15,}?”|«[^»]{15,}?»/g;
      let m;
      while ((m = re.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);
    }
    let referencesAt = -1;
    if (opts.excludeReferences) {
      const re = /^\s*(references|bibliography|works cited|reference list|sources|literature cited)\s*:?\s*$/gim;
      let m;
      while ((m = re.exec(text)) !== null) if (m.index > text.length * 0.4) referencesAt = m.index;
      if (referencesAt >= 0) ranges.push([referencesAt, text.length]);
    }
    return { ranges, referencesAt };
  }

  function markExcluded(tok, ranges) {
    const ex = new Uint8Array(tok.starts.length);
    for (const [a, b] of ranges) {
      for (let i = lowerBound(tok.starts, a); i < tok.starts.length && tok.starts[i] < b; i++) ex[i] = 1;
    }
    return ex;
  }

  function lowerBound(arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** Sentence spans with offsets: runs of text ending in . ! ? or a line break. */
  function sentenceSpans(text) {
    const spans = [];
    const re = /[^.!?\n]+(?:[.!?]+["”’)]*|\n|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      const lead = m[0].length - m[0].trimStart().length;
      const s = m.index + lead, e = m.index + m[0].trimEnd().length;
      if (e > s) spans.push([s, e]);
    }
    return spans;
  }

  /** Content-word stems of a piece of text (filler removed, synonyms merged). */
  function contentTerms(text) {
    const out = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text)) !== null) {
      const w = normalizeWord(m[0]);
      if (!w || STOPWORDS.has(w) || w.length < 2) continue;
      out.push(canonical(w));
    }
    return out;
  }

  /**
   * Reworded copying: sentences whose meaning-bearing words largely match a source
   * sentence even after synonyms are swapped and the order is changed. Scores each
   * pair by cosine similarity of rare-word weights (TF-IDF), using an inverted index
   * so huge sources are compared quickly.
   */
  function findReworded(doc, sources, docTok, owner, excluded, opts) {
    const threshold = opts.rewordThreshold || 0.5;
    const srcSents = []; // { s, start, end, terms }
    const postings = new Map();
    for (let s = 0; s < sources.length; s++) {
      for (const [a, b] of sentenceSpans(sources[s].text)) {
        const terms = [...new Set(contentTerms(sources[s].text.slice(a, b)))];
        if (terms.length < 4) continue;
        const id = srcSents.length;
        srcSents.push({ s, start: a, end: b, terms });
        for (const t of terms) { let p = postings.get(t); if (!p) postings.set(t, (p = [])); p.push(id); }
      }
    }
    if (!srcSents.length) return [];
    const N = srcSents.length;
    const idf = (t) => Math.log(1 + N / ((postings.get(t) || []).length + 1));
    const maxDf = Math.max(50, N * 0.05);
    const norm = new Float64Array(N);
    for (let i = 0; i < N; i++) { let x = 0; for (const t of srcSents[i].terms) x += idf(t) ** 2; norm[i] = Math.sqrt(x); }

    const found = [];
    for (const [a, b] of sentenceSpans(doc.text)) {
      const i0 = lowerBound(docTok.starts, a);
      let i1 = i0;
      while (i1 < docTok.starts.length && docTok.starts[i1] < b) i1++;
      const n = i1 - i0;
      if (n < 4) continue;
      let already = 0, ex = 0;
      for (let i = i0; i < i1; i++) { if (owner[i] !== -1) already++; if (excluded[i]) ex++; }
      if (already >= n * 0.6 || ex >= n * 0.5) continue;

      const terms = [...new Set(contentTerms(doc.text.slice(a, b)))];
      if (terms.length < 4) continue;
      const score = new Map();
      for (const t of terms) {
        const p = postings.get(t);
        if (!p || p.length > maxDf) continue;
        const w = idf(t);
        for (const id of p) score.set(id, (score.get(id) || 0) + w);
      }
      if (!score.size) continue;
      const cands = [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
      let dn = 0;
      for (const t of terms) dn += idf(t) ** 2;
      dn = Math.sqrt(dn);
      let best = null;
      for (const [id] of cands) {
        const src = srcSents[id];
        const set = new Set(src.terms);
        let dot = 0, shared = 0;
        for (const t of terms) if (set.has(t)) { dot += idf(t) ** 2; shared++; }
        const sim = dot / (dn * norm[id]);
        if (shared >= 4 && sim >= threshold && (!best || sim > best.sim)) best = { id, sim };
      }
      if (!best) continue;
      const src = srcSents[best.id];
      for (let i = i0; i < i1; i++) if (owner[i] === -1 && !excluded[i]) owner[i] = src.s;
      found.push({
        kind: "reworded",
        source: src.s,
        similarity: Math.round(best.sim * 100),
        words: n,
        start: a,
        end: b,
        text: doc.text.slice(a, b),
        sourceText: sources[src.s].text.slice(src.start, src.end),
      });
    }
    return found;
  }

  /** Hash of k consecutive word ids, as a float that is exact up to 2^53. */
  function shingleHashes(ids, k) {
    const n = Math.max(0, ids.length - k + 1);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let h1 = 2166136261, h2 = 5381;
      for (let j = 0; j < k; j++) {
        const v = ids[i + j];
        h1 = Math.imul(h1 ^ v, 16777619);
        h2 = (Math.imul(h2, 33) + v) | 0;
      }
      out[i] = (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff);
    }
    return out;
  }

  const POS_BITS = 2 ** 28; // word positions up to 268M per source

  /**
   * Compare one document against any number of sources.
   * doc / sources: { name, text }.  opts: paraphrase, excludeQuotes, excludeReferences,
   * minWords (shortest exact match reported). Returns overall %, exact and reworded %,
   * per-source %, and every matched passage with the source wording beside it.
   */
  function compareToSources(doc, sources, opts) {
    opts = opts || {};
    const k = opts.k || (opts.paraphrase ? 4 : 5);
    const minWords = Math.max(k, opts.minWords || 0);
    const progress = opts.onProgress || function () {};
    const vocab = new Vocab();

    // Index every shingle of every source: hash -> encoded (source, position) list.
    const index = new Map();
    const srcTok = [];
    for (let s = 0; s < sources.length; s++) {
      progress("Indexing " + sources[s].name, s / Math.max(1, sources.length) * 0.4);
      const tok = tokenize(sources[s].text, opts);
      srcTok.push(tok);
      const hashes = shingleHashes(vocab.ids(tok.words), k);
      for (let i = 0; i < hashes.length; i++) {
        const code = s * POS_BITS + i;
        const prev = index.get(hashes[i]);
        if (prev === undefined) index.set(hashes[i], code);
        else if (typeof prev === "number") {
          if (Math.floor(prev / POS_BITS) !== s) index.set(hashes[i], [prev, code]);
        } else if (prev.length < 8 && Math.floor(prev[prev.length - 1] / POS_BITS) !== s) prev.push(code);
      }
    }

    progress("Scanning document", 0.4);
    const tok = tokenize(doc.text, opts);
    const n = tok.words.length;
    const { ranges, referencesAt } = excludedRanges(doc.text, opts);
    const excluded = markExcluded(tok, ranges);
    const hashes = shingleHashes(vocab.ids(tok.words), k);
    const owner = new Int32Array(n).fill(-1);     // which source a matched word is attributed to
    const ownerPos = new Int32Array(n).fill(-1);  // matching word position inside that source

    for (let i = 0; i < hashes.length; i++) {
      const hit = index.get(hashes[i]);
      if (hit === undefined) continue;
      let skip = false;
      for (let j = 0; j < k; j++) if (excluded[i + j]) { skip = true; break; }
      if (skip) continue;
      const codes = typeof hit === "number" ? [hit] : hit;
      for (const code of codes) {
        const s = Math.floor(code / POS_BITS);
        const p = code - s * POS_BITS;
        for (let j = 0; j < k; j++) {
          // First source to claim a word keeps it, so passages stay contiguous.
          if (owner[i + j] === -1) {
            owner[i + j] = s;
            ownerPos[i + j] = p + j;
          }
        }
      }
      if ((i & 0xffff) === 0) progress("Scanning document", 0.4 + 0.3 * i / hashes.length);
    }

    // Collapse matched words into passages (runs owned by one source); drop tiny ones.
    const passages = [];
    for (let i = 0; i < n;) {
      if (owner[i] === -1) { i++; continue; }
      const s = owner[i];
      let j = i;
      while (j + 1 < n && owner[j + 1] === s) j++;
      if (j - i + 1 < minWords) {
        for (let x = i; x <= j; x++) owner[x] = -1;
      } else {
        const st = srcTok[s];
        const ps = Math.max(0, Math.min(ownerPos[i], st.starts.length - 1));
        const pe = Math.max(ps, Math.min(ownerPos[j], st.ends.length - 1));
        passages.push({
          kind: "exact",
          source: s,
          words: j - i + 1,
          start: tok.starts[i],
          end: tok.ends[j],
          text: doc.text.slice(tok.starts[i], tok.ends[j]),
          sourceText: sources[s].text.slice(st.starts[ps], st.ends[pe]),
        });
      }
      i = j + 1;
    }
    progress("Looking for reworded sentences", 0.75);
    const reworded = opts.reworded === false ? [] : findReworded(doc, sources, tok, owner, excluded, opts);
    // A short exact phrase inside a reworded sentence is part of that sentence's match.
    const kept = reworded.length
      ? passages.filter((p) => !reworded.some((r) => p.start >= r.start && p.end <= r.end))
      : passages.slice();
    let exactWords = 0;
    for (const p of kept) exactWords += p.words;
    passages.length = 0;
    passages.push(...kept, ...reworded);
    passages.sort((a, b) => a.start - b.start);

    const perCount = new Float64Array(sources.length);
    let matched = 0, excludedWords = 0;
    for (let i = 0; i < n; i++) {
      if (owner[i] !== -1) { matched++; perCount[owner[i]]++; }
      if (excluded[i]) excludedWords++;
    }

    progress("Done", 1);
    const pctOf = (x) => (n ? (100 * x) / n : 0);
    return {
      words: n,
      matchedWords: matched,
      percent: pctOf(matched),
      exactPercent: pctOf(exactWords),
      rewordedPercent: pctOf(matched - exactWords),
      excludedWords,
      referencesExcluded: referencesAt >= 0,
      k,
      perSource: sources.map((src, s) => ({
        name: src.name,
        words: srcTok[s].words.length,
        percent: pctOf(perCount[s]),
        passages: passages.filter((p) => p.source === s).length,
      })),
      passages,
    };
  }

  /**
   * Similarity of every pair of documents. For large inputs shingles are sampled
   * (hash mod m == 0), a standard and unbiased estimate of the same ratios.
   */
  function compareAll(docs, opts) {
    opts = opts || {};
    const k = opts.k || (opts.paraphrase ? 4 : 5);
    const progress = opts.onProgress || function () {};
    const vocab = new Vocab();
    const toks = docs.map((d) => tokenize(d.text, opts));
    const total = toks.reduce((a, t) => a + t.words.length, 0);
    const mod = total > 4e6 ? 16 : total > 1e6 ? 4 : 1;
    const sets = toks.map((t, i) => {
      progress("Fingerprinting " + docs[i].name, i / docs.length * 0.7);
      const set = new Set();
      const h = shingleHashes(vocab.ids(t.words), k);
      for (let j = 0; j < h.length; j++) if (mod === 1 || h[j] % mod === 0) set.add(h[j]);
      return set;
    });
    const pairs = [];
    for (let a = 0; a < docs.length; a++) {
      progress("Comparing", 0.7 + 0.3 * a / docs.length);
      for (let b = a + 1; b < docs.length; b++) {
        const [small, big] = sets[a].size <= sets[b].size ? [sets[a], sets[b]] : [sets[b], sets[a]];
        let inter = 0;
        for (const h of small) if (big.has(h)) inter++;
        const union = sets[a].size + sets[b].size - inter;
        pairs.push({
          a, b,
          jaccard: union ? (100 * inter) / union : 0,
          aInB: sets[a].size ? (100 * inter) / sets[a].size : 0,
          bInA: sets[b].size ? (100 * inter) / sets[b].size : 0,
        });
      }
    }
    progress("Done", 1);
    return { names: docs.map((d) => d.name), words: toks.map((t) => t.words.length), pairs, sampled: mod > 1 };
  }

  /** Repeated passages inside one document (copy-paste padding). */
  function selfRepetition(text, opts) {
    const k = 8;
    const tok = tokenize(text, opts);
    const h = shingleHashes(new Vocab().ids(tok.words), k);
    const seen = new Map();
    const rep = new Uint8Array(tok.words.length);
    for (let i = 0; i < h.length; i++) {
      const first = seen.get(h[i]);
      if (first === undefined) seen.set(h[i], i);
      else if (i - first >= k) for (let j = 0; j < k; j++) rep[i + j] = 1;
    }
    let c = 0;
    for (let i = 0; i < rep.length; i++) c += rep[i];
    return { percent: tok.words.length ? (100 * c) / tok.words.length : 0 };
  }

  // ---------------- AI-writing heuristics ----------------

  const AI_PHRASES = [
    "delve", "delves", "delving", "tapestry", "testament to", "in today's", "ever-evolving", "ever evolving",
    "it is important to note", "it's important to note", "it is worth noting", "it's worth noting",
    "plays a crucial role", "plays a vital role", "plays a pivotal role", "a crucial role", "pivotal",
    "furthermore", "moreover", "additionally", "in conclusion", "in summary", "overall,", "notably",
    "navigate the", "navigating the", "landscape", "realm", "multifaceted", "nuanced", "intricate",
    "underscore", "underscores", "highlighting the", "showcasing", "foster", "fostering", "leverage",
    "leveraging", "seamless", "seamlessly", "robust", "holistic", "paramount", "comprehensive",
    "shed light", "sheds light", "a myriad of", "myriad", "embark", "unlock", "unleash", "vibrant",
    "in the realm of", "serves as a", "not only", "but also", "whether you're", "let's explore",
    "a deep dive", "dive into", "game-changer", "game changer", "cutting-edge", "transformative",
    "it is essential", "it's essential", "crucial", "key takeaways", "ultimately",
  ];

  function splitSentences(text) {
    return text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
      .map((s) => s.trim())
      .filter((s) => s.split(" ").length >= 3);
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  /**
   * Stylometric estimate of how machine-like a text reads. This is a heuristic, not
   * proof: it looks at sentence-length uniformity ("burstiness"), stock phrases common
   * in language-model output, contraction and typo-like signals, and vocabulary variety.
   */
  function aiSignals(text) {
    const sentences = splitSentences(text);
    const words = text.match(WORD_RE) || [];
    const nw = words.length;
    if (nw < 80 || sentences.length < 4) return { score: null, words: nw, reason: "Need at least ~80 words and 4 sentences." };

    const lens = sentences.map((s) => (s.match(WORD_RE) || []).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    const cv = sd / Math.max(1, mean);

    const lower = " " + text.toLowerCase().replace(/\s+/g, " ") + " ";
    const found = {};
    let phraseHits = 0;
    for (const p of AI_PHRASES) {
      let idx = 0, c = 0;
      while ((idx = lower.indexOf(p, idx)) !== -1) {
        const before = lower[idx - 1], after = lower[idx + p.length];
        if (!/[a-z]/.test(before || " ") && !/[a-z]/.test(after || " ")) c++;
        idx += p.length;
      }
      if (c) { found[p] = c; phraseHits += c; }
    }
    const phrasePer1k = (1000 * phraseHits) / nw;

    const contractions = (text.match(/\b\w+['’](s|t|re|ve|ll|d|m)\b/gi) || []).length;
    const contractionPer1k = (1000 * contractions) / nw;

    // Moving-average type/token ratio over 100-word windows (length independent).
    const lw = words.map((w) => w.toLowerCase());
    let mattr = 0, windows = 0;
    for (let i = 0; i + 100 <= lw.length; i += 50) { mattr += new Set(lw.slice(i, i + 100)).size / 100; windows++; }
    mattr = windows ? mattr / windows : new Set(lw).size / lw.length;

    const starters = sentences.map((s) => s.split(" ")[0].toLowerCase().replace(/[^a-z]/g, ""));
    const transitions = new Set(["furthermore", "moreover", "additionally", "however", "overall", "ultimately", "consequently", "therefore", "thus", "notably", "importantly", "finally", "firstly", "secondly", "lastly"]);
    const transitionShare = starters.filter((s) => transitions.has(s)).length / sentences.length;

    const informal = (text.match(/(!{2,}|\?{2,}|\.\.\.|\b(lol|gonna|wanna|kinda|idk|tbh)\b|\s,|\bi\b)/gi) || []).length;
    const informalPer1k = (1000 * informal) / nw;

    // Each signal mapped to 0 (human-like) .. 1 (AI-like), then weighted.
    const sUniform = clamp01((0.55 - cv) / 0.3);           // AI text: CV ~0.25-0.4, human ~0.5-0.8
    const sPhrases = clamp01(phrasePer1k / 12);            // stock phrases
    const sContract = clamp01((4 - contractionPer1k) / 4); // formal, no contractions
    const sTransit = clamp01(transitionShare / 0.2);
    const sVocab = clamp01((mattr - 0.62) / 0.14);         // even, polished vocabulary
    const sInformal = clamp01(informalPer1k / 6);

    const raw = 0.32 * sUniform + 0.3 * sPhrases + 0.12 * sContract + 0.12 * sTransit + 0.14 * sVocab - 0.35 * sInformal;
    const score = Math.round(100 * clamp01(raw / 0.8));

    return {
      score,
      words: nw,
      sentences: sentences.length,
      signals: {
        sentenceLengthVariation: +cv.toFixed(2),
        averageSentenceWords: +mean.toFixed(1),
        stockPhrasesPer1000Words: +phrasePer1k.toFixed(1),
        contractionsPer1000Words: +contractionPer1k.toFixed(1),
        transitionSentenceShare: +(100 * transitionShare).toFixed(0),
        vocabularyVariety: +mattr.toFixed(2),
      },
      topPhrases: Object.entries(found).sort((a, b) => b[1] - a[1]).slice(0, 12),
    };
  }

  /** AI estimate per block of paragraphs (short paragraphs are merged to ~120+ words). */
  function aiByParagraph(text) {
    const out = [];
    const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
    let m, start = -1, end = 0, words = 0;
    const flush = () => {
      if (start < 0) return;
      out.push({ start, end, score: aiSignals(text.slice(start, end)).score });
      start = -1; words = 0;
    };
    while ((m = re.exec(text)) !== null) {
      if (start < 0) start = m.index;
      end = m.index + m[0].length;
      words += (m[0].match(WORD_RE) || []).length;
      if (words >= 120) flush();
    }
    if (start >= 0 && words < 80 && out.length) {
      // Fold a short tail into the last block rather than leaving it unscored.
      const last = out[out.length - 1];
      last.end = end;
      last.score = aiSignals(text.slice(last.start, last.end)).score;
    } else flush();
    return out;
  }

  /**
   * Passages to look up online: the document is cut into `count` equal stretches and
   * the most distinctive sentence of each is picked (long words, names, numbers),
   * since generic sentences match thousands of unrelated pages.
   */
  function samplePassages(text, count, wordsEach) {
    const sentences = splitSentences(text).filter((s) => s.split(" ").length >= 10);
    if (!sentences.length) return [];
    const distinct = (s) => {
      const ws = s.split(" ");
      let score = 0;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i].replace(/[^\p{L}\p{N}]/gu, "");
        if (w.length >= 8) score += 1;
        if (/\d/.test(w)) score += 1.5;
        if (i > 0 && /^\p{Lu}/u.test(w)) score += 1.5;
        if (STOPWORDS.has(w.toLowerCase())) score -= 0.3;
      }
      return score / Math.sqrt(ws.length);
    };
    const picks = [];
    const n = Math.min(count, sentences.length);
    const step = sentences.length / n;
    for (let i = 0; i < n; i++) {
      let best = null, bestScore = -Infinity;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) {
        const sc = distinct(sentences[j]);
        if (sc > bestScore) { bestScore = sc; best = sentences[j]; }
      }
      if (best) picks.push(best.split(" ").slice(0, wordsEach).join(" "));
    }
    return picks;
  }

  return { tokenize, disguiseScan, compareToSources, compareAll, selfRepetition, aiSignals, aiByParagraph, samplePassages, splitSentences };
});
