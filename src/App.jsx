import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Lock, Bell, Check, X, ArrowRight, Trash2, Repeat, CalendarDays, TrendingDown, Moon, Sun, FileDown, AlertTriangle, CheckCircle2, Sparkles, ShieldCheck, FileText, MessageCircle } from "lucide-react";
import { parseCSV, detectRecurring, SAMPLE_CSV, cancelGuideUrl, cancelSteps } from "./lib/track.ts";

const money = (n) => `$${n.toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const LS_KEY = "subtrack:v1";

function loadPersisted() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{"subs":{}}'); } catch { return { subs: {} }; } }
function savePersisted(p) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {} }

function useCounter(target, active) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setVal(target); return; }
    const start = performance.now(), dur = 900; let raf = 0;
    const tick = (t) => { const p = Math.min(1, (t - start) / dur); const e = 1 - Math.pow(1 - p, 3); setVal(target * e); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target, active]);
  return val;
}

function Stat({ label, value, sub, active }) {
  const v = useCounter(value, active);
  return (
    <div className="rounded-3xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-60">{label}</p>
      <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight">${v.toFixed(0)}</p>
      <p className="mt-1 text-sm opacity-70">{sub}</p>
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useState(false);
  const [txCount, setTxCount] = useState(0);
  const [subs, setSubs] = useState([]);
  const [txs, setTxs] = useState([]);
  const [error, setError] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectedCount, setDetectedCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [uploadsLeft, setUploadsLeft] = useState(4);
  const [locked, setLocked] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const fileRef = useRef(null);

  /* Upload budget — 4 free tests per browser */
  useEffect(() => {
    try {
      const n = parseInt(localStorage.getItem("subtrack:uploads") || "0", 10) || 0;
      setUploadsLeft(Math.max(0, 4 - n));
      if (n >= 4) setLocked(true);
    } catch { setUploadsLeft(4); }
  }, []);

  /* Anti-inspect deterrents (raise copies effort, not true protection) */
  useEffect(() => {
    const onCtx = (e) => e.preventDefault();
    const onKey = (e) => {
      const k = e.key?.toLowerCase();
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && ["i","j","c","k"].includes(k)) || (e.ctrlKey && k === "u") || (e.metaKey && e.altKey && ["i","j"].includes(k))) {
        e.preventDefault();
        setDevOpen(true);
        setTimeout(() => setDevOpen(false), 4000);
      }
    };
    const onDev = () => {
      const w = window.outerWidth - window.innerWidth;
      const h = window.outerHeight - window.innerHeight;
      if (w > 160 || h > 160) setDevOpen(true); else setDevOpen(false);
    };
    const iv = setInterval(onDev, 1000);
    document.addEventListener("contextmenu", onCtx);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("contextmenu", onCtx); document.removeEventListener("keydown", onKey); clearInterval(iv); };
  }, []);

  useEffect(() => {
    try {
      const s = localStorage.getItem("subtrack:theme");
      setDark(s ? s === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("subtrack:theme", dark ? "dark" : "light"); } catch {}
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const runDetection = (text) => {
    // Enforce 4-attempt test budget per browser
    if (locked) return;
    try {
      const n = parseInt(localStorage.getItem("subtrack:uploads") || "0", 10) || 0;
      if (n >= 4) { setLocked(true); return; }
      localStorage.setItem("subtrack:uploads", String(n + 1));
      setUploadsLeft(Math.max(0, 4 - (n + 1)));
      if (n + 1 >= 4) setTimeout(() => setLocked(true), 1200);
    } catch {}
    setError(""); setDetecting(true);
    try {
      const txs = parseCSV(text);
      setTxs(txs);
      setTxCount(txs.length);
      setTimeout(() => {
        const found = detectRecurring(txs);
        const persisted = loadPersisted();
        const merged = found.map(s => ({ ...s, status: persisted.subs[s.id]?.status ?? s.status, reminder: persisted.subs[s.id]?.reminder }));
        setSubs(merged); setDetectedCount(merged.length); setDetecting(false);
      }, 700);
    } catch (e) { setDetecting(false); setError(e?.message ?? "Could not parse CSV."); }
  };

  const handleFile = async (file) => runDetection(await file.text());
  const updateSub = (id, patch) => {
    setSubs(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...patch } : s);
      const persisted = loadPersisted();
      const t = next.find(s => s.id === id);
      if (t) persisted.subs[id] = { status: t.status, reminder: t.reminder };
      savePersisted(persisted); return next;
    });
  };

  const detectedMonthly = useMemo(() => subs.filter(s => !s.isBill).reduce((sum, s) => sum + s.monthly, 0), [subs]);
  const detectedYearly = detectedMonthly * 12;
  const monthly = useMemo(() => subs.filter(s => !s.isBill && s.status !== "cancel").reduce((sum, s) => sum + s.monthly, 0), [subs]);
  const yearly = monthly * 12;
  const savingsYearly = useMemo(() => subs.filter(s => !s.isBill && s.status === "cancel").reduce((sum, s) => sum + s.yearly, 0), [subs]);
  const forgotten = useMemo(() => subs.filter(s => !s.isBill && s.isForgotten), [subs]);
  const nonBills = useMemo(() => subs.filter(s => !s.isBill), [subs]);
  const bills = useMemo(() => subs.filter(s => s.isBill), [subs]);
  const byCategory = useMemo(() => {
    const map = new Map();
    for (const s of subs) if (!s.isBill && s.status !== "cancel") map.set(s.category, (map.get(s.category) ?? 0) + s.monthly);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [subs]);

  const downloadTemplate = () => {
    const blob = new Blob(["date,description,amount\n2025-06-01,Netflix,17.99\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "subtrack-template.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={`${dark ? "dark" : ""} min-h-screen bg-[#F7F3EC] text-[#111] transition-colors duration-500 dark:bg-[#0E0F13] dark:text-white`}>
      {devOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-6 text-center text-white" role="alert">
          <div className="max-w-sm">
            <Lock className="mx-auto h-10 w-10 text-[#C6FF4D]" />
            <p className="mt-4 font-display text-2xl font-bold">Source protection enabled</p>
            <p className="mt-2 text-sm text-white/70">Developer tools are disabled on this demo. This site is licensed — contact the owner before copying or reusing.</p>
            <a href="https://discord.com/users/" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-white px-6 font-bold text-black"><MessageCircle className="h-4 w-4" /> Discord @yuukiririn</a>
          </div>
        </div>
      )}
      <a href="#demo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-black focus:px-4 focus:py-2 focus:text-white">Skip to demo</a>
      <header className="sticky top-3 z-50 mx-auto max-w-6xl px-3">
        <div className="flex items-center justify-between rounded-full border border-black/10 bg-white/75 px-4 py-2 shadow-lg backdrop-blur-2xl backdrop-saturate-150 dark:border-white/15 dark:bg-white/10">
          <a href="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#C6FF4D] text-black"><Repeat className="h-4 w-4" /></span> Subtrack
          </a>
          <nav className="hidden items-center gap-1 text-sm font-medium md:flex" aria-label="Primary">
            <a href="#how" className="rounded-full px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10">How it works</a>
            <a href="#demo" className="rounded-full px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10">Demo</a>
            <a href="#pricing" className="rounded-full px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10">Pricing</a>
            <a href="#faq" className="rounded-full px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10">FAQ</a>
          </nav>
          <button onClick={() => setDark(!dark)} aria-label="Toggle theme" aria-pressed={dark} className="grid h-9 w-9 place-items-center rounded-full border border-black/10 active:scale-90 transition dark:border-white/20">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="pt-14 pb-10 sm:pt-20">
          <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] opacity-60"><Lock className="h-3.5 w-3.5" /> Browser-only · No account · No upload</p>
          <h1 className="font-display text-[clamp(3rem,10vw,7rem)] font-bold leading-[0.88] tracking-[-0.04em] [text-wrap:balance]" style={{ fontOpticalSizing: "auto" }}>
            Find the charges<br />you <span className="bg-[#C6FF4D] px-2 text-black rounded-xl">forgot</span> to cancel.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed opacity-75">Drop a bank statement CSV. Subtrack finds recurring charges, shows what you pay monthly and yearly, and flags the probably-forgotten ones — all in your browser.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#demo" className="inline-flex min-h-[52px] items-center gap-2 rounded-full bg-black px-7 font-bold text-white shadow-xl transition hover:-translate-y-0.5 active:scale-95 dark:bg-[#C6FF4D] dark:text-black">Try the demo <ArrowRight className="h-4 w-4" /></a>
            <button onClick={() => runDetection(SAMPLE_CSV)} className="inline-flex min-h-[52px] items-center gap-2 rounded-full border border-black/20 px-7 font-bold transition active:scale-95 bg-white/50 dark:border-white/25 dark:bg-white/5"><Sparkles className="h-4 w-4" /> Try with sample data</button>
          </div>
        </section>

        <section id="how" className="py-10" aria-labelledby="how-h">
          <h2 id="how-h" className="font-display text-3xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {[["1","Drop your CSV","Export from your bank (usually one click). We accept date, description, amount — in any order."],["2","We detect repeats","Merchant normalization groups Netflix / NETFLIX.COM / NFLX together. Similar amounts + regular intervals = subscription."],["3","Decide & save","Mark keep or cancel, set renewal reminders, open a cancellation guide. Savings meter updates live."]].map(([n,t,d]) => (
              <li key={n} className="rounded-[28px] border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-white/5">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-black font-display text-lg font-bold text-white dark:bg-[#C6FF4D] dark:text-black">{n}</span>
                <h3 className="mt-4 font-display text-xl font-bold">{t}</h3><p className="mt-2 text-sm leading-relaxed opacity-70">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="demo" className="py-10" aria-labelledby="demo-h">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 id="demo-h" className="font-display text-3xl font-bold tracking-tight">Live demo</h2><p className="mt-1 max-w-xl text-sm opacity-70">Parsing happens entirely in the browser — no data leaves your device. Try it now:</p></div>
            <button onClick={downloadTemplate} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-black/15 px-4 text-sm font-semibold active:scale-95 dark:border-white/20"><FileDown className="h-4 w-4" /> Download CSV template</button>
          </div>
          <div onDragOver={e => { e.preventDefault(); if (!locked) setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); if (locked) return; const f = e.dataTransfer.files[0]; if (f) handleFile(f); }} className={`mt-5 rounded-[28px] border-2 border-dashed p-6 transition ${locked ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10" : dragOver ? "border-blue-600 bg-blue-600/5" : "border-black/15 dark:border-white/20 bg-white/60 dark:bg-white/5"}`}>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Upload bank statement CSV" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {locked ? (
              <div className="text-center py-4">
                <p className="font-display text-2xl font-bold">You've used your 4 free test uploads.</p>
                <p className="mt-2 text-sm opacity-70">Want unlimited uploads + Pro features? Contact the owner to continue.</p>
                <a href="https://discord.com/users/" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-[#5865F2] px-7 font-bold text-white active:scale-95 transition">
                  <MessageCircle className="h-5 w-5" /> Contact owner — Discord @yuukiririn
                </a>
                <p className="mt-3 text-xs opacity-60">Source protection enabled.<br />This site's code is licensed — contact owner before copying or reusing.</p>
              </div>
            ) : (
            <>
            <div className="flex flex-wrap items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-black text-white dark:bg-[#C6FF4D] dark:text-black"><Upload className="h-6 w-6" /></span>
              <div className="flex-1 min-w-[220px]"><p className="font-display text-xl font-bold">Drag & drop your statement CSV</p><p className="text-sm opacity-70">or · {uploadsLeft} of 4 free uploads remaining</p></div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => fileRef.current?.click()} className="min-h-[48px] rounded-full bg-black px-6 font-bold text-white active:scale-95 dark:bg-[#C6FF4D] dark:text-black">Choose CSV file</button>
                <button onClick={() => runDetection(SAMPLE_CSV)} className="min-h-[48px] rounded-full border border-black/20 px-6 font-bold active:scale-95 dark:border-white/25">Load sample</button>
              </div>
            </div>
            </>
            )}
            {txCount > 0 && <p className="mt-3 text-sm opacity-70" role="status">Parsed {txCount} transactions · Found {nonBills.length} subscriptions + {bills.length} bills</p>}
            {error && <p role="alert" className="mt-3 flex items-center gap-2 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700"><AlertTriangle className="h-4 w-4" /> {error}</p>}
            {detecting && <div className="mt-4 flex items-center gap-3" aria-live="polite"><div className="h-2 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full w-1/2 animate-pulse rounded-full bg-[#C6FF4D]" /></div><span className="text-sm font-bold">Detecting…</span></div>}
          </div>

          {subs.length > 0 && (
            <div className="mt-8">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Detected /mo" value={detectedMonthly} sub={`${nonBills.length} subs · bills excluded`} active />
                <Stat label="After cancelling /mo" value={monthly} sub={`Saves ${money(savingsYearly)}/yr`} active />
                <Stat label="Possibly forgotten" value={forgotten.reduce((s, x) => s + x.monthly, 0)} sub={`${forgotten.length} to check · not “forgotten”`} active />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
                <div className="space-y-4">
                  <h3 className="font-display text-2xl font-bold tracking-tight">Subscriptions ({nonBills.length})</h3>
                  {nonBills.map((s, i) => (
                    <article key={s.id} className="rounded-[24px] border border-black/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-white/10 dark:bg-white/5" style={{ animation: `fadeUp .5s ${i * 60}ms both` }}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="flex flex-wrap items-center gap-2 font-display text-xl font-bold tracking-tight">{s.merchant}
                            {s.isPriceHike && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-800">Price hike</span>}
                            {s.isForgotten && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-rose-800">Forgotten?</span>}
                            {s.status === "cancel" && <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white dark:bg-white dark:text-black">Cancel · Selected</span>}
                            {s.status === "keep" && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">Keep · Selected</span>}
                          </h4>
                          <p className="mt-1 text-sm opacity-70">{s.category} · {s.frequency} · {s.charges} charges · {money(s.amount)} · next {fmtDate(s.nextDate)}{s.forgottenReason && <span className="mt-1 block text-xs font-semibold text-amber-700 dark:text-amber-300">{s.forgottenReason}</span>}</p>
                        </div>
                        <p className="text-right"><span className="font-display text-2xl font-bold tabular-nums">{money(s.monthly)}</span><span className="block text-xs opacity-60">/mo · {money(s.yearly)}/yr</span></p>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button onClick={() => updateSub(s.id, { status: "keep" })} aria-pressed={s.status === "keep"} className={`min-h-[40px] rounded-full px-4 text-sm font-bold transition active:scale-95 ring-offset-2 ${s.status === "keep" ? "bg-emerald-600 text-white shadow-md ring-2 ring-emerald-600" : "border border-black/15 opacity-70 hover:opacity-100 dark:border-white/20"}`}>{s.status === "keep" ? "✓ Keeping" : "Keep"}</button>
                        <button onClick={() => updateSub(s.id, { status: "cancel" })} aria-pressed={s.status === "cancel"} className={`min-h-[40px] rounded-full px-4 text-sm font-bold transition active:scale-95 ring-offset-2 ${s.status === "cancel" ? "bg-black text-white shadow-md ring-2 ring-black dark:bg-white dark:text-black dark:ring-white" : "border border-black/15 opacity-70 hover:opacity-100 dark:border-white/20"}`}><span className="inline-flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> {s.status === "cancel" ? "Cancelling" : "Cancel"}</span></button>
                        <label className="flex min-h-[40px] items-center gap-2 rounded-full border border-black/15 px-3 text-sm dark:border-white/20"><Bell className="h-3.5 w-3.5" /><span className="sr-only">Reminder for {s.merchant}</span><input type="date" value={s.reminder ?? ""} onChange={e => updateSub(s.id, { reminder: e.target.value || undefined })} className="bg-transparent text-sm outline-none" /></label>
                        <details className="group w-full rounded-2xl border border-black/10 p-3 dark:border-white/15">
                          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-bold">Cancel {s.merchant} in 3 taps <ArrowRight className="h-3.5 w-3.5" /></summary>
                          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed opacity-80">
                            {cancelSteps(s.merchant).map((st, idx) => <li key={idx}>{st}</li>)}
                          </ol>
                          <a href={cancelGuideUrl(s.merchant)} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-black px-4 text-sm font-bold text-white dark:bg-[#C6FF4D] dark:text-black">Open official cancel page ↗</a>
                        </details>
                      </div>
                    </article>
                  ))}
                  {bills.length > 0 && (
                    <>
                      <h3 className="pt-4 font-display text-2xl font-bold tracking-tight">Bills ({bills.length}) <span className="text-sm font-normal opacity-60">— rent, utilities, internet & phone — excluded from totals</span></h3>
                      {bills.map(s => (
                        <article key={s.id} className="rounded-[24px] border border-dashed border-black/20 bg-white/50 p-5 dark:border-white/20 dark:bg-white/5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h4 className="font-display text-lg font-bold">{s.merchant}</h4>
                              <p className="mt-1 text-sm opacity-70">{s.frequency} · {s.charges} charges · {money(s.amount)} · next {fmtDate(s.nextDate)}</p>
                            </div>
                            <p className="font-display text-xl font-bold tabular-nums">{money(s.monthly)}<span className="text-xs font-normal opacity-60">/mo</span></p>
                          </div>
                        </article>
                      ))}
                      {(() => {
                        const seen = new Set();
                        const oneOffs = txs.filter(t => {
                          const k = t.merchant;
                          if (seen.has(k)) return false;
                          const list = txs.filter(x => x.merchant === k);
                          if (list.length === 1 && /DOMAIN|NAMECHEAP|NORTON|ANTIVIRUS|ANNUAL|INSURANCE|RENEWAL/i.test(t.merchantRaw)) { seen.add(k); return true; }
                          return false;
                        });
                        return oneOffs.length > 0 ? (
                          <p className="rounded-2xl bg-black/5 p-3 text-xs leading-relaxed opacity-80 dark:bg-white/10">Annual / one-off charges ({oneOffs.length}): {oneOffs.map(t => `${t.merchant} ${money(t.amount)} (${fmtDate(t.date)})`).join(" · ")} — seen once, may renew yearly.</p>
                        ) : null;
                      })()}
                    </>
                  )}
                </div>
                <aside className="space-y-4 lg:sticky lg:top-32 lg:self-start">
                  <div className="rounded-[24px] border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
                    <h3 className="font-display font-bold">Spend by category</h3>
                    <div className="mt-4 space-y-3">
                      {byCategory.map(([cat, val]) => {
                        const max = byCategory[0]?.[1] ?? 1;
                        return <div key={cat}><div className="flex justify-between text-sm"><span className="font-semibold">{cat}</span><span className="tabular-nums">${val.toFixed(0)}/mo</span></div><div className="mt-1 h-2.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#C6FF4D] to-emerald-500 transition-all duration-700" style={{ width: `${Math.round((val / max) * 100)}%` }} /></div></div>;
                      })}
                    </div>
                  </div>
                  <div className="rounded-[24px] bg-black p-5 text-white dark:bg-[#C6FF4D] dark:text-black">
                    <h3 className="flex items-center gap-2 font-display font-bold"><TrendingDown className="h-4 w-4" /> Savings meter</h3>
                    <p className="mt-2 font-display text-4xl font-bold tabular-nums">${savingsYearly.toFixed(0)}/yr</p>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/20 dark:bg-black/15"><div className="h-full bg-current transition-all duration-700" style={{ width: `${Math.min(100, monthly ? (savingsYearly / (monthly * 12 || 1)) * 100 : 0)}%` }} /></div>
                  </div>
                  <div className="rounded-[24px] border border-black/10 bg-white p-5 text-sm dark:border-white/10 dark:bg-white/5">
                    <h3 className="flex items-center gap-2 font-display font-bold"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Privacy promise</h3>
                    <p className="mt-2 opacity-70">Parsed with File API in this tab. Nothing uploaded, nothing server-side. Reminders live only in localStorage.</p>
                    <button onClick={() => { try { localStorage.removeItem(LS_KEY); } catch {} setSubs([]); setTxCount(0); }} className="mt-3 min-h-[40px] rounded-full border border-black/15 px-4 font-semibold active:scale-95 dark:border-white/20"><span className="inline-flex items-center gap-1.5"><X className="h-3.5 w-3.5" /> Clear local data</span></button>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </section>

        <section className="py-12">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[28px] bg-black p-8 text-white dark:bg-white dark:text-black"><Lock className="h-8 w-8" /><h2 className="mt-4 font-display text-3xl font-bold tracking-tight">Private by architecture, not by promise.</h2><p className="mt-3 leading-relaxed opacity-80">Subtrack never sees your statement. The CSV is read with File.text(), parsed in memory, and forgotten when you close the tab. No analytics on amounts, no account, no server.</p></div>
            <div className="rounded-[28px] border border-black/10 bg-white p-8 dark:border-white/10 dark:bg-white/5"><h3 className="font-display text-xl font-bold">What we detect</h3><ul className="mt-4 space-y-3 text-sm leading-relaxed opacity-80"><li>• Merchant normalization</li><li>• Similar amounts + regular intervals</li><li>• Next renewal date</li><li>• “Possibly forgotten” on price hike / stale</li></ul></div>
          </div>
        </section>

        <section id="pricing" className="py-10" aria-labelledby="pricing-h">
          <h2 id="pricing-h" className="text-center font-display text-3xl font-bold tracking-tight">Pricing</h2>
          <div className="mx-auto mt-6 grid max-w-3xl gap-4 md:grid-cols-2">
            <div className="rounded-[28px] border border-black/10 bg-white p-7 dark:border-white/10 dark:bg-white/5"><p className="text-xs font-bold uppercase tracking-[0.18em] opacity-60">Free</p><p className="mt-2 font-display text-5xl font-bold">$0</p><ul className="mt-5 space-y-2 text-sm opacity-80"><li>• 5 subscriptions</li><li>• Browser-only parsing</li><li>• Renewal reminders</li></ul><a href="#demo" className="mt-6 flex min-h-[48px] items-center justify-center rounded-full border border-black/20 font-bold active:scale-95 dark:border-white/25">Start free</a></div>
            <div className="relative rounded-[28px] bg-black p-7 text-white dark:bg-[#C6FF4D] dark:text-black"><span className="absolute -top-3 right-5 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-black">POPULAR</span><p className="text-xs font-bold uppercase tracking-[0.18em] opacity-60">Pro</p><p className="mt-2 font-display text-5xl font-bold">$4<span className="text-lg font-medium opacity-60">/mo</span></p><ul className="mt-5 space-y-2 text-sm opacity-90"><li>• Unlimited</li><li>• Price-hike alerts</li><li>• Budgets + export</li></ul><button className="mt-6 min-h-[48px] w-full rounded-full bg-white font-bold text-black active:scale-95 dark:bg-black dark:text-white">Go Pro</button></div>
          </div>
        </section>

        <section id="faq" className="py-10" aria-labelledby="faq-h">
          <h2 id="faq-h" className="font-display text-3xl font-bold tracking-tight">FAQ</h2>
          <div className="mt-5 divide-y divide-black/10 rounded-[28px] border border-black/10 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-white/5">
            {[["Does my CSV leave my device?","No. Parsing happens in this browser tab with the File API. No upload, no account."],["What if my bank uses different columns?","We look for date / description / amount case-insensitively. You'll get a clear error — no silent drops."],["How does it detect recurring charges?","Normalization groups names, then similar amounts at regular intervals (weekly/monthly/yearly ±20%)."],["Where are reminders stored?","LocalStorage only in this browser. Clear data wipes everything."],["Can I cancel from Subtrack?","We link to each service's official cancellation guide. We never log in or cancel for you."]].map(([q,a],i) => (
              <details key={i} className="group px-6"><summary className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4 font-semibold">{q} <span aria-hidden className="text-xl group-open:rotate-45 transition-transform">+</span></summary><p className="pb-5 text-sm leading-relaxed opacity-75">{a}</p></details>
            ))}
          </div>
        </section>
        <footer className="py-10 text-center text-sm opacity-60"><p className="font-display font-bold text-base text-current">Subtrack</p><p className="mt-1">Private subscription tracker. Built for the browser.</p></footer>
      </main>
    </div>
  );
}
