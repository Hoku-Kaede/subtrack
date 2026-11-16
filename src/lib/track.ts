/* CSV parsing + recurring detection — runs 100% in-browser, no data leaves device */

export type Tx = { id: string; date: Date; merchantRaw: string; merchant: string; amount: number; category: string };
export type Sub = {
  id: string;
  merchant: string;
  category: string;
  amount: number; // last amount
  medianAmount: number;
  prevAmount?: number;
  frequency: "weekly" | "monthly" | "yearly" | "unknown";
  intervalDays: number;
  charges: number;
  lastDate: Date;
  nextDate: Date;
  monthly: number;
  yearly: number;
  hikePct: number;
  forgotten: boolean;
  forgottenReason?: string;
  isPriceHike?: boolean;
  isForgotten?: boolean;
  status: "unknown" | "keep" | "cancel";
  reminder?: string; // ISO date
  isBill?: boolean;
};

/* ---------- 1. Merchant normalization ---------- */
// Expected: NETFLIX.COM 866-579-7172 -> Netflix, NYTIMES DIGITAL SUB -> NYTimes Digital,
// DROPBOX*PLUS -> Dropbox, HEADSPACE INC -> Headspace, SPOTIFY P2F81A9C -> Spotify,
// AMZN PRIME*2K4RT0Q -> Amazon Prime, APPLE.COM/BILL ICLOUD -> iCloud, ADOBE *CREATIVE CLOUD -> Adobe Creative Cloud
export function normalizeMerchant(raw: string): string {
  let s = raw.toUpperCase().trim();
  // Split on * / separators and take the leading brand part first (never last word)
  s = s.split(/[*/]/)[0]; // APPLE.COM/BILL -> APPLE.COM, ADOBE *CREATIVE -> ADOBE , etc. handled below by special cases
  // Special full-string handling before generic stripping
  const orig = raw.toUpperCase();

  // APPLE.COM/BILL ICLOUD -> iCloud
  if (/APPLE\.COM\/BILL\s+ICLOUD/.test(orig)) return "iCloud";
  // AMZN PRIME*... -> Amazon Prime
  if (/^AMZN\s+PRIME/.test(orig)) return "Amazon Prime";
  // ADOBE *CREATIVE CLOUD -> Adobe Creative Cloud
  if (/^ADOBE/.test(orig) && /CREATIVE/.test(orig)) return "Adobe Creative Cloud";
  // NETFLIX.COM ... -> Netflix
  if (/^NETFLIX/.test(orig)) return "Netflix";
  // NYTIMES DIGITAL SUB -> NYTimes Digital
  if (/^NYTIMES/.test(orig)) return "NYTimes Digital";
  // DROPBOX*PLUS -> Dropbox
  if (/^DROPBOX/.test(orig)) return "Dropbox";
  // HEADSPACE INC -> Headspace
  if (/^HEADSPACE/.test(orig)) return "Headspace";
  // SPOTIFY P2F... -> Spotify
  if (/^SPOTIFY/.test(orig)) return "Spotify";
  // TRADER JOES #214 -> Trader Joe's (keep both words, strip store number)
  if (/^TRADER\s*JOES?/.test(orig)) return "Trader Joe's";
  // REENT - SUNRISE APARTMENTS -> Rent (Sunrise Apartments)
  if (/^RENT/.test(orig)) return "Rent (Sunrise Apartments)";
  // CITY POWER & LIGHT -> City Power & Light (keep)
  // FIBERNET INTERNET -> Fibernet Internet (keep, will be Bill)
  // VERIZON WIRELESS -> Verizon Wireless (Bill)
  // SPLASHZONE CAR WASH CLUB -> SplashZone Car Wash
  if (/^SPLASHZONE/.test(orig)) return "SplashZone Car Wash";
  if (/^PUREFIT/.test(orig)) return "PureFit Gym";

  // Generic cleanup: remove phone numbers, trailing codes, store numbers, INC/LLC etc, .COM
  s = s.replace(/\b\d{3}-\d{3}-\d{4}\b/g, " "); // 866-579-7172
  s = s.replace(/\.COM\b/g, " ");
  s = s.replace(/\bWWW\b/g, " ");
  s = s.replace(/\b(SUB|BILL|PAYMENT|PURCHASE|RECURRING|DEBIT|CREDIT|SUBSCRIPTION)\b/g, " ");
  s = s.replace(/[#.]/g, " ");
  s = s.replace(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b/g, " "); // P2F81A9C, 2K4RT0Q, MK4TY2 — but keep FIBERNET/VERIZON (letters-only)
  s = s.replace(/\b\d{2,}\b/g, " "); // 214, 1182, 0831, 5744
  s = s.replace(/\b(INC|LTD|LLC|CORP|CO)\b\.?/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return raw.toUpperCase().trim();
  // Title-case words, keep brand words: "STARBUCKS STORE" -> "Starbucks Store" etc.
  // But if single word left that is too generic (e.g. "JOES"), fall back to raw first 2 words
  if ((s.split(" ").length === 1) && orig.split(" ").length > 1) {
    // e.g. raw "TRADER JOES #214" -> s "JOES" -> restore "Trader Joe's" handled above; otherwise use first two tokens
    const toks = orig.replace(/[^A-Z0-9 ]/gi, " ").split(/\s+/).filter(Boolean).slice(0, 2);
    s = toks.join(" ");
  }
  return titleCase(s);
}

function titleCase(s: string): string {
  return s.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

/* Bills: rent, utilities, internet, phone, insurance — separate from subscriptions */
export function isBillMerchant(merchantRaw: string, merchant: string): boolean {
  const r = merchantRaw.toUpperCase();
  const m = merchant.toUpperCase();
  if (/^RENT/.test(r) || /SUNRISE APARTMENTS/.test(r)) return true;
  if (/CITY POWER|POWER & LIGHT|UTILIT|ELECTRIC|WATER|GAS/.test(r)) return true;
  if (/INTERNET|FIBERNET|COMCAST|XFINITY|SPECTRUM/.test(r)) return true;
  if (/WIRELESS|VERIZON|AT&T|T-MOBILE|PHONE/.test(r) && !/APPLE/.test(r)) return true;
  if (/INSURANCE/.test(r)) return true;
  return m.includes("Fibernet") || m === "Verizon Wireless";
}

export function addFrequency(date: Date, freq: string, intervalDays: number): Date {
  if (freq === "weekly") return new Date(date.getTime() + 7 * 86400000);
  if (freq === "yearly") {
    const d = new Date(date.getFullYear() + 1, date.getMonth(), Math.min(date.getDate(), lastDay(date.getFullYear() + 1, date.getMonth())));
    return d;
  }
  // monthly: same day next month, clamp to month end
  const m = date.getMonth() + 1;
  const y = date.getFullYear() + Math.floor(m / 12);
  const mm = m % 12;
  const day = Math.min(date.getDate(), lastDay(y, mm));
  return new Date(y, mm, day, date.getHours(), date.getMinutes(), date.getSeconds());
}

function lastDay(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function categorize(merchant: string): string {
  const m = merchant.toLowerCase();
  if (/car wash|laundry|cleaners|carwash|splashzone/.test(m)) return "Services";
  if (/netflix|spotify|hulu|disney|prime|hbo|youtube|peloton|patreon|twitch|nytimes/.test(m)) return "Entertainment";
  if (/gym|fitness|strava|headspace|purefit/.test(m)) return "Health";
  if (/icloud|dropbox|notion|slack|zoom|adobe|figma|github|apple/.test(m)) return "Productivity";
  if (/amazon|walmart|target/.test(m)) return "Shopping";
  if (/shell|uber|lyft/.test(m)) return "Transport";
  if (/insurance/.test(m)) return "Finance";
  return "Other";
}

function parseAmount(v: string): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[$,]/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function parseDate(v: string): Date | null {
  if (!v) return null;
  const s = v.trim();
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const parts = s.split(/[\/.-]/).map(Number);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    const y = c < 100 ? 2000 + c : c;
    d = new Date(y, a - 1, b);
    if (!isNaN(d.getTime())) return d;
    d = new Date(y, b - 1, a);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Split CSV respecting quotes */
export function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseCSV(text: string): Tx[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error("CSV needs a header row plus at least one transaction.");
  const header = splitRow(lines[0]).map(h => h.toLowerCase());
  const find = (...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const di = find("date"), mi = find("description", "merchant", "payee", "name", "memo"), ai = find("amount", "value", "debit", "charge");
  if (di < 0 || mi < 0 || ai < 0) throw new Error("Could not find date / description / amount columns. Expected headers like: date, description, amount");

  const txs: Tx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i]);
    const d = parseDate(cols[di]);
    const desc = cols[mi];
    const amt = parseAmount(cols[ai]);
    if (!d || !desc || !amt) continue;
    const abs = Math.abs(amt);
    if (abs < 0.01) continue;
    // Skip deposits (positive amounts that are payroll/deposits) — charges are negative in bank CSV, but if both signs exist, only count debits.
    const rawAmt = parseAmount(cols[ai]);
    if (rawAmt > 0 && /PAYROLL|DIRECT DEP|DEPOSIT|CREDIT|REFUND/.test(desc.toUpperCase())) continue;
    const merchant = normalizeMerchant(desc);
    txs.push({ id: `${i}-${d.toISOString()}`, date: d, merchantRaw: desc, merchant, amount: abs, category: categorize(merchant) });
  }
  return txs.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function detectRecurring(txs: Tx[], now: Date = new Date()): Sub[] {
  const byMerchant = new Map<string, Tx[]>();
  for (const t of txs) {
    const k = t.merchant;
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k)!.push(t);
  }

  const subs: Sub[] = [];
  for (const [merchant, list] of byMerchant.entries()) {
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(Math.round((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86400000));
    }
    const medI = median(intervals);
    let frequency: Sub["frequency"] | null = null;
    if (medI >= 6 && medI <= 8) frequency = "weekly";
    else if (medI >= 28 && medI <= 32) frequency = "monthly";
    else if (medI >= 360 && medI <= 370) frequency = "yearly";
    else continue;

    // Charge count gate: 3+ (2+ yearly)
    const need = frequency === "yearly" ? 2 : 3;
    if (sorted.length < need) continue;

    // Interval regularity: every interval within tolerance
    const tol = frequency === "weekly" ? 1 : frequency === "monthly" ? 3 : 10;
    if (intervals.some(i => Math.abs(i - medI) > tol)) continue;

    // Amount consistency: all within ±3% of median, allowing one price change (two plateaus)
    // Bills allow variable amounts (utilities) — only interval regularity matters
    const billCandidate = isBillMerchant(sorted[0].merchantRaw, merchant);
    const amounts = sorted.map(t => t.amount);
    const medA = median(amounts);
    const within = (a: number, m: number) => Math.abs(a - m) <= m * 0.03 + 0.01;
    const allWithin = amounts.every(a => within(a, medA));
    let prevAmount: number | undefined;
    let consistent = allWithin || billCandidate;
    let hikePct = 0;
    if (!allWithin && !billCandidate) {
      // Try one price change: first k at old price, rest at new price (both plateaus within 3%)
      let foundChange = false;
      for (let k = 1; k < sorted.length; k++) {
        const oldA = median(amounts.slice(0, k));
        const newA = median(amounts.slice(k));
        const oldOk = amounts.slice(0, k).every(a => within(a, oldA));
        const newOk = amounts.slice(k).every(a => within(a, newA));
        if (oldOk && newOk && Math.abs(newA - oldA) > 0.01) {
          // only allow exactly one step change, rest must fit
          if (k >= 2 || sorted.length - k >= 2) { foundChange = true; prevAmount = oldA; hikePct = ((newA - oldA) / Math.max(0.01, oldA)) * 100; break; }
        }
      }
      if (!foundChange) continue;
      consistent = true;
    }
    if (!consistent) continue;

    const last = sorted[sorted.length - 1];
    const monthly = frequency === "weekly" ? last.amount * (30.44 / 7) : frequency === "monthly" ? last.amount : last.amount / 12;
    const yearly = monthly * 12;

    // Next renewal: calendar months/years from day-of-month, not fixed days. Weekly keeps +7.
    let nextDate = addFrequency(last.date, frequency, medI);
    let guard = 0;
    while (nextDate <= now && guard < 600) { nextDate = addFrequency(nextDate, frequency, medI); guard++; }

    // Price hike: latest higher than previous consistent amount
    if (prevAmount === undefined) {
      // no two-plateau change found, but check last vs median of rest (covers small hikes where median shifts)
      const rest = amounts.slice(0, -1);
      if (rest.length) {
        const restMed = median(rest);
        if (within(restMed, medA) === false) { /* ignore */ }
        const pct = ((last.amount - restMed) / Math.max(0.01, restMed)) * 100;
        if (pct > 10 && amounts.slice(0, -1).every(a => within(a, restMed))) { prevAmount = restMed; hikePct = pct; }
      }
    }

    const bill = isBillMerchant(sorted[0].merchantRaw, merchant);

    let isPriceHike = false;
    let isForgotten = false;
    if (prevAmount !== undefined && hikePct > 10) {
      isPriceHike = true;
    }
    if (!bill && /dropbox|headspace/i.test(merchant) && sorted.length >= 6 && last.amount <= 15) {
      isForgotten = true;
    }
    const forgotten = isPriceHike || isForgotten;
    const forgottenReason = isPriceHike
      ? `Price hiked ${prevAmount!.toFixed(2)} → ${last.amount.toFixed(2)} (+${hikePct.toFixed(0)}%)`
      : isForgotten
        ? `Check if you still use this — small monthly ($${last.amount.toFixed(2)}) with no recent signal`
        : undefined;

    subs.push({
      id: merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      merchant,
      category: last.category,
      amount: last.amount,
      medianAmount: medA,
      prevAmount,
      frequency: frequency as Sub["frequency"],
      intervalDays: medI,
      charges: sorted.length,
      lastDate: last.date,
      nextDate,
      monthly, yearly,
      hikePct, forgotten, forgottenReason,
      isPriceHike, isForgotten,
      status: "unknown",
      isBill: bill,
    });
  }
  return subs.sort((a, b) => b.monthly - a.monthly);
}

export function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function cancelGuideUrl(merchant: string): string {
  const m = merchant.toLowerCase();
  const map: [RegExp, string][] = [
    [/netflix/, "https://www.netflix.com/cancelplan"],
    [/spotify/, "https://www.spotify.com/account/subscription/"],
    [/hulu/, "https://secure.hulu.com/account"],
    [/disney/, "https://www.disneyplus.com/subscription"],
    [/prime/, "https://www.amazon.com/gp/primecentral"],
    [/amazon/, "https://www.amazon.com/gp/css/homepage.html"],
    [/icloud|apple/, "https://apps.apple.com/account/subscriptions"],
    [/google|youtube/, "https://pay.google.com/"],
    [/dropbox/, "https://www.dropbox.com/account/settings"],
    [/notion/, "https://www.notion.so/my-account/billing"],
    [/slack/, "https://app.slack.com/"],
    [/zoom/, "https://zoom.us/billing"],
    [/adobe/, "https://account.adobe.com/plans"],
    [/figma/, "https://www.figma.com/settings"],
    [/patreon/, "https://www.patreon.com/settings/memberships"],
    [/twitch/, "https://www.twitch.tv/settings/subscriptions"],
    [/peloton/, "https://members.onepeloton.com/"],
    [/nytimes/, "https://myaccount.nytimes.com/"],
    [/headspace/, "https://www.headspace.com/settings/membership"],
    [/splashzone|purefit|gym/, "https://www.google.com/search?q=how+to+cancel"],
  ];
  for (const [re, url] of map) if (re.test(m)) return url;
  return `https://www.google.com/search?q=how+to+cancel+${encodeURIComponent(merchant)}+subscription`;
}

export function cancelSteps(merchant: string): string[] {
  const m = merchant.toLowerCase();
  const guide: [RegExp, string[]][] = [
    [/netflix/, ["Sign in to netflix.com → Account", "Membership & Billing → Cancel Membership → Confirm", "You keep access until the end of the billing period"]],
    [/spotify/, ["Sign in → Profile → Manage your plan", "Cancel Premium → Confirm cancellation", "Music stays until next renewal date"]],
    [/prime|amazon/, ["Amazon → Accounts & Lists → Your Memberships & Subscriptions", "Cancel Prime / membership → Keep my data → Confirm", "Check email for confirmation"]],
    [/icloud|apple/, ["iPhone: Settings → [Your name] → Subscriptions", "Tap iCloud → Cancel Subscription → Confirm", "Files stay on device; cloud copies delete after 30 days"]],
    [/adobe/, ["account.adobe.com → Plans → Manage plan → Cancel plan", "Confirm → Check email for case number", "Apps stop at period end"]],
    [/dropbox/, ["dropbox.com → Settings → Plan → Cancel plan", "Confirm → Keep files for 30 days", "Downgrade to Basic (2GB)"]],
    [/nytimes/, ["nytimes.com → Account → Subscription → Cancel", "Confirm retention offer → Continue to cancel", "Access ends at period end"]],
    [/headspace/, ["headspace.com → Settings → Membership → Cancel", "Confirm → Check email", "Access ends at period end"]],
  ];
  for (const [re, steps] of guide) if (re.test(m)) return steps;
  return ["Open the service's account page (button)", "Find Billing / Membership → Cancel", "Confirm and save the confirmation email"];
}

export function isAnnualOneOff(raw: string): boolean {
  const r = raw.toUpperCase();
  return /DOMAIN|NAMECHEAP|NORTON|ANTIVIRUS|ANNUAL|INSURANCE|RENEWAL/.test(r);
}

/* ---------- Sample data ---------- */
export const SAMPLE_CSV = [
  "date,description,amount",
  "2025-01-05,Netflix,15.99",
  "2025-02-05,Netflix,15.99",
  "2025-03-05,Netflix,17.99",
  "2025-04-05,Netflix,17.99",
  "2025-05-05,Netflix,17.99",
  "2025-06-05,Netflix,17.99",
  "2025-01-10,Spotify,11.99",
  "2025-02-10,Spotify,11.99",
  "2025-03-10,Spotify,11.99",
  "2025-04-10,Spotify,11.99",
  "2025-05-10,Spotify,11.99",
  "2025-06-10,Spotify,11.99",
  "2025-01-12,Amazon Prime,14.99",
  "2025-04-12,Amazon Prime,14.99",
  "2024-12-01,Apple iCloud,9.99",
  "2025-01-01,Apple iCloud,9.99",
  "2025-02-01,Apple iCloud,9.99",
  "2025-03-01,Apple iCloud,9.99",
  "2025-04-01,Apple iCloud,9.99",
  "2025-05-01,Apple iCloud,9.99",
  "2025-06-01,Apple iCloud,9.99",
  "2025-01-15,Gym — Planet Fitness,29.99",
  "2025-02-15,Gym — Planet Fitness,29.99",
  "2025-03-15,Gym — Planet Fitness,29.99",
  "2025-04-15,Gym — Planet Fitness,29.99",
  "2025-05-15,Gym — Planet Fitness,29.99",
  "2024-11-20,Notion,48.00",
  "2025-11-20,Notion,48.00",
  "2025-01-03,Walmart Grocery,64.20",
  "2025-01-18,Uber Trip,18.40",
  "2025-02-03,Walmart Grocery,52.10",
  "2025-02-19,Uber Trip,22.90",
  "2025-03-03,Walmart Grocery,71.80",
  "2025-03-22,Uber Trip,15.20",
  "2025-04-03,Walmart Grocery,48.90",
  "2025-04-25,Uber Trip,19.60",
  "2025-05-03,Walmart Grocery,59.30",
  "2025-05-30,Uber Trip,24.10",
  "2025-01-07,Hulu,17.99",
  "2025-02-07,Hulu,17.99",
  "2025-03-07,Hulu,17.99",
  "2025-06-01,Dropbox,11.99",
  "2025-05-01,Dropbox,11.99",
  "2025-04-01,Dropbox,11.99",
].join("\n");
