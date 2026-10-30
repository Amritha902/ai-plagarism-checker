# Deploying on Render, and how the build works

This guide puts the AI Plagiarism Checker on the internet at an address like
`https://ai-plagiarism-checker.onrender.com`, with the **Search the web + AI review**
option switched on. It takes about 10 minutes and needs no coding.

### Which version has which features

| Feature | Render version (this guide) | claude.ai hosted page |
|---|---|---|
| Paste text, upload large PDF / Word / text files | yes | yes |
| Match against your sources, highlighted passages | yes | yes |
| Compare many files | yes | yes |
| AI-writing estimate and heat-map | yes | yes |
| Claude's AI review (verdict and reasons) | yes, on your API key | yes, on the viewer's own Claude account |
| **Search the web for copied passages** | **yes** | no: claude.ai pages cannot reach other websites |
| Download / copy report | yes | yes |

The Render version is the only one with every feature.

Contents

1. [What you need](#1-what-you-need)
2. [Get an Anthropic API key](#2-get-an-anthropic-api-key)
3. [Deploy on Render](#3-deploy-on-render)
4. [Check that it works](#4-check-that-it-works)
5. [Settings (environment variables)](#5-settings-environment-variables)
6. [Costs](#6-costs)
7. [Updating the site](#7-updating-the-site)
8. [Troubleshooting](#8-troubleshooting)
9. [How the build works](#9-how-the-build-works)
10. [How the checks work](#10-how-the-checks-work)
11. [Running it on your own computer](#11-running-it-on-your-own-computer)

---

## 1. What you need

- A **GitHub account** with access to this repository (`Amritha902/ai-plagarism-checker`).
- A **Render account**: sign up free at <https://render.com> (signing up with GitHub is easiest).
- An **Anthropic API key** with some credit, for the web search (next step).
  Without a key the site still works; only the web search is switched off.

## 2. Get an Anthropic API key

1. Go to <https://console.anthropic.com> and sign in or sign up.
2. Open **Settings → Billing** and add credit (the minimum top-up is enough to start).
3. Open **Settings → API Keys → Create Key**, name it `plagiarism-checker`, and copy it.
   It starts with `sk-ant-`. You only see it once, so keep it somewhere safe.
4. Optional but recommended: in **Settings → Limits**, set a monthly spend limit,
   so a busy public site can never cost more than you choose.

Never put the key in the code or commit it to GitHub. It goes only into Render's settings.

## 3. Deploy on Render

### Option A: one click (Blueprint)

The repository contains `render.yaml`, which tells Render everything it needs.

1. Open this link while signed in to Render:
   <https://render.com/deploy?repo=https://github.com/Amritha902/ai-plagarism-checker>
   (If the repository is private and Render says it cannot find it, use Option B, or
   first connect GitHub in Render: **Account Settings → Git Providers → GitHub → Configure**
   and give Render access to this repository.)
2. Render shows a service called **ai-plagiarism-checker** and asks for the values
   it does not know:
   - **ANTHROPIC_API_KEY**: paste your `sk-ant-…` key.
   - **ACCESS_CODE**: optional. If you type a code here (e.g. `class2026`), visitors
     must enter it before the web search runs. Leave it empty to let anyone use it.
3. Click **Apply** (or **Deploy Blueprint**). The first build takes 2–4 minutes.
4. When the status turns **Live**, click the address at the top of the service page.

### Option B: manual setup

1. In the Render dashboard click **New + → Web Service**.
2. Choose **Build and deploy from a Git repository**, connect GitHub if asked, and
   pick `Amritha902/ai-plagarism-checker`.
3. Fill in:

   | Field | Value |
   |---|---|
   | Name | `ai-plagiarism-checker` (this becomes the web address) |
   | Branch | `main` |
   | Runtime / Language | `Node` |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Instance Type | `Free` (or `Starter` to avoid sleeping, see Costs) |

4. Open **Advanced** (or the **Environment** tab after creating) and add:

   | Key | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `ANTHROPIC_API_KEY` | your `sk-ant-…` key |
   | `ACCESS_CODE` | optional code, see above |
   | `ONLINE_CHECKS_PER_HOUR` | `20` |

5. Set **Health Check Path** to `/api/status`.
6. Click **Create Web Service** and wait until it says **Live**.

## 4. Check that it works

1. Open `https://<your-service-name>.onrender.com/api/status`. You should see:
   ```json
   {"ai":true,"model":"claude-opus-5-5","needsCode":false}
   ```
   `"ai":false` means the API key is missing: add it under **Environment** and the
   service restarts by itself.
2. Open the site itself. Next to **Search the web + AI review with Claude** it should say
   "sends the text to Claude; takes ~1 minute", and the box should be ticked.
3. Paste a paragraph copied from a well-known web page (e.g. the first paragraph of a
   Wikipedia article), press **Run check**, and wait. The **Found online** tile should show
   the passage was found, with a link to the page.

## 5. Settings (environment variables)

All settings are changed in Render under the service's **Environment** tab. Saving
restarts the site automatically.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | for web search | none | Your Anthropic key. Without it, the web search is shown as off and everything else works. |
| `ACCESS_CODE` | no | none | If set, visitors type this code (in a box next to the web-search option) before the web search runs. The browser remembers it. Use it if the site is public but only your class or team should spend your credit. |
| `ONLINE_CHECKS_PER_HOUR` | no | `20` | Web searches allowed per visitor (per IP address) per hour. Protects your credit from heavy use. |
| `CLAUDE_MODEL` | no | `claude-opus-5-5` | The Claude model used. A cheaper option is `claude-sonnet-5-5`. |
| `NODE_VERSION` | no | `22` | Node.js version Render installs. |
| `PORT` | no | set by Render | Render sets this itself; do not add it. |

## 6. Costs

**Render**

- **Free** instance: $0. It goes to sleep after 15 minutes without visitors, and the
  next visitor waits about a minute while it wakes up. Fine for a class project or demo.
- **Starter** instance (about $7/month): always awake, no wait.

The server does very little work (file reading and matching run in each visitor's
browser), so the smallest instance is enough.

**Anthropic** (only when someone uses the web search)

- Each web search check is one Claude request: it reads the document (up to about
  100,000 words) and runs up to 10 web searches.
- Rough cost per check with the default model: a few cents for a short essay, more for
  a very long document. Web searches are billed per search on top of tokens. Current
  prices: <https://www.anthropic.com/pricing>.
- See exact spending under **Usage** in the Anthropic console. Set a spend limit there
  (step 2.4) for peace of mind.

## 7. Updating the site

Render redeploys automatically every time something is pushed to the `main` branch on
GitHub (`autoDeploy: true`). To redeploy by hand: service page → **Manual Deploy →
Deploy latest commit**. Logs are under the **Logs** tab.

## 8. Troubleshooting

| What you see | Cause and fix |
|---|---|
| Build fails with `npm ci` error about the lock file | `package-lock.json` is missing or out of date. Run `npm install` locally, commit `package-lock.json`, push. |
| Page loads but says *off: the server has no ANTHROPIC_API_KEY* | Add `ANTHROPIC_API_KEY` in **Environment**, save, wait for the restart. |
| Web search says *The server's ANTHROPIC_API_KEY is invalid* | The key was mistyped or deleted. Create a new key and replace it. |
| Web search says *Claude API error: … credit balance …* | Add credit in the Anthropic console (Settings → Billing). |
| *Wrong or missing access code* | Type the `ACCESS_CODE` value into the box next to the web-search option. |
| *Limit reached: N web searches per hour* | The per-visitor limit was hit. Wait, or raise `ONLINE_CHECKS_PER_HOUR`. |
| *Rate limited by the Claude API* | Too many checks at once for your Anthropic account tier. Wait a minute. |
| First visit takes about a minute | The free instance was asleep. Normal; upgrade to Starter to avoid it. |
| A PDF gives *no readable text* | It is a scanned image with no text layer. Run OCR first (e.g. in Adobe Acrobat or Google Drive), then upload. |
| PDF or Word files do not load at all | The page loads its PDF and Word readers from `cdnjs.cloudflare.com`; a school or office network may block it. Try another network. |

## 9. How the build works

There is no compile step. Render runs two commands:

1. **Build: `npm ci`** installs exactly the versions in `package-lock.json`:
   - `express`: the web server.
   - `@anthropic-ai/sdk`: the official Anthropic library, used for the web search.
2. **Start: `npm start`** runs `node server.mjs`, which:
   - serves the website files in `public/` (HTML, CSS, JavaScript);
   - answers `GET /api/status` (whether the web search is on; also Render's health check);
   - answers `POST /api/ai-check` (the web search + AI review, see below);
   - listens on the port Render provides in `PORT`.

The browser also loads two libraries on demand from cdnjs: `pdf.js 3.11.174` (reads PDFs)
and `mammoth 1.6.0` (reads Word .docx). They load only when someone uploads that file type.

### Project layout

```
ai-plagarism-checker/
├── server.mjs              Web server + web-search endpoint
├── package.json            Dependencies and the start/test commands
├── package-lock.json       Exact dependency versions (used by npm ci)
├── render.yaml             Render Blueprint (one-click deploy settings)
├── public/
│   ├── index.html          Page layout
│   ├── styles.css          Look and feel, light and dark themes
│   ├── app.js              Page behaviour: file reading, results, report
│   ├── engine.js           Matching and AI-style engine
│   └── worker.js           Runs the engine in the background (keeps the page responsive)
└── test/engine.test.cjs    Automated tests (npm test)
```

### What happens when someone presses Run check

```
Browser                                              Server (Render)            Anthropic
───────                                              ───────────────            ─────────
1. Reads the files (PDF/Word/text) into text
2. Background worker compares against the sources,
   scores AI style, finds repeated passages
3. Shows results immediately
4. If web search is ticked: sends the text and
   12 sampled passages ───────────────────────────▶ checks access code
                                                     and hourly limit ───────▶ Claude searches the
                                                                               web, reads the text
   shows "Found online" + AI verdict ◀───────────── returns the JSON ◀──────── and replies
```

Uploaded files never leave the visitor's browser. Only the web search sends text to
the server, which passes it to Anthropic and does not store it.

## 10. How the checks work

**Matching your sources.** Every document is split into words. Each run of 5 consecutive
words (a "shingle") gets a fingerprint. Any shingle in your document that also appears in
a source marks those words as copied, and neighbouring copied words are joined into
passages. *Catch paraphrasing* drops filler words ("the", "of", "is"…) and word endings
("analysed" → "analys"), and uses runs of 4, so light rewording still matches. The
percentage is the share of your document's words covered by matches.

**Compare many files.** Every file gets a set of fingerprints; for each pair the page
shows how much of A appears in B, of B in A, and overall overlap. Very large batches
(over a million words) use a sample of fingerprints, which gives the same percentages
within a small margin.

**AI-writing estimate.** Style measurements known to differ between people and language
models: how much sentence lengths vary (people vary more), stock phrases ("delve",
"it is important to note", "furthermore"…), contractions, sentences that open with
transition words, and vocabulary variety. They are combined into a 0–100% score. It is
an estimate, not proof: formal human writing can score high, and edited AI text can
score low.

**Web search + AI review.** The server sends Claude 12 passages spread across the whole
document and the document text (first ~400,000 characters). Claude searches the web for
the most distinctive passages, reports pages containing the same or closely paraphrased
wording, and gives its own judgement on whether the text is AI-written, with reasons.
The text is treated strictly as data: instructions hidden inside a document are ignored.

**Repeated within itself.** Runs of 8+ words that appear more than once in the same
document, a sign of padding.

**Size limits.** Tested with a 30 MB text file of 3.9 million words (about 30 seconds).
The real limit is the visitor's computer memory.

## 11. Running it on your own computer

Requires Node.js 18 or newer (<https://nodejs.org>).

```bash
npm install
```

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open <http://localhost:3000>. Leave out `ANTHROPIC_API_KEY=…` to run without the web
search. On Windows PowerShell set the key first with `$env:ANTHROPIC_API_KEY="sk-ant-..."`.

Run the tests with:

```bash
npm test
```
