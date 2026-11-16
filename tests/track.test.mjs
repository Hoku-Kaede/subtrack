import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV, detectRecurring, normalizeMerchant, addFrequency, categorize } from "../src/lib/track.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = fs.readFileSync(path.join(__dirname, "mock_bank_statement.csv"), "utf8");
const NOW = new Date("2026-11-09T12:00:00Z");

test("normalizeMerchant maps bank descriptors to clean brands", () => {
  assert.equal(normalizeMerchant("NETFLIX.COM 866-579-7172"), "Netflix");
  assert.equal(normalizeMerchant("NYTIMES DIGITAL SUB"), "NYTimes Digital");
  assert.equal(normalizeMerchant("DROPBOX*PLUS"), "Dropbox");
  assert.equal(normalizeMerchant("HEADSPACE INC"), "Headspace");
  assert.equal(normalizeMerchant("SPOTIFY P2F81A9C"), "Spotify");
  assert.equal(normalizeMerchant("AMZN PRIME*2K4RT0Q"), "Amazon Prime");
  assert.equal(normalizeMerchant("APPLE.COM/BILL ICLOUD"), "iCloud");
  assert.equal(normalizeMerchant("ADOBE *CREATIVE CLOUD"), "Adobe Creative Cloud");
  assert.equal(normalizeMerchant("TRADER JOES #214"), "Trader Joe's");
});

test("mock bank statement: 10 subscriptions, ~$227/mo, 4 bills, no past renewals", () => {
  const txs = parseCSV(CSV);
  assert.equal(txs.length, 285);
  const all = detectRecurring(txs, NOW);
  const bills = all.filter(s => s.isBill);
  const subs = all.filter(s => !s.isBill);

  assert.equal(subs.length, 10, `expected 10 subs got ${subs.length}: ${subs.map(s => s.merchant).join(", ")}`);
  assert.equal(bills.length, 4, `expected 4 bills got ${bills.length}: ${bills.map(s => s.merchant).join(", ")}`);

  const monthly = subs.reduce((a, s) => a + s.monthly, 0);
  assert.ok(Math.abs(monthly - 227.37) < 5, `monthly ${monthly.toFixed(2)} ~227`);
  assert.ok(monthly * 12 > 2600 && monthly * 12 < 2900, `yearly ${(monthly*12).toFixed(0)} ~2700`);

  // everyday spending must NOT be detected
  const banned = ["Trader Joe's", "Starbucks Store", "Domino", "Uber", "Amazon.com", "Shell", "Chipotle", "Target", "Whole Foods", "Local Brewery"];
  for (const b of banned) {
    assert.ok(!subs.some(s => s.merchant.toLowerCase().includes(b.toLowerCase().replace("'",""))), `${b} should not be a subscription`);
  }

  // Netflix hike 15.49 -> 17.99 flagged with old/new
  const nf = subs.find(s => s.merchant === "Netflix");
  assert.ok(nf?.forgotten, "Netflix forgotten");
  assert.ok(nf?.prevAmount && Math.abs(nf.prevAmount - 15.49) < 0.01, `Netflix prev ${nf?.prevAmount}`);
  assert.equal(nf?.amount, 17.99);
  assert.match(nf?.forgottenReason ?? "", /15\.49.*17\.99/);

  // Dropbox + Headspace flagged as small forgotten
  const db = subs.find(s => s.merchant === "Dropbox");
  const hs = subs.find(s => s.merchant === "Headspace");
  assert.ok(db?.forgotten && hs?.forgotten, "Dropbox + Headspace forgotten");

  // Bills excluded from totals + not flagged forgotten
  assert.ok(bills.every(b => b.merchant.match(/Rent|Fibernet|Verizon|City Power/i)));
  assert.ok(bills.every(b => !b.forgotten));
  // Bill names title-cased
  assert.ok(bills.some(b => b.merchant === "Fibernet Internet"), "Fibernet title-case");
  assert.ok(bills.some(b => b.merchant === "Verizon Wireless"), "Verizon title-case");

  // Calendar renewals: same day-of-month, not +30/31 days
  const byName = Object.fromEntries(all.map(s => [s.merchant, s]));
  assert.equal(byName["Netflix"].nextDate.toISOString().slice(0, 10), "2026-12-03");
  assert.equal(byName["PureFit Gym"].nextDate.toISOString().slice(0, 10), "2026-12-01");
  assert.equal(byName["NYTimes Digital"].nextDate.toISOString().slice(0, 10), "2026-12-05");
  assert.equal(byName["Spotify"].nextDate.toISOString().slice(0, 10), "2026-12-08");
  assert.equal(byName["Rent (Sunrise Apartments)"].nextDate.toISOString().slice(0, 10), "2026-12-02");
  assert.equal(byName["SplashZone Car Wash"].nextDate.toISOString().slice(0, 10), "2026-11-14");

  // Next renewals all in future
  for (const s of all) assert.ok(s.nextDate > NOW, `${s.merchant} next ${s.nextDate} in past`);

  // Price-hike vs forgotten badges separate
  assert.ok(byName["Netflix"].isPriceHike && !byName["Netflix"].isForgotten, "Netflix hike only");
  assert.ok(byName["Dropbox"].isForgotten && !byName["Dropbox"].isPriceHike, "Dropbox forgotten only");

  // Services category
  assert.equal(byName["SplashZone Car Wash"].category, "Services");
});

test("addFrequency calendar month-end clamp", () => {
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  assert.equal(fmt(addFrequency(new Date(2026, 0, 31), "monthly", 30)), "2026-02-28");
  assert.equal(fmt(addFrequency(new Date(2026, 0, 31), "yearly", 365)), "2027-01-31");
  assert.equal(fmt(addFrequency(new Date(2024, 1, 29), "yearly", 365)), "2025-02-28");
});
