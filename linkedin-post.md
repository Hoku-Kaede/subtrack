# LinkedIn Post — Subtrack (Showcase Style, no link)

**Status:** Draft ready to post
**Project:** Subtrack — Find forgotten subscriptions

---

I built Subtrack.

A subscription tracker that finds your *forgotten* subscriptions.

The problem: you’ve paid for subscriptions you forgot you had. Or got quietly price-hiked. Or kept paying for software you no longer use.

The fix I wanted to exist:

Drop a bank statement CSV → it finds recurring charges in your browser (File API, in-memory parse, zero data leaves the device, no account needed) → shows:

→ Total monthly + yearly spend
→ Next renewal dates (calendar-accurate, month-end safe)
→ Price hikes (Netflix $15.49 → $17.99 = +16%)
→ “Possibly forgotten” flags (small long-running charges like Dropbox / Headspace)
→ Keep / Cancel per sub + official cancellation guides (Netflix, Spotify, Amazon, Apple, Adobe…)

From my test on a 285-transaction mock bank statement:
→ 10 subscriptions ≈ $227/mo (~$2,728/yr) found
→ 4 real bills (rent, utilities, internet, phone) correctly excluded
→ Price hike flagged automatically
→ Forgotten flags in place

Privacy by architecture, not by promise.

Built with React + Vite + Tailwind. Dark/light. Drag & drop. Sample CSV included.

I use it myself — it’s the tool I’d want to exist.

#BuildInPublic #IndieHacker #SaaS #Fintech #Privacy

---

**Short version (no link):**

Your bank knows what you spend. You don’t.

Built Subtrack: drop a bank CSV → find forgotten subscriptions → decide keep/cancel → save money.

$2,728/yr detected in our test. Netflix got a price hike flagged automatically.

#BuildInPublic #SaaS
