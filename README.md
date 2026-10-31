# AI Plagiarism Checker

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Amritha902/ai-plagarism-checker)

**Step-by-step deployment guide, settings, costs and how the build works: [DEPLOY.md](DEPLOY.md).**

A website that checks text and documents for plagiarism and AI-written content.
You can paste any amount of text or upload large files (PDF, Word .docx, TXT,
Markdown, HTML, RTF, source code). It was tested on a 30 MB file of 3.9 million
words.

## What it checks

| Check | How |
|---|---|
| **Copying from your sources** | Add any number of source files or pasted texts. Finds exact copying (runs of identical words), light rewording (stems and synonyms merged) and reworded sentences (synonym swaps and new word order, scored by rare-word similarity). Matches are highlighted in the source's colour and listed beside the source wording. Quotations and the bibliography can be left out, and tiny matches ignored. |
| **Disguise tricks** | Invisible characters and look-alike letters from other alphabets, used to slip copied text past checkers, are undone before matching and reported. |
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

On Render: click the button above, paste your Anthropic API key when asked, and the
site is live in a few minutes. Full instructions are in [DEPLOY.md](DEPLOY.md).

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on the web search + AI review |
| `ACCESS_CODE` | none | If set, visitors must enter this code to use the web search |
| `ONLINE_CHECKS_PER_HOUR` | `20` | Web searches allowed per visitor per hour |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Claude model for the web search |

The `public/` folder alone can also be hosted as a static site (GitHub Pages, Netlify);
the web search is then unavailable.

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
| `render.yaml` | Render Blueprint for one-click deployment |
| `DEPLOY.md` | Deployment guide and build details |
| `test/engine.test.cjs` | Engine tests |
