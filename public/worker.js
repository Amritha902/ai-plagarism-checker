/* Runs the heavy comparison off the main thread so huge inputs never freeze the page. */
importScripts("engine.js");

self.onmessage = (e) => {
  const { id, task, payload } = e.data;
  const onProgress = (label, frac) => self.postMessage({ id, progress: { label, frac } });
  try {
    let result;
    if (task === "check") {
      const opts = { ...payload.opts, onProgress };
      result = {
        sources: payload.sources.length ? PlagEngine.compareToSources(payload.doc, payload.sources, opts) : null,
        repetition: PlagEngine.selfRepetition(payload.doc.text, payload.opts),
        ai: PlagEngine.aiSignals(payload.doc.text),
        aiParagraphs: PlagEngine.aiByParagraph(payload.doc.text),
        passages: PlagEngine.samplePassages(payload.doc.text, 12, 30),
        disguise: PlagEngine.disguiseScan(payload.doc.text),
      };
    } else if (task === "compareAll") {
      result = PlagEngine.compareAll(payload.docs, { ...payload.opts, onProgress });
    } else throw new Error("Unknown task " + task);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
