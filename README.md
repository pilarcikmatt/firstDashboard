# 📈 MarketDesk

A live stock monitoring dashboard with a Wall Street AI Advisor.

- **Live prices** via Yahoo Finance (no API key needed)
- **2-year charts** per stock
- **AI Advisor** powered by Claude + web search, via a secure Vercel proxy

---

## Project Structure

```
marketdesk/
├── api/
│   └── analyze.js          ← Vercel serverless function (secure API proxy)
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   └── components/
│       └── StockDashboard.jsx
├── index.html
├── vite.config.js
├── vercel.json
├── .env.example            ← Template for local dev
├── .gitignore
└── package.json
```

---

## Step 1 — Get an Anthropic API Key

1. Go to **https://console.anthropic.com/**
2. Sign up or log in
3. Go to **API Keys** → click **Create Key**
4. Copy the key (starts with `sk-ant-...`) — you only see it once

> **Cost**: The Advisor uses `claude-sonnet-4` with web search. Each analysis call
> costs roughly **$0.02–0.08** depending on response length. Very affordable for
> personal use.

---

## Step 2 — Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.example .env.local
# Then edit .env.local and paste your Anthropic API key

# 3. Start the dev server
npm run dev
# → Opens at http://localhost:5173
```

> In local dev, the app calls Anthropic directly using your key from `.env.local`.
> The `.env.local` file is gitignored — it never gets committed.

---

## Step 3 — Deploy to Vercel

### 3a. Push to GitHub

```bash
# In the marketdesk/ folder:
git init
git add .
git commit -m "Initial commit"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/marketdesk.git
git push -u origin main
```

### 3b. Connect to Vercel

1. Go to **https://vercel.com** → Sign up free (use your GitHub account)
2. Click **Add New → Project**
3. Import your `marketdesk` GitHub repo
4. Vercel auto-detects Vite — click **Deploy**

### 3c. Add your API Key as an Environment Variable

This is the critical security step. Your key lives in Vercel, never in code.

1. In Vercel dashboard → your project → **Settings → Environment Variables**
2. Add a new variable:
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: `sk-ant-YOUR_KEY_HERE`
   - **Environment**: Production, Preview, Development (check all three)
3. Click **Save**
4. Go to **Deployments** → click the three dots → **Redeploy**

Your app is now live at `https://marketdesk-xxx.vercel.app` 🎉

---

## How the AI Advisor Works (Security Flow)

```
Browser                    Vercel Edge Function         Anthropic API
  │                              │                            │
  │  POST /api/analyze           │                            │
  │  { messages, tools }  ──────►│                            │
  │  (no API key)                │  POST /v1/messages         │
  │                              │  x-api-key: [SECRET] ─────►│
  │                              │                            │  web_search(...)
  │                              │                            │◄─────────────────
  │                              │◄── response ───────────────│
  │◄── response ─────────────────│                            │
```

- Your API key is stored as a Vercel environment variable
- It **never** appears in the browser or in your source code
- The `/api/analyze.js` function injects it server-side on every request
- Web search is enabled via the `web_search_20250305` tool in the API call

---

## Optional: Password Protection

To add a simple password gate (great for personal use):

1. Vercel dashboard → your project → **Settings → Deployment Protection**
2. Enable **Password Protection**
3. Set a password
4. Anyone visiting your URL will need to enter it first

> Available on Vercel Pro ($20/mo). Free alternative: add a simple login
> screen in React using `localStorage` for a shared password.

---

## Optional: Custom Domain

1. Vercel dashboard → your project → **Settings → Domains**
2. Add your domain (e.g. `marketdesk.yourdomain.com`)
3. Update your DNS with the CNAME Vercel provides

---

## Updating the App

```bash
# Make changes, then:
git add .
git commit -m "Your change"
git push

# Vercel auto-deploys on every push to main
```

---

## FAQ

**Q: The Advisor says "API key not configured"**
A: Make sure you added `ANTHROPIC_API_KEY` in Vercel Environment Variables and redeployed.

**Q: Stock prices aren't loading**
A: Yahoo Finance occasionally blocks requests. Try refreshing. This is a free
   unofficial API — for production use consider a paid provider like Polygon.io or Alpha Vantage.

**Q: How do I add more default stocks?**
A: Edit `DEFAULT_TICKERS` array at the top of `src/components/StockDashboard.jsx`.

**Q: Can I use this commercially?**
A: Check Anthropic's usage policies and Yahoo Finance's terms of service for
   commercial use — both may require paid plans or licenses.
