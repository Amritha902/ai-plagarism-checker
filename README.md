# AI Plagiarism Checker

A website that checks text and documents for plagiarism and AI-written content.
You can paste any amount of text or upload large files (PDF, Word .docx, TXT,
Markdown, HTML, RTF, source code). It was tested on a 30 MB file of 3.9 million
words.

## What it checks

| Check | How |
|---|---|
| **Copying from your sources** | Add any number of source files or pasted texts. Every run of 5 identical words (4 content words in *Catch paraphrasing* mode) is matched, highlighted in the document in the source's colour, and listed side by side with the source wording. |
| **Found online** *(optional)* | Twelve passages sampled across the whole document are searched on the web by Claude (web search tool), which reports the pages where the wording appears. |
| **AI-writing estimate** | Style heuristics: sentence-length uniformity, stock AI phrases ("delve", "it is important to note", "furthermore"…), contractions, transition-word openers, vocabulary variety. An AI heat-map shows which parts read as machine-written. With the online check on, Claude also gives its own verdict and reasons. |
| **Repeated within itself** | Passages of 8+ words that appear more than once (padding). |
| **Compare many files** | Upload a batch (e.g. every submission for an assignment); every pair is compared and the most similar pairs are listed first, with a matrix for up to 40 files. |

Files are read and compared **in the browser** (in a Web Worker), so nothing is
uploaded and file size is limited only by the visitor's memory. Only the optional
online check sends text to the server.

AI-writing scores are estimates, not proof. Always read the highlighted passages
before drawing conclusions.

## Run it

Requires Node.js 18+.

```bash
npm install
npm start
```

Open http://localhost:3000.

To turn on the web search + AI review, start the server with an Anthropic API key:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Without a key everything else works; the online option is shown as off.
The model defaults to `claude-opus-5-5` and can be changed with `CLAUDE_MODEL`.
Each online check costs one Claude request with up to 10 web searches.

## Deploy

Any Node host works (Render, Railway, Fly.io, a VPS): build command `npm install`,
start command `npm start`, and set `ANTHROPIC_API_KEY` as an environment variable
if you want the online check. The `public/` folder alone can also be hosted as a
static site (GitHub Pages, Netlify); the online check is then unavailable.

## Tests

```bash
npm test
```

## Files

| File | Purpose |
|---|---|
| `public/index.html`, `styles.css`, `app.js` | The website |
| `public/engine.js` | Matching and AI-style engine (word n-gram fingerprints) |
| `public/worker.js` | Runs the engine off the main thread so large inputs never freeze the page |
| `server.mjs` | Serves the site and the `/api/ai-check` endpoint (Claude + web search) |
| `test/engine.test.cjs` | Engine tests |
