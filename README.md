# Subtrack — Find forgotten subscriptions

Drop a bank statement CSV. Find recurring charges in your browser — no data leaves your device.

## Run

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # static dist/ — deploy to any host
npm run preview
```

Deploy `dist/` to Vercel / Netlify / Cloudflare Pages / GitHub Pages. No backend needed.

## Features

- **Browser-only CSV parsing** (File API + in-memory detection, zero network)
- Merchant normalization, interval regularity (weekly/monthly/yearly ±20%)
- Monthly/yearly totals, category spend, savings meter with animated counters
- Per-sub keep/cancel, renewal reminders (localStorage), cancellation guides
- “Possibly forgotten” flags (price hike >20% / stale)
- Sample data + CSV template, drag & drop, dark/light, responsive, WCAG AA

## Privacy

Your CSV is read with `File.text()`, parsed in memory, forgotten on tab close. Reminders + keep/cancel live only in `localStorage["subtrack:v1"]`. Verify in DevTools → Network: uploads never post.
