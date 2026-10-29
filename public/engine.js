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

  // Light suffix stripping so "analysed / analyses / analysing" collapse together.
  function stem(w) {
    if (w.length <= 4) return w;
    for (const suf of ["ational", "ization", "fulness", "iveness", "ations", "ation", "ments", "ment",
      "ingly", "edly", "ings", "ing", "ies", "ied", "ers", "est", "ly", "ed", "es", "er", "s"]) {
      if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length);
    }
    return w;
  }

  const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

  /**
   * Split text into words, keeping each word's character offsets so matches can be
   * highlighted in the original text. In paraphrase mode stopwords are dropped and
   * words are stemmed, which makes light rewording still match.
   */
  function tokenize(text, opts) {
    const paraphrase = !!(opts && opts.paraphrase);
    const words = [];
    const starts = [];
    const ends = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text)) !== null) {
      let w = m[0].toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "");
      if (paraphrase) {
        if (STOPWORDS.has(w)) continue;
        w = stem(w);
      }
      words.push(w);
      starts.push(m.index);
      ends.push(m.index + m[0].length);
    }
    return { words, starts, ends };
  }

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
   * doc / sources: { name, text }.  Returns overall %, per-source %, matched passages
   * with their source excerpts, and highlight spans for the document.
   */
  function compareToSources(doc, sources, opts) {
    opts = opts || {};
    const k = opts.k || (opts.paraphrase ? 4 : 5);
    const progress = opts.onProgress || function () {};
    const vocab = new Vocab();

    // Index every shingle of every source: hash -> encoded (source, position) list.
    const index = new Map();
    const srcTok = [];
    for (let s = 0; s < sources.length; s++) {
      progress("Indexing " + sources[s].name, s / Math.max(1, sources.length) * 0.5);
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

    progress("Scanning document", 0.5);
    const tok = tokenize(doc.text, opts);
    const n = tok.words.length;
    const hashes = shingleHashes(vocab.ids(tok.words), k);
    const owner = new Int32Array(n).fill(-1);     // which source a matched word is attributed to
    const ownerPos = new Int32Array(n).fill(-1);  // matching word position inside that source
    const covered = new Float64Array(sources.length);
    const lastEnd = new Int32Array(sources.length).fill(-1);

    for (let i = 0; i < hashes.length; i++) {
      const hit = index.get(hashes[i]);
      if (hit === undefined) continue;
      const codes = typeof hit === "number" ? [hit] : hit;
      for (const code of codes) {
        const s = Math.floor(code / POS_BITS);
        const p = code - s * POS_BITS;
        covered[s] += (i + k) - Math.max(i, lastEnd[s]);
        lastEnd[s] = i + k;
        for (let j = 0; j < k; j++) {
          // First source to claim a word keeps it, so passages stay contiguous.
          if (owner[i + j] === -1) {
            owner[i + j] = s;
            ownerPos[i + j] = p + j;
          }
        }
      }
      if ((i & 0xffff) === 0) progress("Scanning document", 0.5 + 0.45 * i / hashes.length);
    }

    // Collapse matched words into passages (runs owned by one source).
    const passages = [];
    let matched = 0;
    for (let i = 0; i < n;) {
      if (owner[i] === -1) { i++; continue; }
      const s = owner[i];
      let j = i;
      while (j + 1 < n && owner[j + 1] === s) j++;
      matched += j - i + 1;
      const st = srcTok[s];
      const ps = Math.max(0, Math.min(ownerPos[i], st.starts.length - 1));
      const pe = Math.max(ps, Math.min(ownerPos[j], st.ends.length - 1));
      passages.push({
        source: s,
        words: j - i + 1,
        start: tok.starts[i],
        end: tok.ends[j],
        text: doc.text.slice(tok.starts[i], tok.ends[j]),
        sourceText: sources[s].text.slice(st.starts[ps], st.ends[pe]),
      });
      i = j + 1;
    }

    progress("Done", 1);
    return {
      words: n,
      matchedWords: matched,
      percent: n ? (100 * matched) / n : 0,
      k,
      perSource: sources.map((src, s) => ({
        name: src.name,
        words: srcTok[s].words.length,
        percent: n ? Math.min(100, (100 * covered[s]) / n) : 0,
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

  /** Spread-out, distinctive passages to look up online (for very large docs too). */
  function samplePassages(text, count, wordsEach) {
    const sentences = splitSentences(text).filter((s) => s.split(" ").length >= 10);
    if (!sentences.length) return [];
    const picks = [];
    const step = sentences.length / Math.min(count, sentences.length);
    for (let i = 0; i < Math.min(count, sentences.length); i++) {
      const s = sentences[Math.floor(i * step + step / 2)] || sentences[Math.floor(i * step)];
      picks.push(s.split(" ").slice(0, wordsEach).join(" "));
    }
    return picks;
  }

  return { tokenize, compareToSources, compareAll, selfRepetition, aiSignals, aiByParagraph, samplePassages, splitSentences };
});
