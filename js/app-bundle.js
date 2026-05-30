"use strict";

const CONFIG = {
  REFERENCE_DATE: '2026-03-22',
  API_URL: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
  API_MODEL: 'glm-4.7',
  DEFAULT_WITHDRAWAL_RATE: 0.047,
};

// Data store
let snapshots = [];
let currentSnapshot = null;

// Reference date — load from localStorage or fall back to CONFIG default
const REF_DATE_LS_KEY = 'portfolioTracker_referenceDate';
function loadReferenceDate() {
  try {
    const raw = localStorage.getItem(REF_DATE_LS_KEY);
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
  } catch (e) { /* ignore */ }
  return new Date(CONFIG.REFERENCE_DATE);
}
function saveReferenceDate(date) {
  try {
    localStorage.setItem(REF_DATE_LS_KEY, date.toISOString().slice(0, 10));
  } catch (e) { /* ignore */ }
}
let referenceDate = loadReferenceDate();
let distributionChart = null;
let brokerageChart = null;
let evolutionChart = null;
let categoryEvolutionChart = null;
let bucketEvolutionChart = null;
let bucket1HoldingsChart = null;
let bucket2HoldingsChart = null;
let bucket3HoldingsChart = null;
let momentumEvolutionChart = null;
let avanzaRebalanceChart = null;
let nordnetRebalanceChart = null;

// Configuration
const BUCKETS = {
    1: { name: 'Cash/Short', class: 'badge-bucket-1' },
    2: { name: 'Fixed Income/Commodities', class: 'badge-bucket-2' },
    3: { name: 'Equity', class: 'badge-bucket-3' },
    0: { name: 'Sell/Other', class: 'badge-sell' }
};

const DEFAULT_CATEGORIES = [
    'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy', 'Financials', 'Health Care', 'Industrials', 'Information Technology', 'Materials', 'Real Estate', 'Utilities', 'Global Index', 'Sweden Index',
    'Credit', 'Long Term Bond', 'Mix Term Bond',
    'Precious Metals', 'Base Metals', 'Energy', 'Agriculture', 'Livestock',
    'Cash', 'Corporate / Credit', 'Short Duration', 'Other', 'Unassigned'
];

let CATEGORIES = [...DEFAULT_CATEGORIES];

function updateCategories() {
  const holdingsCategories = snapshots.flatMap(s => s.holdings.map(h => h.category).filter(Boolean));
  const refCategories = [
    ...classificationReference.avanza.map(r => r.category).filter(Boolean),
    ...classificationReference.nordnet.map(r => r.category).filter(Boolean)
  ];
  const all = [...new Set([...DEFAULT_CATEGORIES, ...holdingsCategories, ...refCategories])].sort();
  // Keep 'Unassigned' at the end
  if (all.includes('Unassigned')) {
    const idx = all.indexOf('Unassigned');
    all.splice(idx, 1);
    all.push('Unassigned');
  }
  CATEGORIES = all;
}

// Classification Reference Table (Editable)
const DEFAULT_REFERENCE = {
  avanza: [
    { name: 'AMF Företagsobligationsfond', category: 'Corporate / Credit', bucket: 2 },
    { name: 'AMF Räntefond Kort', category: 'Short Duration', bucket: 1 },
    { name: 'Avanza Ränta Kort', category: 'Short Duration', bucket: 1 },
    { name: 'SEB FRN Fond A', category: 'Short Duration', bucket: 1 },
    { name: 'Avanza Zero', category: 'Sweden Index', bucket: 3 },
    { name: 'Pareto Räntefond A', category: 'Short Duration', bucket: 1 },
    { name: 'AMF Räntefond Mix', category: 'Corporate / Credit', bucket: 2 },
    { name: 'Range Resources', category: 'Energy', bucket: 3 },
    { name: 'Avanza Global', category: 'Global Index', bucket: 3 },
    { name: 'Newmont', category: 'Materials', bucket: 3 }
  ],
  nordnet: [
    { name: 'AMF Företagsobligationsfond', category: 'Corporate / Credit', bucket: 2 },
    { name: 'AMF Räntefond Kort', category: 'Short Duration', bucket: 1 },
    { name: 'SEB FRN Fond A', category: 'Short Duration', bucket: 1 },
    { name: 'Spiltan Räntefond Sverige', category: 'Short Duration', bucket: 1 },
    { name: 'Pareto Räntefond A', category: 'Short Duration', bucket: 1 },
    { name: 'Nordnet Sverige Index', category: 'Sweden Index', bucket: 3 },
    { name: 'Cash', category: 'Cash', bucket: 1 },
    { name: 'Nordea Global Passive A Acc SEK', category: 'Global Index', bucket: 3 }
  ]
};

let classificationReference = {
  avanza: [],
  nordnet: []
};

// Excluded assets tracking (assetName|brokerage format)
let excludedAssets = new Set();
const EXCLUDED_LS_KEY = 'portfolioTracker_excludedAssets';

function loadExcludedAssets() {
  try {
    const raw = localStorage.getItem(EXCLUDED_LS_KEY);
    if (raw) {
      excludedAssets = new Set(JSON.parse(raw));
    }
  } catch (e) { console.warn('Failed to load excluded assets:', e); }
}

function saveExcludedAssets() {
  try {
    localStorage.setItem(EXCLUDED_LS_KEY, JSON.stringify([...excludedAssets]));
  } catch (e) { console.warn('Failed to save excluded assets:', e); }
}

function getAssetKey(name, brokerage) {
  return `${name}|${brokerage}`;
}

function isAssetExcluded(name, brokerage) {
  return excludedAssets.has(getAssetKey(name, brokerage));
}

function toggleAssetExclusion(name, brokerage) {
  const key = getAssetKey(name, brokerage);
  if (excludedAssets.has(key)) {
    excludedAssets.delete(key);
  } else {
    excludedAssets.add(key);
  }
  saveExcludedAssets();
}

function getFilteredHoldings(snapshot) {
  if (!snapshot) return [];
  return snapshot.holdings.filter(h => !isAssetExcluded(h.name, h.brokerage));
}

function calculateFilteredTotals(snapshot) {
  const filtered = getFilteredHoldings(snapshot);
  const totalValue = filtered.reduce((sum, h) => sum + h.value, 0);
  const nordnetValue = filtered.filter(h => h.brokerage === 'Nordnet').reduce((sum, h) => sum + h.value, 0);
  const avanzaValue = filtered.filter(h => h.brokerage === 'Avanza').reduce((sum, h) => sum + h.value, 0);
  return { totalValue, nordnetValue, avanzaValue, holdingsCount: filtered.length };
}

// --- UTILITY ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Hook system — allows sections to subscribe to lifecycle events
// without monkey-patching global functions
const hooks = {
  afterSwitchTab: [],
  afterShowDashboard: [],
  afterSetupEventListeners: [],
  beforeFindBucketForName: [],  // subscribers can return a bucket override
  beforeIsInSchedule: []         // subscribers can return a schedule override
};
function registerHook(name, fn) {
  if (hooks[name]) hooks[name].push(fn);
}
"use strict";


// --- CARRY-FORWARD LOGIC ---
// When a snapshot is missing data for a broker, carry forward the most recent
// previous snapshot's data for that broker.

function getSnapshotBrokerInfo(snapshot) {
  const hasAvanza = snapshot.avanzaValue > 0 && snapshot.holdings.some(h => h.brokerage === 'Avanza');
  const hasNordnet = snapshot.nordnetValue > 0 && snapshot.holdings.some(h => h.brokerage === 'Nordnet');
  return { hasAvanza, hasNordnet };
}

function getEffectiveSnapshot(snapshot) {
  if (!snapshot) return null;
  const { hasAvanza, hasNordnet } = getSnapshotBrokerInfo(snapshot);

  // If both brokers are present, no carry-forward needed
  if (hasAvanza && hasNordnet) return snapshot;

  // Find the snapshot's index to search backwards
  const snapIdx = snapshots.indexOf(snapshot);

  // Clone the snapshot to avoid mutating original
  const effective = {
    date: snapshot.date,
    dateStr: snapshot.dateStr,
    holdings: [...snapshot.holdings.map(h => ({ ...h }))],
    totalValue: snapshot.totalValue,
    nordnetValue: snapshot.nordnetValue,
    avanzaValue: snapshot.avanzaValue,
    _carriedForward: {} // track which brokers were carried forward
  };

  // Search backwards for missing broker data
  if (!hasAvanza && snapIdx > 0) {
    for (let i = snapIdx - 1; i >= 0; i--) {
      const prev = snapshots[i];
      if (prev.avanzaValue > 0 && prev.holdings.some(h => h.brokerage === 'Avanza')) {
        // Carry forward Avanza holdings
        const avanzaHoldings = prev.holdings
          .filter(h => h.brokerage === 'Avanza')
          .map(h => ({ ...h, carriedForward: true, carriedFromDate: prev.dateStr }));
        effective.holdings = effective.holdings.concat(avanzaHoldings);
        effective.avanzaValue = prev.avanzaValue;
        effective._carriedForward.avanza = prev.dateStr;
        break;
      }
    }
  }

  if (!hasNordnet && snapIdx > 0) {
    for (let i = snapIdx - 1; i >= 0; i--) {
      const prev = snapshots[i];
      if (prev.nordnetValue > 0 && prev.holdings.some(h => h.brokerage === 'Nordnet')) {
        // Carry forward Nordnet holdings
        const nordnetHoldings = prev.holdings
          .filter(h => h.brokerage === 'Nordnet')
          .map(h => ({ ...h, carriedForward: true, carriedFromDate: prev.dateStr }));
        effective.holdings = effective.holdings.concat(nordnetHoldings);
        effective.nordnetValue = prev.nordnetValue;
        effective._carriedForward.nordnet = prev.dateStr;
        break;
      }
    }
  }

  // Recalculate total
  effective.totalValue = effective.avanzaValue + effective.nordnetValue;

  // Recalculate percentages
  if (effective.totalValue > 0) {
    effective.holdings.forEach(h => {
      h.percentage = (h.value / effective.totalValue) * 100;
    });
  }

  // Sort holdings by value descending
  effective.holdings.sort((a, b) => b.value - a.value);

  return effective;
}

// Get effective snapshots for ALL snapshots (for charts)
function getAllEffectiveSnapshots() {
  return snapshots.map(s => getEffectiveSnapshot(s));
}

// Category rules for assets not in reference
"use strict";


const categoryRules = {
  'Corporate / Credit': 2,
  'Short Duration': 1,
  'Sweden Index': 3,
  'Global Index': 3,
  'Cash': 1,
  'Energy': 3,
  'Materials': 3,
  'Other': 0,
  'Unassigned': 0
};

// Rebalancing configuration
// Final target % for each asset (M10). Current % is computed dynamically from portfolio data.
// M1-M10 schedule is interpolated between current% and target%, following bucket-level targets.
const DEFAULT_REBALANCING_TARGETS = {
  avanza: [
    { bucket: 3, name: 'Range Resources', target: 0 },
    { bucket: 3, name: 'Newmont', target: 0 },
    { bucket: 1, name: 'AMF Räntefond Kort', target: 0 },
    { bucket: 1, name: 'Avanza Ränta Kort', target: 15 },
    { bucket: 1, name: 'SEB FRN Fond A', target: 0 },
    { bucket: 1, name: 'Pareto Räntefond A', target: 0 },
    { bucket: 2, name: 'AMF Företagsobligationsfond', target: 20 },
    { bucket: 2, name: 'AMF Räntefond Mix', target: 5 },
    { bucket: 3, name: 'Avanza Global', target: 48 },
    { bucket: 3, name: 'Avanza Zero', target: 12 }
  ],
  nordnet: [
    { bucket: 1, name: 'AMF Räntefond Kort', target: 0 },
    { bucket: 1, name: 'Spiltan Räntefond Sverige', target: 10 },
    { bucket: 1, name: 'Cash', target: 5 },
    { bucket: 2, name: 'Pareto Räntefond A', target: 12.5 },
    { bucket: 2, name: 'SEB FRN Fond A', target: 12.5 },
    { bucket: 2, name: 'AMF Företagsobligationsfond', target: 0 },
    { bucket: 3, name: 'Nordea Global Passive A Acc SEK', target: 48 },
    { bucket: 3, name: 'Nordnet Sverige Index', target: 12 }
  ]
};

let rebalancingTargets = JSON.parse(JSON.stringify(DEFAULT_REBALANCING_TARGETS));

const REBALANCING_TARGETS_LS_KEY = 'portfolioTracker_rebalancingTargets';

function loadRebalancingTargets() {
  try {
    const raw = localStorage.getItem(REBALANCING_TARGETS_LS_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      if (loaded.avanza && loaded.nordnet) {
        rebalancingTargets = loaded;
      }
    }
  } catch (e) { console.warn('Failed to load rebalancing targets:', e); }
}

function saveRebalancingTargets() {
  try {
    localStorage.setItem(REBALANCING_TARGETS_LS_KEY, JSON.stringify(rebalancingTargets));
  } catch (e) { console.warn('Failed to save rebalancing targets:', e); }
}

// Rebalancing duration configuration (10-36 months)
const REBALANCING_DURATION_LS_KEY = 'portfolioTracker_rebalancingDuration';
const REBALANCING_MONTH_LS_KEY = 'portfolioTracker_rebalancingCurrentMonth';
let REBALANCING_MONTHS = 10;
let currentRebalancingMonth = 1;

function loadRebalancingDuration() {
  try {
    const raw = localStorage.getItem(REBALANCING_DURATION_LS_KEY);
    if (raw) {
      const val = parseInt(raw);
      if (val >= 10 && val <= 36) { REBALANCING_MONTHS = val; return; }
    }
  } catch (e) { console.warn('Failed to load rebalancing duration:', e); }
  REBALANCING_MONTHS = 10;
}

function loadRebalancingMonth() {
  try {
    const raw = localStorage.getItem(REBALANCING_MONTH_LS_KEY);
    if (raw) {
      const val = parseInt(raw);
      if (val >= 1 && val <= REBALANCING_MONTHS) { currentRebalancingMonth = val; return; }
    }
  } catch (e) { console.warn('Failed to load rebalancing month:', e); }
  currentRebalancingMonth = 1;
}

function saveRebalancingMonth() {
  try {
    localStorage.setItem(REBALANCING_MONTH_LS_KEY, String(currentRebalancingMonth));
  } catch (e) { console.warn('Failed to save rebalancing month:', e); }
}

function updateMonthSelector() {
  const sel = document.getElementById('rebalancingMonthSelect');
  if (!sel) return;
  const prev = currentRebalancingMonth;
  sel.innerHTML = '';
  for (let m = 1; m <= REBALANCING_MONTHS; m++) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = getMonthLabel(m);
    sel.appendChild(opt);
  }
  currentRebalancingMonth = Math.min(prev, REBALANCING_MONTHS);
  sel.value = currentRebalancingMonth;
}

// Returns real calendar month label for a rebalancing month index (1-based)
// Month 1 = end of March 2026 (the reference date's month)
function getMonthLabel(monthIndex) {
  const refMonth = 2; // March = index 2 (0-based)
  const refYear = 2026;
  const date = new Date(refYear, refMonth + monthIndex - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); // e.g. "Mar 2026"
}

function getMonthShortLabel(monthIndex) {
  const refMonth = 2; // March = index 2 (0-based)
  const refYear = 2026;
  const date = new Date(refYear, refMonth + monthIndex - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short' }); // e.g. "Mar"
}

function onMonthChange() {
  const sel = document.getElementById('rebalancingMonthSelect');
  if (!sel) return;
  currentRebalancingMonth = parseInt(sel.value) || 1;
  saveRebalancingMonth();
  renderRebalancingTables();
}

function saveRebalancingDuration() {
  try {
    localStorage.setItem(REBALANCING_DURATION_LS_KEY, String(REBALANCING_MONTHS));
  } catch (e) { console.warn('Failed to save rebalancing duration:', e); }
}

// Base bucket-level target percentages per month for first 10 months (M1-M10)
const baseBucketTargets = {
  0: [1.1, 1.0, 0.9, 0.8, 0.7, 0.5, 0.3, 0.2, 0.1, 0.0],
  1: [49.3, 45.5, 41.7, 37.9, 34.1, 30.3, 26.5, 22.7, 18.8, 15.0],
  2: [38.8, 37.3, 35.7, 34.2, 32.7, 31.1, 29.6, 28.1, 26.5, 25.0],
  3: [10.8, 16.2, 21.7, 27.1, 32.5, 38.1, 43.6, 49.0, 54.6, 60.0]
};

// Generate bucket targets for configured duration (rescale 10-month base schedule)
function getBucketTargets(months) {
  const m = months || REBALANCING_MONTHS;
  const result = {};
  for (const bucket of [0, 1, 2, 3]) {
    result[bucket] = [];
    const base = baseBucketTargets[bucket];
    for (let i = 0; i < m; i++) {
      // Map month i (0..m-1) to fractional position in the 10-month base schedule (0..9)
      const pos = (i / Math.max(m - 1, 1)) * 9;
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, 9);
      const frac = pos - lo;
      const interpolated = base[lo] + (base[hi] - base[lo]) * frac;
      result[bucket].push(Math.round(interpolated * 10) / 10);
    }
  }
  return result;
}

// Backward compatibility: build rebalancingSchedule dynamically
const rebalancingSchedule = { avanza: [], nordnet: [] };

function roundTo1(v) { return Math.round(v * 10) / 10; }

function onDurationChange() {
  const val = parseInt(document.getElementById('rebalancingDurationInput').value);
  if (val >= 10 && val <= 36) {
    REBALANCING_MONTHS = val;
    saveRebalancingDuration();
    updateMonthSelector();
    saveRebalancingMonth(); // Persist the (possibly clamped) month to localStorage
    refreshRebalancingSchedule();
    renderRebalancingTables();
    // Update header text
    const headerEl = document.getElementById('rebalancingScheduleHeader');
    if (headerEl) headerEl.textContent = REBALANCING_MONTHS + '-Month Rebalancing Schedule';
  }
}

// Smart asset name matching that handles prefix differences (AMF vs Avanza etc.)
function namesMatch(name1, name2) {
  if (!name1 || !name2) return false;
  // Exact match
  if (name1 === name2) return true;
  // Original includes check
  if (name1.includes(name2) || name2.includes(name1)) return true;

  // Strip common fund company prefixes for comparison
  const prefixes = ['AMF', 'Avanza', 'SEB', 'Nordnet', 'Spiltan', 'Pareto', 'Nordea'];
  const strip = (n) => {
    for (const p of prefixes) {
      if (n.startsWith(p + ' ')) return n.substring(p.length + 1).trim();
    }
    return n;
  };
  const s1 = strip(name1);
  const s2 = strip(name2);
  if (s1 === s2) return true;
  if (s1.includes(s2) || s2.includes(s1)) return true;

  return false;
}

function computeDynamicSchedule(broker) {
  const targets = rebalancingTargets[broker];
  if (!targets || !currentSnapshot) return [];

  const effective = getEffectiveSnapshot(currentSnapshot);
  const schedFt = calculateFilteredTotals(effective);
  const totalBrokerValue = broker === 'nordnet' ? schedFt.nordnetValue : schedFt.avanzaValue;
  const brokerHoldings = getFilteredHoldings(effective).filter(h => h.brokerage.toLowerCase() === broker);

  // Calculate current % for each scheduled asset
  const assetCurrents = {};
  targets.forEach(t => { assetCurrents[t.name] = 0; });
  brokerHoldings.forEach(h => {
    const match = targets.find(t => namesMatch(t.name, h.name));
    if (match) assetCurrents[match.name] += (h.value / totalBrokerValue) * 100;
  });

  // Group by bucket
  const buckets = {};
  targets.forEach(t => {
    if (!buckets[t.bucket]) buckets[t.bucket] = [];
    buckets[t.bucket].push({ name: t.name, current: assetCurrents[t.name] || 0, target: t.target });
  });

  const numMonths = REBALANCING_MONTHS;
  const bTargets = getBucketTargets(numMonths);

  // Compute schedule for each asset
  const result = [];
  for (const [bk, items] of Object.entries(buckets)) {
    const b = parseInt(bk);
    const bucketMonthlyTargets = bTargets[b];
    const totalCurrent = items.reduce((s, i) => s + i.current, 0);
    const totalTarget = items.reduce((s, i) => s + i.target, 0);

    items.forEach(item => {
      const schedule = [];
      for (let m = 0; m < numMonths; m++) {
        const bt = bucketMonthlyTargets[m];
        const fCurrent = totalCurrent > 0 ? item.current / totalCurrent : (totalTarget > 0 ? item.target / totalTarget : 1 / items.length);
        const fTarget = totalTarget > 0 ? item.target / totalTarget : fCurrent;
        const frac = fCurrent + (fTarget - fCurrent) * (m / (numMonths - 1));
        schedule.push(bt * frac);
      }
      result.push({ bucket: b, name: item.name, schedule: schedule.map(roundTo1) });
    });
  }

  // Adjust rounding so each column sums to exactly 100.0
  for (let m = 0; m < numMonths; m++) {
    let sum = result.reduce((s, x) => s + x.schedule[m], 0);
    sum = roundTo1(sum);
    if (sum !== 100.0) {
      const diff = roundTo1(100.0 - sum);
      let maxI = 0, maxV = 0;
      result.forEach((x, i) => { if (x.schedule[m] > maxV) { maxV = x.schedule[m]; maxI = i; } });
      result[maxI].schedule[m] = roundTo1(result[maxI].schedule[m] + diff);
    }
  }

  return result;
}

function refreshRebalancingSchedule() {
  rebalancingSchedule.avanza = computeDynamicSchedule('avanza');
  rebalancingSchedule.nordnet = computeDynamicSchedule('nordnet');
}

// --- TARGETS CONFIG UI ---

function renderTargetsConfig() {
  const container = document.getElementById('targetsConfigContent');
  if (!container) return;

  const renderBrokerSection = (broker, label, assets) => {
    // Calculate bucket sums
    const bucketSums = { 0: 0, 1: 0, 2: 0, 3: 0 };
    assets.forEach(a => { bucketSums[a.bucket] += a.target; });
    const totalSum = assets.reduce((s, a) => s + a.target, 0);

    const rows = assets.map((asset, index) => {
      const bucketColor = BUCKETS[asset.bucket]?.class || 'badge-other';
      return `
        <div class="flex items-center gap-3 py-2 border-b border-[var(--border-subtle)]">
          <span class="badge ${bucketColor} text-xs w-8 justify-center">B${asset.bucket}</span>
          <span class="flex-1 text-sm truncate" title="${asset.name}">${asset.name}</span>
          <div class="flex items-center gap-1">
            <input type="number" id="target_${broker}_${index}" value="${asset.target}" min="0" max="100" step="0.5"
              class="w-20 bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-2 py-1 text-sm text-right font-mono focus:border-[var(--accent-primary)] outline-none"
              oninput="updateTargetFromUI('${broker}', ${index}, this.value)">
            <span class="text-xs text-[var(--fg-muted)]">%</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="bg-[var(--bg-secondary)] rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-semibold text-cyan-400">${label}</h4>
          <div class="text-right">
            <span class="text-xs text-[var(--fg-muted)]">Total: </span>
            <span id="targetSum_${broker}" class="text-sm font-mono font-bold ${Math.abs(totalSum - 100) < 0.1 ? 'text-emerald-400' : 'text-red-400'}">${totalSum.toFixed(1)}%</span>
          </div>
        </div>
        <div class="grid grid-cols-[32px_1fr_80px] gap-1 items-center py-1 border-b border-[var(--border)] text-xs text-[var(--fg-muted)] uppercase font-semibold mb-1">
          <div>Bucket</div><div>Asset</div><div class="text-right">Target</div>
        </div>
        ${rows}
        <div class="mt-3 pt-2 border-t border-[var(--border)]">
          <div class="grid grid-cols-2 gap-2 text-xs">
            ${Object.entries(bucketSums).filter(([k,v]) => v > 0).map(([k,v]) => {
              const info = BUCKETS[k];
              return `<div class="flex items-center gap-2"><span class="badge ${info.class} text-xs">B${k}</span><span class="font-mono">${v.toFixed(1)}%</span></div>`;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  };

  container.innerHTML =
    renderBrokerSection('avanza', 'Avanza', rebalancingTargets.avanza) +
    renderBrokerSection('nordnet', 'Nordnet', rebalancingTargets.nordnet);
}

function updateTargetFromUI(broker, index, value) {
  rebalancingTargets[broker][index].target = parseFloat(value) || 0;
  // Update sum display
  const totalSum = rebalancingTargets[broker].reduce((s, a) => s + a.target, 0);
  const sumEl = document.getElementById(`targetSum_${broker}`);
  if (sumEl) {
    sumEl.textContent = totalSum.toFixed(1) + '%';
    sumEl.className = `text-sm font-mono font-bold ${Math.abs(totalSum - 100) < 0.1 ? 'text-emerald-400' : 'text-red-400'}`;
  }
  // Dynamically refresh the rebalancing schedule tables and bucket summary
  refreshRebalancingSchedule();
  renderRebalanceTablesOnly();
  renderBucketSummaryCards();
  renderConsolidatedBucketTable();
}

function renderRebalanceTablesOnly() {
  const avanzaBody = document.getElementById('avanzaRebalanceTable');
  const nordnetBody = document.getElementById('nordnetRebalanceTable');
  renderRebalanceTable(avanzaBody, 'Avanza', rebalancingSchedule.avanza);
  renderRebalanceTable(nordnetBody, 'Nordnet', rebalancingSchedule.nordnet);
}

function saveTargetsFromUI() {
  // Validate sums
  for (const broker of ['avanza', 'nordnet']) {
    const total = rebalancingTargets[broker].reduce((s, a) => s + a.target, 0);
    if (Math.abs(total - 100) > 0.5) {
      if (!confirm(`${broker.charAt(0).toUpperCase() + broker.slice(1)} targets sum to ${total.toFixed(1)}%, not 100%. Save anyway?`)) {
        return;
      }
    }
  }
  saveRebalancingTargets();
  renderRebalancingTables();
}

function resetTargetsToDefaults() {
  if (confirm('Reset all rebalancing targets to defaults? This will also reset the reference table. This cannot be undone.')) {
    classificationReference = JSON.parse(JSON.stringify(DEFAULT_REFERENCE));
    rebalancingTargets = JSON.parse(JSON.stringify(DEFAULT_REBALANCING_TARGETS));
    try {
      localStorage.setItem('portfolioTracker_reference', JSON.stringify(classificationReference));
    } catch(e) {}
    saveRebalancingTargets();
    renderRebalancingTables();
  }
}

function updateScheduleTableHeaders() {
  // Build schedule table headers dynamically with real month names
  ['avanzaRebalanceThead', 'nordnetRebalanceThead'].forEach(theadId => {
    const thead = document.getElementById(theadId);
    if (!thead) return;
    
    let html = '<tr>';
    html += '<th>Asset Name</th>';
    html += '<th class="text-right">Current</th>';
    // Build all month columns, highlighting selected month and final month
    for (let m = 1; m <= REBALANCING_MONTHS; m++) {
      const isSelected = (m === currentRebalancingMonth);
      const isFinal = (m === REBALANCING_MONTHS);
      const isHL = isSelected || isFinal;
      const label = (m === currentRebalancingMonth) 
        ? `${getMonthShortLabel(m)} <span class="target-badge">Target</span>` 
        : `${getMonthShortLabel(m)}${isFinal ? ' <span class="target-badge">Target</span>' : ''}`;
      html += `<th class="text-right ${isHL ? 'highlight-col' : ''}">${label}</th>`;
    }
    html += '</tr>';
    thead.innerHTML = html;
  });
}
"use strict";


// --- END TARGETS CONFIG UI ---

const categoryColors = {
  'Corporate / Credit': { bg: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee', chart: 'rgba(6, 182, 212, 0.8)' },
  'Short Duration': { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', chart: 'rgba(16, 185, 129, 0.8)' },
  'Sweden Index': { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', chart: 'rgba(245, 158, 11, 0.8)' },
  'Global Index': { bg: 'rgba(99, 102, 241, 0.15)', text: '#818cf8', chart: 'rgba(99, 102, 241, 0.8)' },
  'Cash': { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8', chart: 'rgba(148, 163, 184, 0.8)' },
  'Energy': { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', chart: 'rgba(239, 68, 68, 0.8)' },
  'Materials': { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', chart: 'rgba(168, 85, 247, 0.8)' },
  'Other': { bg: 'rgba(148, 163, 184, 0.1)', text: '#94a3b8', chart: 'rgba(148, 163, 184, 0.5)' },
  'Unassigned': { bg: 'rgba(239, 68, 68, 0.15)', text: '#fca5a5', chart: 'rgba(239, 68, 68, 0.5)' }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkUrlParams();
});

function setupEventListeners() {
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');


  fileInput.addEventListener('change', handleFileSelect);
  
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  document.getElementById('brokerageFilter').addEventListener('change', renderHoldingsTable);
  document.getElementById('categoryFilter').addEventListener('change', renderHoldingsTable);
  
  // Setup return target calculator listeners
  setupReturnTargetCalculatorListeners();
  // Notify hook subscribers
  hooks.afterSetupEventListeners.forEach(fn => fn());
}

function checkUrlParams() {
  if (window.location.search.includes('demo')) loadDemoData();
}

// --- Import / Export Logic ---

function downloadTemplate() {
    const csvContent = `Date;Asset Name;Brokerage;Category;Value;Percentage;Total;Nordnet Value;Avanza Value
2026-03-22;AMF Företagsobligationsfond;Avanza;Corporate / Credit;4907776.25;23.51;20874792.50;0;13242075.39
2026-03-22;AMF Räntefond Kort;Avanza;Short Duration;3551980.95;17.02;20874792.50;0;13242075.39
2026-03-22;Avanza Ränta Kort;Avanza;Short Duration;2903968.27;13.91;20874792.50;0;13242075.39
2026-03-22;SEB FRN Fond A;Avanza;Short Duration;518874.34;2.49;20874792.50;0;13242075.39
2026-03-22;Avanza Zero;Avanza;Sweden Index;486490.07;2.33;20874792.50;0;13242075.39
2026-03-22;Avanza Global;Avanza;Global Index;111091.27;0.53;20874792.50;0;13242075.39
2026-03-22;Range Resources;Avanza;Energy;120483.68;0.58;20874792.50;0;13242075.39
2026-03-22;AMF Företagsobligationsfond;Nordnet;Corporate / Credit;1982381.25;9.50;20874792.50;7632717.11;0
2026-03-22;AMF Räntefond Kort;Nordnet;Short Duration;1541640.45;7.39;20874792.50;7632717.11;0
2026-03-22;Spiltan Räntefond Sverige;Nordnet;Short Duration;1213850.54;5.81;20874792.50;7632717.11;0
2026-03-22;Pareto Räntefond A;Nordnet;Short Duration;1002001.86;4.80;20874792.50;7632717.11;0
2026-03-22;SEB FRN Fond A;Nordnet;Short Duration;1534563.61;7.35;20874792.50;7632717.11;0
2026-03-22;Nordea Global Passive A Acc SEK;Nordnet;Global Index;59593.13;0.29;20874792.50;7632717.11;0
2026-03-22;Nordnet Sverige Index;Nordnet;Sweden Index;122526.16;0.59;20874792.50;7632717.11;0
2026-03-22;Cash;Nordnet;Cash;176160.11;0.84;20874792.50;7632717.11;0`;

    try {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'portfolio_tracker_template.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    } catch (err) {
        console.error('Template download failed:', err);
        alert('Failed to download template. Error: ' + err.message);
    }
}

function exportData() {
    if (snapshots.length === 0) {
        alert("No data to export.");
        return;
    }

    try {
        // Helpers to safely read localStorage JSON
        const readLS = (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch(e) { return null; } };
        const readLSRaw = (key) => { try { return localStorage.getItem(key) || null; } catch(e) { return null; } };

        // Bundle all site data (except API keys) into structured export
        const exportBundle = {
            version: 2,
            exportDate: new Date().toISOString(),
            snapshots: snapshots.map(s => ({
                date: s.date.toISOString(), dateStr: s.dateStr, holdings: s.holdings,
                totalValue: s.totalValue, nordnetValue: s.nordnetValue, avanzaValue: s.avanzaValue
            })),
            classificationReference: classificationReference,
            rebalancingTargets: rebalancingTargets,
            excludedAssets: [...excludedAssets],
            performanceData: performanceData,
            retirementData: retirementData,
            // --- New fields (v2) ---
            analyticsSnapshots: readLS('portfolioTracker_analyticsSnapshots'),
            momentumSnapshots: readLS('portfolioTracker_momentumSnapshots'),
            notes: readLS('portfolioTracker_notes'),
            performanceLinks: readLS('portfolioTracker_perfLinks'),
            perfLiveData: readLS('portfolioTracker_perfLiveData'),
            perfTracked: readLS('portfolioTracker_perfTracked'),
            aiAnalysis: readLS('portfolioTracker_aiAnalysis'),
            targetSettings: readLS('portfolioTracker_targetSettings'),
            referenceDate: readLSRaw('portfolioTracker_referenceDate'),
            rebalancingDuration: readLSRaw('portfolioTracker_rebalancingDuration'),
            rebalancingCurrentMonth: readLSRaw('portfolioTracker_rebalancingCurrentMonth')
        };

        // Clean out undefined/null values (don't export empty keys)
        Object.keys(exportBundle).forEach(k => {
            if (exportBundle[k] === null || exportBundle[k] === undefined) delete exportBundle[k];
        });

        const dataStr = JSON.stringify(exportBundle, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        // Create link
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        // Generate filename
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `portfolio_data_${dateStr}.json`;
        
        // Add to body (required for Firefox/Edge)
        document.body.appendChild(a);
        
        // Trigger download
        a.click();
        
        // Cleanup: Remove element after a short delay to ensure download starts
        setTimeout(() => {
            document.body.removeChild(a);
        }, 100);

    } catch (err) {
        console.error("Export failed", err);
        alert("Failed to export data. Error: " + err.message);
    }
}

function handleDataImport(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);

            // Helper to safely write localStorage (object or raw string)
            const writeLS = (key, value) => { try { if (value !== null && value !== undefined) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch(e) {} };
            const restoredItems = [];

            // Handle structured export format v2 or v1
            if (importedData && (importedData.version === 1 || importedData.version === 2) && importedData.snapshots) {
                const bundle = importedData;

                // Restore snapshots
                bundle.snapshots.forEach(snap => { snap.date = new Date(snap.date); snap.dateStr = formatDate(snap.date); });
                snapshots = bundle.snapshots;
                snapshots.sort((a, b) => a.date - b.date);
                currentSnapshot = snapshots[snapshots.length - 1];
                restoredItems.push('snapshots');

                // Restore classification reference
                if (bundle.classificationReference && bundle.classificationReference.avanza && bundle.classificationReference.nordnet) {
                    classificationReference = bundle.classificationReference;
                    try { localStorage.setItem('portfolioTracker_reference', JSON.stringify(classificationReference)); } catch(e) {}
                    restoredItems.push('reference table');
                }

                // Restore rebalancing targets
                if (bundle.rebalancingTargets && bundle.rebalancingTargets.avanza && bundle.rebalancingTargets.nordnet) {
                    rebalancingTargets = bundle.rebalancingTargets;
                    saveRebalancingTargets();
                    restoredItems.push('rebalancing targets');
                }

                // Restore excluded assets
                if (Array.isArray(bundle.excludedAssets)) {
                    excludedAssets = new Set(bundle.excludedAssets);
                    saveExcludedAssets();
                    restoredItems.push('excluded assets');
                }

                // Restore performance data
                if (bundle.performanceData && bundle.performanceData.assets) {
                    performanceData = bundle.performanceData;
                    savePerformanceData();
                    restoredItems.push('performance data');
                }

                // Restore retirement data
                if (bundle.retirementData) {
                    retirementData = bundle.retirementData;
                    saveRetirementData();
                    restoredItems.push('retirement data');
                }

                // --- v2 fields ---
                if (bundle.analyticsSnapshots) {
                    writeLS('portfolioTracker_analyticsSnapshots', bundle.analyticsSnapshots);
                    restoredItems.push('analytics snapshots');
                }
                if (bundle.momentumSnapshots) {
                    writeLS('portfolioTracker_momentumSnapshots', bundle.momentumSnapshots);
                    restoredItems.push('momentum snapshots');
                }
                if (bundle.notes) {
                    writeLS('portfolioTracker_notes', bundle.notes);
                    restoredItems.push('notes');
                }
                if (bundle.performanceLinks) {
                    writeLS('portfolioTracker_perfLinks', bundle.performanceLinks);
                    // Also update the global variable used by ai-holdings
                    try { performanceLinks = JSON.parse(JSON.stringify(bundle.performanceLinks)); } catch(e) {}
                    restoredItems.push('performance links');
                }
                if (bundle.perfLiveData) {
                    writeLS('portfolioTracker_perfLiveData', bundle.perfLiveData);
                    restoredItems.push('live prices');
                }
                if (bundle.perfTracked) {
                    writeLS('portfolioTracker_perfTracked', bundle.perfTracked);
                    restoredItems.push('tracked holdings');
                }
                if (bundle.aiAnalysis) {
                    writeLS('portfolioTracker_aiAnalysis', bundle.aiAnalysis);
                    restoredItems.push('AI analysis');
                }
                if (bundle.targetSettings) {
                    writeLS('portfolioTracker_targetSettings', bundle.targetSettings);
                    restoredItems.push('target settings');
                }
                if (bundle.referenceDate) {
                    writeLS('portfolioTracker_referenceDate', bundle.referenceDate);
                    restoredItems.push('reference date');
                }
                if (bundle.rebalancingDuration) {
                    writeLS('portfolioTracker_rebalancingDuration', bundle.rebalancingDuration);
                    restoredItems.push('rebalancing duration');
                }
                if (bundle.rebalancingCurrentMonth) {
                    writeLS('portfolioTracker_rebalancingCurrentMonth', bundle.rebalancingCurrentMonth);
                    restoredItems.push('rebalancing month');
                }

                showDashboard();
                // Re-render analytics snapshot history if on analytics tab
                if (typeof renderAnalyticsSnapshotHistory === 'function') {
                    setTimeout(() => renderAnalyticsSnapshotHistory(), 300);
                }
                // Re-render momentum evolution chart if function exists
                if (typeof renderMomentumEvolutionChart === 'function') {
                    setTimeout(() => renderMomentumEvolutionChart(), 400);
                }
                // Re-render live prices table if function exists
                if (typeof renderPerfLivePricesTable === 'function') {
                    setTimeout(() => renderPerfLivePricesTable(), 500);
                }
                // Reload notes into global variable
                if (typeof loadNotes === 'function') {
                    try { window._notesData = loadNotes(); } catch(e) {}
                }
                // Reload AI analysis into global variable  
                if (typeof loadAiAnalysis === 'function') {
                    try { loadAiAnalysis(); } catch(e) {}
                }
                alert(`Full data imported successfully!\n\nRestored: ${restoredItems.join(', ')}.`);

            // Handle legacy array format (backward compatible)
            } else if (Array.isArray(importedData)) {
                if (importedData[0].date && importedData[0].holdings) {
                    importedData.forEach(snap => { snap.date = new Date(snap.date); snap.dateStr = formatDate(snap.date); });
                    snapshots = importedData;
                    snapshots.sort((a, b) => a.date - b.date);
                    currentSnapshot = snapshots[snapshots.length - 1];
                    showDashboard();
                    alert("Snapshots imported successfully!\n\nNote: This was a legacy export file. Only snapshot data was restored.");
                } else { alert("Invalid JSON structure."); }
            } else { alert("Invalid JSON format. Expected a Portfolio Tracker export file."); }
        } catch (err) { console.error(err); alert("Failed to parse JSON file: " + err.message); }
    };
    reader.readAsText(file);
    input.value = '';
}

// --- End Import / Export ---

function handleFileSelect(e) {
  const files = e.target.files;
  // Don't clear input until processing is done
  handleFiles(files).finally(() => { e.target.value = ''; });
}

function datesAreEqual(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function consolidateBrokerData(newData) {
  // newData is a broker-specific snapshot (either Avanza or Nordnet only)
  // Find existing snapshot for the same date
  const existingIdx = snapshots.findIndex(s => datesAreEqual(s.date, newData.date));

  if (existingIdx === -1) {
    // No existing snapshot for this date — just add it
    snapshots.push(newData);
    return;
  }

  const existing = snapshots[existingIdx];

  // Determine which broker we're merging
  const isAvanzaUpload = newData.avanzaValue > 0 && newData.nordnetValue === 0;
  const isNordnetUpload = newData.nordnetValue > 0 && newData.avanzaValue === 0;

  if (isAvanzaUpload) {
    // Remove old Avanza holdings, keep Nordnet holdings
    existing.holdings = existing.holdings.filter(h => h.brokerage !== 'Avanza');
    // Add new Avanza holdings
    existing.holdings = existing.holdings.concat(newData.holdings.filter(h => h.brokerage === 'Avanza'));
    existing.avanzaValue = newData.avanzaValue;
  } else if (isNordnetUpload) {
    // Remove old Nordnet holdings, keep Avanza holdings
    existing.holdings = existing.holdings.filter(h => h.brokerage !== 'Nordnet');
    // Add new Nordnet holdings
    existing.holdings = existing.holdings.concat(newData.holdings.filter(h => h.brokerage === 'Nordnet'));
    existing.nordnetValue = newData.nordnetValue;
  } else {
    // Generic CSV with both — full replacement
    existing.holdings = newData.holdings;
    existing.avanzaValue = newData.avanzaValue;
    existing.nordnetValue = newData.nordnetValue;
  }

  // Recalculate total and percentages
  existing.totalValue = existing.avanzaValue + existing.nordnetValue;
  if (existing.totalValue > 0) {
    existing.holdings.forEach(h => {
      h.percentage = (h.value / existing.totalValue) * 100;
    });
  }
  existing.holdings.sort((a, b) => b.value - a.value);
}

function showLoadingOverlay(message) {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60';
    overlay.innerHTML = `<div class="card p-8 text-center max-w-sm mx-4"><div class="animate-spin w-12 h-12 border-4 border-[var(--accent-primary)] border-t-transparent rounded-full mx-auto mb-4"></div><p id="loadingMessage" class="text-sm text-[var(--fg-secondary)]">${message}</p></div>`;
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = '';
    document.getElementById('loadingMessage').textContent = message;
  }
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function handleFiles(files) {
  let filesProcessed = 0;
  const consolidationMessages = [];
  const fileArr = Array.from(files);
  const hasPdf = fileArr.some(f => f.name.toLowerCase().endsWith('.pdf'));
  
  if (hasPdf) {
    showLoadingOverlay('Extracting text from PDF...');
  }

  try {
  for (const file of fileArr) {
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv')) {
        const text = await file.text();
        if (text.includes('Kontonummer') && text.includes('Marknadsvärde')) {
          const data = parseAvanzaCSV(text, file.name);
          if (data) {
            const existingDate = snapshots.find(s => datesAreEqual(s.date, data.date));
            consolidateBrokerData(data);
            filesProcessed++;
            consolidationMessages.push(existingDate
              ? `Avanza data for ${data.dateStr} consolidated with existing snapshot`
              : `Avanza data for ${data.dateStr} added as new snapshot`);
          }
        } else {
          const data = parseCSV(text);
          if (data) { snapshots.push(data); filesProcessed++; }
        }
      } else if (name.endsWith('.pdf')) {
        const data = await parseNordnetPDF(file);
        if (data) {
          const existingDate = snapshots.find(s => datesAreEqual(s.date, data.date));
          consolidateBrokerData(data);
          filesProcessed++;
          consolidationMessages.push(existingDate
            ? `Nordnet data for ${data.dateStr} consolidated with existing snapshot`
            : `Nordnet data for ${data.dateStr} added as new snapshot`);
        }
      }
    } catch (err) { console.error("Error processing file:", err); alert('Error processing ' + file.name + ': ' + err.message); }
  }
  } finally {
    hideLoadingOverlay();
  }
  if (filesProcessed > 0) {
    snapshots.sort((a, b) => a.date - b.date);
    currentSnapshot = snapshots[snapshots.length - 1];
    showDashboard();
    // Show consolidation info
    if (consolidationMessages.length > 0) {
      alert(consolidationMessages.join('\n'));
    }
  }
}
"use strict";


// --- AVANZA CSV PARSER ---
function parseAvanzaCSV(text, filename) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  const snapshotDate = dateMatch ? parseDate(dateMatch[1]) : new Date();
  const assetTotals = {};
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(';');
    if (fields.length < 5) continue;
    const name = fields[1].trim();
    const marketValueStr = fields[4].trim().replace(/\s/g, '').replace(',', '.');
    const type = fields.length > 10 ? fields[10].trim() : '';
    if (!name || type === 'BOLAN' || !marketValueStr) continue;
    const value = parseFloat(marketValueStr) || 0;
    if (value <= 0) continue;
    if (assetTotals[name]) { assetTotals[name].value += value; }
    else { assetTotals[name] = { name, value }; }
  }
  const totalValue = Object.values(assetTotals).reduce((s, h) => s + h.value, 0);
  const holdings = Object.values(assetTotals).map(h => {
    const cls = getClassificationFromReference(h.name, 'Avanza');
    return { name: h.name, brokerage: 'Avanza', category: cls.found ? cls.category : 'Unassigned', value: h.value, percentage: (h.value / totalValue) * 100, bucket: cls.found ? cls.bucket : 0 };
  }).sort((a, b) => b.value - a.value);
  if (holdings.length === 0) return null;
  return { date: snapshotDate, dateStr: formatDate(snapshotDate), holdings, totalValue, nordnetValue: 0, avanzaValue: totalValue };
}

// --- NORDNET PDF PARSER (Percentage-based, no AI required) ---
function parseNordnetPDFText(text) {
  // Helper: Parse Swedish number format (space as thousands separator, comma as decimal)
  const parseSwedishNumber = (str) => {
    if (!str) return 0;
    return parseFloat(str.replace(/\s/g, '').replace(',', '.')) || 0;
  };

  // Extract date from document (format: YYYY-MM-DD)
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const snapshotDate = dateMatch ? parseDate(dateMatch[1]) : new Date();

  const assetTotals = {};
  let totalValue = 0;

  // Split text by account sections (marked by "Le Merle Yann" + account number)
  const accountSections = text.split(/Le Merle Yann\s+\d+\s*‧\s*Kontonr\s+\d+/);
  
  for (const section of accountSections) {
    if (!section || section.trim().length === 0) continue;
    
    // Extract total from this section (marked with "Totalt")
    const totalMatch = section.match(/Totalt([\d\s]+,\d{2})/);
    const sectionTotal = totalMatch ? parseSwedishNumber(totalMatch[1]) : 0;
    
    // Extract fund names and their percentages
    // Format: "FundName ... percentage%"
    // Example: "Aktiespararna Topp Sverige A   38,08   SEK   36,68   1 090,58   41 529,38   +1 529,38   8,23 %"
    // Strategy: Find fund name, then find percentage at end of line
    
    // Pattern 1: Find fund name followed by percentage (last number before %)
    const fundPattern = /([A-ZÅÄÖa-zåäö][A-ZÅÄÖa-zåäö\s\-\.]{2,}?)\s+[\d\s,]+\s+SEK\s+[\d\s,]+\s+[\d\s,]+\s+[\d\s,]+\s+[+-][\d\s,]+\s+(\d+,\d{2})\s*%/g;
    let match;
    while ((match = fundPattern.exec(section)) !== null) {
      const fundName = match[1].trim();
      const percentage = parseSwedishNumber(match[2]); // e.g., 8.23
      
      if (percentage > 0 && fundName.length > 2 && !fundName.match(/^\d/) && !fundName.includes('Totalt') && !fundName.includes('Likvida')) {
        // Calculate market value from percentage and section total
        const marketValue = sectionTotal > 0 ? (sectionTotal * percentage / 100) : 0;
        
        if (marketValue > 0) {
          if (assetTotals[fundName]) {
            assetTotals[fundName].value += marketValue;
          } else {
            assetTotals[fundName] = { name: fundName, value: marketValue, isCash: false };
          }
        }
      }
    }
    
    // Pattern 2: Alternative - find fund name with more flexible spacing
    const altFundPattern = /([A-ZÅÄÖa-zåäö][A-ZÅÄÖa-zåäö\s\-\.]{2,}?)\s+[\d\s,]+\s+SEK[\d\s,]+\d+,\d{2}\s*[+-][\d\s,]+\s+(\d+,\d{2})\s*%/g;
    while ((match = altFundPattern.exec(section)) !== null) {
      const fundName = match[1].trim();
      const percentage = parseSwedishNumber(match[2]);
      
      if (percentage > 0 && fundName.length > 2 && !fundName.match(/^\d/) && !fundName.includes('Totalt') && !fundName.includes('Likvida')) {
        const marketValue = sectionTotal > 0 ? (sectionTotal * percentage / 100) : 0;
        
        if (marketValue > 0 && !assetTotals[fundName]) {
          assetTotals[fundName] = { name: fundName, value: marketValue, isCash: false };
        }
      }
    }
    
    // Extract cash (Likvida medel) - extract value directly
    // Format 1: "Likvida medel   33 817,98   6,70 %"
    // Format 2: "Likvida medel33 817,986,70%"
    const cashPatterns = [
      /Likvida medel\s+([\d\s,]+)\s+(\d+,\d{2})\s*%/g,
      /Likvida medel([\d\s,]+)(\d+,\d{2})%/g
    ];
    for (const cashPattern of cashPatterns) {
      while ((match = cashPattern.exec(section)) !== null) {
        const cashValue = parseSwedishNumber(match[1]);
        if (cashValue > 0) {
          if (assetTotals['Likvida medel']) {
            assetTotals['Likvida medel'].value += cashValue;
          } else {
            assetTotals['Likvida medel'] = { name: 'Likvida medel', value: cashValue, isCash: true };
          }
        }
      }
    }
    
    // Add section total to overall total
    if (sectionTotal > 0) {
      totalValue += sectionTotal;
    }
  }

  // Build holdings array
  const holdings = Object.values(assetTotals).map(h => {
    const cls = getClassificationFromReference(h.name, 'Nordnet');
    return {
      name: h.name,
      brokerage: 'Nordnet',
      category: cls.found ? cls.category : (h.isCash ? 'Cash' : 'Unassigned'),
      value: h.value,
      percentage: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
      bucket: cls.found ? cls.bucket : (h.isCash ? 1 : 0)
    };
  }).sort((a, b) => b.value - a.value);

  // Calculate total if not found in PDF
  if (totalValue === 0) {
    totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  }

  if (holdings.length === 0) return null;

  return {
    date: snapshotDate,
    dateStr: formatDate(snapshotDate),
    holdings,
    totalValue,
    nordnetValue: totalValue,
    avanzaValue: 0
  };
}

async function parseNordnetPDF(file) {
  if (typeof pdfjsLib === 'undefined') { alert('PDF.js library not loaded.'); return null; }
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) { 
      const page = await pdf.getPage(i); 
      const content = await page.getTextContent(); 
      fullText += content.items.map(item => item.str).join(' ') + '\n'; 
    }

    console.log('=== NORDNET PDF EXTRACTED TEXT ===');
    console.log(fullText);
    console.log('=== END EXTRACTED TEXT ===');

    // Parse using regex (no AI required)
    const result = parseNordnetPDFText(fullText);
    if (!result) {
      // Show debug modal with extracted text for debugging
      const debugProceed = await showPdfDebugModal(fullText, file.name);
      if (!debugProceed) return null;
      // Try parsing again after user sees the text
      const retryResult = parseNordnetPDFText(fullText);
      if (!retryResult) {
        return null;
      }
      return retryResult;
    }

    console.log('Parsed Nordnet PDF:', result);
    return result;
  } catch (err) { 
    console.error('PDF parsing error:', err); 
    alert('Failed to parse Nordnet PDF: ' + err.message); 
    return null; 
  }
}

function showPdfDebugModal(text, filename) {
  return new Promise((_resolve) => {
    window._pdfDebugResolve = _resolve;
    const modal = document.createElement('div');
    modal.id = 'pdfDebugModal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60';
    modal.innerHTML = `
      <div class="card p-6 w-full max-w-3xl mx-4" style="max-height:80vh;display:flex;flex-direction:column;">
        <h3 class="text-lg font-semibold mb-2">📄 PDF Debug: ${filename}</h3>
        <p class="text-sm text-[var(--fg-muted)] mb-4">Extracted text from PDF. Copy this to share for analysis.</p>
        <textarea id="pdfDebugText" readonly style="flex:1;min-height:300px;background:var(--bg-secondary);color:var(--fg-primary);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;resize:vertical;">${text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')}</textarea>
        <div class="flex gap-3 mt-4">
          <button onclick="navigator.clipboard.writeText(document.getElementById('pdfDebugText').value);this.textContent='Copied!'" class="btn-secondary flex-1">📋 Copy to Clipboard</button>
          <button onclick="document.getElementById('pdfDebugModal').remove();window._pdfDebugResolve(true)" class="btn-primary flex-1">Continue to AI</button>
          <button onclick="document.getElementById('pdfDebugModal').remove();window._pdfDebugResolve(false)" class="btn-secondary flex-1" style="color:var(--accent-danger)">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); _resolve(false); } });
  });
}

function repairJsonString(str) {
  // Remove markdown code fences
  str = str.trim();
  str = str.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  // Remove trailing commas before ] or }
  str = str.replace(/,\s*([\]}])/g, '$1');
  // Remove JavaScript-style comments
  str = str.replace(/\/\/.*$/gm, '');
  str = str.replace(/\/\*[\s\S]*?\*\//g, '');
  // Fix single quotes to double quotes (simple cases)
  // Fix missing quotes around keys (common AI mistake)
  // Fix unquoted numeric values that are actually strings with spaces
  // Replace smart quotes with standard quotes
  str = str.replace(/[\u201C\u201D]/g, '"');
  str = str.replace(/[\u2018\u2019]/g, "'");
  return str;
}

function attemptJsonParse(str) {
  // Try direct parse first
  try { return JSON.parse(str); } catch(e) {}

  // Try extracting JSON object with regex
  const match = str.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch(e) {}
  }

  // Try more aggressive repairs
  let repaired = str;
  
  // Remove any text before first { and after last }
  const firstBrace = repaired.indexOf('{');
  const lastBrace = repaired.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    repaired = repaired.substring(firstBrace, lastBrace + 1);
  }

  // Fix trailing commas (multiple passes)
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');

  // Fix missing commas between array/object elements
  // e.g., "} {" -> "}, {" and "] [" -> "], ["
  repaired = repaired.replace(/}\s*{/g, '}, {');
  repaired = repaired.replace(/]\s*\[/g, '], [');

  try { return JSON.parse(repaired); } catch(e) {}

  // Last resort: try to fix individual lines in the JSON
  // Sometimes AI outputs JSON with extra whitespace or newlines in wrong places
  repaired = repaired.replace(/\r\n/g, '\n');
  // Remove newlines inside string values (between quotes)
  repaired = repaired.replace(/(?<=":[\s]*)\n/g, '');

  try { return JSON.parse(repaired); } catch(e) {}

  return null;
}

async function callAiForNordnetExtraction(text, filename) {
  const apiKey = getApiKey();
  const apiUrl = getApiUrl();

  // Count approximate number of holdings in text to help AI
  const holdingCountHint = (text.match(/SEK|kr|Marknadsvärde|Marknadsvärde|Kursvärde/gi) || []).length;

  const prompt = `CRITICAL TASK: Extract ALL holdings from this Nordnet portfolio PDF text. There are approximately ${holdingCountHint} value references. You MUST find EVERY single holding - do not stop until you have listed them all.

Return ONLY valid JSON with this EXACT format (no extra text, no markdown, no comments):

{"date":"YYYY-MM-DD","holdings":[{"name":"Asset Name","value":12345.67,"isCash":false}]}

MANDATORY RULES:
1. Extract the portfolio date (look for dates near the top of the document)
2. List EVERY holding you can find - funds, stocks, cash, everything
3. For each holding extract: exact name and total market value in SEK (numbers only, no quotes)
4. "Likvida medel" or any cash balance must have isCash:true, all others isCash:false
5. If the same fund appears multiple times, AGGREGATE (sum) their values into one entry
6. Include ALL holdings - do not skip any, even small ones
7. No trailing commas anywhere in the JSON
8. Count your holdings before responding - a typical Nordnet portfolio has 7-10 holdings

TEXT FROM ${filename}:
${text}`;

  try {
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify({ model: getApiModel(), messages: [{ role: 'system', content: 'You are a precise data extraction assistant. Your ONLY job is to extract ALL holdings from financial documents and return them as valid JSON. You must be COMPLETE - list every single holding without exception. Return ONLY valid JSON. No markdown. No code blocks. No trailing commas. No explanations. No text before or after the JSON.' }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4000 }) });
    if (!response.ok) { const errBody = await response.text(); throw new Error('API returned ' + response.status + ': ' + errBody); }
    const result = await response.json();
    let jsonStr = (result.choices?.[0]?.message?.content || '').trim();
    if (!jsonStr) {
      const errMsg = result.error?.message || result.message || 'Empty response from API (possible rate limit or insufficient balance)';
      throw new Error(errMsg);
    }

    // Repair and parse JSON
    jsonStr = repairJsonString(jsonStr);
    const parsed = attemptJsonParse(jsonStr);
    if (parsed) return parsed;

    // If first attempt fails, try a retry with stricter prompt
    console.warn('First JSON parse attempt failed, retrying with stricter prompt...');
    const retryResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify({ model: getApiModel(), messages: [{ role: 'system', content: 'Return ONLY valid JSON. No markdown. No code blocks. No trailing commas.' }, { role: 'user', content: 'The previous response had invalid JSON syntax. Please fix it and return ONLY valid JSON:\n\n' + jsonStr }], temperature: 0.0, max_tokens: 2000 }) });
    if (retryResponse.ok) {
      const retryResult = await retryResponse.json();
      let retryStr = (retryResult.choices?.[0]?.message?.content || '').trim();
      if (retryStr) {
        retryStr = repairJsonString(retryStr);
        const retryParsed = attemptJsonParse(retryStr);
        if (retryParsed) return retryParsed;
      }
    }

    throw new Error('Could not parse AI response as JSON after multiple attempts. Raw response: ' + jsonStr.substring(0, 300));
  } catch (err) { console.error('AI API error:', err); alert('AI API error: ' + err.message); return null; }
}
"use strict";


// --- API SETTINGS ---
const DEFAULT_API_URL = CONFIG.API_URL;
const DEFAULT_API_MODEL = CONFIG.API_MODEL;

function getApiKey() { return localStorage.getItem('portfolioTracker_apiKey') || ''; }
function getApiUrl() {
  const url = localStorage.getItem('portfolioTracker_apiUrl');
  if (!url || !url.includes('/chat/completions')) return DEFAULT_API_URL;
  return url;
}
function getApiModel() { return localStorage.getItem('portfolioTracker_apiModel') || DEFAULT_API_MODEL; }

function migrateOldApiSettings() {
  // Clean up old provider-based settings
  localStorage.removeItem('portfolioTracker_apiProvider');
  const storedUrl = localStorage.getItem('portfolioTracker_apiUrl');
  if (storedUrl && !storedUrl.includes('/chat/completions')) {
    localStorage.removeItem('portfolioTracker_apiUrl');
  }
}

function showApiSettings() {
  const currentUrl = getApiUrl();
  const currentModel = getApiModel();
  const currentKey = getApiKey();
  const modal = document.createElement('div');
  modal.id = 'apiSettingsModal';
  modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60';
  modal.innerHTML = `<div class="card p-6 w-full max-w-md mx-4"><h3 class="text-lg font-semibold mb-4">Z.ai API Settings</h3><p class="text-sm text-[var(--fg-muted)] mb-4">Configure the Z.ai API for Nordnet PDF parsing. All settings stored locally.</p><div class="space-y-4"><div><label class="block text-sm font-medium mb-1">API URL</label><input type="text" id="apiUrlInput" class="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" value="${currentUrl}"></div><div><label class="block text-sm font-medium mb-1">Model</label><input type="text" id="apiModelInput" class="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" value="${currentModel}"></div><div><label class="block text-sm font-medium mb-1">API Key</label><input type="password" id="apiKeyInput" class="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono" value="${currentKey}"></div></div><div class="flex gap-3 mt-6"><button onclick="saveApiSettings()" class="btn-primary flex-1">Save</button><button onclick="document.getElementById('apiSettingsModal').remove()" class="btn-secondary flex-1">Cancel</button></div><p class="text-xs text-[var(--fg-muted)] mt-3">Current: ${currentModel} @ ${currentUrl}</p></div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function saveApiSettings() {
  localStorage.setItem('portfolioTracker_apiUrl', document.getElementById('apiUrlInput').value.trim());
  localStorage.setItem('portfolioTracker_apiModel', document.getElementById('apiModelInput').value.trim());
  localStorage.setItem('portfolioTracker_apiKey', document.getElementById('apiKeyInput').value.trim());
  document.getElementById('apiSettingsModal').remove();
  alert('API settings saved!');
}

function isInSchedule(name, broker) {
    // Allow hooks to override before running default logic
    for (const fn of hooks.beforeIsInSchedule) {
      const result = fn(name, broker);
      if (result !== undefined) return result;
    }
    const schedule = rebalancingSchedule[broker.toLowerCase()];
    if (!schedule) return false;
    return schedule.some(s => s.name === name || name.includes(s.name) || s.name.includes(name));
}

function findBucketForName(name, broker, csvCategory) {
    // Allow hooks to override before running default logic
    for (const fn of hooks.beforeFindBucketForName) {
      const result = fn(name, broker, csvCategory);
      if (result !== undefined) return result;
    }
    const schedule = rebalancingSchedule[broker.toLowerCase()];
    if (!schedule) return 0; 
    const item = schedule.find(s => s.name === name || name.includes(s.name) || s.name.includes(name));
    return item ? item.bucket : 0; 
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const holdings = [];
  let totalValue = 0, nordnetValue = 0, avanzaValue = 0, snapshotDate = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split('|');
    const dataStr = parts.length > 1 ? parts[1].trim() : line;
    const fields = dataStr.split(';');
    
    if (fields.length >= 7) {
      const date = parseDate(fields[0]);
      if (!snapshotDate) snapshotDate = date;
      
      const name = fields[1].trim();
      const brokerage = fields[2].trim();
      const rawCategory = fields[3].trim();
      
      holdings.push({
        name: name,
        brokerage: brokerage,
        category: rawCategory || "Unassigned",
        value: parseFloat(fields[4]) || 0,
        percentage: parseFloat(fields[5]) || 0,
        bucket: findBucketForName(name, brokerage, rawCategory || "Unassigned"),
        isScheduled: isInSchedule(name, brokerage)
      });
      
      totalValue = parseFloat(fields[6]) || 0;
      nordnetValue = parseFloat(fields[7]) || 0;
      avanzaValue = parseFloat(fields[8]) || 0;
    }
  }

  if (!snapshotDate || holdings.length === 0) return null;
  return { date: snapshotDate, dateStr: formatDate(snapshotDate), holdings, totalValue, nordnetValue, avanzaValue };
}

function parseDate(dateStr) {
  const parts = dateStr.trim().split('-');
  if (parts.length === 3) return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return new Date(dateStr);
}

function formatDate(date) { return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function formatCurrency(value) { return 'SEK ' + value.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

function showDashboard() {
  document.getElementById('uploadSection').classList.add('hidden');
  document.getElementById('statsGrid').classList.remove('hidden');
  document.getElementById('tabsSection').classList.remove('hidden');
  updateStats();
  switchTab('overview');
  populateFilters();
  populateCompareSelects();
  // Notify hook subscribers
  hooks.afterShowDashboard.forEach(fn => fn());
}

function renderSnapshotChips() {
  const container = document.getElementById('snapshotChips');
  container.innerHTML = '';
  snapshots.forEach((snapshot, index) => {
    const effective = getEffectiveSnapshot(snapshot);
    const { hasAvanza, hasNordnet } = getSnapshotBrokerInfo(snapshot);
    const carried = effective._carriedForward || {};

    // Build broker indicator badges
    let brokerBadges = '';
    if (hasAvanza || carried.avanza) {
      const carriedLabel = carried.avanza ? '↩' : '';
      brokerBadges += `<span style="background:rgba(16,185,129,0.2);color:#34d399;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;" title="${carried.avanza ? 'Avanza data carried from ' + carried.avanza : 'Avanza data present'}">A${carriedLabel}</span>`;
    }
    if (hasNordnet || carried.nordnet) {
      const carriedLabel = carried.nordnet ? '↩' : '';
      brokerBadges += `<span style="background:rgba(6,182,212,0.2);color:#22d3ee;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;" title="${carried.nordnet ? 'Nordnet data carried from ' + carried.nordnet : 'Nordnet data present'}">N${carriedLabel}</span>`;
    }

    const chip = document.createElement('button');
    chip.className = `snapshot-chip ${snapshot === currentSnapshot ? 'active' : ''}`;
    chip.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg> ${snapshot.dateStr} ${brokerBadges} <svg class="w-3 h-3 ml-1 hover:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" onclick="event.stopPropagation(); deleteSnapshot(${index})"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;
    chip.onclick = () => selectSnapshot(index);
    container.appendChild(chip);
  });
}

function deleteSnapshot(index) {
  if (snapshots.length <= 1) {
    alert("Cannot delete the last snapshot. Use Import Data to replace it.");
    return;
  }
  if (confirm(`Delete snapshot from ${snapshots[index].dateStr}?`)) {
    snapshots.splice(index, 1);
    currentSnapshot = snapshots[snapshots.length - 1];
    saveToLocalStorage();
    renderSnapshotChips();
    updateStats();
    updateCharts();
    renderHoldingsTable();
    populateCompareSelects();
  }
}

function selectSnapshot(index) {
  currentSnapshot = snapshots[index];
  updateStats();
  updateCharts();
  renderHoldingsTable();
  // Refresh snapshots tab if it's visible
  if (!document.getElementById('snapshotsTab').classList.contains('hidden')) renderSnapshotsTab();
  if (!document.getElementById('rebalancingTab').classList.contains('hidden')) renderRebalancingTables();
}

function updateStats() {
  if (!currentSnapshot) return;
  const effective = getEffectiveSnapshot(currentSnapshot);
  const ft = calculateFilteredTotals(effective);
  document.getElementById('totalValue').textContent = formatCurrency(ft.totalValue);
  document.getElementById('nordnetValue').textContent = formatCurrency(ft.nordnetValue);
  document.getElementById('avanzaValue').textContent = formatCurrency(ft.avanzaValue);
  document.getElementById('holdingsCount').textContent = ft.holdingsCount;
  
  const nordnetPercent = ft.totalValue > 0 ? ((ft.nordnetValue / ft.totalValue) * 100).toFixed(1) : '0.0';
  const avanzaPercent = ft.totalValue > 0 ? ((ft.avanzaValue / ft.totalValue) * 100).toFixed(1) : '0.0';
  document.getElementById('nordnetPercent').textContent = `${nordnetPercent}% of total`;
  document.getElementById('avanzaPercent').textContent = `${avanzaPercent}% of total`;

  const reference = snapshots.find(s => s.date.getTime() === referenceDate.getTime());
  if (reference && currentSnapshot !== reference) {
    const refEffective = getEffectiveSnapshot(reference);
    const refFt = calculateFilteredTotals(refEffective);
    const change = ft.totalValue - refFt.totalValue;
    const changePercent = refFt.totalValue > 0 ? ((change / refFt.totalValue) * 100).toFixed(2) : '0.00';
    const changeEl = document.getElementById('totalChange');
    changeEl.textContent = `${changePercent > 0 ? '+' : ''}${formatCurrency(change)} (${changePercent > 0 ? '+' : ''}${changePercent}%)`;
    changeEl.className = `text-sm mt-1 ${change >= 0 ? 'change-positive' : 'change-negative'}`;
  } else {
    document.getElementById('totalChange').textContent = 'Reference point';
    document.getElementById('totalChange').className = 'text-sm mt-1 text-[var(--fg-muted)]';
  }
  document.getElementById('lastUpdated').textContent = `Updated: ${currentSnapshot.dateStr}`;
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
  const activePanel = document.getElementById(`${tabId}Tab`);
  if (activePanel) activePanel.classList.remove('hidden');

  if (tabId === 'overview') setTimeout(() => { renderDistributionChart(); renderBrokerageChart(); renderCategoryBreakdown(); }, 100);
  else if (tabId === 'holdings') renderHoldingsTable();
  else if (tabId === 'evolution') setTimeout(() => { renderTargetTracker(); renderEvolutionChart(); renderCategoryEvolutionChart(); renderBucketEvolutionChart(); renderBucket1HoldingsChart(); renderBucket2HoldingsChart(); renderBucket3HoldingsChart(); }, 100);
  else if (tabId === 'rebalancing') setTimeout(() => renderRebalancingTables(), 100);
  else if (tabId === 'comparison') populateCompareSelects();
  else if (tabId === 'reference') renderReferenceTable();
  else if (tabId === 'snapshots') renderSnapshotsTab();
  else if (tabId === 'retirement') populateRetirementForm();
  else if (tabId === 'notes') renderNotesTab();
  else if (tabId === 'live-prices') {
    checkServerStatus();
    initPerfTrackedHoldings();
    loadPerfLiveData();
    if (perfLivePrices.length > 0) {
      document.getElementById('livePricesIntro').classList.add('hidden');
      document.getElementById('livePricesTableContainer').classList.remove('hidden');
      document.getElementById('livePricesSuccess').classList.remove('hidden');
      document.getElementById('livePricesTimestamp').textContent = localStorage.getItem(PERF_LIVE_LS_KEY) ? JSON.parse(localStorage.getItem(PERF_LIVE_LS_KEY)).timestamp : '--';
      document.getElementById('livePricesSource').textContent = localStorage.getItem(PERF_LIVE_LS_KEY) ? JSON.parse(localStorage.getItem(PERF_LIVE_LS_KEY)).source : 'Yahoo Finance';
      renderPerfLivePricesTable();
    }
    setTimeout(() => renderMomentumEvolutionChart(), 200);
  }
  // Notify hook subscribers
  hooks.afterSwitchTab.forEach(fn => fn(tabId));
}

function renderSnapshotsTab() {
  const tbody = document.getElementById('snapshotsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (snapshots.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-[var(--fg-muted)] py-8">No snapshots imported yet</td></tr>';
    return;
  }
  // Show in reverse order (newest first)
  const reversed = [...snapshots].reverse();
  reversed.forEach((snapshot, reverseIdx) => {
    const realIndex = snapshots.length - 1 - reverseIdx;
    const effective = getEffectiveSnapshot(snapshot);
    const ft = calculateFilteredTotals(effective);
    const { hasAvanza, hasNordnet } = getSnapshotBrokerInfo(snapshot);
    const carried = effective._carriedForward || {};

    // Build broker badges
    let brokerBadges = '';
    if (hasAvanza || carried.avanza) {
      const carriedLabel = carried.avanza ? '↩' : '';
      brokerBadges = `<span style="background:rgba(16,185,129,0.2);color:#34d399;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Avanza${carriedLabel}</span>`;
    }
    if (hasNordnet || carried.nordnet) {
      const carriedLabel = carried.nordnet ? '↩' : '';
      brokerBadges += brokerBadges ? ' ' : '';
      brokerBadges += `<span style="background:rgba(6,182,212,0.2);color:#22d3ee;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Nordnet${carriedLabel}</span>`;
    }

    const isCurrent = snapshot === currentSnapshot;
    const row = document.createElement('tr');
    if (isCurrent) row.classList.add('highlight-row');
    row.innerHTML = `
      <td class="font-medium">${snapshot.dateStr}</td>
      <td style="min-width:150px;">${brokerBadges || '<span class="text-[var(--fg-muted)]">None</span>'}</td>
      <td class="text-right font-mono">${formatCurrency(ft.totalValue)}</td>
      <td class="text-right font-mono">${ft.holdingsCount}</td>
      <td class="text-center">
        <div class="flex gap-2 justify-center">
          ${!isCurrent ? `<button class="snapshot-action-btn snapshot-select-btn" onclick="selectSnapshot(${realIndex})">Select</button>` : `<button class="snapshot-action-btn snapshot-select-btn is-current" disabled>Current</button>`}
          <button class="snapshot-action-btn snapshot-delete-btn" onclick="deleteSnapshot(${realIndex})">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}
"use strict";


// --- EDITING LOGIC ---

function handleCategoryChange(name, brokerage, newCategory) {
    if (!currentSnapshot) return;
    const holding = currentSnapshot.holdings.find(h => h.name === name && h.brokerage === brokerage);
    if (holding) {
        holding.category = newCategory;
        holding.bucket = categoryRules[newCategory] !== undefined ? categoryRules[newCategory] : holding.bucket;
    }
    // Also update the reference table so the change persists across renders
    const refKey = brokerage.toLowerCase() === 'nordnet' ? 'nordnet' : 'avanza';
    const refEntry = classificationReference[refKey]?.find(r => r.name === name);
    if (refEntry) {
        refEntry.category = newCategory;
        refEntry.bucket = categoryRules[newCategory] !== undefined ? categoryRules[newCategory] : refEntry.bucket;
    } else {
        // Add new entry to reference table if not found
        if (!classificationReference[refKey]) classificationReference[refKey] = [];
        classificationReference[refKey].push({ name, category: newCategory, bucket: categoryRules[newCategory] !== undefined ? categoryRules[newCategory] : 0 });
    }
    populateFilters();
    renderCategoryBreakdown();
    renderDistributionChart();
    renderHoldingsTable();
}

function handleBucketChange(name, brokerage, newBucket) {
    if (!currentSnapshot) return;
    const holding = currentSnapshot.holdings.find(h => h.name === name && h.brokerage === brokerage);
    if (holding) {
        holding.bucket = parseInt(newBucket);
    }
    // Also update the reference table so the change persists across renders
    const refKey = brokerage.toLowerCase() === 'nordnet' ? 'nordnet' : 'avanza';
    const refEntry = classificationReference[refKey]?.find(r => r.name === name);
    if (refEntry) {
        refEntry.bucket = parseInt(newBucket);
    } else {
        if (!classificationReference[refKey]) classificationReference[refKey] = [];
        classificationReference[refKey].push({ name, category: holding?.category || 'Unassigned', bucket: parseInt(newBucket) });
    }
    renderRebalancingTables();
    renderHoldingsTable();
}

// --- END EDITING LOGIC ---

function calculateBrokerCurrents(broker) {
    if(!currentSnapshot) return { assets: {}, unscheduled: [], totalBrokerValue: 0 };
    
    const effective = getEffectiveSnapshot(currentSnapshot);
    const filteredHoldings = getFilteredHoldings(effective);
    const brokerHoldings = filteredHoldings.filter(h => h.brokerage === broker);
    const ft = calculateFilteredTotals(effective);
    const totalBrokerValue = broker === 'Nordnet' ? ft.nordnetValue : ft.avanzaValue;
    
    const assets = {};
    const unscheduled = [];
    
    const scheduleKeys = rebalancingSchedule[broker.toLowerCase()].map(s => s.name);
    
    brokerHoldings.forEach(h => {
        const match = scheduleKeys.find(key => namesMatch(key, h.name));
        
        if (match) {
            if(!assets[match]) assets[match] = 0;
            assets[match] += (h.value / totalBrokerValue) * 100;
        } else {
            unscheduled.push({
                name: h.name,
                bucket: h.bucket || 0,
                val: (h.value / totalBrokerValue) * 100
            });
        }
    });
    
    return { assets, unscheduled, totalBrokerValue };
}

function renderRebalanceTable(body, broker, scheduleData) {
    const currentData = calculateBrokerCurrents(broker);
    body.innerHTML = '';
    
    let currentSum = 0;

    scheduleData.forEach(item => {
        const currentVal = currentData.assets[item.name] || 0;
        currentSum += currentVal;
        
        const row = document.createElement('tr');
        let cells = `<td class="font-medium">${escapeHtml(item.name)} <span class="badge ${BUCKETS[item.bucket].class} ml-2">B${item.bucket}</span></td>`;
        
        cells += `<td class="text-right font-mono">${currentVal.toFixed(1)}%</td>`;
        item.schedule.forEach((val, idx) => {
            const isHighlight = (idx === currentRebalancingMonth - 1 || idx === REBALANCING_MONTHS - 1);
            cells += `<td class="text-right font-mono ${isHighlight ? 'highlight-col' : 'text-[var(--fg-muted)]'}">${val.toFixed(1)}%</td>`;
        });
        
        row.innerHTML = cells;
        body.appendChild(row);
    });

    // Unscheduled Holdings
    currentData.unscheduled
      .sort((a, b) => {
          if (a.bucket !== b.bucket) return a.bucket - b.bucket;
          return a.name.localeCompare(b.name);
      })
      .forEach(item => {
          currentSum += item.val;
          
          const bucket = BUCKETS[item.bucket];
          const otherRow = document.createElement('tr');
          let otherCells = `<td class="font-medium text-[var(--fg-muted)]">${escapeHtml(item.name)} <span class="badge ${bucket.class} ml-2">B${item.bucket}</span></td>`;
          
          otherCells += `<td class="text-right font-mono">${item.val.toFixed(1)}%</td>`;
          
          for(let i=0; i<REBALANCING_MONTHS; i++) {
              const isHighlight = (i === currentRebalancingMonth - 1 || i === REBALANCING_MONTHS - 1);
              otherCells += `<td class="text-right font-mono ${isHighlight ? 'highlight-col' : 'text-[var(--fg-muted)]'}">0.0%</td>`;
          }
          otherRow.innerHTML = otherCells;
          body.appendChild(otherRow);
      });

    const sumRow = document.createElement('tr');
    sumRow.className = 'sum-row';
    let sumCells = `<td>TOTAL</td>`;
    sumCells += `<td class="text-right font-mono">${currentSum.toFixed(1)}%</td>`;
    for(let i=0; i<REBALANCING_MONTHS; i++) {
        const isHighlight = (i === currentRebalancingMonth - 1 || i === REBALANCING_MONTHS - 1);
        sumCells += `<td class="text-right font-mono ${isHighlight ? 'highlight-col' : ''}">100.0%</td>`;
    }
    sumRow.innerHTML = sumCells;
    body.appendChild(sumRow);
}

function renderRebalancingTables() {
    syncTargetsFromReference();
    refreshRebalancingSchedule();
    renderTargetsConfig();
    const avanzaBody = document.getElementById('avanzaRebalanceTable');
    const nordnetBody = document.getElementById('nordnetRebalanceTable');

    renderRebalanceTable(avanzaBody, 'Avanza', rebalancingSchedule.avanza);
    renderRebalanceTable(nordnetBody, 'Nordnet', rebalancingSchedule.nordnet);
    
    // Render bucket summary cards
    renderBucketSummaryCards();
    
    // Render consolidated bucket overview table
    renderConsolidatedBucketTable();

    // Update consolidated table headers to show selected month
    const monthHeaderEl = document.getElementById('consolidatedMonthHeader');
    if (monthHeaderEl) monthHeaderEl.textContent = getMonthShortLabel(currentRebalancingMonth) + ' 2026 Target';
    const monthDeltaHeaderEl = document.getElementById('consolidatedMonthDeltaHeader');
    if (monthDeltaHeaderEl) monthDeltaHeaderEl.textContent = 'Δ Current → ' + getMonthShortLabel(currentRebalancingMonth) + ' 2026';

    // Update schedule table headers with real month names
    updateScheduleTableHeaders();

    // Populate and update Return Target Rebalancing Calculator
    updateReturnTargetCalculator();

    // Render holdings allocation tables in SEK
    renderHoldingsAllocationSek('avanzaSekTable', 'Avanza');
    renderHoldingsAllocationSek('nordnetSekTable', 'Nordnet');

    // Update SEK table month headers
    const avanzaMonthHdr = document.getElementById('avanzaSekMonthHeader');
    if (avanzaMonthHdr) avanzaMonthHdr.textContent = getMonthShortLabel(currentRebalancingMonth) + ' 2026 Target (SEK)';
    const nordnetMonthHdr = document.getElementById('nordnetSekMonthHeader');
    if (nordnetMonthHdr) nordnetMonthHdr.textContent = getMonthShortLabel(currentRebalancingMonth) + ' 2026 Target (SEK)';

    // Render rebalancing projection charts
    renderRebalancingCharts();
}

function renderRebalancingCharts() {
    const bucketColors = {
        0: '#f87171', // Red for Bucket 0 (Sell)
        1: '#22d3ee', // Cyan for Bucket 1
        2: '#fbbf24', // Amber for Bucket 2
        3: '#34d399'  // Emerald for Bucket 3
    };
    const bucketOrder = [0, 1, 2, 3];

    ['avanza', 'nordnet'].forEach(broker => {
        const canvasId = broker + 'RebalanceChart';
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const schedule = rebalancingSchedule[broker];
        if (!schedule || schedule.length === 0) return;

        const months = REBALANCING_MONTHS;
        const labels = [];
        for (let m = 1; m <= months; m++) {
            labels.push(getMonthShortLabel(m));
        }

        // Aggregate schedule by bucket per month
        const bucketSchedules = {};
        bucketOrder.forEach(b => { bucketSchedules[b] = new Array(months).fill(0); });
        schedule.forEach(item => {
            const b = item.bucket;
            if (bucketSchedules[b]) {
                item.schedule.forEach((val, idx) => {
                    bucketSchedules[b][idx] += val;
                });
            }
        });

        // Build stacked area datasets — one per bucket, filled from the bucket below
        const datasets = bucketOrder.map(b => ({
            label: (BUCKETS[b]?.name || 'Bucket ' + b).split('—')[0]?.trim() || ('Bucket ' + b),
            data: bucketSchedules[b],
            backgroundColor: bucketColors[b] + '50',
            borderColor: bucketColors[b],
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: bucketColors[b],
            pointBorderColor: 'transparent'
        }));

        const ctx = canvas.getContext('2d');

        // Destroy existing chart if any
        if (broker === 'avanza' && avanzaRebalanceChart) avanzaRebalanceChart.destroy();
        if (broker === 'nordnet' && nordnetRebalanceChart) nordnetRebalanceChart.destroy();

        const currentMonthIdx = currentRebalancingMonth - 1;

        // Custom plugin: dashed vertical line + label at the current month
        const currentMonthLinePlugin = {
            id: 'currentMonthDashedLine',
            afterDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                if (!meta || !chart.scales.x || !chart.scales.y) return;
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                if (currentMonthIdx < 0 || currentMonthIdx >= labels.length) return;

                const x = xScale.getPixelForValue(currentMonthIdx);
                const ctx = chart.ctx;

                // Dashed vertical line
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([6, 4]);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
                ctx.lineWidth = 2;
                ctx.moveTo(x, yScale.top);
                ctx.lineTo(x, yScale.bottom);
                ctx.stroke();
                ctx.restore();

                // "Current" label above the line
                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.70)';
                ctx.font = 'bold 11px "DM Sans", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(labels[currentMonthIdx], x, yScale.top - 4);
                ctx.restore();
            }
        };

        const chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    intersect: true
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: { color: '#94a3b8', font: { size: 10 } }
                    },
                    y: {
                        stacked: true,
                        max: 100,
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 },
                            callback: (v) => v + '%'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#cbd5e1',
                            boxWidth: 12,
                            padding: 10,
                            font: { size: 10 },
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`
                        }
                    }
                }
            },
            plugins: [currentMonthLinePlugin]
        });

        if (broker === 'avanza') avanzaRebalanceChart = chartInstance;
        if (broker === 'nordnet') nordnetRebalanceChart = chartInstance;
    });
}

function renderHoldingsAllocationSek(tbodyId, broker) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody || !currentSnapshot) return;

    const brokerKey = broker.toLowerCase();
    const currentData = calculateBrokerCurrents(broker);
    const totalBrokerValue = currentData.totalBrokerValue;
    const scheduleData = rebalancingSchedule[brokerKey] || [];

    tbody.innerHTML = '';

    let sumCurrent = 0;
    let sumDiff = 0;
    let sumMonthTarget = 0;
    let sumFinalTarget = 0;

    // Scheduled assets
    scheduleData.forEach(item => {
        const currentPct = currentData.assets[item.name] || 0;
        const currentSek = (currentPct / 100) * totalBrokerValue;
        const monthPct = item.schedule[currentRebalancingMonth - 1] || 0;
        const monthSek = (monthPct / 100) * totalBrokerValue;
        const finalPct = item.schedule[REBALANCING_MONTHS - 1] || 0;
        const finalSek = (finalPct / 100) * totalBrokerValue;
        const diffSek = monthSek - currentSek;

        sumCurrent += currentSek;
        sumDiff += diffSek;
        sumMonthTarget += monthSek;
        sumFinalTarget += finalSek;

        const diffClass = diffSek >= 0 ? 'change-positive' : 'change-negative';
        const diffSign = diffSek >= 0 ? '+' : '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="font-medium">${escapeHtml(item.name)} <span class="badge ${BUCKETS[item.bucket].class} ml-2">B${item.bucket}</span></td>
            <td class="text-right font-mono">${formatCurrency(Math.round(currentSek))}</td>
            <td class="text-right font-mono ${diffClass}">${diffSign}${formatCurrency(Math.round(Math.abs(diffSek)))}</td>
            <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(monthSek))}</td>
            <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(finalSek))}</td>
        `;
        tbody.appendChild(row);
    });

    // Unscheduled holdings
    currentData.unscheduled
        .sort((a, b) => {
            if (a.bucket !== b.bucket) return a.bucket - b.bucket;
            return a.name.localeCompare(b.name);
        })
        .forEach(item => {
            const currentSek = (item.val / 100) * totalBrokerValue;
            sumCurrent += currentSek;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="font-medium text-[var(--fg-muted)]">${escapeHtml(item.name)} <span class="badge ${BUCKETS[item.bucket].class} ml-2">B${item.bucket}</span></td>
                <td class="text-right font-mono">${formatCurrency(Math.round(currentSek))}</td>
                <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
                <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
                <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
            `;
            tbody.appendChild(row);
        });

    // Sum row
    const sumDiffClass = sumDiff >= 0 ? 'change-positive' : 'change-negative';
    const sumDiffSign = sumDiff >= 0 ? '+' : '';

    const sumRow = document.createElement('tr');
    sumRow.className = 'sum-row';
    sumRow.innerHTML = `
        <td>TOTAL</td>
        <td class="text-right font-mono">${formatCurrency(Math.round(sumCurrent))}</td>
        <td class="text-right font-mono ${sumDiffClass}">${sumDiffSign}${formatCurrency(Math.round(Math.abs(sumDiff)))}</td>
        <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(sumMonthTarget))}</td>
        <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(sumFinalTarget))}</td>
    `;
    tbody.appendChild(sumRow);
}

// --- RETURN TARGET REBALANCING CALCULATOR ---

function updateReturnTargetCalculator() {
    const costBasisInput = document.getElementById('costBasisInput');
    const marketValueInput = document.getElementById('marketValueInput');
    const currentProfitInput = document.getElementById('currentProfitInput');

    if (!costBasisInput || !marketValueInput || !currentProfitInput) return;

    // Get current portfolio value from snapshot
    let currentPortfolioValue = 0;
    if (currentSnapshot) {
        const effective = getEffectiveSnapshot(currentSnapshot);
        const ft = calculateFilteredTotals(effective);
        currentPortfolioValue = ft.totalValue;
    }

    // Set initial values if inputs are empty (only on first load)
    if (!costBasisInput.value && currentPortfolioValue > 0) {
        costBasisInput.value = Math.round(currentPortfolioValue);
    }
    if (!marketValueInput.value && currentPortfolioValue > 0) {
        marketValueInput.value = Math.round(currentPortfolioValue);
    }

    // Calculate and update
    calculateReturnTargetAmounts();
}

function calculateReturnTargetAmounts() {
    const costBasis = parseFloat(document.getElementById('costBasisInput').value) || 0;
    const marketValue = parseFloat(document.getElementById('marketValueInput').value) || 0;
    const currentProfit = marketValue - costBasis;

    // Update current profit display - show negative values
    document.getElementById('currentProfitInput').value = currentProfit !== 0 ? Math.round(currentProfit) : 0;

    // Quick reference table amounts - include negative targets
    const targets = [-0.10, -0.05, -0.02, 0.04, 0.05, 0.07, 0.10];
    const elementIds = ['buyAmount-10', 'buyAmount-5', 'buyAmount-2', 'buyAmount4', 'buyAmount5', 'buyAmount7', 'buyAmount10'];

    targets.forEach((targetReturn, index) => {
        const buyAmount = calculateBuyAmount(costBasis, currentProfit, targetReturn);
        const el = document.getElementById(elementIds[index]);
        if (el) {
            if (buyAmount >= 0) {
                el.textContent = formatCurrency(Math.round(buyAmount));
                el.className = 'text-right py-3 font-mono';
            } else if (targetReturn > 0 && currentProfit > 0) {
                // Should buy but formula gives negative - impossible scenario
                el.textContent = 'N/A';
                el.className = 'text-right py-3 font-mono text-[var(--fg-muted)]';
            } else {
                // Negative buy amount means SELL - display negative value in red
                el.textContent = '-' + formatCurrency(Math.round(Math.abs(buyAmount)));
                el.className = 'text-right py-3 font-mono change-negative';
            }
        }
    });

    // Custom target return calculator - allow negative targets
    const customTargetReturnInput = document.getElementById('customTargetReturnInput');
    const customResultEl = document.getElementById('customBuyAmountResult');
    if (customTargetReturnInput && customTargetReturnInput.value && customResultEl) {
        const customTargetReturn = parseFloat(customTargetReturnInput.value) / 100; // Supports negative values
        const customBuyAmount = calculateBuyAmount(costBasis, currentProfit, customTargetReturn);
        if (customBuyAmount >= 0) {
            customResultEl.textContent = formatCurrency(Math.round(customBuyAmount));
            customResultEl.className = 'text-xl font-bold font-mono text-[var(--accent-primary)]';
        } else if (customTargetReturn > 0 && currentProfit > 0) {
            customResultEl.textContent = 'N/A';
            customResultEl.className = 'text-xl font-bold font-mono text-[var(--fg-muted)]';
        } else {
            customResultEl.textContent = '-' + formatCurrency(Math.round(Math.abs(customBuyAmount)));
            customResultEl.className = 'text-xl font-bold font-mono change-negative';
        }
    } else if (customResultEl) {
        customResultEl.textContent = '--';
        customResultEl.className = 'text-xl font-bold font-mono text-[var(--accent-primary)]';
    }
}

function calculateBuyAmount(costBasis, currentProfit, targetReturn) {
    // Generic formula: Buy Amount = (Profit ÷ Target Return) - Cost Basis
    // Works for all scenarios: positive/negative profit, positive/negative target return
    // Returns -1 for impossible scenarios (target return = 0 or no profit to achieve positive target when underwater)
    if (targetReturn === 0) {
        return -1; // Cannot divide by zero
    }
    return (currentProfit / targetReturn) - costBasis;
}

// Setup event listeners for the return target calculator
function setupReturnTargetCalculatorListeners() {
    const costBasisInput = document.getElementById('costBasisInput');
    const marketValueInput = document.getElementById('marketValueInput');
    const customTargetReturnInput = document.getElementById('customTargetReturnInput');

    if (costBasisInput) {
        costBasisInput.addEventListener('input', calculateReturnTargetAmounts);
    }
    if (marketValueInput) {
        marketValueInput.addEventListener('input', calculateReturnTargetAmounts);
    }
    if (customTargetReturnInput) {
        customTargetReturnInput.addEventListener('input', calculateReturnTargetAmounts);
    }
}

function renderConsolidatedBucketTable() {
    const tbody = document.getElementById('consolidatedBucketTable');
    if (!tbody || !currentSnapshot) return;

    const effective = getEffectiveSnapshot(currentSnapshot);
    const conFt = calculateFilteredTotals(effective);
    const totalPortfolio = conFt.totalValue;
    const avanzaWeight = conFt.avanzaValue / totalPortfolio;
    const nordnetWeight = conFt.nordnetValue / totalPortfolio;

    const bucketNames = {
        1: { name: 'Bucket 1 — ' + BUCKETS[1].name, color: '#22d3ee', class: 'badge-bucket-1' },
        2: { name: 'Bucket 2 — ' + BUCKETS[2].name, color: '#fbbf24', class: 'badge-bucket-2' },
        3: { name: 'Bucket 3 — ' + BUCKETS[3].name, color: '#34d399', class: 'badge-bucket-3' },
        0: { name: 'Bucket 0 — ' + BUCKETS[0].name, color: '#f87171', class: 'badge-sell' }
    };

    // Calculate current bucket allocations (weighted by portfolio share)
    const calcCurrentBuckets = (broker) => {
        const brokerKey = broker.toLowerCase();
        const holdings = getFilteredHoldings(effective).filter(h => h.brokerage === broker);
        const cbFt = calculateFilteredTotals(effective);
        const brokerValue = broker === 'Avanza' ? cbFt.avanzaValue : cbFt.nordnetValue;
        const scheduleData = rebalancingSchedule[brokerKey] || [];
        const scheduleKeys = scheduleData.map(s => s.name);
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        holdings.forEach(h => {
            const match = scheduleKeys.find(key => namesMatch(key, h.name));
            let bucket = h.bucket || 0;
            if (match) {
                const item = scheduleData.find(s => s.name === match);
                bucket = item.bucket;
            }
            buckets[bucket] += (h.value / brokerValue) * 100;
        });
        return buckets;
    };

    const avanzaCurrent = calcCurrentBuckets('Avanza');
    const nordnetCurrent = calcCurrentBuckets('Nordnet');

    // M1 targets from bucketTargets (same for both brokers)
    // Final targets from rebalancingTargets per broker
    const calcFinalTargets = (broker) => {
        const targets = rebalancingTargets[broker] || [];
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        targets.forEach(t => { buckets[t.bucket] += t.target; });
        return buckets;
    };

    const avanzaFinal = calcFinalTargets('avanza');
    const nordnetFinal = calcFinalTargets('nordnet');

    // Build rows for buckets 1, 2, 3 (skip 0 if empty)
    const rows = [];
    let totalCurrent = 0, totalM1 = 0, totalFinal = 0;

    [1, 2, 3, 0].forEach(b => {
        const current = (avanzaCurrent[b] * avanzaWeight) + (nordnetCurrent[b] * nordnetWeight);
        const selectedMonthTarget = getBucketTargets(REBALANCING_MONTHS)[b][currentRebalancingMonth - 1]; // Selected month target
        const finalTarget = (avanzaFinal[b] * avanzaWeight) + (nordnetFinal[b] * nordnetWeight);
        const info = bucketNames[b];

        totalCurrent += current;
        totalM1 += selectedMonthTarget;
        totalFinal += finalTarget;

        const deltaM1 = current - selectedMonthTarget;
        const deltaFinal = current - finalTarget;

        rows.push(`
            <tr>
                <td><span class="badge ${info.class}">B${b}</span> <span class="text-sm">${info.name.split('—')[1]?.trim() || info.name}</span></td>
                <td class="text-right font-mono">${current.toFixed(1)}%</td>
                <td class="text-right font-mono highlight-col">${selectedMonthTarget.toFixed(1)}%</td>
                <td class="text-right font-mono highlight-col">${finalTarget.toFixed(1)}%</td>
                <td class="text-right font-mono ${deltaM1 >= 0 ? 'change-positive' : 'change-negative'}">${deltaM1 >= 0 ? '+' : ''}${deltaM1.toFixed(1)}%</td>
                <td class="text-right font-mono ${deltaFinal >= 0 ? 'change-positive' : 'change-negative'}">${deltaFinal >= 0 ? '+' : ''}${deltaFinal.toFixed(1)}%</td>
            </tr>
        `);
    });

    // Total row
    const totalDeltaM1 = totalCurrent - totalM1;
    const totalDeltaFinal = totalCurrent - totalFinal;
    rows.push(`
        <tr class="sum-row">
            <td class="font-bold">TOTAL</td>
            <td class="text-right font-mono">${totalCurrent.toFixed(1)}%</td>
            <td class="text-right font-mono highlight-col">${totalM1.toFixed(1)}%</td>
            <td class="text-right font-mono highlight-col">${totalFinal.toFixed(1)}%</td>
            <td class="text-right font-mono ${totalDeltaM1 >= 0 ? 'change-positive' : 'change-negative'}">${totalDeltaM1 >= 0 ? '+' : ''}${totalDeltaM1.toFixed(1)}%</td>
            <td class="text-right font-mono ${totalDeltaFinal >= 0 ? 'change-positive' : 'change-negative'}">${totalDeltaFinal >= 0 ? '+' : ''}${totalDeltaFinal.toFixed(1)}%</td>
        </tr>
    `);

    tbody.innerHTML = rows.join('');
}

function renderBucketSummaryCards() {
    const container = document.getElementById('bucketSummaryCards');
    if (!container || !currentSnapshot) return;

    const effective = getEffectiveSnapshot(currentSnapshot);
    const ft = calculateFilteredTotals(effective);
    const totalPortfolio = ft.totalValue;
    const avanzaWeight = ft.avanzaValue / totalPortfolio;
    const nordnetWeight = ft.nordnetValue / totalPortfolio;

    const bucketMeta = {
        1: { shortName: BUCKETS[1].name, color: '#22d3ee', class: 'badge-bucket-1' },
        2: { shortName: BUCKETS[2].name, color: '#fbbf24', class: 'badge-bucket-2' },
        3: { shortName: BUCKETS[3].name, color: '#34d399', class: 'badge-bucket-3' },
        0: { shortName: BUCKETS[0].name, color: '#f87171', class: 'badge-sell' }
    };

    // Calculate current bucket % for a broker
    const calcBrokerBuckets = (broker) => {
        const brokerKey = broker.toLowerCase();
        const holdings = getFilteredHoldings(effective).filter(h => h.brokerage === broker);
        const brokerValue = broker === 'Avanza' ? ft.avanzaValue : ft.nordnetValue;
        const scheduleData = rebalancingSchedule[brokerKey] || [];
        const scheduleKeys = scheduleData.map(s => s.name);
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        holdings.forEach(h => {
            const match = scheduleKeys.find(key => namesMatch(key, h.name));
            let bucket = h.bucket || 0;
            if (match) {
                const item = scheduleData.find(s => s.name === match);
                bucket = item.bucket;
            }
            buckets[bucket] += (h.value / brokerValue) * 100;
        });
        return buckets;
    };

    const calcFinalTargets = (broker) => {
        const targets = rebalancingTargets[broker] || [];
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        targets.forEach(t => { buckets[t.bucket] += t.target; });
        return buckets;
    };

    const avanzaCurrent = calcBrokerBuckets('Avanza');
    const nordnetCurrent = calcBrokerBuckets('Nordnet');
    const avanzaFinal = calcFinalTargets('avanza');
    const nordnetFinal = calcFinalTargets('nordnet');

    const _bt = getBucketTargets(REBALANCING_MONTHS);
    const getSelectedMonthTarget = (b) => _bt[b] ? _bt[b][currentRebalancingMonth - 1] : 0;

    // Determine which buckets to show
    const bucketsToShow = [1, 2, 3];
    const b0combined = (avanzaCurrent[0] * avanzaWeight) + (nordnetCurrent[0] * nordnetWeight);
    if (b0combined > 0.5) bucketsToShow.push(0);

    // Bullet chart: single horizontal bar with target markers
    const renderBullet = (current, m1Target, finalTarget, color, scaleMax) => {
        const toPct = (v) => Math.min(Math.max((v / scaleMax) * 100, 0), 100);
        const cP = toPct(current);
        const m1P = toPct(m1Target);
        const fP = toPct(finalTarget);
        return `<div class="relative" style="height:28px;">
            <!-- Background range -->
            <div class="absolute top-2 left-0 right-0 h-5 rounded-full" style="background:var(--bg-secondary);">
                <!-- Subtle range to final target -->
                <div class="absolute top-0 left-0 h-full rounded-full" style="width:${Math.max(cP, fP)}%;background:rgba(148,163,184,0.08);"></div>
                <!-- Current fill -->
                <div class="absolute top-0 left-0 h-full rounded-full transition-all duration-700" style="width:${cP}%;background:${color};opacity:0.6;"></div>
                <!-- M1 target line -->
                <div class="absolute" style="left:${m1P}%;top:-3px;bottom:-3px;width:2px;background:#fbbf24;border-radius:1px;z-index:2;"></div>
                <!-- Final target line -->
                <div class="absolute" style="left:${fP}%;top:-3px;bottom:-3px;width:2px;background:#34d399;border-radius:1px;z-index:2;"></div>
            </div>
            <!-- Current value label -->
            <div class="absolute text-[10px] font-mono font-bold" style="left:${Math.min(cP + 1, 90)}%;top:4px;color:${color};white-space:nowrap;">${current.toFixed(1)}%</div>
        </div>`;
    };

    // Build a single card with all bullet charts stacked vertically
    const bulletRows = bucketsToShow.map(b => {
        const meta = bucketMeta[b];
        const monthTarget = getSelectedMonthTarget(b);
        const aC = avanzaCurrent[b];
        const nC = nordnetCurrent[b];
        const aT = avanzaFinal[b];
        const nT = nordnetFinal[b];
        const combined = (aC * avanzaWeight) + (nC * nordnetWeight);
        const combinedTarget = (aT * avanzaWeight) + (nT * nordnetWeight);
        const scaleMax = Math.max(combined, monthTarget, combinedTarget, 10) * 1.25;
        const delta = combined - combinedTarget;
        const deltaSign = delta >= 0 ? '+' : '';
        const deltaColor = Math.abs(delta) < 2 ? 'text-emerald-400' : (delta > 0 ? 'text-amber-400' : 'text-amber-400');

        return `<div class="py-3 ${b !== bucketsToShow[bucketsToShow.length - 1] ? 'border-b border-[var(--border-subtle)]' : ''}">
            <!-- Bucket header -->
            <div class="flex items-center justify-between mb-1.5">
                <div class="flex items-center gap-2">
                    <span class="badge ${meta.class} text-xs">B${b}</span>
                    <span class="text-sm font-semibold">${meta.shortName}</span>
                </div>
                <div class="flex items-center gap-4 text-xs">
                    <span class="text-[var(--fg-muted)]">Avanza <span class="font-mono">${aC.toFixed(1)}%</span></span>
                    <span class="text-[var(--fg-muted)]">Nordnet <span class="font-mono">${nC.toFixed(1)}%</span></span>
                    <span class="font-mono font-bold ${deltaColor}">${deltaSign}${delta.toFixed(1)}%</span>
                </div>
            </div>
            <!-- Bullet chart -->
            ${renderBullet(combined, monthTarget, combinedTarget, meta.color, scaleMax)}
            <!-- Target legend -->
            <div class="flex items-center gap-4 mt-1 text-[10px] text-[var(--fg-muted)]">
                <span>${getMonthShortLabel(currentRebalancingMonth)} Target <span class="font-mono" style="color:#fbbf24;">${monthTarget.toFixed(1)}%</span></span>
                <span>Final <span class="font-mono" style="color:#34d399;">${combinedTarget.toFixed(1)}%</span></span>
            </div>
        </div>`;
    }).join('');

    // Global legend
    const legend = `<div class="flex items-center gap-6 mb-4 text-xs text-[var(--fg-muted)] px-1">
        <span class="flex items-center gap-1.5"><span style="display:inline-block;width:12px;height:6px;border-radius:3px;opacity:0.6;background:#94a3b8;"></span> Current allocation</span>
        <span class="flex items-center gap-1.5"><span style="display:inline-block;width:2px;height:10px;background:#fbbf24;border-radius:1px;"></span> ${getMonthShortLabel(currentRebalancingMonth)} Target</span>
        <span class="flex items-center gap-1.5"><span style="display:inline-block;width:2px;height:10px;background:#34d399;border-radius:1px;"></span> Final Target</span>
    </div>`;

    container.innerHTML = `<div class="card p-5 col-span-1 lg:col-span-2">
        ${legend}
        ${bulletRows}
    </div>`;
}"use strict";

function renderDistributionChart() {
  const ctx = document.getElementById('distributionChart');
  if (!ctx || !currentSnapshot) return;
  const effective = getEffectiveSnapshot(currentSnapshot);
  const filteredHoldings = getFilteredHoldings(effective);
  // Apply reference table classifications (same as holdings table)
  const classifiedHoldings = filteredHoldings.map(h => {
    const cls = getClassificationFromReference(h.name, h.brokerage);
    return { ...h, category: cls.found ? cls.category : (h.category || 'Unassigned') };
  });
  const categories = {};
  classifiedHoldings.forEach(h => { if (!categories[h.category]) categories[h.category] = 0; categories[h.category] += h.value; });
  const labels = Object.keys(categories);
  const data = Object.values(categories);
  const colors = labels.map(cat => categoryColors[cat]?.chart || 'rgba(148, 163, 184, 0.8)');
  if (distributionChart) distributionChart.destroy();
  distributionChart = new Chart(ctx, {
    type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'circle' } } } }
  });
}

function renderBrokerageChart() {
  const ctx = document.getElementById('brokerageChart');
  if (!ctx || !currentSnapshot) return;
  const effective = getEffectiveSnapshot(currentSnapshot);
  const ft = calculateFilteredTotals(effective);
  if (brokerageChart) brokerageChart.destroy();
  brokerageChart = new Chart(ctx, {
    type: 'doughnut', data: { labels: ['Nordnet', 'Avanza'], datasets: [{ data: [ft.nordnetValue, ft.avanzaValue], backgroundColor: ['rgba(6, 182, 212, 0.8)', 'rgba(16, 185, 129, 0.8)'], borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'circle' } } } }
  });
}

function renderCategoryBreakdown() {
  const container = document.getElementById('categoryBreakdown');
  if (!container || !currentSnapshot) return;
  const effective = getEffectiveSnapshot(currentSnapshot);
  const filteredHoldings = getFilteredHoldings(effective);
  // Apply reference table classifications (same as holdings table)
  const classifiedHoldings = filteredHoldings.map(h => {
    const cls = getClassificationFromReference(h.name, h.brokerage);
    return { ...h, category: cls.found ? cls.category : (h.category || 'Unassigned') };
  });
  const ft = calculateFilteredTotals(effective);
  const categories = {};
  classifiedHoldings.forEach(h => { if (!categories[h.category]) categories[h.category] = { value: 0, holdings: [] }; categories[h.category].value += h.value; categories[h.category].holdings.push(h); });
  const sorted = Object.entries(categories).sort((a, b) => b[1].value - a[1].value);
  const total = ft.totalValue;
  container.innerHTML = sorted.map(([cat, data]) => {
    const percent = ((data.value / total) * 100).toFixed(1);
    const color = categoryColors[cat] || { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8', chart: 'rgba(148, 163, 184, 0.8)' };
    return `<div class="bg-[var(--bg-secondary)] rounded-lg p-4"><div class="flex items-center justify-between mb-2"><span class="badge" style="background: ${color.bg}; color: ${color.text}">${cat}</span><span class="text-sm text-[var(--fg-muted)]">${data.holdings.length} holdings</span></div><div class="flex items-end justify-between mb-2"><span class="text-xl font-bold">${formatCurrency(data.value)}</span><span class="text-lg font-semibold">${percent}%</span></div><div class="progress-bar"><div class="progress-fill" style="width: ${percent}%; background: ${color.chart}"></div></div></div>`;
  }).join('');
}

function renderEvolutionChart() {
  const ctx = document.getElementById('evolutionChart');
  if (!ctx || snapshots.length < 2) {
    if (ctx) {
      const parent = ctx.parentElement;
      parent.innerHTML = '<div class="flex items-center justify-center h-full text-[var(--fg-muted)]"><p>At least 2 snapshots needed to show evolution</p></div>';
    }
    return;
  }

  if (evolutionChart) evolutionChart.destroy();

  const effectiveSnaps = getAllEffectiveSnapshots();
  const labels = effectiveSnaps.map(s => s.dateStr);
  const filtered = effectiveSnaps.map(s => calculateFilteredTotals(s));
  const data = filtered.map(f => f.totalValue);
  const nordnetData = filtered.map(f => f.nordnetValue);
  const avanzaData = filtered.map(f => f.avanzaValue);

  evolutionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total', data, borderColor: 'rgba(16, 185, 129, 1)', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.3 },
        { label: 'Nordnet', data: nordnetData, borderColor: 'rgba(6, 182, 212, 1)', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.3 },
        { label: 'Avanza', data: avanzaData, borderColor: 'rgba(16, 185, 129, 0.7)', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'DM Sans' } } } },
      scales: {
        x: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8', callback: (v) => 'SEK ' + (v / 1e6).toFixed(1) + 'M' } }
      }
    }
  });
}

function renderCategoryEvolutionChart() {
  const ctx = document.getElementById('categoryEvolutionChart');
  if (!ctx || snapshots.length < 2) {
    if (ctx) {
      const parent = ctx.parentElement;
      parent.innerHTML = '<div class="flex items-center justify-center h-full text-[var(--fg-muted)]"><p>At least 2 snapshots needed to show evolution</p></div>';
    }
    return;
  }

  if (categoryEvolutionChart) categoryEvolutionChart.destroy();

  const effectiveSnaps = getAllEffectiveSnapshots();
  const labels = effectiveSnaps.map(s => s.dateStr);
  const allCategories = [...new Set(effectiveSnaps.flatMap(s => s.holdings.map(h => h.category)))];
  
  const datasets = allCategories.map(cat => {
    const data = effectiveSnaps.map(s => {
      return getFilteredHoldings(s).filter(h => h.category === cat).reduce((sum, h) => sum + h.value, 0);
    });
    const color = categoryColors[cat] || { chart: 'rgba(148, 163, 184, 0.8)' };
    return { label: cat, data, borderColor: color.chart, backgroundColor: 'transparent', tension: 0.3 };
  });

  categoryEvolutionChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'DM Sans', size: 10 }, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        x: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8', callback: (v) => 'SEK ' + (v / 1e6).toFixed(1) + 'M' } }
      }
    }
  });
}

function renderBucketEvolutionChart() {
  const ctx = document.getElementById('bucketEvolutionChart');
  console.log('Bucket Evolution: ctx =', ctx, ', snapshots.length =', snapshots.length);
  
  if (!ctx) {
    console.error('Bucket Evolution: canvas element not found');
    return;
  }
  
  if (snapshots.length < 2) {
    console.log('Bucket Evolution: not enough snapshots');
    const parent = ctx.parentElement;
    if (parent) {
      parent.innerHTML = '<div class="flex items-center justify-center h-full text-[var(--fg-muted)]"><p>At least 2 snapshots needed to show evolution</p></div>';
    }
    return;
  }

  if (bucketEvolutionChart) bucketEvolutionChart.destroy();

  const effectiveSnaps = getAllEffectiveSnapshots();
  console.log('Bucket Evolution: effective snapshots =', effectiveSnaps.length);
  const labels = effectiveSnaps.map(s => s.dateStr);
  console.log('Bucket Evolution: labels =', labels);

  // Apply reference table classifications to all holdings in effective snapshots
  // This ensures holdings have correct bucket values
  effectiveSnaps.forEach(snap => {
    snap.holdings.forEach(h => {
      const cls = getClassificationFromReference(h.name, h.brokerage);
      if (cls.found) {
        h.bucket = cls.bucket;
      } else {
        // Fall back to category rules
        const csvCat = h.category || 'Unassigned';
        h.bucket = categoryRules[csvCat] !== undefined ? categoryRules[csvCat] : 0;
      }
    });
  });

  // Calculate bucket allocations as percentages for each snapshot
  const datasets = [
    {
      label: 'Bucket 1 (Cash/Short)',
      data: effectiveSnaps.map(s => {
        const filtered = getFilteredHoldings(s);
        const totalValue = filtered.reduce((sum, h) => sum + h.value, 0);
        if (totalValue === 0) return 0;
        return filtered.filter(h => h.bucket === 1).reduce((sum, h) => sum + h.value, 0) / totalValue * 100;
      }),
      borderColor: 'rgba(34, 211, 238, 1)',
      backgroundColor: 'rgba(34, 211, 238, 0.1)',
      tension: 0.3
    },
    {
      label: 'Bucket 2 (Fixed Income/Commodities)',
      data: effectiveSnaps.map(s => {
        const filtered = getFilteredHoldings(s);
        const totalValue = filtered.reduce((sum, h) => sum + h.value, 0);
        if (totalValue === 0) return 0;
        return filtered.filter(h => h.bucket === 2).reduce((sum, h) => sum + h.value, 0) / totalValue * 100;
      }),
      borderColor: 'rgba(251, 191, 36, 1)',
      backgroundColor: 'rgba(251, 191, 36, 0.1)',
      tension: 0.3
    },
    {
      label: 'Bucket 3 (Equity)',
      data: effectiveSnaps.map(s => {
        const filtered = getFilteredHoldings(s);
        const totalValue = filtered.reduce((sum, h) => sum + h.value, 0);
        if (totalValue === 0) return 0;
        return filtered.filter(h => h.bucket === 3).reduce((sum, h) => sum + h.value, 0) / totalValue * 100;
      }),
      borderColor: 'rgba(52, 211, 153, 1)',
      backgroundColor: 'rgba(52, 211, 153, 0.1)',
      tension: 0.3
    }
  ];

  bucketEvolutionChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { 
        legend: { 
          labels: { color: '#94a3b8', font: { family: 'DM Sans' } },
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8' } },
        y: { 
          grid: { color: 'rgba(45, 58, 82, 0.5)' }, 
          ticks: { color: '#94a3b8', callback: (v) => v + '%' },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function renderBucket1HoldingsChart() {
  const ctx = document.getElementById('bucket1HoldingsChart');
  if (!ctx || snapshots.length < 2) {
    if (ctx) {
      const parent = ctx.parentElement;
      parent.innerHTML = '<div class="flex items-center justify-center h-full text-[var(--fg-muted)]"><p>At least 2 snapshots needed to show evolution</p></div>';
    }
    return;
  }

  if (bucket1HoldingsChart) bucket1HoldingsChart.destroy();

  const effectiveSnaps = getAllEffectiveSnapshots();
  const labels = effectiveSnaps.map(s => s.dateStr);

  // Apply bucket classifications
  effectiveSnaps.forEach(snap => {
    snap.holdings.forEach(h => {
      const cls = getClassificationFromReference(h.name, h.brokerage);
      if (cls.found) h.bucket = cls.bucket;
      else {
        const csvCat = h.category || 'Unassigned';
        h.bucket = categoryRules[csvCat] !== undefined ? categoryRules[csvCat] : 0;
      }
    });
  });

  // Collect all unique holdings in bucket 1 across all snapshots
  const bucket1Holdings = new Set();
  effectiveSnaps.forEach(s => {
    getFilteredHoldings(s).filter(h => h.bucket === 1).forEach(h => bucket1Holdings.add(h.name));
  });

  // Create datasets for each holding
  const datasets = Array.from(bucket1Holdings).map((name, index) => {
    const colorIndex = index % 10;
    const colors = [
      'rgba(34, 211, 238, 1)', 'rgba(6, 182, 212, 1)', 'rgba(59, 130, 246, 1)',
      'rgba(99, 102, 241, 1)', 'rgba(168, 85, 247, 1)', 'rgba(236, 72, 153, 1)',
      'rgba(239, 68, 68, 1)', 'rgba(249, 115, 22, 1)', 'rgba(245, 158, 11, 1)',
      'rgba(16, 185, 129, 1)'
    ];
    
    const data = effectiveSnaps.map(s => {
      const filtered = getFilteredHoldings(s);
      const bucket1HoldingsInSnap = filtered.filter(h => h.bucket === 1);
      const bucket1Total = bucket1HoldingsInSnap.reduce((sum, h) => sum + h.value, 0);
      if (bucket1Total === 0) return 0;
      
      const holding = bucket1HoldingsInSnap.find(h => h.name === name);
      return holding ? (holding.value / bucket1Total) * 100 : 0;
    });

    return {
      label: name,
      data,
      borderColor: colors[colorIndex],
      backgroundColor: 'transparent',
      tension: 0.3,
      borderWidth: 2
    };
  });

  bucket1HoldingsChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: 'DM Sans', size: 10 },
            usePointStyle: true,
            pointStyle: 'circle'
          },
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8' } },
        y: {
          grid: { color: 'rgba(45, 58, 82, 0.5)' },
          ticks: { color: '#94a3b8', callback: (v) => v + '%' },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function renderBucket2HoldingsChart() {
  const ctx = document.getElementById('bucket2HoldingsChart');
  if (!ctx || snapshots.length < 2) {
    if (ctx) {
      const parent = ctx.parentElement;
      parent.innerHTML = '<div class="flex items-center justify-center h-full text-[var(--fg-muted)]"><p>At least 2 snapshots needed to show evolution</p></div>';
    }
    return;
  }

  if (bucket2HoldingsChart) bucket2HoldingsChart.destroy();

  const effectiveSnaps = getAllEffectiveSnapshots();
  const labels = effectiveSnaps.map(s => s.dateStr);

  // Apply bucket classifications
  effectiveSnaps.forEach(snap => {
    snap.holdings.forEach(h => {
      const cls = getClassificationFromReference(h.name, h.brokerage);
      if (cls.found) h.bucket = cls.bucket;
      else {
        const csvCat = h.category || 'Unassigned';
        h.bucket = categoryRules[csvCat] !== undefined ? categoryRules[csvCat] : 0;
      }
    });
  });

  // Collect all unique holdings in bucket 2 across all snapshots
  const bucket2Holdings = new Set();
  effectiveSnaps.forEach(s => {
    getFilteredHoldings(s).filter(h => h.bucket === 2).forEach(h => bucket2Holdings.add(h.name));
  });

  // Create datasets for each holding
  const datasets = Array.from(bucket2Holdings).map((name, index) => {
    const colorIndex = index % 10;
    const colors = [
      'rgba(251, 191, 36, 1)', 'rgba(245, 158, 11, 1)', 'rgba(249, 115, 22, 1)',
      'rgba(239, 68, 68, 1)', 'rgba(236, 72, 153, 1)', 'rgba(168, 85, 247, 1)',
      'rgba(99, 102, 241, 1)', 'rgba(59, 130, 246, 1)', 'rgba(6, 182, 212, 1)',
      'rgba(34, 211, 238, 1)'
    ];
    
    const data = effectiveSnaps.map(s => {
      const filtered = getFilteredHoldings(s);
      const bucket2HoldingsInSnap = filtered.filter(h => h.bucket === 2);
      const bucket2Total = bucket2HoldingsInSnap.reduce((sum, h) => sum + h.value, 0);
      if (bucket2Total === 0) return 0;
      
      const holding = bucket2HoldingsInSnap.find(h => h.name === name);
      return holding ? (holding.value / bucket2Total) * 100 : 0;
    });

    return {
      label: name,
      data,
      borderColor: colors[colorIndex],
      backgroundColor: 'transparent',
      tension: 0.3,
      borderWidth: 2
    };
  });

  bucket2HoldingsChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: 'DM Sans', size: 10 },
            usePointStyle: true,
            pointStyle: 'circle'
          },
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8' } },
        y: {
          grid: { color: 'rgba(45, 58, 82, 0.5)' },
          ticks: { color: '#94a3b8', callback: (v) => v + '%' },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function renderBucket3HoldingsChart() {
  const ctx = document.getElementById('bucket3HoldingsChart');
  if (!ctx || snapshots.length < 2) {
    if (ctx) {
      const parent = ctx.parentElement;
      parent.innerHTML = '<div class="flex items-center justify-center h-full text-[var(--fg-muted)]"><p>At least 2 snapshots needed to show evolution</p></div>';
    }
    return;
  }

  if (bucket3HoldingsChart) bucket3HoldingsChart.destroy();

  const effectiveSnaps = getAllEffectiveSnapshots();
  const labels = effectiveSnaps.map(s => s.dateStr);

  // Apply bucket classifications
  effectiveSnaps.forEach(snap => {
    snap.holdings.forEach(h => {
      const cls = getClassificationFromReference(h.name, h.brokerage);
      if (cls.found) h.bucket = cls.bucket;
      else {
        const csvCat = h.category || 'Unassigned';
        h.bucket = categoryRules[csvCat] !== undefined ? categoryRules[csvCat] : 0;
      }
    });
  });

  // Collect all unique holdings in bucket 3 across all snapshots
  const bucket3Holdings = new Set();
  effectiveSnaps.forEach(s => {
    getFilteredHoldings(s).filter(h => h.bucket === 3).forEach(h => bucket3Holdings.add(h.name));
  });

  // Create datasets for each holding
  const datasets = Array.from(bucket3Holdings).map((name, index) => {
    const colorIndex = index % 10;
    const colors = [
      'rgba(52, 211, 153, 1)', 'rgba(34, 211, 238, 1)', 'rgba(6, 182, 212, 1)',
      'rgba(59, 130, 246, 1)', 'rgba(99, 102, 241, 1)', 'rgba(168, 85, 247, 1)',
      'rgba(236, 72, 153, 1)', 'rgba(239, 68, 68, 1)', 'rgba(249, 115, 22, 1)',
      'rgba(245, 158, 11, 1)'
    ];
    
    const data = effectiveSnaps.map(s => {
      const filtered = getFilteredHoldings(s);
      const bucket3HoldingsInSnap = filtered.filter(h => h.bucket === 3);
      const bucket3Total = bucket3HoldingsInSnap.reduce((sum, h) => sum + h.value, 0);
      if (bucket3Total === 0) return 0;
      
      const holding = bucket3HoldingsInSnap.find(h => h.name === name);
      return holding ? (holding.value / bucket3Total) * 100 : 0;
    });

    return {
      label: name,
      data,
      borderColor: colors[colorIndex],
      backgroundColor: 'transparent',
      tension: 0.3,
      borderWidth: 2
    };
  });

  bucket3HoldingsChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: 'DM Sans', size: 10 },
            usePointStyle: true,
            pointStyle: 'circle'
          },
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(45, 58, 82, 0.5)' }, ticks: { color: '#94a3b8' } },
        y: {
          grid: { color: 'rgba(45, 58, 82, 0.5)' },
          ticks: { color: '#94a3b8', callback: (v) => v + '%' },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function populateFilters() {
  updateCategories();
  const categoryFilter = document.getElementById('categoryFilter');
  categoryFilter.innerHTML = '<option value="all">All Categories</option>' + CATEGORIES.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
}

function populateCompareSelects() {
  const fromSelect = document.getElementById('compareFrom');
  const toSelect = document.getElementById('compareTo');
  if (!fromSelect || !toSelect || snapshots.length < 1) return;

  fromSelect.innerHTML = snapshots.map((s, i) => `<option value="${i}">${escapeHtml(s.dateStr)}</option>`).join('');
  toSelect.innerHTML = snapshots.map((s, i) => `<option value="${i}" ${i === snapshots.length - 1 ? 'selected' : ''}>${escapeHtml(s.dateStr)}</option>`).join('');
}

function updateCharts() {
  if (!document.getElementById('overviewTab').classList.contains('hidden')) {
    renderDistributionChart();
    renderBrokerageChart();
    renderCategoryBreakdown();
  }
  if (!document.getElementById('evolutionTab').classList.contains('hidden')) {
    renderEvolutionChart();
    renderCategoryEvolutionChart();
    renderBucketEvolutionChart();
  }
}

function getClassificationFromReference(name, broker) {
  // Ensure reference table is loaded
  if (classificationReference.avanza.length === 0 && classificationReference.nordnet.length === 0) {
    loadReferenceTable();
  }
  
  const ref = classificationReference[broker.toLowerCase()];
  if (ref && ref.length > 0) {
    const match = ref.find(r => namesMatch(r.name, name));
    if (match) {
      return { category: match.category, bucket: match.bucket, found: true };
    }
  }
  return { category: null, bucket: null, found: false };
}

function clearAllExclusions() {
  excludedAssets.clear();
  saveExcludedAssets();
  refreshAllCalculations();
}

function refreshAllCalculations() {
  updateStats();
  updateCharts();
  renderHoldingsTable();
  if (!document.getElementById('rebalancingTab').classList.contains('hidden')) {
    renderRebalancingTables();
  }
}

function renderHoldingsTable() {
  const tbody = document.getElementById('holdingsTable');
  if (!tbody || !currentSnapshot) return;
  
  const effective = getEffectiveSnapshot(currentSnapshot);
  const brokerageFilter = document.getElementById('brokerageFilter').value;
  const categoryFilter = document.getElementById('categoryFilter').value;
  
  let filtered = [...effective.holdings];
  
  // Classify each holding based on reference table
  filtered.forEach(h => {
    const cls = getClassificationFromReference(h.name, h.brokerage);
    if (cls.found) {
      h.category = cls.category;
      h.bucket = cls.bucket;
    } else {
      // Not in reference table: keep CSV category but derive bucket from category rules
      const csvCat = h.category || 'Unassigned';
      h.bucket = categoryRules[csvCat] !== undefined ? categoryRules[csvCat] : 0;
    }
  });

  if (brokerageFilter !== 'all') filtered = filtered.filter(h => h.brokerage === brokerageFilter);
  if (categoryFilter !== 'all') filtered = filtered.filter(h => h.category === categoryFilter);
  
  filtered.sort((a, b) => b.value - a.value);

  // Calculate filtered total for percentage display
  const filteredTotals = calculateFilteredTotals(effective);
  const displayTotal = filteredTotals.totalValue;

  // Update exclude banner
  const banner = document.getElementById('excludeBanner');
  const bannerText = document.getElementById('excludeBannerText');
  if (banner && bannerText) {
    if (excludedAssets.size > 0) {
      banner.classList.remove('hidden');
      bannerText.textContent = `${excludedAssets.size} asset${excludedAssets.size > 1 ? 's' : ''} excluded`;
    } else {
      banner.classList.add('hidden');
    }
  }
  
  tbody.innerHTML = filtered.map((h) => {
    const excluded = isAssetExcluded(h.name, h.brokerage);
    const catColor = categoryColors[h.category] || { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8' };
    const escapedName = escapeHtml(h.name).replace(/'/g, "\\'");
    const catOptions = [...new Set([...CATEGORIES, ...currentSnapshot.holdings.map(hh => hh.category)])].sort().map(c => 
      `<option value="${c}" ${h.category === c ? 'selected' : ''}>${c}</option>`
    ).join('');
    const catBadge = `<select class="edit-select" onchange="handleCategoryChange('${escapedName}','${h.brokerage}',this.value)">${catOptions}</select>`;
    
    const bucketInfo = BUCKETS[h.bucket] || { name: 'Unknown', class: 'badge-other' };
    const bucketOptions = Object.entries(BUCKETS).map(([k, v]) => 
      `<option value="${k}" ${h.bucket == k ? 'selected' : ''}>B${k}: ${v.name}</option>`
    ).join('');
    const bucketBadge = `<select class="edit-select" onchange="handleBucketChange('${escapedName}','${h.brokerage}',this.value)">${bucketOptions}</select>`;
    
    const pct = displayTotal > 0 ? ((h.value / displayTotal) * 100).toFixed(2) : '0.00';
    
    const carriedStyle = h.carriedForward ? 'opacity:0.6;' : '';
    const carriedBadge = h.carriedForward ? ` <span style="font-size:10px;color:var(--accent-warning);" title="Data carried from ${h.carriedFromDate}">↩</span>` : '';
    return `<tr class="${excluded ? 'excluded-row' : ''}" style="${carriedStyle}">
        <td class="text-center"><input type="checkbox" class="exclude-checkbox" ${excluded ? 'checked' : ''} onchange="handleExcludeToggle('${h.name.replace(/'/g, "\\'")}', '${h.brokerage}', this.checked)" title="Exclude from calculations"></td>
        <td class="font-medium">${escapeHtml(h.name)}${carriedBadge}</td>
        <td>${escapeHtml(h.brokerage)}</td>
        <td>${catBadge}</td>
        <td>${bucketBadge}</td>
        <td class="font-mono">${formatCurrency(h.value)}</td>
        <td class="font-mono">${pct}%</td>
    </tr>`;
  }).join('');
}

function handleExcludeToggle(name, brokerage, checked) {
  toggleAssetExclusion(name, brokerage);
  refreshAllCalculations();
}

// --- COMPARISON LOGIC (FIXED) ---

function runComparison() {
  const fromIndex = parseInt(document.getElementById('compareFrom').value); 
  const toIndex = parseInt(document.getElementById('compareTo').value);
  if (fromIndex === toIndex) return;
  
  const fromSnapshot = getEffectiveSnapshot(snapshots[fromIndex]); 
  const toSnapshot = getEffectiveSnapshot(snapshots[toIndex]);
  
  // Filter excluded holdings for comparison
  const fromHoldings = getFilteredHoldings(fromSnapshot);
  const toHoldings = getFilteredHoldings(toSnapshot);
  const fromTotals = calculateFilteredTotals(fromSnapshot);
  const toTotals = calculateFilteredTotals(toSnapshot);
  
  const valueChange = toTotals.totalValue - fromTotals.totalValue; 
  const valueChangePercent = fromTotals.totalValue > 0 ? ((valueChange / fromTotals.totalValue) * 100).toFixed(2) : '0.00';
  
  document.getElementById('comparisonSummary').innerHTML = `
    <div class="flex justify-between items-center py-2 border-b border-[var(--border)]"><span class="text-[var(--fg-muted)]">From</span><span class="font-medium">${fromSnapshot.dateStr}</span></div>
    <div class="flex justify-between items-center py-2 border-b border-[var(--border)]"><span class="text-[var(--fg-muted)]">To</span><span class="font-medium">${toSnapshot.dateStr}</span></div>
    <div class="flex justify-between items-center py-2 border-b border-[var(--border)]"><span class="text-[var(--fg-muted)]">Starting Value</span><span class="font-mono">${formatCurrency(fromTotals.totalValue)}</span></div>
    <div class="flex justify-between items-center py-2 border-b border-[var(--border)]"><span class="text-[var(--fg-muted)]">Ending Value</span><span class="font-mono">${formatCurrency(toTotals.totalValue)}</span></div>
    <div class="flex justify-between items-center py-2"><span class="text-[var(--fg-muted)]">Total Change</span><span class="font-bold ${valueChange >= 0 ? 'change-positive' : 'change-negative'}">${valueChange >= 0 ? '+' : ''}${formatCurrency(valueChange)} (${valueChangePercent}%)</span></div>
  `;

  const changes = []; 
  const processedKeys = new Set();

  // Helper: get category from reference table
  const getCat = (h) => {
      const cls = getClassificationFromReference(h.name, h.brokerage);
      return cls.found ? cls.category : (h.category || 'Unassigned');
  };

  // 1. Process holdings currently in 'To' snapshot
  toHoldings.forEach(h => {
      const key = `${h.name}-${h.brokerage}`;
      processedKeys.add(key);
      
      const fromHolding = fromHoldings.find(fh => fh.name === h.name && fh.brokerage === h.brokerage);
      const cat = getCat(h);
      
      let changeData;
      
      if (fromHolding) {
          // Existing holding
          const change = h.value - fromHolding.value;
          const changePercent = fromHolding.value > 0 ? ((change / fromHolding.value) * 100).toFixed(2) : (h.value > 0 ? 100 : 0).toFixed(2);
          changeData = {
              name: h.name,
              category: cat,
              fromValue: fromHolding.value,
              toValue: h.value,
              change,
              changePercent,
              status: 'held'
          };
      } else {
          // NEW holding
          changeData = {
              name: h.name,
              category: cat,
              fromValue: 0,
              toValue: h.value,
              change: h.value,
              changePercent: 'NEW',
              status: 'new'
          };
      }
      changes.push(changeData);
  });

  // 2. Process holdings that were in 'From' but not in 'To' (SOLD)
  fromHoldings.forEach(h => {
      const key = `${h.name}-${h.brokerage}`;
      
      if (!processedKeys.has(key)) {
          changes.push({
              name: h.name,
              category: getCat(h),
              fromValue: h.value,
              toValue: 0,
              change: -h.value,
              changePercent: 'SOLD',
              status: 'sold'
          });
      }
  });
  
  // Sort by magnitude of change
  changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  document.getElementById('comparisonTable').innerHTML = changes.map(c => { 
      const color = categoryColors[c.category] || { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8' }; 
      
      let changeDisplay;
      let changePercentDisplay;

      if (c.status === 'new') {
          changeDisplay = `<span class="badge badge-new">NEW</span>`;
          changePercentDisplay = `<span class="badge badge-bucket-3">+100%</span>`;
      } else if (c.status === 'sold') {
          changeDisplay = `<span class="badge badge-sell">SOLD</span>`;
          changePercentDisplay = `<span class="badge badge-sell">-100%</span>`;
      } else {
          changeDisplay = `<span class="${c.change >= 0 ? 'change-positive' : 'change-negative'}">${c.change >= 0 ? '+' : ''}${formatCurrency(c.change)}</span>`;
          changePercentDisplay = `<span class="${c.change >= 0 ? 'change-positive' : 'change-negative'}">${c.changePercent > 0 ? '+' : ''}${c.changePercent}%</span>`;
      }

      return `<tr>
          <td class="font-medium">${c.name}</td>
          <td><span class="badge" style="background: ${color.bg}; color: ${color.text}">${c.category}</span></td>
          <td class="font-mono">${formatCurrency(c.fromValue)}</td>
          <td class="font-mono">${formatCurrency(c.toValue)}</td>
          <td class="font-mono">${changeDisplay}</td>
          <td class="font-mono">${changePercentDisplay}</td>
      </tr>`; 
  }).join('');
}


// --- ANALYTICS: Historical Performance ---
let performanceData = null;
let returnsChart = null;
let perfSortKey = null;
let perfSortAsc = true;

// Recommendations table sort state
let recSortKey = null;
let recSortAsc = true;

const PERF_LS_KEY = 'portfolioTracker_performance';

// --- DYNAMIC ASSET LIST FOR PERFORMANCE PARSING ---
function getKnownAssetNames() {
  const names = new Set();
  // From reference table (Avanza only — performance data comes from Avanza)
  (classificationReference.avanza || []).forEach(r => names.add(r.name));
  // From all snapshots (Avanza holdings)
  snapshots.forEach(s => {
    s.holdings.filter(h => h.brokerage === 'Avanza').forEach(h => names.add(h.name));
  });
  // Always include these as fallback
  const fallback = ['Newmont', 'Range Resources', 'Cash'];
  fallback.forEach(n => names.add(n));
  return Array.from(names);
}

// Parse Avanza performance PDF text
function parseAvanzaPerformancePDFText(text) {
  // Helper: Parse Swedish number format (comma as decimal separator)
  const parseSwedishPercent = (str) => {
    if (!str) return null;
    const cleaned = str.replace(/[\u2212−]/g, '-').replace(/\s/g, '').replace(',', '.').replace('%', '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
  };

  const periodKeys = ['1W', '1M', '3M', '1Y', '3Y', '5Y'];
  const periodLabels = ['1 Week', '1 Month', '3 Months', '1 Year', '3 Years', '5 Years'];

  const assets = [];

  // DYNAMIC: Build asset list from reference table + snapshots
  const allKnownNames = getKnownAssetNames();

  // Determine which assets are stocks vs funds based on reference table
  const stockNames = new Set();
  const fundNames = new Set();
  allKnownNames.forEach(name => {
    const cls = getClassificationFromReference(name, 'avanza');
    if (cls.found) {
      // Stocks typically have categories like Energy, Materials, etc.
      const stockCategories = ['Energy', 'Materials', 'Financials', 'Industrials', 'Real Estate',
        'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Health Care',
        'Information Technology', 'Utilities'];
      if (stockCategories.includes(cls.category)) {
        stockNames.add(name);
      } else {
        fundNames.add(name);
      }
    } else {
      // Check snapshots to determine type
      const inSnapshots = snapshots.flatMap(s => s.holdings)
        .filter(h => h.brokerage === 'Avanza' && namesMatch(h.name, name));
      if (inSnapshots.length > 0) {
        const cat = inSnapshots[0].category || '';
        if (['Energy', 'Materials'].includes(cat)) {
          stockNames.add(name);
        } else {
          fundNames.add(name);
        }
      } else {
        // Fallback: known stocks
        if (['Newmont', 'Range Resources'].some(s => namesMatch(s, name))) {
          stockNames.add(name);
        } else {
          fundNames.add(name);
        }
      }
    }
  });

  // Merge all names for searching (we search full text, not sections)
  const allNames = [...new Set([...stockNames, ...fundNames])];
  const processedNames = new Set();
  const assetMap = new Map(); // name -> {assetType, name, returns}

  // Helper: find the best fuzzy match for a name in the text
  const fuzzyIndexOf = (haystack, needle) => {
    // Exact match
    const exactIdx = haystack.indexOf(needle);
    if (exactIdx >= 0) return exactIdx;

    // Try finding the longest common prefix (handles truncated names like "AMF Företagsobligati...")
    // Find where the name starts in the text by looking for significant substrings
    const words = needle.split(/\s+/);
    if (words.length >= 2) {
      // Try matching with first word + start of second word
      const prefix = words[0] + ' ' + words[1].substring(0, Math.max(3, words[1].length - 3));
      const prefixIdx = haystack.indexOf(prefix);
      if (prefixIdx >= 0) return prefixIdx;
    }

    // Try each word >= 5 chars as a search term
    for (const word of words) {
      if (word.length >= 5) {
        const wordIdx = haystack.indexOf(word);
        if (wordIdx >= 0) {
          // Verify there's a percentage cluster nearby (within 200 chars)
          const nearby = haystack.substring(wordIdx, wordIdx + 200);
          if (/[+\u2212-]?\s*\d+,\d{2}\s*%/.test(nearby)) {
            return wordIdx;
          }
        }
      }
    }

    return -1;
  };

  // Pattern for 7 percentage values: handles both "+9,42 %" and "−2,98 %" (Unicode minus)
  // Values may be separated by spaces or directly concatenated
  const sevenPctPattern = /([+\u2212-]?\s*\d+,\d{2}\s*%)[\s]*([+\u2212-]?\s*\d+,\d{2}\s*%)[\s]*([+\u2212-]?\s*\d+,\d{2}\s*%)[\s]*([+\u2212-]?\s*\d+,\d{2}\s*%)[\s]*([+\u2212-]?\s*\d+,\d{2}\s*%)[\s]*([+\u2212-]?\s*\d+,\d{2}\s*%)[\s]*([+\u2212-]?\s*\d+,\d{2}\s*%)/;

  // Search for each known asset name in the FULL text (not section-limited)
  allNames.forEach(assetName => {
    if (processedNames.has(assetName)) return;

    const idx = fuzzyIndexOf(text, assetName);
    if (idx < 0) return;

    const afterName = text.substring(idx + 1); // +1 to avoid matching the name itself
    const pctMatch = afterName.match(sevenPctPattern);
    if (!pctMatch || pctMatch.length < 7) {
      // Try alternate: just find 7 consecutive percentage values near the name
      const nearby = text.substring(idx, idx + 400);
      const allPcts = nearby.match(/([+\u2212-]?\s*\d+,\d{2}\s*%)/g);
      if (allPcts && allPcts.length >= 7) {
        const values = allPcts.slice(0, 7).map(m => parseSwedishPercent(m));
        const returns = {};
        returns['1W'] = values[0];
        returns['1M'] = values[1];
        returns['3M'] = values[2];
        // Skip index 3 (YTD/i år)
        returns['1Y'] = values[4];
        returns['3Y'] = values[5];
        returns['5Y'] = values[6];

        const isStock = stockNames.has(assetName);
        assetMap.set(assetName, {
          assetType: isStock ? 'Stock' : 'Fund',
          name: assetName,
          returns
        });
        processedNames.add(assetName);
      }
      return;
    }

    const values = pctMatch.slice(0, 7).map(m => parseSwedishPercent(m));
    const returns = {};
    returns['1W'] = values[0];
    returns['1M'] = values[1];
    returns['3M'] = values[2];
    // Skip index 3 (YTD/i år)
    returns['1Y'] = values[4];
    returns['3Y'] = values[5];
    returns['5Y'] = values[6];

    const isStock = stockNames.has(assetName);
    assetMap.set(assetName, {
      assetType: isStock ? 'Stock' : 'Fund',
      name: assetName,
      returns
    });
    processedNames.add(assetName);
  });

  // Convert map to array
  assetMap.forEach((asset) => assets.push(asset));

  if (assets.length === 0) return null;

  return { assets, periodKeys, periodLabels };
}

async function loadPerformancePDF(file) {
  if (typeof pdfjsLib === 'undefined') {
    alert('PDF.js library not loaded.');
    return;
  }
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }

    console.log('=== AVANZA PERFORMANCE PDF EXTRACTED TEXT ===');
    console.log(fullText);
    console.log('=== END EXTRACTED TEXT ===');

    const data = parseAvanzaPerformancePDFText(fullText);
    if (data && data.assets.length > 0) {
      performanceData = data;
      savePerformanceData();
      renderPerformanceContent();
    } else {
      // Try AI fallback parser if regex parser found nothing
      const apiKey = getApiKey();
      if (apiKey) {
        const aiData = await callAiForPerformanceExtraction(fullText, file.name);
        if (aiData && aiData.assets && aiData.assets.length > 0) {
          performanceData = aiData;
          savePerformanceData();
          renderPerformanceContent();
          return;
        }
      }
      // Show debug modal as last resort
      await showPerformancePdfDebugModal(fullText, file.name);
    }
  } catch (err) {
    console.error('Error parsing performance PDF:', err);
    alert('Failed to parse PDF: ' + err.message);
  }
}

async function callAiForPerformanceExtraction(text, filename) {
  const apiKey = getApiKey();
  const apiUrl = getApiUrl();
  const allKnownNames = getKnownAssetNames();

  const prompt = `Extract historical return data from this Avanza portfolio performance PDF.

Return ONLY valid JSON with this EXACT format:
{
  "assets": [
{"assetType":"Stock","name":"Asset Name","returns":{"1W":1.23,"1M":4.56,"3M":-2.34,"1Y":12.34,"3Y":45.67,"5Y":89.01}}
  ]
}

MANDATORY RULES:
1. Look for these known asset names in the text: ${allKnownNames.join(', ')}
2. assetType must be "Stock" for individual stocks, "Fund" for funds
3. Returns are percentages. Look for numbers with "%" after each asset name
4. The text has 7 percentage values per asset: 1W, 1M, 3M, YTD (skip this), 1Y, 3Y, 5Y
5. The minus sign may appear as Unicode minus (U+2212) - use regular minus in JSON
6. Return ONLY valid JSON. No markdown. No code blocks. No trailing commas.

TEXT FROM ${filename}:
${text.substring(0, 30000)}`;

  try {
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify({ model: getApiModel(), messages: [{ role: 'system', content: 'You are a precise data extraction assistant. Return ONLY valid JSON with asset performance data. No markdown. No code blocks.' }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4000 }) });
    if (!response.ok) return null;
    const result = await response.json();
    let jsonStr = (result.choices?.[0]?.message?.content || '').trim();
    if (!jsonStr) return null;

    jsonStr = repairJsonString(jsonStr);
    const parsed = attemptJsonParse(jsonStr);
    if (parsed && parsed.assets && Array.isArray(parsed.assets)) {
      // Add period metadata
      parsed.periodKeys = ['1W', '1M', '3M', '1Y', '3Y', '5Y'];
      parsed.periodLabels = ['1 Week', '1 Month', '3 Months', '1 Year', '3 Years', '5 Years'];
      // Ensure all assets have the returns object
      parsed.assets.forEach(a => {
        if (!a.returns) a.returns = {};
        parsed.periodKeys.forEach(k => {
          if (a.returns[k] === undefined || a.returns[k] === null) a.returns[k] = null;
        });
      });
      return parsed;
    }
    return null;
  } catch (err) { console.error('AI performance extraction error:', err); return null; }
}

function showPerformancePdfDebugModal(text, filename) {
  return new Promise((_resolve) => {
    window._perfPdfDebugResolve = _resolve;
    const modal = document.createElement('div');
    modal.id = 'perfPdfDebugModal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60';
    modal.innerHTML = `
      <div class="card p-6 w-full max-w-3xl mx-4" style="max-height:80vh;display:flex;flex-direction:column;">
        <h3 class="text-lg font-semibold mb-2">Performance PDF Debug: ${filename}</h3>
        <p class="text-sm text-[var(--fg-muted)] mb-4">The parser could not find performance data in this PDF. Copy the extracted text below to share for debugging.</p>
        <textarea id="perfPdfDebugText" readonly style="flex:1;min-height:300px;background:var(--bg-secondary);color:var(--fg-primary);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;resize:vertical;">${text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')}</textarea>
        <div class="flex gap-3 mt-4">
          <button onclick="navigator.clipboard.writeText(document.getElementById('perfPdfDebugText').value);this.textContent='Copied!'" class="btn-secondary flex-1">Copy to Clipboard</button>
          <button onclick="document.getElementById('perfPdfDebugModal').remove();window._perfPdfDebugResolve(false)" class="btn-primary flex-1">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); _resolve(false); } });
  });
}

function clearPerformanceData() {
  if (confirm('Clear all historical performance data?')) {
    performanceData = null;
    localStorage.removeItem(PERF_LS_KEY);
    renderPerformanceContent();
  }
}

function savePerformanceData() {
  try {
    if (performanceData) {
      localStorage.setItem(PERF_LS_KEY, JSON.stringify(performanceData));
    }
  } catch (e) { console.warn('Failed to save performance data:', e); }
}

function loadPerformanceDataFromStorage() {
  try {
    const raw = localStorage.getItem(PERF_LS_KEY);
    if (raw) {
      performanceData = JSON.parse(raw);
      return true;
    }
  } catch (e) { console.warn('Failed to load performance data:', e); }
  return false;
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return 0;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function renderCorrelationMatrix() {
  const container = document.getElementById('correlationMatrixContainer');
  if (!container || !performanceData) return;

  const { assets, periodKeys } = performanceData;

  // Only include assets that have at least 2 return values for meaningful correlation
  const usable = assets.filter(a => {
    const vals = periodKeys.map(k => a.returns[k]).filter(v => v !== null && !isNaN(v));
    return vals.length >= 2;
  });

  if (usable.length < 2) {
    container.innerHTML = '<div class="flex items-center justify-center h-32 text-[var(--fg-muted)]"><p>Need at least 2 assets with ≥2 return periods each</p></div>';
    return;
  }

  // Build return vectors (only overlapping non-null periods)
  const names = usable.map(a => a.name);

  const cellSize = Math.max(50, Math.min(70, 600 / usable.length));
  const labelW = 140;

  let html = '<table style="border-collapse:collapse;">';
  // Header row
  html += '<tr><td style="width:' + labelW + 'px"></td>';
  names.forEach(name => {
    html += '<td class="text-center text-xs font-medium" style="width:' + cellSize + 'px;padding:4px;writing-mode:vertical-rl;transform:rotate(180deg);max-height:100px;overflow:hidden;color:var(--fg-muted);">' + name + '</td>';
  });
  html += '</tr>';

  usable.forEach((rowAsset, ri) => {
    html += '<tr><td class="text-xs pr-2 text-right" style="white-space:nowrap;color:var(--fg-muted);max-width:' + labelW + 'px;overflow:hidden;text-overflow:ellipsis;">' + rowAsset.name + '</td>';

    usable.forEach((colAsset, ci) => {
      if (ri === ci) {
        // Diagonal
        html += '<td class="text-center font-mono text-xs" style="width:' + cellSize + 'px;height:' + cellSize + 'px;background:rgba(16,185,129,0.15);border:1px solid var(--border-subtle);padding:2px;">1.00</td>';
      } else {
        // Compute correlation using overlapping non-null period returns
        const x = [], y = [];
        periodKeys.forEach(k => {
          const v1 = rowAsset.returns[k];
          const v2 = colAsset.returns[k];
          if (v1 !== null && !isNaN(v1) && v2 !== null && !isNaN(v2)) {
            x.push(v1);
            y.push(v2);
          }
        });

        const corr = x.length >= 2 ? pearsonCorrelation(x, y) : 0;
        const abs = Math.abs(corr);
        let bg;
        if (corr >= 0) {
          bg = 'rgba(16,185,129,' + (abs * 0.5) + ')';
        } else {
          bg = 'rgba(239,68,68,' + (abs * 0.5) + ')';
        }

        html += '<td class="text-center font-mono text-xs" style="width:' + cellSize + 'px;height:' + cellSize + 'px;background:' + bg + ';border:1px solid var(--border-subtle);padding:2px;">' + corr.toFixed(2) + '</td>';
      }
    });

    html += '</tr>';
  });

  html += '</table>';
  container.innerHTML = html;
}

function renderPerformanceContent() {
  const content = document.getElementById('perfContent');
  const dropZone = document.getElementById('perfDropZone');
  const clearBtn = document.getElementById('clearPerfBtn');

  if (!performanceData || !performanceData.assets || performanceData.assets.length === 0) {
    if (content) content.classList.add('hidden');
    if (dropZone) dropZone.style.display = '';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  if (content) content.classList.remove('hidden');
  if (dropZone) dropZone.style.display = 'none';
  if (clearBtn) clearBtn.style.display = '';

  renderPerformerCards();
  renderReturnsChart('1W');
  renderCorrelationMatrix();
  renderPerformanceHeatmap();
  renderPerformanceTable();
  renderBucketAnalysisTables();
}

function renderPerformerCards() {
  const container = document.getElementById('performerCards');
  if (!container || !performanceData) return;

  const cards = [];
  const periods = ['1W', '1M', '1Y'];
  const periodNames = { '1W': '1 Week', '1M': '1 Month', '1Y': '1 Year' };

  periods.forEach(period => {
    const withReturns = performanceData.assets.filter(a => a.returns[period] !== null && !isNaN(a.returns[period]));
    if (withReturns.length === 0) return;

    const sorted = [...withReturns].sort((a, b) => b.returns[period] - a.returns[period]);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const avg = withReturns.reduce((s, a) => s + a.returns[period], 0) / withReturns.length;

    cards.push(`
      <div class="card stat-card p-5 animate-fade-in">
        <p class="text-sm text-[var(--fg-muted)] mb-3">${periodNames[period]} Performance</p>
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-[var(--fg-muted)]">🏆 Best</span>
            <span class="text-sm font-medium truncate">${best.name}</span>
            <span class="text-sm font-bold change-positive whitespace-nowrap">+${best.returns[period].toFixed(2)}%</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-[var(--fg-muted)]">📉 Worst</span>
            <span class="text-sm font-medium truncate">${worst.name}</span>
            <span class="text-sm font-bold ${worst.returns[period] >= 0 ? 'change-positive' : 'change-negative'} whitespace-nowrap">${worst.returns[period] >= 0 ? '+' : ''}${worst.returns[period].toFixed(2)}%</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-[var(--fg-muted)]">📊 Average</span>
            <span class="text-sm font-medium">${withReturns.length} assets</span>
            <span class="text-sm font-bold ${avg >= 0 ? 'change-positive' : 'change-negative'} whitespace-nowrap">${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%</span>
          </div>
        </div>
      </div>
    `);
  });

  container.innerHTML = cards.join('');
}

function renderReturnsChart(period) {
  const ctx = document.getElementById('returnsChart');
  if (!ctx || !performanceData) return;

  if (returnsChart) returnsChart.destroy();

  const withReturns = performanceData.assets.filter(a => a.returns[period] !== null && !isNaN(a.returns[period]));
  const sorted = [...withReturns].sort((a, b) => b.returns[period] - a.returns[period]);

  const labels = sorted.map(a => a.name);
  const data = sorted.map(a => a.returns[period]);
  const colors = data.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)');
  const borderColors = data.map(v => v >= 0 ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)');

  returnsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Return (%)',
        data,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x >= 0 ? '+' : ''}${ctx.parsed.x.toFixed(2)}%`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(45, 58, 82, 0.5)' },
          ticks: {
            color: '#94a3b8',
            callback: (v) => v + '%'
          }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 } }
        }
      }
    }
  });
}

function renderPerformanceHeatmap() {
  const container = document.getElementById('heatmapContainer');
  if (!container || !performanceData) return;

  const { assets, periodKeys, periodLabels } = performanceData;

  if (!assets || assets.length === 0) {
    container.innerHTML = '<div class="flex items-center justify-center h-32 text-[var(--fg-muted)]"><p>No performance data available</p></div>';
    return;
  }

  // Find max absolute value for color scaling
  let maxAbs = 1;
  assets.forEach(a => {
    periodKeys.forEach(k => {
      if (a.returns[k] !== null && !isNaN(a.returns[k])) {
        maxAbs = Math.max(maxAbs, Math.abs(a.returns[k]));
      }
    });
  });

  let html = '<table style="border-collapse:separate;border-spacing:3px;">';
  html += '<tr><td style="min-width:160px;"></td>';
  periodLabels.forEach(label => {
    html += `<td class="text-center text-xs font-semibold px-2 py-1" style="color:var(--fg-muted);min-width:80px;">${label}</td>`;
  });
  html += '</tr>';

  assets.forEach(asset => {
    html += `<tr><td class="text-sm font-medium pr-3 whitespace-nowrap">${asset.name}</td>`;
    periodKeys.forEach(key => {
      const val = asset.returns[key];
      if (val !== null && !isNaN(val)) {
        const intensity = Math.abs(val) / maxAbs;
        let bg;
        if (val >= 0) {
          bg = `rgba(16, 185, 129, ${Math.min(0.85, intensity * 0.85)})`;
        } else {
          bg = `rgba(239, 68, 68, ${Math.min(0.85, intensity * 0.85)})`;
        }
        html += `<td class="text-center font-mono text-xs rounded px-2 py-2 font-semibold" style="background:${bg};min-width:80px;">${val >= 0 ? '+' : ''}${val.toFixed(2)}%</td>`;
      } else {
        html += `<td class="text-center font-mono text-xs rounded px-2 py-2" style="background:var(--bg-secondary);color:var(--fg-muted);min-width:80px;">—</td>`;
      }
    });
    html += '</tr>';
  });

  html += '</table>';
  container.innerHTML = html;
}

function sortPerfTable(key) {
  if (perfSortKey === key) {
    perfSortAsc = !perfSortAsc;
  } else {
    perfSortKey = key;
    perfSortAsc = false; // default descending for returns
  }
  renderPerformanceTable();
}

function renderPerformanceTable() {
  const tbody = document.getElementById('perfTableBody');
  if (!tbody || !performanceData) return;

  const { assets, periodKeys } = performanceData;

  let sorted = [...assets];
  if (perfSortKey) {
    sorted.sort((a, b) => {
      const va = a.returns[perfSortKey];
      const vb = b.returns[perfSortKey];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return perfSortAsc ? va - vb : vb - va;
    });
  }

  tbody.innerHTML = sorted.map(asset => {
    const typeBadge = asset.assetType === 'Stock'
      ? '<span class="badge badge-bucket-1">STOCK</span>'
      : '<span class="badge badge-bucket-3">FUND</span>';

    const returnCells = periodKeys.map(key => {
      const val = asset.returns[key];
      if (val !== null && !isNaN(val)) {
        return `<td class="text-right font-mono ${val >= 0 ? 'change-positive' : 'change-negative'}">${val >= 0 ? '+' : ''}${val.toFixed(2)}%</td>`;
      }
      return '<td class="text-right font-mono text-[var(--fg-muted)]">—</td>';
    }).join('');

    return `<tr>
      <td>${typeBadge}</td>
      <td class="font-medium">${escapeHtml(asset.name)}</td>
      ${returnCells}
    </tr>`;
  }).join('');
}

function setupPerformanceListeners() {
  const perfFileInput = document.getElementById('perfFileInput');
  const perfDropZone = document.getElementById('perfDropZone');

  if (perfFileInput) {
    perfFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        loadPerformancePDF(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  if (perfDropZone) {
    perfDropZone.addEventListener('dragover', (e) => { e.preventDefault(); perfDropZone.classList.add('dragover'); });
    perfDropZone.addEventListener('dragleave', () => perfDropZone.classList.remove('dragover'));
    perfDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      perfDropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) {
        loadPerformancePDF(e.dataTransfer.files[0]);
      }
    });
  }

  // Period selector buttons
  document.querySelectorAll('.perf-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.perf-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderReturnsChart(btn.dataset.period);
    });
  });
}

// --- TARGET RETURN TRACKER ---
const TARGET_LS_KEY = 'portfolioTracker_targetSettings';
let targetSettings = { yearStartValue: 20614796, targetReturn: 7 };

function loadTargetSettings() {
  try {
    const raw = localStorage.getItem(TARGET_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.yearStartValue !== undefined) targetSettings.yearStartValue = parsed.yearStartValue;
      if (parsed.targetReturn !== undefined) targetSettings.targetReturn = parsed.targetReturn;
    }
  } catch (e) { console.warn('Failed to load target settings:', e); }
}

function saveTargetSettings() {
  try {
    localStorage.setItem(TARGET_LS_KEY, JSON.stringify(targetSettings));
  } catch (e) { console.warn('Failed to save target settings:', e); }
}

function renderTargetTracker() {
  const yearStartInput = document.getElementById('yearStartValueInput');
  const targetReturnInput = document.getElementById('targetReturnInput');
  const resultsDiv = document.getElementById('targetTrackerResults');
  const noDataDiv = document.getElementById('targetTrackerNoData');
  if (!yearStartInput || !targetReturnInput || !resultsDiv || !noDataDiv) return;

  // Set input values from settings
  yearStartInput.value = targetSettings.yearStartValue;
  targetReturnInput.value = targetSettings.targetReturn;

  const yearStartValue = parseFloat(targetSettings.yearStartValue);
  const targetReturn = parseFloat(targetSettings.targetReturn);

  // Need both values to show results
  if (!yearStartValue || yearStartValue <= 0 || isNaN(targetReturn)) {
    resultsDiv.classList.add('hidden');
    noDataDiv.classList.remove('hidden');
    return;
  }

  // Get current portfolio value
  let currentValue = 0;
  if (currentSnapshot) {
    const effective = getEffectiveSnapshot(currentSnapshot);
    const ft = calculateFilteredTotals(effective);
    currentValue = ft.totalValue;
  }

  if (currentValue <= 0) {
    resultsDiv.classList.add('hidden');
    noDataDiv.classList.remove('hidden');
    noDataDiv.querySelector('p').textContent = 'No portfolio data available.';
    return;
  }

  // Calculate
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1); // Jan 1
  const yearEnd = new Date(now.getFullYear(), 11, 31); // Dec 31
  const daysInYear = Math.ceil((yearEnd - yearStart) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.ceil((now - yearStart) / (1000 * 60 * 60 * 24));
  const daysRemaining = daysInYear - daysElapsed;

  const targetEoyValue = yearStartValue * (1 + targetReturn / 100);
  const targetReturnYtd = targetReturn * daysElapsed / daysInYear;
  const targetValueYtd = yearStartValue * (1 + targetReturnYtd / 100);
  const actualReturnYtd = ((currentValue - yearStartValue) / yearStartValue) * 100;
  const diff = actualReturnYtd - targetReturnYtd;

  // Update displays
  document.getElementById('ttCurrentValue').textContent = formatCurrency(currentValue);
  document.getElementById('ttTargetEoy').textContent = formatCurrency(targetEoyValue);

  const actualReturnEl = document.getElementById('ttActualReturn');
  actualReturnEl.textContent = (actualReturnYtd >= 0 ? '+' : '') + actualReturnYtd.toFixed(2) + '%';
  actualReturnEl.className = 'text-lg font-bold font-mono ' + (actualReturnYtd >= 0 ? 'change-positive' : 'change-negative');

  const targetReturnEl = document.getElementById('ttTargetReturn');
  targetReturnEl.textContent = (targetReturnYtd >= 0 ? '+' : '') + targetReturnYtd.toFixed(2) + '% (' + daysElapsed + '/' + daysInYear + ' days)';

  // Status
  const statusEl = document.getElementById('ttStatus');
  if (Math.abs(diff) < 0.5) {
    statusEl.textContent = '🎯 On Track (' + (diff >= 0 ? '+' : '') + diff.toFixed(2) + '% vs target)';
    statusEl.className = 'rounded-lg p-3 text-center font-semibold';
    statusEl.style.background = 'rgba(245, 158, 11, 0.1)';
    statusEl.style.color = '#fbbf24';
  } else if (diff > 0) {
    statusEl.textContent = '✅ Ahead of target (+' + diff.toFixed(2) + '% ahead)';
    statusEl.className = 'rounded-lg p-3 text-center font-semibold';
    statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
    statusEl.style.color = '#34d399';
  } else {
    statusEl.textContent = '⚠️ Behind target (' + diff.toFixed(2) + '% behind)';
    statusEl.className = 'rounded-lg p-3 text-center font-semibold';
    statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
    statusEl.style.color = '#f87171';
  }

  resultsDiv.classList.remove('hidden');
  noDataDiv.classList.add('hidden');
}

// --- LOCALSTORAGE PERSISTENCE ---
const LS_KEY = 'portfolioTracker_snapshots';

function saveToLocalStorage() {
  try {
    const data = snapshots.map(s => ({
      date: s.date.toISOString(), dateStr: s.dateStr, holdings: s.holdings,
      totalValue: s.totalValue, nordnetValue: s.nordnetValue, avanzaValue: s.avanzaValue
    }));
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) { console.warn('localStorage save failed:', e); }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return false;
    snapshots = data.map(s => ({
      ...s, date: new Date(s.date)
    }));
    snapshots.sort((a, b) => a.date - b.date);
    currentSnapshot = snapshots[snapshots.length - 1];
    return true;
  } catch (e) { console.warn('localStorage load failed:', e); return false; }
}

// --- BUCKET MOMENTUM ACCELERATION TABLES ---
// Data source: Performance tab (Yahoo Finance live prices via perfLivePrices)

// Signal pairs using Yahoo Finance trailing return periods
const SIGNAL_PAIRS = [
  { short: 'fiveDay', long: 'oneMonth', label: '1W vs 1M', tooltip: 'Micro momentum shift · Tactical (days→weeks)' },
  { short: 'oneMonth', long: 'threeMonth', label: '1M vs 3M', tooltip: 'Near-term trend change · Tactical (weeks→quarter)' },
  { short: 'threeMonth', long: 'oneYear', label: '3M vs 1Y', tooltip: 'Medium-term momentum · Strategic (quarter→year)' },
  { short: 'oneYear', long: 'threeYear', label: '1Y vs 3Y', tooltip: 'Trend establishment · Structural' },
  { short: 'threeYear', long: 'fiveYear', label: '3Y vs 5Y', tooltip: 'Long-term regime · Secular' }
];

// Computed analytics data (populated by computeBucketAnalysisData, used for snapshots)
let currentAnalyticsData = null;

// --- ANALYTICS LOCALSTORAGE ---
const ANALYTICS_LS_KEY = 'portfolioTracker_analyticsSnapshots';

function saveAnalyticsSnapshotToLocalStorage(snapshot) {
  try {
    const raw = localStorage.getItem(ANALYTICS_LS_KEY);
    let snapshots = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(snapshots)) snapshots = [];
    snapshots.push(snapshot);
    // Keep last 50 snapshots max
    if (snapshots.length > 50) snapshots = snapshots.slice(-50);
    localStorage.setItem(ANALYTICS_LS_KEY, JSON.stringify(snapshots));
    return true;
  } catch (e) { console.warn('Failed to save analytics snapshot:', e); return false; }
}

function loadAnalyticsSnapshotsFromLocalStorage() {
  try {
    const raw = localStorage.getItem(ANALYTICS_LS_KEY);
    if (!raw) return [];
    const snapshots = JSON.parse(raw);
    return Array.isArray(snapshots) ? snapshots : [];
  } catch (e) { console.warn('Failed to load analytics snapshots:', e); return []; }
}

function deleteAnalyticsSnapshot(index) {
  try {
    const snapshots = loadAnalyticsSnapshotsFromLocalStorage();
    if (index >= 0 && index < snapshots.length) {
      snapshots.splice(index, 1);
      localStorage.setItem(ANALYTICS_LS_KEY, JSON.stringify(snapshots));
      return true;
    }
  } catch (e) { console.warn('Failed to delete analytics snapshot:', e); }
  return false;
}

// Compute structured analytics data from live prices (reusable for both rendering & snapshots)
function computeBucketAnalysisData() {
  const buckets = [1, 2, 3];
  const result = {
    timestamp: new Date().toISOString(),
    dateLabel: new Date().toLocaleString(),
    priceSource: document.getElementById('livePricesTimestamp')?.textContent || 'Unknown',
    buckets: {}
  };

  // Build a lookup map from perfLivePrices (Yahoo Finance data)
  const priceMap = new Map();
  if (typeof perfLivePrices !== 'undefined' && perfLivePrices && perfLivePrices.length > 0) {
    perfLivePrices.forEach(p => priceMap.set(p.name.toLowerCase(), p));
  }

  buckets.forEach(bucketNum => {
    // Collect assets for this bucket from classificationReference
    const bucketAssets = [];
    const seen = new Set();

    ['avanza', 'nordnet'].forEach(brokerage => {
      (classificationReference[brokerage] || []).forEach(ref => {
        if (ref.bucket === bucketNum && !seen.has(ref.name)) {
          seen.add(ref.name);
          bucketAssets.push({ name: ref.name, brokerage });
        }
      });
    });

    const assets = [];
    bucketAssets.forEach(asset => {
      const livePrice = priceMap.get(asset.name.toLowerCase());
      const signals = [];
      let compositeScore = null;
      let compositeCount = 0;
      let compositeSum = 0;

      SIGNAL_PAIRS.forEach(sp => {
        let delta = null;
        if (livePrice && livePrice.trailingReturns) {
          const shortVal = livePrice.trailingReturns[sp.short];
          const longVal = livePrice.trailingReturns[sp.long];
          if (shortVal !== null && shortVal !== undefined && !isNaN(shortVal) &&
              longVal !== null && longVal !== undefined && !isNaN(longVal)) {
            delta = shortVal - longVal;
            compositeSum += delta;
            compositeCount++;
          }
        }
        signals.push({ label: sp.label, delta: delta !== null ? parseFloat(delta.toFixed(2)) : null });
      });

      if (compositeCount > 0) {
        compositeScore = parseFloat((compositeSum / compositeCount).toFixed(2));
      }

      assets.push({
        name: asset.name,
        brokerage: asset.brokerage,
        compositeScore,
        signals
      });
    });

    result.buckets[bucketNum] = { label: `Bucket ${bucketNum}`, assets };
  });

  currentAnalyticsData = result;
  return result;
}

function renderBucketAnalysisTables() {
  const data = computeBucketAnalysisData();
  const hasLiveData = (typeof perfLivePrices !== 'undefined' && perfLivePrices && perfLivePrices.length > 0);

  [1, 2, 3].forEach(bucketNum => {
    const container = document.getElementById(`bucket${bucketNum}TableContainer`);
    if (!container) return;

    const bucketData = data.buckets[bucketNum];
    if (!bucketData || bucketData.assets.length === 0) {
      container.innerHTML = '<div class="text-center text-sm text-[var(--fg-muted)] py-8">No assets classified in this bucket.</div>';
      return;
    }

    // Check if any asset has data
    const hasAnyData = bucketData.assets.some(a => a.compositeScore !== null);

    if (!hasLiveData) {
      container.innerHTML = '<div class="text-center text-sm text-[var(--fg-muted)] py-8">No live price data loaded. Click "Refresh Prices" in the Performance tab first.</div>';
      return;
    }
    if (!hasAnyData) {
      container.innerHTML = '<div class="text-center text-sm text-[var(--fg-muted)] py-8">Live prices loaded but no matching trailing returns found for this bucket.</div>';
      return;
    }

    // Build table HTML with per-signal-pair columns
    const signalLabels = SIGNAL_PAIRS.map(sp => sp.label);

    let html = '<table style="width:100%;border-collapse:collapse;">';
    html += '<thead><tr>';
    html += '<th style="min-width:140px;">Asset</th>';
    html += '<th>Brokerage</th>';
    html += '<th class="text-center">Composite Score</th>';
    signalLabels.forEach(label => {
      html += `<th class="text-center">${label}</th>`;
    });
    html += '</tr></thead><tbody>';

    bucketData.assets.forEach(asset => {
      html += '<tr>';
      html += `<td class="font-medium">${escapeHtml(asset.name)}</td>`;
      html += `<td><span class="text-xs text-[var(--fg-muted)]">${asset.brokerage}</span></td>`;

      // Composite Score cell
      if (asset.compositeScore !== null) {
        const scoreColor = asset.compositeScore > 0.5 ? 'change-positive' : asset.compositeScore < -0.5 ? 'change-negative' : 'text-[var(--fg-muted)]';
        const scoreIcon = asset.compositeScore > 0.5 ? '📈' : asset.compositeScore < -0.5 ? '📉' : '➡️';
        html += `<td class="text-center font-mono text-sm ${scoreColor} font-semibold">${scoreIcon} ${asset.compositeScore >= 0 ? '+' : ''}${asset.compositeScore.toFixed(2)}pp</td>`;
      } else {
        html += '<td class="text-center text-[var(--fg-muted)]">—</td>';
      }

      // Per-signal-pair delta cells with color coding
      (asset.signals || []).forEach(s => {
        if (s.delta !== null) {
          const deltaColor = s.delta > 0.5 ? 'change-positive' : s.delta < -0.5 ? 'change-negative' : 'text-[var(--fg-muted)]';
          const deltaIcon = s.delta > 0.5 ? '📈' : s.delta < -0.5 ? '📉' : '➡️';
          html += `<td class="text-center font-mono text-xs ${deltaColor} font-semibold">${deltaIcon} ${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(2)}pp</td>`;
        } else {
          html += '<td class="text-center text-[var(--fg-muted)]">—</td>';
        }
      });

      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  });

  // Also refresh recommendations
  renderRecommendationsTable();
}

// --- ANALYTICS SNAPSHOT FUNCTIONS ---

function saveAnalyticsSnapshot() {
  if (!currentAnalyticsData || !currentAnalyticsData.buckets) {
    alert('No analytics data available. Load live prices in the Performance tab first.');
    return;
  }

  // Check if any bucket has data
  const hasData = [1, 2, 3].some(b => {
    const bucket = currentAnalyticsData.buckets[b];
    return bucket && bucket.assets.some(a => a.compositeScore !== null);
  });

  if (!hasData) {
    alert('No computed analytics data to snapshot. Ensure live prices are loaded and assets have trailing returns.');
    return;
  }

  const snapshot = {
    id: Date.now(),
    timestamp: currentAnalyticsData.timestamp,
    dateLabel: currentAnalyticsData.dateLabel,
    priceSource: currentAnalyticsData.priceSource,
    buckets: JSON.parse(JSON.stringify(currentAnalyticsData.buckets))
  };

  if (saveAnalyticsSnapshotToLocalStorage(snapshot)) {
    renderAnalyticsSnapshotHistory();
  } else {
    alert('Failed to save snapshot.');
  }
}

function renderAnalyticsSnapshotHistory() {
  const container = document.getElementById('analyticsSnapshotList');
  if (!container) return;

  const snapshots = loadAnalyticsSnapshotsFromLocalStorage();

  if (snapshots.length === 0) {
    container.innerHTML = '<div class="text-center text-sm text-[var(--fg-muted)] py-6">No snapshots saved yet. Click "Save Current Snapshot" to capture the current analytics state.</div>';
    return;
  }

  // Show most recent first
  const reversed = [...snapshots].reverse();

  let html = '';
  reversed.forEach(snapshot => {
    const assetCount = [1, 2, 3].reduce((sum, b) => {
      const bucket = snapshot.buckets && snapshot.buckets[b];
      return sum + (bucket ? bucket.assets.length : 0);
    }, 0);

    const acceleratingCount = [1, 2, 3].reduce((sum, b) => {
      const bucket = snapshot.buckets && snapshot.buckets[b];
      return sum + (bucket ? bucket.assets.filter(a => a.compositeScore !== null && a.compositeScore > 0.5).length : 0);
    }, 0);

    const deceleratingCount = [1, 2, 3].reduce((sum, b) => {
      const bucket = snapshot.buckets && snapshot.buckets[b];
      return sum + (bucket ? bucket.assets.filter(a => a.compositeScore !== null && a.compositeScore < -0.5).length : 0);
    }, 0);

    html += `
    <div class="analytics-snapshot-card" style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:8px;cursor:pointer;transition:background 0.15s;" 
         onmouseenter="this.style.background='var(--bg-hover)'" 
         onmouseleave="this.style.background='var(--bg-secondary)'"
         onclick="toggleAnalyticsSnapshotDetail(this, ${snapshot.id})">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div class="font-semibold text-sm">📸 ${snapshot.dateLabel}</div>
          <div class="text-xs text-[var(--fg-muted)] mt-1">${assetCount} assets · 📈 ${acceleratingCount} accelerating · 📉 ${deceleratingCount} decelerating</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button onclick="event.stopPropagation();deleteAnalyticsSnapshotById(${snapshot.id})" 
                  class="text-xs text-[var(--fg-muted)] hover:text-red-400 transition-colors" title="Delete snapshot">🗑️</button>
          <svg class="snapshot-chevron w-4 h-4 text-[var(--fg-muted)] transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </div>
      <div class="snapshot-detail hidden mt-3 pt-3 border-t border-[var(--border)]">
        ${renderSnapshotDetailTables(snapshot)}
      </div>
    </div>`;
  });

  container.innerHTML = html;
}

function renderSnapshotDetailTables(snapshot) {
  const signalLabels = SIGNAL_PAIRS.map(sp => sp.label);
  let html = '';

  [1, 2, 3].forEach(bucketNum => {
    const bucketData = snapshot.buckets && snapshot.buckets[bucketNum];
    if (!bucketData || !bucketData.assets || bucketData.assets.length === 0) return;

    const hasData = bucketData.assets.some(a => a.compositeScore !== null);
    if (!hasData) return;

    html += `<div class="mb-3">
      <div class="text-sm font-semibold mb-2">${bucketData.label}</div>
      <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
        <thead><tr>
          <th style="min-width:120px;text-align:left;padding:4px 6px;">Asset</th>
          <th style="text-align:left;padding:4px 6px;">Brokerage</th>
          <th style="text-align:center;padding:4px 6px;">Composite Score</th>`;

    signalLabels.forEach(label => {
      html += `<th style="text-align:center;padding:4px 6px;">${label}</th>`;
    });

    html += '</tr></thead><tbody>';

    bucketData.assets.forEach(asset => {
      html += '<tr>';
      html += `<td style="padding:4px 6px;font-weight:500;">${escapeHtml(asset.name)}</td>`;
      html += `<td style="padding:4px 6px;color:var(--fg-muted);">${asset.brokerage}</td>`;

      if (asset.compositeScore !== null) {
        const scoreColor = asset.compositeScore > 0.5 ? 'color:#34d399;' : asset.compositeScore < -0.5 ? 'color:#f87171;' : 'color:var(--fg-muted);';
        const scoreIcon = asset.compositeScore > 0.5 ? '📈' : asset.compositeScore < -0.5 ? '📉' : '➡️';
        html += `<td style="padding:4px 6px;text-align:center;font-weight:600;${scoreColor}">${scoreIcon} ${asset.compositeScore >= 0 ? '+' : ''}${asset.compositeScore.toFixed(2)}</td>`;
      } else {
        html += '<td style="padding:4px 6px;text-align:center;color:var(--fg-muted);">—</td>';
      }

      (asset.signals || []).forEach(s => {
        if (s.delta !== null) {
          const deltaColor = s.delta > 0.5 ? 'color:#34d399;' : s.delta < -0.5 ? 'color:#f87171;' : 'color:var(--fg-muted);';
          html += `<td style="padding:4px 6px;text-align:center;font-weight:600;${deltaColor}">${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(2)}</td>`;
        } else {
          html += '<td style="padding:4px 6px;text-align:center;color:var(--fg-muted);">—</td>';
        }
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
  });

  return html || '<div class="text-xs text-[var(--fg-muted)]">No data in this snapshot.</div>';
}

function toggleAnalyticsSnapshotDetail(cardElement, snapshotId) {
  const detail = cardElement.querySelector('.snapshot-detail');
  const chevron = cardElement.querySelector('.snapshot-chevron');
  if (detail) {
    detail.classList.toggle('hidden');
    if (chevron) {
      chevron.style.transform = detail.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  }
}

function deleteAnalyticsSnapshotById(snapshotId) {
  if (!confirm('Delete this snapshot?')) return;
  const snapshots = loadAnalyticsSnapshotsFromLocalStorage();
  const index = snapshots.findIndex(s => s.id === snapshotId);
  if (index >= 0) {
    snapshots.splice(index, 1);
    localStorage.setItem(ANALYTICS_LS_KEY, JSON.stringify(snapshots));
    renderAnalyticsSnapshotHistory();
  }
}

// --- MOMENTUM-ACCELERATION RECOMMENDATIONS ALGORITHM ---

// Weights for weighted momentum score
const REC_WEIGHTS = {
  d1: 0.15, // 1W vs 1M
  d2: 0.25, // 1M vs 3M
  d3: 0.30, // 3M vs 1Y
  d4: 0.20, // 1Y vs 3Y
  d5: 0.10  // 3Y vs 5Y
};

// Exposure groups based on category patterns
const EXPOSURE_GROUPS = {
  'Global Index': 'Global Developed Equity',
  'Sweden Index': 'Sweden Equity',
  'Precious Metals': 'Gold / Mining / Metals',
  'Base Metals': 'Gold / Mining / Metals',
  'Materials': 'Gold / Mining / Metals',
  'Energy': 'Energy / Natural Resources',
  'Short Duration': 'Cash / Short Duration',
  'Cash': 'Cash / Short Duration',
  'Corporate / Credit': 'Fixed Income / Credit',
  'Credit': 'Fixed Income / Credit',
  'Mix Term Bond': 'Fixed Income / Credit',
  'Long Term Bond': 'Fixed Income / Credit',
  'Agriculture': 'Commodities',
  'Livestock': 'Commodities',
  'Communication Services': 'Thematic / Sector',
  'Consumer Discretionary': 'Thematic / Sector',
  'Consumer Staples': 'Thematic / Sector',
  'Financials': 'Thematic / Sector',
  'Health Care': 'Thematic / Sector',
  'Industrials': 'Thematic / Sector',
  'Information Technology': 'Thematic / Sector',
  'Real Estate': 'Thematic / Sector',
  'Utilities': 'Thematic / Sector'
};

// Store current recommendations
let currentRecommendations = null;

function computeRecommendations() {
  const data = computeBucketAnalysisData();
  if (!data || !data.buckets) {
    currentRecommendations = null;
    return null;
  }

  // Build price lookup
  const priceMap = new Map();
  if (typeof perfLivePrices !== 'undefined' && perfLivePrices && perfLivePrices.length > 0) {
    perfLivePrices.forEach(p => priceMap.set(p.name.toLowerCase(), p));
  }

  // Build position value lookup from currentSnapshot
  const positionMap = new Map();
  if (currentSnapshot) {
    const effective = getEffectiveSnapshot(currentSnapshot);
    const holdings = (typeof getFilteredHoldings === 'function') ? getFilteredHoldings(effective) : effective.holdings;
    holdings.forEach(h => {
      const key = (h.name + '|' + (h.brokerage || '')).toLowerCase();
      positionMap.set(key, h.value || 0);
    });
  }

  // Build category/bucket lookup from classificationReference
  const assetMeta = new Map();
  ['avanza', 'nordnet'].forEach(brokerage => {
    (classificationReference[brokerage] || []).forEach(ref => {
      const key = (ref.name + '|' + brokerage).toLowerCase();
      assetMeta.set(key, { category: ref.category, bucket: ref.bucket, brokerage });
    });
  });

  // Collect all unique assets across buckets
  const allAssets = [];
  const seen = new Set();
  [1, 2, 3].forEach(bucketNum => {
    const bucketData = data.buckets[bucketNum];
    if (!bucketData || !bucketData.assets) return;
    bucketData.assets.forEach(asset => {
      const key = (asset.name + '|' + asset.brokerage).toLowerCase();
      if (!seen.has(key) && asset.compositeScore !== null) {
        seen.add(key);
        allAssets.push({ ...asset, bucketAssign: bucketNum });
      }
    });
  });

  if (allAssets.length === 0) {
    currentRecommendations = null;
    return null;
  }

  // Compute acceleration ratio for regime filter
  const accelerating = allAssets.filter(a => a.compositeScore > 0.5).length;
  const decelerating = allAssets.filter(a => a.compositeScore < -0.5).length;
  const accelerationRatio = allAssets.length > 0 ? (accelerating / allAssets.length) * 100 : 0;

  // Regime determination
  let regime;
  if (accelerationRatio > 60) regime = 'riskOn';
  else if (accelerationRatio >= 40) regime = 'mixed';
  else if (accelerationRatio >= 20) regime = 'weak';
  else regime = 'defensive';

  // Group assets by exposure for duplicate detection
  const exposureGroups = {};
  allAssets.forEach(asset => {
    const key = (asset.name + '|' + asset.brokerage).toLowerCase();
    const meta = assetMeta.get(key) || {};
    const category = meta.category || 'Unassigned';
    const groupName = EXPOSURE_GROUPS[category] || category;
    if (!exposureGroups[groupName]) exposureGroups[groupName] = [];
    exposureGroups[groupName].push({ ...asset, category, bucket: meta.bucket, positionKey: key });
  });

  // Compute group momentum scores (weighted by position)
  const groupScores = {};
  Object.entries(exposureGroups).forEach(([groupName, assets]) => {
    let totalWeight = 0;
    let weightedSum = 0;
    assets.forEach(a => {
      const key = (a.name + '|' + a.brokerage).toLowerCase();
      const pos = positionMap.get(key) || 0;
      if (pos > 0) {
        weightedSum += pos * (a.compositeScore || 0);
        totalWeight += pos;
      }
    });
    groupScores[groupName] = {
      score: totalWeight > 0 ? weightedSum / totalWeight : 0,
      count: assets.length,
      overweight: false // placeholder — needs rebalancing target data to determine
    };
  });

  // Process each asset
  const recommendations = allAssets.map(asset => {
    // Extract deltas from signals array (order: 1Wvs1M, 1Mvs3M, 3Mvs1Y, 1Yvs3Y, 3Yvs5Y)
    const signals = asset.signals || [];
    const d1 = signals[0] ? signals[0].delta : null;
    const d2 = signals[1] ? signals[1].delta : null;
    const d3 = signals[2] ? signals[2].delta : null;
    const d4 = signals[3] ? signals[3].delta : null;
    const d5 = signals[4] ? signals[4].delta : null;

    // Classify signals
    function classifySignal(delta) {
      if (delta === null) return 'neutral';
      if (delta > 0.5) return 'green';
      if (delta < -0.5) return 'red';
      return 'neutral';
    }

    const s1 = classifySignal(d1);
    const s2 = classifySignal(d2);
    const s3 = classifySignal(d3);
    const s4 = classifySignal(d4);
    const s5 = classifySignal(d5);

    const greenCount = [s1, s2, s3, s4, s5].filter(s => s === 'green').length;
    const redCount = [s1, s2, s3, s4, s5].filter(s => s === 'red').length;
    const breadthScore = greenCount - redCount;

    // Weighted momentum score
    const weightedScore =
      (REC_WEIGHTS.d1 * (d1 || 0)) +
      (REC_WEIGHTS.d2 * (d2 || 0)) +
      (REC_WEIGHTS.d3 * (d3 || 0)) +
      (REC_WEIGHTS.d4 * (d4 || 0)) +
      (REC_WEIGHTS.d5 * (d5 || 0));

    // Get metadata
    const key = (asset.name + '|' + asset.brokerage).toLowerCase();
    const meta = assetMeta.get(key) || {};
    const category = meta.category || 'Unassigned';
    const bucket = meta.bucket || asset.bucketAssign || 3;
    const exposureGroup = EXPOSURE_GROUPS[category] || category;
    const positionValue = positionMap.get(key) || 0;

    // --- Decision Logic ---
    let rawAction = 'Hold';
    let actionDetails = '';

    // Determine raw action from weighted score + breadth
    if (weightedScore > 1.5 && breadthScore >= 3 && redCount <= 1 && d3 !== null && d3 > 0.5) {
      rawAction = 'Strong Buy';
      actionDetails = 'Multi-timeframe acceleration, confirmed medium-term trend';
    } else if (weightedScore > 0.5 && breadthScore >= 2 && (d2 === null || d2 >= -0.5) && (d3 === null || d3 >= -0.5)) {
      rawAction = 'Buy / Increase';
      actionDetails = 'Broad momentum improvement, key timeframes confirm';
    } else if (weightedScore > 0.5 && breadthScore >= 1) {
      rawAction = 'Mild Buy';
      actionDetails = 'Positive but partial confirmation';
    } else if (weightedScore < -2.0 && breadthScore <= -3) {
      rawAction = 'Strong Trim / Sell';
      actionDetails = 'Severe deceleration across multiple horizons';
    } else if (weightedScore < -0.5 && breadthScore <= -2) {
      rawAction = 'Trim';
      actionDetails = 'Broad weakness, momentum deteriorating';
    } else if (weightedScore > -0.5 && weightedScore < 0.5) {
      rawAction = 'Hold';
      actionDetails = 'Mixed or neutral signals';
    } else if (weightedScore < -0.5 && breadthScore > -2) {
      rawAction = 'Hold / Watch';
      actionDetails = 'Weakening but not yet broad — monitor';
    } else if (weightedScore > 0.5 && breadthScore < 1) {
      rawAction = 'Hold / Watch';
      actionDetails = 'Score positive but lacking breadth confirmation';
    }

    // --- Portfolio Role Adjustment ---
    let finalAction = rawAction;

    // Bucket 1 (Cash/Short Duration): more forgiving
    if (bucket === 1 && (rawAction === 'Trim' || rawAction === 'Strong Trim / Sell')) {
      if (weightedScore > -1.5 || breadthScore > -3) {
        finalAction = 'Hold';
        actionDetails = 'Defensive asset — trim signal overridden';
      } else {
        finalAction = 'Trim';
        actionDetails = 'Weak momentum in defensive asset, but only trim if better alternative exists';
      }
    }

    // Bucket 3 volatile categories: stricter
    const volatileCategories = ['Energy', 'Materials', 'Precious Metals', 'Base Metals'];
    if (bucket === 3 && volatileCategories.includes(category)) {
      if (rawAction === 'Trim' && weightedScore < -1.0) {
        finalAction = 'Strong Trim / Sell';
        actionDetails = 'Volatile asset with deepening weakness';
      }
    }

    // --- Regime Filter Adjustment ---
    if (regime === 'defensive') {
      if (finalAction === 'Strong Buy') {
        finalAction = 'Buy / Increase';
        actionDetails = 'Downgraded: defensive regime';
      } else if (finalAction === 'Buy / Increase') {
        finalAction = 'Mild Buy';
        actionDetails = 'Downgraded: defensive regime';
      } else if (finalAction === 'Mild Buy') {
        finalAction = 'Hold / Watch';
        actionDetails = 'Downgraded: defensive regime, wait for confirmation';
      }
    } else if (regime === 'weak') {
      if (finalAction === 'Strong Buy') {
        finalAction = 'Buy / Increase';
        actionDetails = 'Downgraded: weak regime';
      } else if (finalAction === 'Mild Buy') {
        finalAction = 'Hold / Watch';
        actionDetails = 'Downgraded: weak regime';
      }
    }

    // --- Duplicate Exposure ---
    const groupData = groupScores[exposureGroup];
    const isDuplicate = groupData && groupData.count >= 2;

    // --- Position Sizing ---
    let sizeAction = '';
    if (finalAction === 'Strong Buy') sizeAction = 'Increase 10–20%';
    else if (finalAction === 'Buy / Increase') sizeAction = 'Increase 10–15%';
    else if (finalAction === 'Mild Buy') sizeAction = 'Increase 5–10%';
    else if (finalAction === 'Hold' || finalAction === 'Hold / Watch') sizeAction = '—';
    else if (finalAction === 'Trim') sizeAction = 'Reduce 10–15%';
    else if (finalAction === 'Strong Trim / Sell') sizeAction = 'Reduce 15–30%';

    // Calculate SEK suggestion
    let sizeSEK = '';
    if (positionValue > 0) {
      if (finalAction === 'Strong Buy') sizeSEK = `${formatCurrency(positionValue * 0.10)}–${formatCurrency(positionValue * 0.20)}`;
      else if (finalAction === 'Buy / Increase') sizeSEK = `${formatCurrency(positionValue * 0.10)}–${formatCurrency(positionValue * 0.15)}`;
      else if (finalAction === 'Mild Buy') sizeSEK = `${formatCurrency(positionValue * 0.05)}–${formatCurrency(positionValue * 0.10)}`;
      else if (finalAction === 'Trim') sizeSEK = `-${formatCurrency(positionValue * 0.10)}–-${formatCurrency(positionValue * 0.15)}`;
      else if (finalAction === 'Strong Trim / Sell') sizeSEK = `-${formatCurrency(positionValue * 0.15)}–-${formatCurrency(positionValue * 0.30)}`;
    }

    // Build reason string
    let reasonParts = [];
    if (isDuplicate) reasonParts.push(`Duplicate in "${exposureGroup}"`);
    if (bucket === 1) reasonParts.push('Defensive role');
    else if (bucket === 3 && volatileCategories.includes(category)) reasonParts.push('Volatile asset');
    if (actionDetails) reasonParts.push(actionDetails);
    const reason = reasonParts.join(' · ');

    return {
      name: asset.name,
      brokerage: asset.brokerage,
      bucket,
      category,
      exposureGroup,
      compositeScore: asset.compositeScore,
      weightedScore: parseFloat(weightedScore.toFixed(2)),
      breadthScore,
      greenCount,
      redCount,
      neutralCount: 5 - greenCount - redCount,
      d3: d3 !== null ? parseFloat(d3.toFixed(2)) : null,
      d2: d2 !== null ? parseFloat(d2.toFixed(2)) : null,
      rawAction,
      finalAction,
      sizeAction,
      sizeSEK,
      reason,
      isDuplicate,
      positionValue
    };
  });

  // Sort: sell/trim first, then holds, then buys last
  const actionOrder = {
    'Strong Trim / Sell': 0,
    'Trim': 1,
    'Hold / Watch': 2,
    'Hold': 3,
    'Mild Buy': 4,
    'Buy / Increase': 5,
    'Strong Buy': 6
  };

  recommendations.sort((a, b) => {
    const orderDiff = (actionOrder[a.finalAction] || 3) - (actionOrder[b.finalAction] || 3);
    if (orderDiff !== 0) return orderDiff;
    return a.weightedScore - b.weightedScore; // within same action, worst first
  });

  currentRecommendations = {
    items: recommendations,
    regime,
    accelerationRatio,
    acceleratingCount: accelerating,
    deceleratingCount: decelerating,
    totalCount: allAssets.length
  };

  return currentRecommendations;
}

function sortRecTable(key) {
  if (recSortKey === key) {
    recSortAsc = !recSortAsc;
  } else {
    recSortKey = key;
    // Sensible defaults: numeric columns default descending (worst first), text columns ascending
    recSortAsc = (key === 'name' || key === 'action' || key === 'reason');
  }
  renderRecommendationsTable();
}

function renderRecommendationsTable() {
  const container = document.getElementById('recommendationsTableContainer');
  const regimeBanner = document.getElementById('recRegimeBanner');
  if (!container) return;

  const hasLiveData = (typeof perfLivePrices !== 'undefined' && perfLivePrices && perfLivePrices.length > 0);

  if (!hasLiveData) {
    container.innerHTML = '<div class="text-center text-sm text-[var(--fg-muted)] py-8">No live price data loaded. Click "Refresh Prices" in the Performance tab first.</div>';
    if (regimeBanner) regimeBanner.classList.add('hidden');
    return;
  }

  const recs = computeRecommendations();

  if (!recs || recs.items.length === 0) {
    container.innerHTML = '<div class="text-center text-sm text-[var(--fg-muted)] py-8">No recommendation data available. Ensure live prices have trailing returns data.</div>';
    if (regimeBanner) regimeBanner.classList.add('hidden');
    return;
  }

  // Regime banner
  if (regimeBanner) {
    const regimeConfig = {
      riskOn: { emoji: '🟢', label: 'Risk-On', desc: 'Buy signals actionable', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', color: '#34d399' },
      mixed: { emoji: '🟡', label: 'Mixed', desc: 'Standard rules apply', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', color: '#fbbf24' },
      weak: { emoji: '🟠', label: 'Weak', desc: 'Only strongest assets', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', color: '#fbbf24' },
      defensive: { emoji: '🔴', label: 'Defensive', desc: 'Avoid aggressive buying', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', color: '#f87171' }
    };
    const cfg = regimeConfig[recs.regime] || regimeConfig.mixed;
    regimeBanner.classList.remove('hidden');
    regimeBanner.style.cssText = `background:${cfg.bg};border:1px solid ${cfg.border};border-radius:8px;padding:8px 14px;text-align:center;`;
    regimeBanner.innerHTML = `<span style="font-size:14px;">${cfg.emoji}</span> <strong style="color:${cfg.color};">${cfg.label} Regime</strong> <span style="font-size:12px;color:var(--fg-muted);">— ${recs.acceleratingCount}/${recs.totalCount} accelerating (${recs.accelerationRatio.toFixed(0)}%) · ${cfg.desc}</span>`;
  }

  // Sort items based on current sort state
  let items = [...recs.items];
  if (recSortKey) {
    items.sort((a, b) => {
      let va, vb;
      switch (recSortKey) {
        case 'name': va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
        case 'bucket': va = a.bucket; vb = b.bucket; break;
        case 'weightedScore': va = a.weightedScore; vb = b.weightedScore; break;
        case 'breadthScore': va = a.breadthScore; vb = b.breadthScore; break;
        case 'd3': va = a.d3 !== null ? a.d3 : (recSortAsc ? Infinity : -Infinity); vb = b.d3 !== null ? b.d3 : (recSortAsc ? Infinity : -Infinity); break;
        case 'd2': va = a.d2 !== null ? a.d2 : (recSortAsc ? Infinity : -Infinity); vb = b.d2 !== null ? b.d2 : (recSortAsc ? Infinity : -Infinity); break;
        case 'action': {
          const actionOrder = { 'Strong Trim / Sell': 0, 'Trim': 1, 'Hold / Watch': 2, 'Hold': 3, 'Mild Buy': 4, 'Buy / Increase': 5, 'Strong Buy': 6 };
          va = actionOrder[a.finalAction] || 3; vb = actionOrder[b.finalAction] || 3; break;
        }
        case 'size': va = a.positionValue; vb = b.positionValue; break;
        case 'reason': va = a.reason.toLowerCase(); vb = b.reason.toLowerCase(); break;
        default: return 0;
      }
      if (va == vb) return 0;
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return recSortAsc ? cmp : -cmp;
    });
  }

  // Build sorted column headers with sort indicators
  function sortArrow(colKey) {
    if (recSortKey !== colKey) return ' <span style="opacity:0.3;">⭥</span>';
    return recSortAsc ? ' <span>▲</span>' : ' <span>▼</span>';
  }
  function sortableHeader(colKey, label, style) {
    const arrow = sortArrow(colKey);
    return `<th class="sortable-header" onclick="sortRecTable('${colKey}')" style="${style}cursor:pointer;user-select:none;white-space:nowrap;">${label}${arrow}</th>`;
  }

  const actionColors = {
    'Strong Buy': { bg: 'rgba(16,185,129,0.15)', fg: '#34d399', icon: '🚀' },
    'Buy / Increase': { bg: 'rgba(16,185,129,0.1)', fg: '#34d399', icon: '📈' },
    'Mild Buy': { bg: 'rgba(16,185,129,0.06)', fg: '#22c55e', icon: '↗️' },
    'Hold': { bg: 'rgba(148,163,184,0.08)', fg: '#94a3b8', icon: '➡️' },
    'Hold / Watch': { bg: 'rgba(245,158,11,0.08)', fg: '#fbbf24', icon: '👀' },
    'Trim': { bg: 'rgba(245,158,11,0.1)', fg: '#f59e0b', icon: '📉' },
    'Strong Trim / Sell': { bg: 'rgba(239,68,68,0.12)', fg: '#f87171', icon: '🔻' }
  };

  let html = '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">';
  html += '<thead><tr>';
  html += sortableHeader('name', 'Asset', 'min-width:140px;');
  html += sortableHeader('bucket', 'B', 'width:28px;text-align:center;');
  html += sortableHeader('weightedScore', 'Wtd Score', 'text-align:center;width:64px;');
  html += sortableHeader('breadthScore', 'Br', 'text-align:center;width:36px;');
  html += sortableHeader('d3', '3Mvs1Y', 'text-align:center;width:64px;');
  html += sortableHeader('d2', '1Mvs3M', 'text-align:center;width:64px;');
  html += sortableHeader('action', 'Action', 'text-align:center;width:90px;');
  html += sortableHeader('size', 'Size (SEK)', 'text-align:right;width:110px;');
  html += sortableHeader('reason', 'Reason', '');
  html += '</tr></thead><tbody>';

  items.forEach(rec => {
    const actColor = actionColors[rec.finalAction] || actionColors['Hold'];
    const bucketClass = rec.bucket === 1 ? 'badge-bucket-1' : rec.bucket === 2 ? 'badge-bucket-2' : 'badge-bucket-3';

    // Signal coloring
    function signalCell(delta) {
      if (delta === null) return '<td class="text-center text-[var(--fg-muted)]">—</td>';
      const color = delta > 0.5 ? 'color:#34d399;' : delta < -0.5 ? 'color:#f87171;' : 'color:var(--fg-muted);';
      const icon = delta > 0.5 ? '📈' : delta < -0.5 ? '📉' : '➡️';
      return `<td class="text-center font-mono" style="${color}font-size:0.75rem;">${icon} ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}</td>`;
    }

    html += '<tr>';
    html += `<td class="font-medium">${escapeHtml(rec.name)} <span class="text-xs text-[var(--fg-muted)]">${rec.brokerage}</span></td>`;
    html += `<td class="text-center"><span class="badge ${bucketClass}" style="padding:2px 6px;font-size:10px;">${rec.bucket}</span></td>`;

    // Weighted Score
    const wsColor = rec.weightedScore > 0.5 ? 'color:#34d399;' : rec.weightedScore < -0.5 ? 'color:#f87171;' : 'color:var(--fg-muted);';
    html += `<td class="text-center font-mono font-semibold" style="${wsColor}">${rec.weightedScore >= 0 ? '+' : ''}${rec.weightedScore.toFixed(2)}</td>`;

    // Breadth
    const brColor = rec.breadthScore >= 2 ? 'color:#34d399;' : rec.breadthScore <= -2 ? 'color:#f87171;' : 'color:var(--fg-muted);';
    html += `<td class="text-center font-mono font-semibold" style="${brColor}">${rec.breadthScore >= 0 ? '+' : ''}${rec.breadthScore}</td>`;

    // Key signals
    html += signalCell(rec.d3);
    html += signalCell(rec.d2);

    // Action badge
    html += `<td class="text-center"><span style="display:inline-block;padding:3px 8px;border-radius:12px;font-size:0.7rem;font-weight:600;background:${actColor.bg};color:${actColor.fg};">${actColor.icon} ${rec.finalAction}</span></td>`;

    // Size
    html += `<td class="text-right text-xs font-mono text-[var(--fg-secondary)]">${rec.sizeSEK || '—'}</td>`;

    // Reason
    html += `<td class="text-xs text-[var(--fg-muted)]" style="max-width:260px;white-space:normal;">${escapeHtml(rec.reason)}</td>`;

    html += '</tr>';
  });

  html += '</tbody></table>';

  // Summary row
  html += `<div class="mt-3 text-xs text-[var(--fg-muted)] text-center">
    ${recs.totalCount} assets · 
    ${recs.items.filter(r => r.finalAction.includes('Buy')).length} buy · 
    ${recs.items.filter(r => r.finalAction === 'Hold' || r.finalAction === 'Hold / Watch').length} hold · 
    ${recs.items.filter(r => r.finalAction.includes('Trim')).length} trim/sell
  </div>`;

  container.innerHTML = html;
}

// Add hover style for sortable headers
(function injectRecSortStyles() {
  if (document.getElementById('rec-sort-styles')) return;
  const style = document.createElement('style');
  style.id = 'rec-sort-styles';
  style.textContent = `.sortable-header:hover { color: var(--fg-primary) !important; }`;
  document.head.appendChild(style);
})();

"use strict";


// --- AI HOLDINGS ANALYSIS ---
const AI_ANALYSIS_LS_KEY = 'portfolioTracker_aiAnalysis';
let aiAnalysisHistory = []; // { role: 'user'|'assistant', content: '...' }
let aiAbortController = null; // for cancelling in-flight API requests

function loadAiAnalysis() {
  try {
    const raw = localStorage.getItem(AI_ANALYSIS_LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      aiAnalysisHistory = data.history || [];
      if (data.initialAnalysis) {
        renderAiAnalysisContent(data.initialAnalysis, false);
      }
    }
  } catch (e) { console.warn('Failed to load AI analysis:', e); }
}

function saveAiAnalysis() {
  try {
    const initialAnalysis = aiAnalysisHistory.find(m => m.role === 'assistant');
    localStorage.setItem(AI_ANALYSIS_LS_KEY, JSON.stringify({
      initialAnalysis: initialAnalysis ? initialAnalysis.content : null,
      history: aiAnalysisHistory
    }));
  } catch (e) { console.warn('Failed to save AI analysis:', e); }
}

/**
 * Determine if a Yahoo Finance ticker/symbol is valid for web search.
 * Returns false only for non-financial placeholders (CASH, not_found).
 * All real Yahoo Finance tickers (stocks, ETFs, mutual funds) are included.
 */
function isSearchableTicker(symbol) {
  if (!symbol) return false;
  // Skip if symbol is just "CASH" or null
  if (symbol === 'CASH' || symbol === 'not_found') return false;
  // All real Yahoo Finance tickers are searchable (stocks, ETFs, mutual funds)
  return true;
}

/**
 * Extract the company/asset name from a holding name for search queries.
 * Strips common Swedish fund suffixes and normalizes for web search.
 */
function buildSearchableName(name) {
  if (!name) return '';
  // For known patterns, extract the meaningful part
  return name
    .replace(/\s*(fond|fond a|fond sverige|index|räntefond|ränta kort)$/i, '')
    .replace(/\s*(a acc sek|a acc|ex mega cap)$/i, '')
    .trim();
}

function simpleMarkdownToHtml(text) {
  if (!text) return '';
  let html = text
    // Escape HTML
    .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  // Paragraphs: wrap remaining lines
  html = html.split('\n').map(line => {
    if (line.startsWith('<h') || line.startsWith('<ul') || line.startsWith('<blockquote') || line.startsWith('<li') || line.trim() === '') return line;
    return '<p>' + line + '</p>';
  }).join('\n');
  return html;
}

function buildPortfolioSummary() {
  if (!currentSnapshot) return 'No portfolio data available.';
  const effective = getEffectiveSnapshot(currentSnapshot);
  const ft = calculateFilteredTotals(effective);
  const holdings = getFilteredHoldings(effective);
  holdings.forEach(h => {
    const cls = getClassificationFromReference(h.name, h.brokerage);
    if (cls.found) { h.category = cls.category; h.bucket = cls.bucket; }
  });
  holdings.sort((a, b) => b.value - a.value);

  let summary = `## Portfolio Summary\n`;
  summary += `- **Total Value:** ${formatCurrency(ft.totalValue)}\n`;
  summary += `- **Number of Holdings:** ${holdings.length}\n`;

  // Bucket allocation
  const bucketAlloc = { 1: 0, 2: 0, 3: 0, 0: 0 };
  holdings.forEach(h => { bucketAlloc[h.bucket] = (bucketAlloc[h.bucket] || 0) + h.value; });
  summary += `\n### Bucket Allocation\n`;
  Object.keys(bucketAlloc).sort().forEach(b => {
    if (bucketAlloc[b] > 0) {
      const pct = ft.totalValue > 0 ? ((bucketAlloc[b] / ft.totalValue) * 100).toFixed(1) : 0;
      const bname = BUCKETS[b] ? BUCKETS[b].name : 'Unknown';
      summary += `- **B${b} (${bname}):** ${formatCurrency(bucketAlloc[b])} (${pct}%)\n`;
    }
  });

  // Build momentum data from perfLivePrices
  const priceMap = new Map((typeof perfLivePrices !== 'undefined' ? perfLivePrices : []).map(p => [p.name.toLowerCase(), p]));
  const bucketLabels = { 1: 'B1 — Cash/Short', 2: 'B2 — Fixed Income', 3: 'B3 — Equity', 0: 'Unclassified' };

  // Group holdings by bucket
  const grouped = {};
  holdings.forEach(h => {
    const b = h.bucket || 0;
    if (!grouped[b]) grouped[b] = [];
    grouped[b].push(h);
  });

  // Render momentum table per bucket (B3 → B2 → B1)
  const bucketOrder = [3, 2, 1, 0];
  bucketOrder.forEach(b => {
    const group = grouped[b];
    if (!group || group.length === 0) return;

    const label = bucketLabels[b] || 'Unknown';
    summary += `\n### ${label}\n\n`;
    summary += `| Asset | Brokerage | Composite Score | Signal | Notes/Rationale |\n`;
    summary += `|-------|-----------|-----------------|--------|-----------------|\n`;

    group.forEach(h => {
      const priceData = priceMap.get(h.name.toLowerCase());
      const tr = priceData?.trailingReturns || {};
      const oneMonth = tr.oneMonth ?? null;
      const threeMonth = tr.threeMonth ?? null;
      const oneYear = tr.oneYear ?? null;

      // 12-1M Momentum = (1+1Y)/(1+1M) - 1
      let twelveMinusOne = null;
      if (oneMonth !== null && oneYear !== null && (1 + oneMonth / 100) !== 0) {
        twelveMinusOne = ((1 + oneYear / 100) / (1 + oneMonth / 100)) - 1;
      }

      // Composite Score = 70% * 12-1M + 30% * 3M
      let compositeScore = null;
      if (twelveMinusOne !== null && threeMonth !== null) {
        compositeScore = 0.7 * twelveMinusOne + 0.3 * (threeMonth / 100);
      }

      // Signal determination
      const score = compositeScore;
      const tm1 = twelveMinusOne;
      const m3 = threeMonth !== null ? threeMonth / 100 : null;
      let signal;
      if (score === null || tm1 === null || m3 === null) {
        signal = '🔴 No Data';
      } else if (score < 0 || (tm1 < 0 && m3 < 0)) {
        signal = '🔴 Weak';
      } else if (m3 < 0) {
        signal = '🟠 Declining';
      } else if (score > 0.05 && tm1 > 0 && m3 > 0) {
        signal = '🟢 Strong';
      } else if (score > 0 && m3 > 0) {
        signal = '🟡 Moderate';
      } else {
        signal = '🟠 Mixed';
      }

      const fmtScore = compositeScore !== null ? (compositeScore >= 0 ? '+' : '') + (compositeScore * 100).toFixed(2) + '%' : '—';
      summary += `| ${h.name} | ${h.brokerage} | ${fmtScore} | ${signal} | *(to be analyzed)* |\n`;
    });
  });

  return summary;
}

function renderAiAnalysisContent(markdown, showFollowUp) {
  const contentEl = document.getElementById('aiAnalysisContent');
  const emptyEl = document.getElementById('aiAnalysisEmpty');
  const followUpEl = document.getElementById('aiFollowUpSection');
  if (!contentEl) return;

  contentEl.innerHTML = simpleMarkdownToHtml(markdown);
  contentEl.classList.remove('hidden');
  if (emptyEl) emptyEl.classList.add('hidden');

  if (showFollowUp !== false) {
    if (followUpEl) followUpEl.classList.remove('hidden');
    const input = document.getElementById('aiFollowUpInput');
    const btn = document.getElementById('aiFollowUpBtn');
    if (input) input.disabled = false;
    if (btn) btn.disabled = false;
  }

  renderAiChatHistory();
}

function renderAiChatHistory() {
  const chatEl = document.getElementById('aiChatHistory');
  if (!chatEl) return;
  // Show only follow-up messages (skip the initial analysis pair)
  const followUps = aiAnalysisHistory.slice(2);
  if (followUps.length === 0) {
    chatEl.innerHTML = '';
    return;
  }
  chatEl.innerHTML = followUps.map(msg => {
    if (msg.role === 'user') {
      return `<div class="ai-chat-user text-sm"><strong>You:</strong> ${escapeHtml(msg.content)}</div>`;
    } else {
      return `<div class="ai-chat-ai ai-markdown text-sm">${simpleMarkdownToHtml(msg.content)}</div>`;
    }
  }).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function analyzeHoldingsWithAI() {
  if (!currentSnapshot) {
    alert('Please load portfolio data first.');
    return;
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    alert('Please configure your AI API key first. Click the "API" button in the header.');
    showApiSettings();
    return;
  }

  // Warn if re-analyzing would discard follow-up conversation
  if (aiAnalysisHistory.length > 2) {
    if (!confirm('Re-analyzing will discard your follow-up conversation. Continue?')) {
      return;
    }
  }

  // Cancel any in-flight request
  if (aiAbortController) {
    aiAbortController.abort();
  }
  aiAbortController = new AbortController();

  const btn = document.getElementById('aiAnalyzeBtn');
  const btnText = document.getElementById('aiAnalyzeBtnText');
  const spinner = document.getElementById('aiLoadingSpinner');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Analyzing...';
  if (spinner) spinner.classList.remove('hidden');

  try {
    const portfolioSummary = buildPortfolioSummary();

    // --- Build targeted web search query from searchable holdings ---
    const priceMapForSearch = new Map((typeof perfLivePrices !== 'undefined' ? perfLivePrices : []).map(p => [p.name.toLowerCase(), p]));
    const effective = getEffectiveSnapshot(currentSnapshot);
    const holdingsForSearch = getFilteredHoldings(effective);
    const searchableAssets = [];

    holdingsForSearch.forEach(h => {
      const pd = priceMapForSearch.get(h.name.toLowerCase());
      const symbol = pd?.symbol;
      if (isSearchableTicker(symbol)) {
        const searchName = buildSearchableName(h.name);
        searchableAssets.push({ name: searchName, symbol: symbol });
      }
    });

    // Build a focused search query listing only real stocks/ETFs
    let webSearchEnabled = false;
    let searchQuery = '';
    if (searchableAssets.length > 0) {
      const assetQueries = searchableAssets.map(a => {
        // Strip exchange suffix for cleaner search (e.g., "EXUS.DE" → "Xtrackers EXUS ETF")
        const baseSymbol = a.symbol.replace(/\.[A-Z]+$/, '');
        return `${a.name} (${baseSymbol}) stock ETF outlook news 2025 2026`;
      });
      searchQuery = 'Recent market news and outlook for: ' + assetQueries.join('. ');
      webSearchEnabled = true;
      console.log(`🔍 Web search enabled for ${searchableAssets.length} searchable assets:`, searchableAssets.map(a => a.symbol));
    }

    // Update loading indicator
    if (spinner) spinner.textContent = webSearchEnabled ? 'Searching web & analyzing...' : 'Analyzing...';

    const systemPrompt = `You are a professional portfolio analyst specializing in momentum analysis. Analyze the portfolio data provided below.

${webSearchEnabled ? `Web search results have been included for the holdings in the portfolio. Use the web search results to provide up-to-date market context, recent news, and analyst sentiment where available. For assets where web results are sparse or not directly relevant, supplement with the provided performance data (trailing returns, momentum scores) to assess their momentum.` : `Use your knowledge of current market conditions, recent earnings reports, sector rotation, and macro trends to provide informed rationale.`}

For each asset in each bucket, fill in the "Notes/Rationale" column with a concise 2-3 sentence analysis that:
1. Explains what's driving the composite momentum score (combining long-term and short-term trends)
2. Provides market context — recent news, sector trends, earnings, or macro factors affecting this asset
3. Assesses whether the signal (Strong/Moderate/Declining/Weak) matches the current market situation

Group your response by bucket (B3 → B2 → B1) using the same table format as the input, but with the Notes/Rationale column filled in. Then add a brief summary section with:
- **Key momentum risks** — assets showing deteriorating momentum
- **Positive highlights** — assets with strongest momentum signals
- **Bucket-level assessment** — overall health of each bucket's momentum

Always respond in Markdown format. Be specific and reference actual data from the portfolio.`;

    const userPrompt = `Analyze the momentum of my portfolio holdings. Here is the data:\n\n${portfolioSummary}`;

    // Build request body — include web_search tool if searchable assets exist
    const requestBody = {
      model: getApiModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 4000
    };

    if (webSearchEnabled) {
      requestBody.tools = [{
        type: 'web_search',
        web_search: {
          search_query: searchQuery
        }
      }];
    }

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(requestBody),
      signal: aiAbortController.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error: ${response.status} - ${errText.substring(0, 200)}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || 'No analysis could be generated.';

    // Extract web search sources from the response
    const webSearchResults = result.web_search || [];
    let sourcesHtml = '';
    if (webSearchResults.length > 0) {
      sourcesHtml = '\n\n---\n\n### 📰 Web Search Sources\n';
      webSearchResults.forEach((src, i) => {
        const title = src.title || 'Untitled';
        const link = src.link || '#';
        const media = src.media || '';
        sourcesHtml += `${i + 1}. [${title}](${link})${media ? ` — *${media}*` : ''}\n`;
      });
    }

    // Store metadata about web search enrichment
    const fullContent = content + sourcesHtml;
    const searchBadge = webSearchEnabled
      ? `<span class="text-xs text-[var(--fg-muted)] ml-2">🔍 Enriched with web search (${searchableAssets.length} assets, ${webSearchResults.length} sources)</span>`
      : '';

    aiAnalysisHistory = [
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: fullContent }
    ];
    saveAiAnalysis();
    renderAiAnalysisContent(fullContent);

    // Show web search enrichment badge
    const badgeEl = document.getElementById('aiWebSearchBadge');
    if (badgeEl) {
      badgeEl.innerHTML = searchBadge;
      badgeEl.classList.toggle('hidden', !webSearchEnabled);
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('AI analysis request was cancelled.');
      return;
    }
    console.error('AI Holdings Analysis error:', err);
    alert('AI Analysis failed: ' + err.message);
    // Revert button text on error
    if (btnText) btnText.textContent = 'Analyze Holdings with AI';
  } finally {
    if (btn) btn.disabled = false;
    if (btnText && btnText.textContent === 'Analyzing...') {
      btnText.textContent = aiAnalysisHistory.length > 0 ? 'Re-Analyze Holdings' : 'Analyze Holdings with AI';
    }
    if (spinner) spinner.classList.add('hidden');
    aiAbortController = null;
  }
}

async function askFollowUpQuestion() {
  const input = document.getElementById('aiFollowUpInput');
  const btn = document.getElementById('aiFollowUpBtn');
  const question = input ? input.value.trim() : '';
  if (!question) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    alert('Please configure your AI API key first.');
    showApiSettings();
    return;
  }

  // Add user message to history
  aiAnalysisHistory.push({ role: 'user', content: question });
  if (input) input.value = '';
  if (btn) btn.disabled = true;
  if (input) input.disabled = true;

  renderAiChatHistory();

  try {
    // Build conversation messages for context
    const systemMsg = { role: 'system', content: 'You are a professional portfolio analyst specializing in momentum analysis. Always respond in Markdown format. Be specific, reference actual momentum data and signals when relevant. Keep answers concise.' };
    const contextMsg = { role: 'user', content: `Here is my portfolio momentum summary for context:\n\n${buildPortfolioSummary()}` };
    const contextReply = aiAnalysisHistory[1] ? { role: 'assistant', content: aiAnalysisHistory[1].content } : null;

    const messages = [systemMsg, contextMsg];
    if (contextReply) messages.push(contextReply);

    // Add follow-up conversation (skip first pair which is the initial analysis)
    const followUps = aiAnalysisHistory.slice(2);
    // Only include last few exchanges to keep within token limits
    const recentFollowUps = followUps.slice(-6);
    messages.push(...recentFollowUps.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })));

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: getApiModel(),
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || 'No response could be generated.';

    aiAnalysisHistory.push({ role: 'assistant', content: content });
    saveAiAnalysis();
    renderAiChatHistory();

  } catch (err) {
    console.error('AI Follow-up error:', err);
    aiAnalysisHistory.push({ role: 'assistant', content: `*Error: ${err.message}*` });
    renderAiChatHistory();
  } finally {
    if (btn) btn.disabled = false;
    if (input) input.disabled = false;
    if (input) input.focus();
  }
}

// Handle Enter key in follow-up input
document.addEventListener('DOMContentLoaded', () => {
  const followUpInput = document.getElementById('aiFollowUpInput');
  if (followUpInput) {
    followUpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !followUpInput.disabled) {
        e.preventDefault();
        askFollowUpQuestion();
      }
    });
  }
});

// --- ANALYTICS HOLDINGS WITH EXTERNAL LINKS ---
const PERF_LINK_LS_KEY = 'portfolioTracker_perfLinks';
let performanceLinks = {};

function loadPerformanceLinks() {
  try {
    const raw = localStorage.getItem(PERF_LINK_LS_KEY);
    if (raw) performanceLinks = JSON.parse(raw);
  } catch (e) { console.warn('Failed to load performance links:', e); }
}

function savePerformanceLinks() {
  try {
    localStorage.setItem(PERF_LINK_LS_KEY, JSON.stringify(performanceLinks));
  } catch (e) { console.warn('Failed to save performance links:', e); }
}

function setPerformanceLink(name, brokerage) {
  const key = `${name}|${brokerage}`;
  const currentUrl = performanceLinks[key] || '';
  const url = prompt(`Enter external performance link for "${name}" (${brokerage}):`, currentUrl);
  if (url === null) return; // cancelled
  if (url.trim()) {
    performanceLinks[key] = url.trim();
  } else {
    delete performanceLinks[key];
  }
  savePerformanceLinks();
  renderAnalyticsHoldings();
}

function renderAnalyticsHoldings() {
  const tbody = document.getElementById('analyticsHoldingsTable');
  if (!tbody || !currentSnapshot) return;

  const effective = getEffectiveSnapshot(currentSnapshot);
  const ft = calculateFilteredTotals(effective);
  const holdings = getFilteredHoldings(effective);

  // Classify each holding
  holdings.forEach(h => {
    const cls = getClassificationFromReference(h.name, h.brokerage);
    if (cls.found) { h.category = cls.category; h.bucket = cls.bucket; }
  });

  holdings.sort((a, b) => b.value - a.value);

  tbody.innerHTML = holdings.map(h => {
    const bucketInfo = BUCKETS[h.bucket] || { name: 'Unknown', class: 'badge-other' };
    const pct = ft.totalValue > 0 ? ((h.value / ft.totalValue) * 100).toFixed(2) : '0.00';
    const key = `${h.name}|${h.brokerage}`;
    const link = performanceLinks[key];
    const escapedName = h.name.replace(/'/g, "\\'");

    let linkCell;
    if (link) {
      linkCell = `<div class="flex items-center gap-2">
        <a href="${link}" target="_blank" rel="noopener noreferrer" class="text-[var(--accent-secondary)] hover:underline text-sm truncate max-w-[200px]" title="${link}">${link.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</a>
        <button onclick="setPerformanceLink('${escapedName}','${h.brokerage}')" class="text-[var(--fg-muted)] hover:text-[var(--fg-primary)] flex-shrink-0" title="Edit link">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
        </button>
      </div>`;
    } else {
      linkCell = `<button onclick="setPerformanceLink('${escapedName}','${h.brokerage}')" class="flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-[var(--accent-secondary)] text-sm" title="Add performance link">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
        <span>Add link</span>
      </button>`;
    }

    return `<tr>
      <td class="font-medium">${escapeHtml(h.name)}</td>
      <td>${escapeHtml(h.brokerage)}</td>
      <td><span class="badge" style="background: ${(categoryColors[h.category] || {bg:'rgba(148,163,184,0.15)'}).bg}; color: ${(categoryColors[h.category] || {text:'#94a3b8'}).text}">${h.category || 'Unassigned'}</span></td>
      <td><span class="badge ${bucketInfo.class}">B${h.bucket}</span></td>
      <td class="text-right font-mono">${formatCurrency(h.value)}</td>
      <td class="text-right font-mono">${pct}%</td>
      <td>${linkCell}</td>
    </tr>`;
  }).join('');
}

// Load performance links on startup
loadPerformanceLinks();

// --- PWA REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// Hook: after switchTab — render analytics/retirement/notes tabs
registerHook('afterSwitchTab', function(tabId) {
  if (tabId === 'analytics') { renderAnalyticsHoldings(); loadAiAnalysis(); renderBucketAnalyticsSnapshots(); }
  if (tabId === 'retirement') { loadRetirementData(); populateRetirementForm(); }
  if (tabId === 'notes') { renderNotesTab(); }
});

// Hook: after showDashboard — auto-save to localStorage
registerHook('afterShowDashboard', function() {
  saveToLocalStorage();
});

// Hook: after setupEventListeners — restore state from localStorage
registerHook('afterSetupEventListeners', function() {
  migrateOldApiSettings(); // Migrate old API settings
  loadExcludedAssets(); // Load excluded assets on startup
  loadReferenceTable(); // Load reference table on startup
  loadRebalancingTargets(); // Load custom rebalancing targets
  loadRebalancingDuration(); // Load rebalancing duration
  loadRebalancingMonth(); // Load selected rebalancing month
  loadTargetSettings(); // Load target return tracker settings
  loadRetirementData(); // Load retirement data early so it's available when tab opens
  // Set duration input value
  const durInput = document.getElementById('rebalancingDurationInput');
  if (durInput) durInput.value = REBALANCING_MONTHS;
  // Update header text
  const headerEl = document.getElementById('rebalancingScheduleHeader');
  if (headerEl) headerEl.textContent = REBALANCING_MONTHS + '-Month Rebalancing Schedule';
  // Initialize month selector
  updateMonthSelector();
  // Update schedule table headers
  updateScheduleTableHeaders();
  if (loadFromLocalStorage()) showDashboard();
  setupPerformanceListeners();
  // Setup target tracker input listeners
  document.getElementById('yearStartValueInput')?.addEventListener('change', function() {
    targetSettings.yearStartValue = this.value;
    saveTargetSettings();
    renderTargetTracker();
  });
  document.getElementById('targetReturnInput')?.addEventListener('change', function() {
    targetSettings.targetReturn = parseFloat(this.value) || 7;
    saveTargetSettings();
    renderTargetTracker();
  });
  if (loadPerformanceDataFromStorage()) {
    // Performance data restored; will render when Analytics tab is opened
  }
});

// --- REFERENCE TABLE FUNCTIONS ---

function loadReferenceTable() {
  try {
    const raw = localStorage.getItem('portfolioTracker_reference');
    if (raw) {
      classificationReference = JSON.parse(raw);
    } else {
      // Load default reference
      classificationReference = JSON.parse(JSON.stringify(DEFAULT_REFERENCE));
    }
    renderReferenceTable();
  } catch (e) {
    console.error('Failed to load reference table:', e);
    classificationReference = JSON.parse(JSON.stringify(DEFAULT_REFERENCE));
    renderReferenceTable();
  }
}

function renderReferenceTable() {
  const container = document.getElementById('referenceTableContent');
  if (!container) return;

  const renderSection = (broker, brokerLabel, assets) => {
    const rows = assets.map((asset, index) => `
      <div class="grid grid-cols-[40px_1fr_120px_180px_160px] gap-2 items-center py-2 border-b border-[var(--border-subtle)]">
        <div>
          <button onclick="deleteReferenceAsset('${broker}', ${index})" class="text-red-400 hover:text-red-300 p-1" title="Delete">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
        <div>
          <input type="text" value="${asset.name}" onchange="updateReferenceAsset('${broker}', ${index}, 'name', this.value)" 
            class="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-2 py-1 text-sm focus:border-[var(--accent-primary)] outline-none">
        </div>
        <div>
          <input type="text" value="${asset.symbol || ''}" placeholder="e.g. AAPL" onchange="updateReferenceAsset('${broker}', ${index}, 'symbol', this.value)" 
            class="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-2 py-1 text-sm font-mono focus:border-[var(--accent-secondary)] outline-none" title="Yahoo Finance ticker symbol">
        </div>
        <div>
          <select class="edit-select w-full" onchange="updateReferenceAsset('${broker}', ${index}, 'category', this.value)">
            ${CATEGORIES.map(c => `<option value="${c}" ${asset.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <select class="edit-select w-full" onchange="updateReferenceAsset('${broker}', ${index}, 'bucket', this.value)">
            ${Object.entries(BUCKETS).map(([k, v]) => `<option value="${k}" ${asset.bucket == k ? 'selected' : ''}>B${k}: ${v.name}</option>`).join('')}
          </select>
        </div>
      </div>
    `).join('');

    return `
      <div class="bg-[var(--bg-secondary)] rounded-lg p-4">
        <h4 class="font-semibold mb-3 text-cyan-400">${brokerLabel} <span class="text-xs text-[var(--fg-muted)]">(${assets.length} assets)</span></h4>
        <div class="grid grid-cols-[40px_1fr_120px_180px_160px] gap-2 items-center py-1 border-b border-[var(--border)] text-xs text-[var(--fg-muted)] uppercase font-semibold">
          <div></div><div>Asset Name</div><div>Symbol</div><div>Category</div><div>Bucket</div>
        </div>
        ${rows || '<div class="py-4 text-center text-[var(--fg-muted)]">No assets defined</div>'}
      </div>
    `;
  };

  container.innerHTML = 
    renderSection('avanza', 'Avanza', classificationReference.avanza) +
    renderSection('nordnet', 'Nordnet', classificationReference.nordnet);
}

function updateReferenceAsset(broker, index, field, value) {
  if (field === 'bucket') {
    value = parseInt(value);
  }
  classificationReference[broker][index][field] = value;
}

function addNewAssetRow(broker) {
  const newAsset = {
    name: 'New Asset',
    symbol: '',
    category: 'Other',
    bucket: 0
  };
  classificationReference[broker].push(newAsset);
  renderReferenceTable();
}

function deleteReferenceAsset(broker, index) {
  if (confirm('Delete this asset from reference table?')) {
    classificationReference[broker].splice(index, 1);
    renderReferenceTable();
  }
}

function syncTargetsFromReference() {
  // Ensure rebalancing targets match the reference table holdings
  // Skip if no reference exists yet (classificationReference empty/initial)
  const hasReference = (classificationReference.avanza && classificationReference.avanza.length > 0)
                    || (classificationReference.nordnet && classificationReference.nordnet.length > 0);
  if (!hasReference) return;

  for (const broker of ['avanza', 'nordnet']) {
    const refAssets = classificationReference[broker] || [];
    // Only sync for brokers that actually have reference entries
    if (refAssets.length === 0) continue;
    const currentTargets = rebalancingTargets[broker] || [];

    // Build new targets list from reference table
    const newTargets = refAssets.map(refAsset => {
      // Keep existing target if asset name matches
      const existing = currentTargets.find(t =>
        namesMatch(t.name, refAsset.name)
      );
      return {
        bucket: refAsset.bucket,
        name: refAsset.name,
        target: existing ? existing.target : 0
      };
    });

    rebalancingTargets[broker] = newTargets;
  }
}

function saveReferenceTable() {
  try {
    localStorage.setItem('portfolioTracker_reference', JSON.stringify(classificationReference));
    // Sync rebalancing targets with updated reference table
    syncTargetsFromReference();
    saveRebalancingTargets();
    // Re-render rebalancing tab if visible
    const rebalTab = document.getElementById('rebalancingTab');
    if (rebalTab && !rebalTab.classList.contains('hidden')) {
      renderRebalancingTables();
    }
    alert('Reference table saved successfully! Rebalancing targets synced.');
  } catch (e) {
    console.error('Failed to save reference table:', e);
    alert('Failed to save reference table. Error: ' + e.message);
  }
}

function exportReferenceTable() {
  try {
    const dataStr = JSON.stringify(classificationReference, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'classification_reference.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (e) {
    console.error('Failed to export reference table:', e);
    alert('Failed to export reference table. Error: ' + e.message);
  }
}

function importReferenceTable(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported.avanza && imported.nordnet) {
        if (confirm('Importing reference table will overwrite current settings. Continue?')) {
          classificationReference = imported;
          renderReferenceTable();
          saveReferenceTable();
        }
      } else {
        alert('Invalid reference table format.');
      }
    } catch (err) {
      console.error('Failed to parse reference table:', err);
      alert('Failed to parse reference table file.');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// Hook: beforeFindBucketForName — use reference table for bucket classification
registerHook('beforeFindBucketForName', function(name, broker, csvCategory) {
  // Ensure reference table is loaded
  if (classificationReference.avanza.length === 0 && classificationReference.nordnet.length === 0) {
    loadReferenceTable();
  }
  
  const ref = classificationReference[broker.toLowerCase()];
  if (ref && ref.length > 0) {
    const match = ref.find(r => namesMatch(r.name, name));
    
    if (match) {
      return match.bucket;
    }
  }
  
  // Fall back to category rules using CSV-provided category
  if (csvCategory && categoryRules[csvCategory] !== undefined) {
    return categoryRules[csvCategory];
  }
  
  // Return undefined to let default logic run
});

// Hook: beforeIsInSchedule — use reference table to determine schedule membership
registerHook('beforeIsInSchedule', function(name, broker) {
  // Ensure reference table is loaded
  if (classificationReference.avanza.length === 0 && classificationReference.nordnet.length === 0) {
    loadReferenceTable();
  }
  
  const ref = classificationReference[broker.toLowerCase()];
  if (!ref || ref.length === 0) return; // undefined: let default logic run
  
  return ref.some(r => namesMatch(r.name, name));
});
"use strict";


// --- RETIREMENT PLANNING ---
const RETIREMENT_LS_KEY = 'portfolioTracker_retirement';
let retirementData = { manualPortfolioValue: null, withdrawalRate: CONFIG.DEFAULT_WITHDRAWAL_RATE, yearOverrides: {} };
let pensionProjectionChart = null;

// External Pension Data (from minPension.se)
const PENSION_DATA = {
  karin: {
    name: 'Karin', birthYear: 1970,
    allman: { capital: 3852188 },
    privat: { capital: 216345 },
    policies: [
      { provider: 'Alecta', name: 'ITP2 Ålderspension', type: 'tjanstepension', capital: 1550000, minPensionMonthly: 9921, startAge: 65, durationYears: Infinity, status: 'active' },
      { provider: 'Alecta', name: 'Optimal Pension ITPK', type: 'tjanstepension', capital: 145134, minPensionMonthly: 703, startAge: 65, durationYears: Infinity, status: 'active' },
      { provider: 'Alecta', name: 'ITP1 Optimal (1)', type: 'tjanstepension', capital: 155508, minPensionMonthly: 878, startAge: 66, durationYears: Infinity, status: 'completed' },
      { provider: 'Alecta', name: 'ITP1 Optimal (2)', type: 'tjanstepension', capital: 128426, minPensionMonthly: 725, startAge: 66, durationYears: Infinity, status: 'completed' },
      { provider: 'KPA Pension', name: 'KAP-KL Livränta', type: 'tjanstepension', capital: 160000, minPensionMonthly: 1038, startAge: 65, durationYears: Infinity, status: 'completed' },
      { provider: 'KPA Pension', name: 'KAP-KL/AKAP-KR', type: 'tjanstepension', capital: 197608, minPensionMonthly: 1086, startAge: 70, durationYears: Infinity, status: 'completed' },
      { provider: 'SEB', name: 'Avtalspension ITPK (5 år)', type: 'tjanstepension', capital: 192465, minPensionMonthly: null, startAge: 65, durationYears: 5, status: 'completed' },
      { provider: 'SEB', name: 'Avtalspension ITPK (liv)', type: 'tjanstepension', capital: 129375, minPensionMonthly: null, startAge: 65, durationYears: Infinity, status: 'completed' },
      { provider: 'SEB', name: 'Avtalspension ITPK Entré', type: 'tjanstepension', capital: 52746, minPensionMonthly: null, startAge: 65, durationYears: Infinity, status: 'completed' },
      { provider: 'Skandia', name: 'ITP Avtalspension', type: 'tjanstepension', capital: 42258, minPensionMonthly: 180, startAge: 65, durationYears: Infinity, status: 'completed' },
      { provider: 'Skandia', name: 'Pensionsförsäkring (15 år)', type: 'tjanstepension', capital: 55819, minPensionMonthly: 390, startAge: 65, durationYears: 15, status: 'completed' },
      { provider: 'Skandia', name: 'Tjänstepension (5 år)', type: 'tjanstepension', capital: 179709, minPensionMonthly: 3522, startAge: 65, durationYears: 5, status: 'completed' },
      { provider: 'Skandia', name: 'Tjänstepension (10 år)', type: 'tjanstepension', capital: 503524, minPensionMonthly: 4997, startAge: 65, durationYears: 10, status: 'completed' }
    ]
  },
  yann: {
    name: 'Yann', birthYear: 1972,
    allman: { capital: 3819909 },
    privat: { capital: 0 },
    policies: [
      { provider: 'Various', name: 'Tjänstepension', type: 'tjanstepension', capital: 505484, minPensionMonthly: null, startAge: 65, durationYears: Infinity, status: 'completed' }
    ]
  }
};

function isPolicyActive(policy, age) {
  if (age < policy.startAge) return false;
  if (policy.durationYears === Infinity) return true;
  return age < policy.startAge + policy.durationYears;
}

function getPolicyMonthly(policy, withdrawalRate) {
  if (policy.minPensionMonthly) return policy.minPensionMonthly;
  if (policy.durationYears !== Infinity && policy.durationYears > 0) {
    return policy.capital / (policy.durationYears * 12);
  }
  return policy.capital * (withdrawalRate / 100) / 12;
}

function calculateAllmanMonthly(capital) {
  const lifeExpectancy = 84;
  const startAge = 65;
  const years = Math.max(lifeExpectancy - startAge, 1);
  return (capital / years) / 12;
}

function loadRetirementData() {
  try {
    const raw = localStorage.getItem(RETIREMENT_LS_KEY);
    if (raw) { retirementData = JSON.parse(raw); }
  } catch (e) { console.warn('Failed to load retirement data:', e); }
}

function saveRetirementData() {
  try { localStorage.setItem(RETIREMENT_LS_KEY, JSON.stringify(retirementData)); }
  catch (e) { console.warn('Failed to save retirement data:', e); }
}

function populateRetirementForm() {
  const valueInput = document.getElementById('retirementTotalValueInput');
  if (valueInput) {
    if (retirementData.manualPortfolioValue) {
      valueInput.value = Math.round(retirementData.manualPortfolioValue);
    } else if (currentSnapshot) {
      const effective = getEffectiveSnapshot(currentSnapshot);
      const ft = calculateFilteredTotals(effective);
      valueInput.value = Math.round(ft.totalValue);
    }
  }
  // Restore saved default WR%, tax%, and growth rate
  if (retirementData.defaultWR !== undefined) {
    const wrInput = document.getElementById('retirementDefaultWR');
    if (wrInput) wrInput.value = retirementData.defaultWR;
  }
  if (retirementData.defaultTax !== undefined) {
    const taxInput = document.getElementById('retirementDefaultTax');
    if (taxInput) taxInput.value = retirementData.defaultTax;
  }
  if (retirementData.growthRate !== undefined) {
    const growthInput = document.getElementById('retirementGrowthRate');
    if (growthInput) growthInput.value = retirementData.growthRate;
  }
  const portfolioValueInput = document.getElementById('retirementTotalValueInput');
  if (portfolioValueInput) {
    portfolioValueInput.addEventListener('input', updateRetirementTab);
    portfolioValueInput.addEventListener('change', updateRetirementTab);
  }
  updateRetirementTab();
}

function getYearOverride(year) {
  return retirementData.yearOverrides && retirementData.yearOverrides[year] 
    ? retirementData.yearOverrides[year] : null;
}

function getYearWR(year) {
  const o = getYearOverride(year);
  const defWR = parseFloat(document.getElementById('retirementDefaultWR').value) || 4.7;
  return o && o.wr !== undefined ? o.wr : defWR;
}

function getYearTax(year) {
  const o = getYearOverride(year);
  const defTax = parseFloat(document.getElementById('retirementDefaultTax').value) || 15;
  return o && o.tax !== undefined ? o.tax : defTax;
}

function applyDefaultWR(val) {
  const wr = parseFloat(val) || 4.7;
  document.getElementById('retirementDefaultWR').value = wr;
  if (!retirementData.yearOverrides) retirementData.yearOverrides = {};
  Object.keys(retirementData.yearOverrides).forEach(y => { retirementData.yearOverrides[y].wr = wr; });
  saveRetirementData();
  updateRetirementTab();
}

function applyDefaultTax(val) {
  const tax = parseFloat(val) || 15;
  document.getElementById('retirementDefaultTax').value = tax;
  if (!retirementData.yearOverrides) retirementData.yearOverrides = {};
  Object.keys(retirementData.yearOverrides).forEach(y => { retirementData.yearOverrides[y].tax = tax; });
  saveRetirementData();
  updateRetirementTab();
}

function setYearWR(year, val) {
  if (!retirementData.yearOverrides) retirementData.yearOverrides = {};
  if (!retirementData.yearOverrides[year]) retirementData.yearOverrides[year] = {};
  retirementData.yearOverrides[year].wr = parseFloat(val) || 0;
  saveRetirementData();
  const pv = parseFloat(document.getElementById('retirementTotalValueInput').value) || 0;
  renderRetirementChart(pv);
  renderRetirementTable(pv);
}

function setYearTax(year, val) {
  if (!retirementData.yearOverrides) retirementData.yearOverrides = {};
  if (!retirementData.yearOverrides[year]) retirementData.yearOverrides[year] = {};
  retirementData.yearOverrides[year].tax = parseFloat(val) || 0;
  saveRetirementData();
  const pv = parseFloat(document.getElementById('retirementTotalValueInput').value) || 0;
  renderRetirementChart(pv);
  renderRetirementTable(pv);
}

function updateRetirementTab() {
  const portfolioValue = parseFloat(document.getElementById('retirementTotalValueInput').value) || 0;
  retirementData.manualPortfolioValue = portfolioValue;
  // Persist default WR%, tax%, and growth rate
  const wrInput = document.getElementById('retirementDefaultWR');
  if (wrInput) retirementData.defaultWR = parseFloat(wrInput.value) || 4.7;
  const taxInput = document.getElementById('retirementDefaultTax');
  if (taxInput) retirementData.defaultTax = parseFloat(taxInput.value) || 15;
  const growthInput = document.getElementById('retirementGrowthRate');
  if (growthInput) retirementData.growthRate = parseFloat(growthInput.value) || 5;
  saveRetirementData();
  renderRetirementChart(portfolioValue);
  renderRetirementTable(portfolioValue);
}

// Helper: compute yearly retirement projection data with portfolio depletion
function computeRetirementProjection(portfolioValue) {
  const karinBirthYear = 1970, yannBirthYear = 1972;
  const startAge = 57;
  const startYear = Math.min(startAge + karinBirthYear, startAge + yannBirthYear);
  const endYear = 90 + Math.min(karinBirthYear, yannBirthYear);
  const PENSION_TAX = 0.30;
  const growthRate = parseFloat(document.getElementById('retirementGrowthRate').value) || 5;
  const projection = [];
  let currentPortfolio = portfolioValue;

  for (let year = startYear; year <= endYear; year++) {
    const karinAge = year - karinBirthYear;
    const yannAge = year - yannBirthYear;
    const wrPct = getYearWR(year);
    const taxPct = getYearTax(year);

    let karinMonthly = 0;
    if (karinAge >= 65) {
      karinMonthly += calculateAllmanMonthly(PENSION_DATA.karin.allman.capital);
      karinMonthly += PENSION_DATA.karin.privat.capital * 0.04 / 12;
    }
    PENSION_DATA.karin.policies.forEach(p => {
      if (isPolicyActive(p, karinAge)) karinMonthly += getPolicyMonthly(p, 4);
    });

    let yannMonthly = 0;
    if (yannAge >= 65) {
      yannMonthly += calculateAllmanMonthly(PENSION_DATA.yann.allman.capital);
    }
    PENSION_DATA.yann.policies.forEach(p => {
      if (isPolicyActive(p, yannAge)) yannMonthly += getPolicyMonthly(p, 4);
    });

    const portfolioStartOfYear = Math.max(currentPortfolio, 0);
    const portfolioWRMonthly = portfolioStartOfYear > 0 ? portfolioStartOfYear * (wrPct / 100) / 12 : 0;
    const wrTax = portfolioWRMonthly * (taxPct / 100);
    const wrNet = portfolioWRMonthly - wrTax;
    const combinedGross = karinMonthly + yannMonthly + portfolioWRMonthly;
    const pensionNet = (karinMonthly + yannMonthly) * (1 - PENSION_TAX);
    const combinedNet = pensionNet + wrNet;

    projection.push({
      year, karinAge, yannAge, karinMonthly, yannMonthly,
      portfolioStartOfYear, wrPct, taxPct,
      portfolioWRMonthly, wrTax, wrNet,
      combinedGross, combinedNet
    });

    // Deplete portfolio: withdraw WR% then grow by growthRate
    // P_next = P * (1 - WR%) * (1 + growth%)
    if (currentPortfolio > 0) {
      currentPortfolio = currentPortfolio * (1 - wrPct / 100) * (1 + growthRate / 100);
      if (currentPortfolio < 0) currentPortfolio = 0;
    }
  }
  return projection;
}

function renderRetirementChart(portfolioValue) {
  const ctx = document.getElementById('pensionProjectionChart');
  if (!ctx) return;
  if (pensionProjectionChart) pensionProjectionChart.destroy();

  const projection = computeRetirementProjection(portfolioValue);
  const years = [], grossData = [], netData = [], karinData = [], yannData = [], portfolioData = [], portfolioValueData = [];

  projection.forEach(p => {
    years.push(p.year);
    karinData.push(Math.round(p.karinMonthly));
    yannData.push(Math.round(p.yannMonthly));
    portfolioData.push(Math.round(p.portfolioWRMonthly));
    portfolioValueData.push(Math.round(p.portfolioStartOfYear));
    grossData.push(Math.round(p.combinedGross));
    netData.push(Math.round(p.combinedNet));
  });

  pensionProjectionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        { label: 'Combined Gross', data: grossData, borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.1, borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
        { label: 'Combined Net', data: netData, borderColor: 'rgba(6,182,212,1)', backgroundColor: 'rgba(6,182,212,0.08)', fill: true, tension: 0.1, borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
        { label: 'Karin Pension', data: karinData, borderColor: 'rgba(52,211,153,0.7)', borderDash: [4,4], tension: 0.1, borderWidth: 1.5, pointRadius: 0, fill: false, yAxisID: 'y' },
        { label: 'Yann Pension', data: yannData, borderColor: 'rgba(34,211,238,0.7)', borderDash: [4,4], tension: 0.1, borderWidth: 1.5, pointRadius: 0, fill: false, yAxisID: 'y' },
        { label: 'Portfolio WR', data: portfolioData, borderColor: 'rgba(251,191,36,0.7)', borderDash: [6,3], tension: 0.1, borderWidth: 1.5, pointRadius: 0, fill: false, yAxisID: 'y' },
        { label: 'Portfolio Value', data: portfolioValueData, borderColor: 'rgba(139,92,246,0.6)', borderDash: [2,2], tension: 0.1, borderWidth: 1, pointRadius: 0, fill: false, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + (ctx.parsed.y > 0 ? ctx.parsed.y.toLocaleString('sv-SE') : '0') + (ctx.dataset.yAxisID === 'y1' ? ' kr' : ' kr/mån') } }
      },
      scales: {
        x: { grid: { color: 'rgba(45,58,82,0.5)' }, ticks: { color: '#94a3b8', maxTicksLimit: 15 }, title: { display: true, text: 'Year', color: '#94a3b8' } },
        y: { position: 'left', grid: { color: 'rgba(45,58,82,0.5)' }, ticks: { color: '#94a3b8', callback: v => (v/1000).toFixed(0) + 'k' }, title: { display: true, text: 'Monthly (SEK)', color: '#94a3b8' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: 'rgba(139,92,246,0.6)', callback: v => (v/1e6).toFixed(1) + 'M' }, title: { display: true, text: 'Portfolio Value (SEK)', color: 'rgba(139,92,246,0.6)' } }
      }
    }
  });
}

function renderRetirementTable(portfolioValue) {
  const tbody = document.getElementById('retirementProjectionTable');
  if (!tbody) return;

  const projection = computeRetirementProjection(portfolioValue);
  const defWR = parseFloat(document.getElementById('retirementDefaultWR').value) || 4.7;
  const defTax = parseFloat(document.getElementById('retirementDefaultTax').value) || 15;
  let rows = '';

  projection.forEach(p => {
    const fmt = (v) => Math.round(v).toLocaleString('sv-SE');
    const isDefaultWR = Math.abs(p.wrPct - defWR) < 0.01;
    const isDefaultTax = Math.abs(p.taxPct - defTax) < 0.01;
    const depleted = p.portfolioStartOfYear < portfolioValue * 0.1;
    const pvStyle = depleted ? 'color:var(--accent-danger);' : 'color:var(--accent-secondary);';

    rows += `<tr>
      <td class="font-mono text-sm">${p.year}</td>
      <td class="text-sm text-[var(--fg-muted)]">K${p.karinAge} / Y${p.yannAge}</td>
      <td class="text-right font-mono text-sm">${fmt(p.karinMonthly)}</td>
      <td class="text-right font-mono text-sm">${fmt(p.yannMonthly)}</td>
      <td class="text-right font-mono text-sm" style="${pvStyle}">${fmt(p.portfolioStartOfYear)}</td>
      <td class="text-right"><input type="number" value="${p.wrPct}" step="0.1" min="0" max="10" data-year="${p.year}" class="yr-wr-input" style="width:48px;background:${isDefaultWR?'transparent':'rgba(16,185,129,0.15)'};border:1px solid ${isDefaultWR?'transparent':'var(--accent-primary)'};border-radius:3px;padding:2px 4px;font-size:12px;font-family:'Space Grotesk',monospace;text-align:right;color:var(--accent-primary);outline:none;" onchange="setYearWR(${p.year},this.value)"></td>
      <td class="text-right font-mono text-sm">${fmt(p.portfolioWRMonthly)}</td>
      <td class="text-right"><input type="number" value="${p.taxPct}" step="1" min="0" max="50" data-year="${p.year}" class="yr-tax-input" style="width:42px;background:${isDefaultTax?'transparent':'rgba(245,158,11,0.15)'};border:1px solid ${isDefaultTax?'transparent':'var(--accent-warning)'};border-radius:3px;padding:2px 4px;font-size:12px;font-family:'Space Grotesk',monospace;text-align:right;color:var(--accent-warning);outline:none;" onchange="setYearTax(${p.year},this.value)"></td>
      <td class="text-right font-mono text-sm" style="color:var(--accent-warning);">${fmt(p.wrTax)}</td>
      <td class="text-right font-mono text-sm">${fmt(p.wrNet)}</td>
      <td class="text-right font-mono text-sm font-semibold" style="color:var(--accent-primary);">${fmt(p.combinedGross)}</td>
      <td class="text-right font-mono text-sm font-semibold" style="color:var(--accent-secondary);">${fmt(p.combinedNet)}</td>
    </tr>`;
  });
  tbody.innerHTML = rows;
}

  

// --- PERFORMANCE TAB FUNCTIONS ---
// LIVE PRICES TAB
// ============================================================

// Fetch live prices for all holdings from the proxy server
// --- SERVER STATUS CHECK ---
let serverRunning = false;
let serverCheckInProgress = false;

// Performance tab state
const PERF_LIVE_LS_KEY = 'portfolioTracker_perfLiveData';
const PERF_TRACKED_LS_KEY = 'portfolioTracker_perfTracked';
let perfLivePrices = [];        // latest fetched price data from Yahoo
let perfTrackedHoldings = [];   // array of {name, brokerage} to track
let perfBucketFilter = 'all';   // 'all', '1', '2', or '3'
let perfLiveSortKey = 'ytd';
let perfLiveSortAsc = false;

function savePerfLiveData() {
  try {
    if (perfLivePrices.length > 0) {
      localStorage.setItem(PERF_LIVE_LS_KEY, JSON.stringify({
        prices: perfLivePrices,
        timestamp: document.getElementById('livePricesTimestamp')?.textContent || new Date().toLocaleString(),
        source: document.getElementById('livePricesSource')?.textContent || 'Yahoo Finance'
      }));
    }
  } catch (e) { console.warn('Failed to save perf live data:', e); }
}

function loadPerfLiveData() {
  try {
    const raw = localStorage.getItem(PERF_LIVE_LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.prices && Array.isArray(data.prices) && data.prices.length > 0) {
        perfLivePrices = data.prices;
        return data;
      }
    }
  } catch (e) { console.warn('Failed to load perf live data:', e); }
  return null;
}

function savePerfTrackedHoldings() {
  try {
    localStorage.setItem(PERF_TRACKED_LS_KEY, JSON.stringify(perfTrackedHoldings));
  } catch (e) { console.warn('Failed to save perf tracked:', e); }
}

function loadPerfTrackedHoldings() {
  try {
    const raw = localStorage.getItem(PERF_TRACKED_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) perfTrackedHoldings = parsed;
    }
  } catch (e) { console.warn('Failed to load perf tracked:', e); }
}

function initPerfTrackedHoldings() {
  // If empty, pre-populate from reference table
  if (perfTrackedHoldings.length === 0) {
    const seen = new Set();
    ['avanza', 'nordnet'].forEach(broker => {
      (classificationReference[broker] || []).forEach(r => {
        if (!seen.has(r.name)) {
          seen.add(r.name);
          perfTrackedHoldings.push({ name: r.name, brokerage: broker });
        }
      });
    });
    savePerfTrackedHoldings();
  }
}

// --- Perf Tracked Holdings UI ---
function updatePerfTrackedUI() {
  const section = document.getElementById('perfTrackedSection');
  const countEl = document.getElementById('perfTrackedCount');
  const select = document.getElementById('perfAddHoldingSelect');
  const chipsContainer = document.getElementById('perfTrackedChips');
  const bucketFilters = document.getElementById('perfBucketFilters');
  const bucketFilterLabel = document.getElementById('livePricesBucketFilterLabel');

  if (!section) return;

  if (perfTrackedHoldings.length > 0) {
    section.classList.remove('hidden');
    bucketFilters?.classList.remove('hidden');
  }

  // Update count
  if (countEl) countEl.textContent = `${perfTrackedHoldings.length} tracked`;

  // Populate add select with available holdings from reference + snapshots
  if (select) {
    const allAvailable = [];
    const seen = new Set();
    // From reference table
    ['avanza', 'nordnet'].forEach(broker => {
      (classificationReference[broker] || []).forEach(r => {
        if (!seen.has(r.name)) {
          seen.add(r.name);
          allAvailable.push({ name: r.name, brokerage: broker });
        }
      });
    });
    // From current snapshot if any
    if (currentSnapshot) {
      const effective = getEffectiveSnapshot(currentSnapshot);
      (effective?.holdings || []).forEach(h => {
        if (!seen.has(h.name)) {
          seen.add(h.name);
          allAvailable.push({ name: h.name, brokerage: h.brokerage });
        }
      });
    }
    // Filter out already tracked
    const trackedKeys = new Set(perfTrackedHoldings.map(h => `${h.name}|${h.brokerage}`));
    const available = allAvailable.filter(a => !trackedKeys.has(`${a.name}|${a.brokerage}`));
    select.innerHTML = '<option value="">— Add holding —</option>' +
      available.map(a => `<option value="${a.name}|${a.brokerage}">${a.name} (${a.brokerage})</option>`).join('');
  }

  // Render tracked chips
  if (chipsContainer) {
    chipsContainer.innerHTML = perfTrackedHoldings.map((h, idx) => `
      <span class="perf-tracked-chip">
        ${h.name}
        <button onclick="removePerfTrackedHolding(${idx})" title="Remove">&times;</button>
      </span>
    `).join('');
  }

  // Update bucket filter label
  if (bucketFilterLabel) {
    if (perfBucketFilter !== 'all') {
      const labels = { '1': 'B1 — Cash/Short', '2': 'B2 — Fixed Income', '3': 'B3 — Equity' };
      bucketFilterLabel.textContent = 'Filter: ' + (labels[perfBucketFilter] || perfBucketFilter);
      bucketFilterLabel.classList.remove('hidden');
    } else {
      bucketFilterLabel.classList.add('hidden');
    }
  }
}

function addPerfTrackedHolding() {
  const select = document.getElementById('perfAddHoldingSelect');
  if (!select || !select.value) return;
  const [name, brokerage] = select.value.split('|');
  if (name && brokerage) {
    perfTrackedHoldings.push({ name, brokerage });
    savePerfTrackedHoldings();
    updatePerfTrackedUI();
  }
}

function removePerfTrackedHolding(index) {
  perfTrackedHoldings.splice(index, 1);
  savePerfTrackedHoldings();
  updatePerfTrackedUI();
  // Re-render table if data exists
  if (perfLivePrices.length > 0 && currentSnapshot) {
    renderPerfLivePricesTable();
  }
}

function setPerfBucketFilter(bucket) {
  perfBucketFilter = bucket;
  // Update button active states
  document.querySelectorAll('.perf-bucket-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bucket === bucket);
  });
  updatePerfTrackedUI();
  if (perfLivePrices.length > 0 && currentSnapshot) {
    renderPerfLivePricesTable();
  }
}

function sortPerfLiveTable(key) {
  if (perfLiveSortKey === key) {
    perfLiveSortAsc = !perfLiveSortAsc;
  } else {
    perfLiveSortKey = key;
    perfLiveSortAsc = (key === 'name' || key === 'price'); // ascending for name/price, descending for returns
  }
  renderPerfLivePricesTable();
}

// Helper: get bucket for a holding name
function getPerfAssetBucket(name) {
  for (const brokerage of ['avanza', 'nordnet']) {
    const ref = classificationReference[brokerage] || [];
    const match = ref.find(r => namesMatch(r.name, name));
    if (match) return match.bucket;
  }
  // Fallback: check from current snapshot
  if (currentSnapshot) {
    const h = currentSnapshot.holdings.find(hh => namesMatch(hh.name, name));
    if (h) return h.bucket || 0;
  }
  return 0;
}

function renderPerfLivePricesTable() {
  const tbody = document.getElementById('livePricesTable');
  if (!tbody || perfLivePrices.length === 0) return;

  // Build lookup map for prices
  const priceMap = new Map(perfLivePrices.map(p => [p.name.toLowerCase(), p]));

  // Build rows from tracked holdings
  let rows = perfTrackedHoldings.map(th => {
    const priceData = priceMap.get(th.name.toLowerCase());
    const bucket = getPerfAssetBucket(th.name);

    // Look up current symbol from classification reference table
    let currentSymbol = '';
    for (const broker of ['avanza', 'nordnet']) {
      const ref = classificationReference[broker] || [];
      const match = ref.find(r => namesMatch(r.name, th.name));
      if (match && match.symbol) { currentSymbol = match.symbol; break; }
    }

    if (!priceData || !priceData.price) {
      return {
        name: th.name,
        symbol: currentSymbol || priceData?.symbol || '—',
        bucket,
        price: null,
        dayChange: null,
        fiveDay: null,
        ytd: null,
        oneMonth: null,
        threeMonth: null,
        oneYear: null,
        threeYear: null,
        fiveYear: null,
        tenYear: null
      };
    }

      const tr = priceData.trailingReturns || {};
    return {
      name: th.name,
      symbol: currentSymbol || priceData.symbol || '—',
      bucket,
      price: priceData.price,
      currency: priceData.currency || 'SEK',
      dayChange: priceData.changePercent,
      fiveDay: tr.fiveDay,
      ytd: tr.ytd,
      oneMonth: tr.oneMonth,
      threeMonth: tr.threeMonth,
      oneYear: tr.oneYear,
      threeYear: tr.threeYear,
      fiveYear: tr.fiveYear,
      tenYear: tr.tenYear
    };
  });

  // Also add any returned price data for holdings not in tracked list
  const trackedKeys = new Set(perfTrackedHoldings.map(h => h.name.toLowerCase()));
  perfLivePrices.forEach(p => {
    if (!trackedKeys.has(p.name.toLowerCase())) {
      const bucket = getPerfAssetBucket(p.name);
      const tr = p.trailingReturns || {};
      rows.push({
        name: p.name,
        symbol: p.symbol || '—',
        bucket,
        price: p.price,
        currency: p.currency || 'SEK',
        dayChange: p.changePercent,
        fiveDay: tr.fiveDay,
        ytd: tr.ytd,
        oneMonth: tr.oneMonth,
        threeMonth: tr.threeMonth,
        oneYear: tr.oneYear,
        threeYear: tr.threeYear,
        fiveYear: tr.fiveYear,
        tenYear: tr.tenYear
      });
    }
  });

  // Apply bucket filter
  if (perfBucketFilter !== 'all') {
    rows = rows.filter(r => r.bucket === parseInt(perfBucketFilter));
  }

  // Sort rows
  rows.sort((a, b) => {
    const va = a[perfLiveSortKey];
    const vb = b[perfLiveSortKey];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (perfLiveSortKey === 'name') {
      return perfLiveSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return perfLiveSortAsc ? va - vb : vb - va;
  });

  // Update sort icons
  ['name', 'price', 'dayChange', 'fiveDay', 'ytd', 'oneMonth', 'threeMonth', 'oneYear', 'threeYear', 'fiveYear', 'tenYear'].forEach(k => {
    const icon = document.getElementById('perfSortIcon_' + k);
    if (icon) {
      icon.textContent = perfLiveSortKey === k ? (perfLiveSortAsc ? ' ▲' : ' ▼') : '';
      icon.className = 'perf-sort-icon' + (perfLiveSortKey === k ? ' active' : '');
    }
  });

  // Render
  tbody.innerHTML = rows.map(r => {
    const bucketLabels = { 1: 'B1', 2: 'B2', 3: 'B3', 0: '—' };
    const bucketBadge = `<span class="perf-bucket-badge b${r.bucket}">${bucketLabels[r.bucket] || '—'}</span>`;

    if (r.price === null) {
      return `<tr>
        <td class="font-medium">${r.name}</td>
        <td class="text-sm text-[var(--fg-muted)]">${r.symbol}</td>
        <td>${bucketBadge}</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">N/A</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
      </tr>`;
    }

    const dayClass = r.dayChange !== null && r.dayChange >= 0 ? 'change-positive' : 'change-negative';
    const dayStr = r.dayChange !== null ? `<span class="${dayClass}">${r.dayChange >= 0 ? '+' : ''}${r.dayChange.toFixed(2)}%</span>` : '<span class="text-[var(--fg-muted)]">—</span>';

    const fmtR = (val) => {
      if (val === null || val === undefined || isNaN(val)) return '<span class="text-[var(--fg-muted)]">—</span>';
      const cls = val >= 0 ? 'change-positive' : 'change-negative';
      return `<span class="${cls}">${val >= 0 ? '+' : ''}${val.toFixed(2)}%</span>`;
    };

    return `<tr>
      <td class="font-medium">${r.name}</td>
      <td class="text-sm text-[var(--fg-muted)]">${r.symbol}</td>
      <td>${bucketBadge}</td>
      <td class="text-right font-mono">${r.price.toFixed(2)} ${r.currency}</td>
      <td class="text-right font-mono">${dayStr}</td>
      <td class="text-right font-mono">${fmtR(r.fiveDay)}</td>
      <td class="text-right font-mono">${fmtR(r.ytd)}</td>
      <td class="text-right font-mono">${fmtR(r.oneMonth)}</td>
      <td class="text-right font-mono">${fmtR(r.threeMonth)}</td>
      <td class="text-right font-mono">${fmtR(r.oneYear)}</td>
      <td class="text-right font-mono">${fmtR(r.threeYear)}</td>
      <td class="text-right font-mono">${fmtR(r.fiveYear)}</td>
      <td class="text-right font-mono">${fmtR(r.tenYear)}</td>
    </tr>`;
  }).join('');

  // Show the track section and bucket filters
  document.getElementById('perfTrackedSection')?.classList.remove('hidden');
  document.getElementById('perfBucketFilters')?.classList.remove('hidden');

  // Also render the momentum table
  renderMomentumTable();
  // Also render the bucket analysis tables in Analytics tab
  if (typeof renderBucketAnalysisTables === 'function') renderBucketAnalysisTables();

  // --- NEW PERFORMANCE FEATURES ---
  // Show search/filter bar
  const searchWrap = document.getElementById('perfSearchWrap');
  if (searchWrap) searchWrap.classList.remove('hidden');
  // Render summary cards
  renderPerfSummaryCards(rows);
  // Render bar chart
  renderPerfBarChart(rows);
  // Add portfolio-weighted footer row
  renderPerfWeightedFooter(rows);
  // Update stale indicator
  updatePerfStaleIndicator();
  // Update search result count
  applyPerfFilters();
}

function stopServer() {
  // Try to call the shutdown endpoint
  fetch('http://localhost:3000/api/shutdown', { method: 'POST', cache: 'no-store' })
    .then(() => {})
    .catch(() => {});
  serverRunning = false;
  updateServerStatusUI();
}

async function checkServerStatus() {
  if (serverCheckInProgress) return;
  serverCheckInProgress = true;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2000);
    const resp = await fetch('http://localhost:3000/api/ping', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timeout);
    serverRunning = resp.ok;
  } catch(e) {
    serverRunning = false;
  }
  serverCheckInProgress = false;
  updateServerStatusUI();
}

function updateServerStatusUI() {
  const dot = document.getElementById('serverStatusDot');
  const text = document.getElementById('serverStatusText');
  const btn = document.getElementById('startServerBtn');
  const stopBtn = document.getElementById('stopServerBtn');
  if (!dot || !text || !btn) return;
  if (serverRunning) {
    dot.style.background = '#22c55e'; // green
    text.textContent = 'Server running ✅';
    text.style.color = '#22c55e';
    btn.textContent = '✓ Server Running';
    btn.classList.add('btn-success');
    btn.classList.remove('btn-secondary');
    btn.disabled = true;
    if (stopBtn) stopBtn.classList.remove('hidden');
  } else {
    dot.style.background = '#ef4444'; // red
    text.textContent = 'Server offline ❌';
    text.style.color = '#ef4444';
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Start Server`;
    btn.classList.remove('btn-success');
    btn.classList.add('btn-secondary');
    btn.disabled = false;
    if (stopBtn) stopBtn.classList.add('hidden');
  }
}

function startServer() {
  const box = document.getElementById('serverCommandBox');
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Auto-copy the command so user just needs to paste in terminal
  const cmd = document.getElementById('serverCommandText').textContent;
  navigator.clipboard.writeText(cmd).then(() => {
    const copyBtn = document.getElementById('serverCommandBox').querySelector('button');
    if (copyBtn) {
      copyBtn.textContent = '✓ Copied to clipboard!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 3000);
    }
  }).catch(() => {});

  // Start polling for server to come online
  if (window._serverPollInterval) clearInterval(window._serverPollInterval);
  window._serverPollInterval = setInterval(async () => {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 2000);
      const resp = await fetch('http://localhost:3000/api/ping', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timeout);
      if (resp.ok) {
        // Server is now running!
        clearInterval(window._serverPollInterval);
        window._serverPollInterval = null;
        serverRunning = true;
        updateServerStatusUI();
        // Hide the command box now that server is detected
        box.classList.add('hidden');
        // Show a brief success notification
        showServerStartedNotification();
      }
    } catch(e) {
      // Server not ready yet, keep polling
    }
  }, 2000);
  // Stop polling after 60 seconds
  setTimeout(() => {
    if (window._serverPollInterval) {
      clearInterval(window._serverPollInterval);
      window._serverPollInterval = null;
    }
    // Check one final time
    checkServerStatus();
  }, 60000);
}

function showServerStartedNotification() {
  // Create a brief toast notification
  const toast = document.createElement('div');
  toast.className = 'fixed top-20 right-4 z-50 bg-green-600/90 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-fade-in';
  toast.style.cssText = 'position:fixed;top:5rem;right:1rem;z-index:100;';
  toast.innerHTML = '✅ Server started! Prices are now available.';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s';
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

function copyServerCommand() {
  const cmd = document.getElementById('serverCommandText').textContent;
  navigator.clipboard.writeText(cmd).then(() => {
    const copyBtn = event.target;
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
  }).catch(() => {
    // Fallback: select the text so user can manually copy
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('serverCommandText'));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
}

async function fetchLivePrices() {
  // Ensure tracked holdings are initialized from reference table
  if (perfTrackedHoldings.length === 0) {
    initPerfTrackedHoldings();
  }

  if (perfTrackedHoldings.length === 0) {
    alert('No holdings to fetch prices for. Add holdings in the Reference Table or via the "Tracked Holdings" section.');
    return;
  }

  // Show loading state
  document.getElementById('livePricesIntro').classList.add('hidden');
  document.getElementById('livePricesTableContainer').classList.remove('hidden');
  document.getElementById('livePricesLoading').classList.remove('hidden');
  document.getElementById('livePricesSuccess').classList.add('hidden');
  document.getElementById('livePricesError').classList.add('hidden');

  const btn = document.getElementById('fetchPricesBtn');
  btn.disabled = true;
  btn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Fetching...';

  try {
    // Build list of unique assets from tracked holdings (reference table + manually added)
    const seen = new Set();
    const assetPayload = [];

    perfTrackedHoldings.forEach(th => {
      const key = th.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      // Look up symbol from classification reference table
      let symbol = '';
      for (const broker of ['avanza', 'nordnet']) {
        const ref = classificationReference[broker] || [];
        const match = ref.find(r => namesMatch(r.name, th.name));
        if (match && match.symbol) { symbol = match.symbol; break; }
      }
      // Fallback: known symbol mappings for common holdings
      if (!symbol) {
        const SYMBOL_FALLBACKS = {
          'Xtrackers MSCI World ex USA UCITS ETF 1C': 'EXUS.L',
          'Xtrackers MSCI World ex USA': 'EXUS.L'
        };
        for (const [key, sym] of Object.entries(SYMBOL_FALLBACKS)) {
          if (namesMatch(key, th.name)) { symbol = sym; break; }
        }
      }
      // Skip holdings without a ticker — user must set symbol in Reference tab
      if (!symbol) return;
      assetPayload.push({ name: th.name, symbol });
    });
    
    // Check if proxy server is running, otherwise show setup instructions
    const proxyUrl = 'http://localhost:3000/api/prices';
    
    // First, try to fetch from proxy
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets: assetPayload })
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.prices || !Array.isArray(data.prices)) {
      throw new Error('Invalid response format from server');
    }

    // Store fetched prices globally and persist
    perfLivePrices = data.prices;
    savePerfLiveData();

    // Initialize tracked holdings from assets if none set
    initPerfTrackedHoldings();

    // Render the results
    renderPerfLivePricesTable();

    // Update metadata
    document.getElementById('livePricesTimestamp').textContent = new Date().toLocaleString();
    document.getElementById('livePricesSource').textContent = data.source || 'Proxy Server';

    // Show success state
    document.getElementById('livePricesLoading').classList.add('hidden');
    document.getElementById('livePricesSuccess').classList.remove('hidden');

  } catch (err) {
    console.error('Failed to fetch live prices:', err);
    
    // Show error state
    document.getElementById('livePricesLoading').classList.add('hidden');
    document.getElementById('livePricesError').classList.remove('hidden');
    document.getElementById('livePricesErrorText').textContent = err.message;

    // Check if it's a connection error (proxy not running)
    if (err.message.includes('Failed to fetch') || err.message.includes('ECONNREFUSED')) {
      document.getElementById('livePricesErrorText').innerHTML = 
        'Proxy server not running. Start it with:<br><code class="text-xs">cd "/Users/yannlemerle/Sync/Finance/Portfolio Tracker" && npm install && npm start</code>';
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Refresh Prices';
  }
}
"use strict";


// --- MOMENTUM TABLE ---
// ========== NEW PERFORMANCE FEATURES ==========

let perfBarChartInstance = null;

function renderPerfSummaryCards(rows) {
  const container = document.getElementById('perfSummaryCards');
  if (!container || !rows || rows.length === 0) {
    if (container) container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');

  // YTD stats
  const withYtd = rows.filter(r => r.ytd !== null && !isNaN(r.ytd));
  const positiveYtd = withYtd.filter(r => r.ytd > 0);
  const negativeYtd = withYtd.filter(r => r.ytd <= 0);
  const avgYtd = withYtd.length > 0 ? withYtd.reduce((s, r) => s + r.ytd, 0) / withYtd.length : 0;
  const bestYtd = withYtd.length > 0 ? withYtd.reduce((a, b) => a.ytd > b.ytd ? a : b) : null;
  const worstYtd = withYtd.length > 0 ? withYtd.reduce((a, b) => a.ytd < b.ytd ? a : b) : null;

  // All returns for overall score
  const allReturns = [];
  rows.forEach(r => {
    ['ytd', 'oneMonth', 'threeMonth', 'oneYear'].forEach(k => {
      if (r[k] !== null && !isNaN(r[k])) allReturns.push(r[k]);
    });
  });
  const posPct = allReturns.length > 0 ? (allReturns.filter(v => v > 0).length / allReturns.length * 100) : 0;

  const fmtVal = (val) => {
    const cls = val >= 0 ? 'stat-positive' : 'stat-negative';
    return '<span class="' + cls + '">' + (val >= 0 ? '+' : '') + val.toFixed(2) + '%</span>';
  };

  container.innerHTML =
    '<div class="perf-summary-card">' +
      '<div class="stat-label">YTD Average</div>' +
      '<div class="stat-value">' + fmtVal(avgYtd) + '</div>' +
      '<div class="stat-sub">' + withYtd.length + ' holdings with YTD data</div>' +
    '</div>' +
    '<div class="perf-summary-card">' +
      '<div class="stat-label">Best YTD</div>' +
      '<div class="stat-value">' + (bestYtd ? fmtVal(bestYtd.ytd) : '-') + '</div>' +
      '<div class="stat-sub">' + (bestYtd ? escapeHtml(bestYtd.name) : '') + '</div>' +
    '</div>' +
    '<div class="perf-summary-card">' +
      '<div class="stat-label">Worst YTD</div>' +
      '<div class="stat-value">' + (worstYtd ? fmtVal(worstYtd.ytd) : '-') + '</div>' +
      '<div class="stat-sub">' + (worstYtd ? escapeHtml(worstYtd.name) : '') + '</div>' +
    '</div>' +
    '<div class="perf-summary-card">' +
      '<div class="stat-label">Positive Returns</div>' +
      '<div class="stat-value">' + posPct.toFixed(0) + '%</div>' +
      '<div class="stat-sub">' + positiveYtd.length + ' up / ' + negativeYtd.length + ' down (YTD)</div>' +
    '</div>';
}

function renderPerfBarChart(rows) {
  const container = document.getElementById('perfChartContainer');
  const canvas = document.getElementById('perfBarChart');
  if (!container || !canvas || !rows || rows.length === 0) {
    if (container) container.classList.add('hidden');
    return;
  }

  const withYtd = rows.filter(r => r.ytd !== null && !isNaN(r.ytd));
  if (withYtd.length < 2) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  // Update chart title with bucket filter context
  const titleEl = document.getElementById('perfChartTitle');
  if (titleEl && perfBucketFilter !== 'all') {
    const labels = { '1': 'B1 — Cash/Short', '2': 'B2 — Fixed Income', '3': 'B3 — Equity' };
    titleEl.textContent = 'YTD Performance — ' + (labels[perfBucketFilter] || 'All');
  } else if (titleEl) {
    titleEl.textContent = 'YTD Performance by Holding';
  }

  const sorted = withYtd.slice().sort((a, b) => b.ytd - a.ytd);
  const labels = sorted.map(r => r.name);
  const data = sorted.map(r => r.ytd);
  const bgColors = data.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)');
  const borderColors = data.map(v => v >= 0 ? 'rgba(16, 185, 129, 1)' : 'rgba(239, 68, 68, 1)');

  if (perfBarChartInstance) perfBarChartInstance.destroy();

  perfBarChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'YTD Return %',
        data,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return (ctx.parsed.x >= 0 ? '+' : '') + ctx.parsed.x.toFixed(2) + '%'; }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(45, 58, 82, 0.5)' },
          ticks: { color: '#94a3b8', callback: function(v) { return v + '%'; } }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 }, callback: function(v) { return v.length > 25 ? v.substring(0, 22) + '...' : v; } }
        }
      }
    }
  });
}

function renderPerfWeightedFooter(rows) {
  const tbody = document.getElementById('livePricesTable');
  if (!tbody) return;

  // Calculate portfolio-weighted average YTD return
  let totalPortfolioValue = 0;
  const holdingValues = {};
  if (currentSnapshot) {
    const effective = getEffectiveSnapshot(currentSnapshot);
    const ft = calculateFilteredTotals(effective);
    totalPortfolioValue = ft.totalValue;
    const holdings = getFilteredHoldings(effective);
    holdings.forEach(function(h) {
      holdingValues[h.name.toLowerCase()] = h.value;
    });
  }

  // Remove any existing footer row first
  const existingFooter = tbody.querySelector('.perf-weighted-footer');
  if (existingFooter) existingFooter.remove();

  // Only add footer if we have portfolio data and rows with YTD
  const withYtd = rows.filter(r => r.ytd !== null && !isNaN(r.ytd));
  if (withYtd.length === 0 || totalPortfolioValue === 0) return;

  // Calculate weighted YTD
  let totalWeight = 0;
  let weightedSum = 0;
  withYtd.forEach(function(r) {
    const val = holdingValues[r.name.toLowerCase()] || 0;
    if (val > 0) {
      weightedSum += r.ytd * val;
      totalWeight += val;
    }
  });

  if (totalWeight === 0) return;
  const weightedYtd = weightedSum / totalWeight;

  // Also calculate simple average for comparison
  const simpleAvg = withYtd.reduce(function(s, r) { return s + r.ytd; }, 0) / withYtd.length;

  const colSpan = document.querySelector('#livePricesTable thead tr') ? document.querySelector('#livePricesTable thead tr').children.length : 13;
  const footerRow = document.createElement('tr');
  footerRow.className = 'perf-weighted-footer';
  const cls = weightedYtd >= 0 ? 'change-positive' : 'change-negative';
  footerRow.innerHTML =
    '<td colspan="' + colSpan + '" style="text-align:right;">' +
      '<span class="weighted-label">Portfolio-Weighted YTD:</span>' +
      '<span class="' + cls + '" style="margin-left:8px;">' + (weightedYtd >= 0 ? '+' : '') + weightedYtd.toFixed(2) + '%</span>' +
      '<span style="color:var(--fg-muted);margin-left:4px;font-weight:400;">| Simple avg: ' + (simpleAvg >= 0 ? '+' : '') + simpleAvg.toFixed(2) + '%</span>' +
      '<span style="color:var(--fg-muted);margin-left:4px;font-weight:400;">| Weighted by: ' + (totalWeight / totalPortfolioValue * 100).toFixed(1) + '% of portfolio</span>' +
    '</td>';
  tbody.appendChild(footerRow);
}

function filterPerfByBucket() {
  const select = document.getElementById('perfBucketFilter');
  if (select && select.value) {
    setPerfBucketFilter(select.value);
  }
}

function applyPerfFilters() {
  const searchInput = document.getElementById('perfSearchInput');
  const resultCount = document.getElementById('perfResultCount');
  const tbody = document.getElementById('livePricesTable');
  if (!searchInput || !tbody) return;

  const query = searchInput.value.toLowerCase().trim();
  const rows = tbody.querySelectorAll('tr:not(.perf-weighted-footer)');
  let visibleCount = 0;

  rows.forEach(function(row) {
    const nameCell = row.querySelector('td:first-child');
    if (!nameCell) return;
    const name = nameCell.textContent.toLowerCase();
    if (!query || name.indexOf(query) !== -1) {
      row.style.display = '';
      visibleCount++;
    } else {
      row.style.display = 'none';
    }
  });

  if (resultCount) {
    const totalRows = rows.length;
    resultCount.textContent = query
      ? visibleCount + ' of ' + totalRows + ' holdings'
      : totalRows + ' holdings';
  }
}

function clearPerfSearch() {
  const searchInput = document.getElementById('perfSearchInput');
  if (searchInput) {
    searchInput.value = '';
    applyPerfFilters();
  }
}

function updatePerfStaleIndicator() {
  const indicator = document.getElementById('perfStaleIndicator');
  const tsEl = document.getElementById('livePricesTimestamp');
  if (!indicator || !tsEl) return;

  const tsText = tsEl.textContent;
  if (!tsText || tsText === '--') {
    indicator.classList.add('hidden');
    return;
  }

  // Parse the timestamp (format: "M/D/YYYY, H:MM:SS AM/PM")
  let ageMinutes = Infinity;
  try {
    const date = new Date(tsText);
    if (!isNaN(date.getTime())) {
      ageMinutes = (Date.now() - date.getTime()) / 60000;
    }
  } catch (e) {}

  indicator.classList.remove('hidden', 'perf-stale-fresh', 'perf-stale-ageing', 'perf-stale-old');

  if (ageMinutes < 15) {
    indicator.classList.add('perf-stale-fresh');
    indicator.innerHTML = '&#9679; Fresh';
  } else if (ageMinutes < 60) {
    indicator.classList.add('perf-stale-ageing');
    indicator.innerHTML = '&#9679; Ageing (' + Math.round(ageMinutes) + 'm)';
  } else {
    indicator.classList.add('perf-stale-old');
    const hours = Math.floor(ageMinutes / 60);
    indicator.innerHTML = '&#9679; Old (' + hours + 'h+)';
  }
}

// --- AUTO-REFRESH ---
let autoRefreshInterval = null;
let autoRefreshCountdown = 0;

function toggleAutoRefresh(enabled) {
  const countdownEl = document.getElementById('perfRefreshCountdown');
  const toggle = document.getElementById('perfAutoRefreshToggle');

  if (enabled) {
    autoRefreshCountdown = 5 * 60; // 5 minutes in seconds
    if (countdownEl) countdownEl.classList.remove('hidden');
    updateRefreshCountdown();

    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(function() {
      autoRefreshCountdown--;
      updateRefreshCountdown();
      if (autoRefreshCountdown <= 0) {
        // Trigger refresh
        if (typeof serverRunning !== 'undefined' && serverRunning) {
          fetchLivePrices();
        }
        autoRefreshCountdown = 5 * 60;
      }
    }, 1000);
  } else {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
    autoRefreshCountdown = 0;
    if (countdownEl) {
      countdownEl.classList.add('hidden');
      countdownEl.textContent = '';
    }
  }
}

function updateRefreshCountdown() {
  const countdownEl = document.getElementById('perfRefreshCountdown');
  if (!countdownEl) return;
  const mins = Math.floor(autoRefreshCountdown / 60);
  const secs = autoRefreshCountdown % 60;
  countdownEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}

// ==========================================

function renderMomentumTable() {
  const tbody = document.getElementById('momentumTableBody');
  const card = document.getElementById('momentumCard');
  if (!tbody || perfLivePrices.length === 0) return;

  const priceMap = new Map(perfLivePrices.map(p => [p.name.toLowerCase(), p]));

  // Build momentum rows from tracked holdings
  let rows = perfTrackedHoldings.map(th => {
    const priceData = priceMap.get(th.name.toLowerCase());
    const bucket = getPerfAssetBucket(th.name);
    const tr = priceData?.trailingReturns || {};
    const oneMonth = tr.oneMonth ?? null;
    const threeMonth = tr.threeMonth ?? null;
    const oneYear = tr.oneYear ?? null;

    // 12-1M Momentum = (1+1Y)/(1+1M) - 1
    let twelveMinusOne = null;
    if (oneMonth !== null && oneYear !== null && (1 + oneMonth / 100) !== 0) {
      twelveMinusOne = ((1 + oneYear / 100) / (1 + oneMonth / 100)) - 1;
    }

    // Composite Score = 70% * 12-1M + 30% * 3M
    let compositeScore = null;
    if (twelveMinusOne !== null && threeMonth !== null) {
      compositeScore = 0.7 * twelveMinusOne + 0.3 * (threeMonth / 100);
    }

    return {
      name: th.name,
      bucket,
      oneMonth,
      threeMonth,
      oneYear,
      twelveMinusOne,
      compositeScore,
      signal: null,
      rank: null
    };
  });

  // Also add untracked prices
  const trackedKeys = new Set(perfTrackedHoldings.map(h => h.name.toLowerCase()));
  perfLivePrices.forEach(p => {
    if (!trackedKeys.has(p.name.toLowerCase())) {
      const bucket = getPerfAssetBucket(p.name);
      const tr = p.trailingReturns || {};
      const oneMonth = tr.oneMonth ?? null;
      const threeMonth = tr.threeMonth ?? null;
      const oneYear = tr.oneYear ?? null;
      let twelveMinusOne = null;
      if (oneMonth !== null && oneYear !== null && (1 + oneMonth / 100) !== 0) {
        twelveMinusOne = ((1 + oneYear / 100) / (1 + oneMonth / 100)) - 1;
      }
      let compositeScore = null;
      if (twelveMinusOne !== null && threeMonth !== null) {
        compositeScore = 0.7 * twelveMinusOne + 0.3 * (threeMonth / 100);
      }
      rows.push({ name: p.name, bucket, oneMonth, threeMonth, oneYear, twelveMinusOne, compositeScore, signal: null, rank: null });
    }
  });

  // Apply bucket filter
  if (perfBucketFilter !== 'all') {
    rows = rows.filter(r => r.bucket === parseInt(perfBucketFilter));
  }

  // Rank within each bucket
  const bucketGroups = {};
  rows.forEach(r => {
    if (!bucketGroups[r.bucket]) bucketGroups[r.bucket] = [];
    bucketGroups[r.bucket].push(r);
  });

  Object.values(bucketGroups).forEach(group => {
    group.sort((a, b) => {
      if (a.compositeScore === null && b.compositeScore === null) return 0;
      if (a.compositeScore === null) return 1;
      if (b.compositeScore === null) return -1;
      return b.compositeScore - a.compositeScore;
    });
    group.forEach((r, idx) => { r.rank = idx + 1; });

    const total = group.length;
    group.forEach(r => {
      const tm1 = r.twelveMinusOne;
      const m3 = r.threeMonth !== null ? r.threeMonth / 100 : null;
      const score = r.compositeScore;
      const rank = r.rank;
      const topTier = total >= 3 ? rank <= Math.ceil(total * 0.33) : rank === 1;

      if (score === null || tm1 === null || m3 === null) {
        r.signal = 'red';
      } else if (score < 0 || (tm1 < 0 && m3 < 0)) {
        r.signal = 'red';
      } else if (m3 < 0) {
        r.signal = 'orange';
      } else if (topTier && tm1 > 0 && m3 > 0) {
        r.signal = 'green';
      } else if (score > 0 && m3 > 0) {
        r.signal = 'yellow';
      } else {
        r.signal = 'orange';
      }
    });
  });

  // Sort by composite score descending
  rows.sort((a, b) => {
    if (a.compositeScore === null && b.compositeScore === null) return 0;
    if (a.compositeScore === null) return 1;
    if (b.compositeScore === null) return -1;
    return b.compositeScore - a.compositeScore;
  });

  // Render
  const fmtPct = (val) => {
    if (val === null || val === undefined) return '<span class="text-[var(--fg-muted)]">—</span>';
    const v = val;
    const cls = v >= 0 ? 'change-positive' : 'change-negative';
    return `<span class="${cls}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
  };
  const fmtDec = (val) => {
    if (val === null || val === undefined) return '<span class="text-[var(--fg-muted)]">—</span>';
    const cls = val >= 0 ? 'change-positive' : 'change-negative';
    return `<span class="${cls}">${val >= 0 ? '+' : ''}${(val * 100).toFixed(2)}%</span>`;
  };

  const signalLabels = { green: '🟢 Strong', yellow: '🟡 Monitor', orange: '🟠 Weak', red: '🔴 Avoid' };
  const bucketLabels = { 1: 'B1', 2: 'B2', 3: 'B3', 0: '—' };

  tbody.innerHTML = rows.map(r => {
    const bucketBadge = `<span class="perf-bucket-badge b${r.bucket}">${bucketLabels[r.bucket] || '—'}</span>`;
    const sig = r.signal || 'red';
    const rankClass = r.rank <= 2 ? 'momentum-rank-top' : r.rank <= 4 ? 'momentum-rank-mid' : 'momentum-rank-low';

    return `<tr class="momentum-row-${sig}">
      <td class="font-medium">${escapeHtml(r.name)}</td>
      <td>${bucketBadge}</td>
      <td class="text-right font-mono">${fmtPct(r.oneMonth)}</td>
      <td class="text-right font-mono">${fmtPct(r.threeMonth)}</td>
      <td class="text-right font-mono">${fmtPct(r.oneYear)}</td>
      <td class="text-right font-mono font-semibold">${fmtDec(r.twelveMinusOne)}</td>
      <td class="text-right font-mono font-semibold">${fmtDec(r.compositeScore)}</td>
      <td class="text-center"><span class="momentum-rank ${rankClass}">${r.rank || '—'}</span></td>
      <td class="text-center"><span class="momentum-signal momentum-signal-${sig}">${signalLabels[sig]}</span></td>
    </tr>`;
  }).join('');

  // Show the card
  if (card) card.classList.remove('hidden');
  
  // Save momentum snapshot for historical tracking
  saveMomentumSnapshot(rows);
}

// Save a daily snapshot of momentum scores for the evolution chart
"use strict";


// --- MOMENTUM SNAPSHOT STORAGE ---
const MOMENTUM_SNAPSHOT_LS_KEY = 'portfolioTracker_momentumSnapshots';

function saveMomentumSnapshot(rows) {
  if (!rows || rows.length === 0) return;
  const today = new Date().toISOString().slice(0, 10); // "2026-05-21"
  
  let snapshots = [];
  try {
    const raw = localStorage.getItem(MOMENTUM_SNAPSHOT_LS_KEY);
    if (raw) snapshots = JSON.parse(raw);
    if (!Array.isArray(snapshots)) snapshots = [];
  } catch (e) { snapshots = []; }

  // Overwrite if today already exists, otherwise append
  const existingIdx = snapshots.findIndex(s => s.date === today);
  const entry = {
    date: today,
    items: rows.map(r => ({
      name: r.name,
      compositeScore: r.compositeScore,
      signal: r.signal || 'red'
    }))
  };

  if (existingIdx >= 0) {
    snapshots[existingIdx] = entry;
  } else {
    snapshots.push(entry);
    // Keep only last 365 snapshots
    if (snapshots.length > 365) snapshots.shift();
  }

  try {
    localStorage.setItem(MOMENTUM_SNAPSHOT_LS_KEY, JSON.stringify(snapshots));
  } catch (e) { /* quota exceeded — silently ignore */ }
}

function renderMomentumEvolutionChart() {
  const card = document.getElementById('momentumEvolutionCard');
  const canvas = document.getElementById('momentumEvolutionChart');
  const emptyMsg = document.getElementById('momentumEvolutionEmpty');
  const container = document.getElementById('momentumEvolutionChartContainer');

  if (!card || !canvas) return;
  
  // Load snapshots
  let snapshots = [];
  try {
    const raw = localStorage.getItem(MOMENTUM_SNAPSHOT_LS_KEY);
    if (raw) snapshots = JSON.parse(raw);
    if (!Array.isArray(snapshots)) snapshots = [];
  } catch (e) { snapshots = []; }

  if (snapshots.length < 2) {
    // Not enough data — show empty state
    card.classList.remove('hidden');
    if (container) container.classList.add('hidden');
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    if (momentumEvolutionChart) {
      momentumEvolutionChart.destroy();
      momentumEvolutionChart = null;
    }
    return;
  }

  // Enough data — build chart
  card.classList.remove('hidden');
  if (container) container.classList.remove('hidden');
  if (emptyMsg) emptyMsg.classList.add('hidden');

  // Collect all unique asset names across all snapshots
  const assetNames = new Set();
  snapshots.forEach(s => s.items.forEach(i => assetNames.add(i.name)));
  // Sort names by their latest composite score (descending) to match momentum ranking
  const latestSnapshot = snapshots[snapshots.length - 1];
  const names = Array.from(assetNames).sort((a, b) => {
    const aItem = latestSnapshot.items.find(i => i.name === a);
    const bItem = latestSnapshot.items.find(i => i.name === b);
    const aScore = aItem && aItem.compositeScore !== null ? aItem.compositeScore : -Infinity;
    const bScore = bItem && bItem.compositeScore !== null ? bItem.compositeScore : -Infinity;
    return bScore - aScore;
  });

  // Build labels (dates) sorted chronologically
  const labels = snapshots.map(s => s.date);

  // Color palette (consistent across charts)
  const palette = [
    '#60a5fa', '#f472b6', '#4ade80', '#facc15', '#fb923c',
    '#a78bfa', '#34d399', '#f87171', '#38bdf8', '#c084fc',
    '#fbbf24', '#818cf8', '#2dd4bf', '#e879f9', '#22d3ee'
  ];

  const datasets = names.map((name, idx) => {
    const color = palette[idx % palette.length];
    const data = snapshots.map(s => {
      const item = s.items.find(i => i.name === name);
      // Convert to percentage (compositeScore is stored as decimal, e.g. 0.6003 → 60.03)
      return item && item.compositeScore !== null ? item.compositeScore * 100 : null;
    });
    return {
      label: name,
      data: data,
      borderColor: color,
      backgroundColor: color + '20',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.2,
      fill: false,
      spanGaps: true
    };
  });

  // Destroy previous chart instance
  if (momentumEvolutionChart) {
    momentumEvolutionChart.destroy();
    momentumEvolutionChart = null;
  }

  const ctx = canvas.getContext('2d');
  momentumEvolutionChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            usePointStyle: true,
            padding: 16,
            font: { size: 11 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const val = ctx.parsed.y;
              if (val === null) return `${ctx.dataset.label}: —`;
              return `${ctx.dataset.label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Date', color: '#94a3b8' },
          ticks: { color: '#64748b', maxTicksLimit: 15, maxRotation: 45 },
          grid: { color: 'rgba(148, 163, 184, 0.08)' }
        },
        y: {
          title: { display: true, text: 'Composite Score (%)', color: '#94a3b8' },
          ticks: {
            color: '#64748b',
            callback: function(v) { return v.toFixed(0) + '%'; }
          },
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
          // Draw a horizontal line at 0
          beginAtZero: false
        }
      }
    }
  });
}

// Helper: format a period return value for display
function fmtReturn(val) {
  if (val === null || val === undefined || isNaN(val)) return '<span class="text-[var(--fg-muted)]">—</span>';
  const cls = val >= 0 ? 'change-positive' : 'change-negative';
  const sign = val >= 0 ? '+' : '';
  return `<span class="${cls}">${sign}${val.toFixed(2)}%</span>`;
}

function renderLivePricesTable(prices, assets, snapshot) {
  const tbody = document.getElementById('livePricesTable');
  if (!tbody) return;

  // Create a map for quick lookup
  const priceMap = new Map(prices.map(p => [p.name.toLowerCase(), p]));

  // Render table rows
  tbody.innerHTML = assets.map(asset => {
    const priceData = priceMap.get(asset.name.toLowerCase());

    if (!priceData || !priceData.price) {
      // No price data found
      return `
        <tr>
          <td class="font-medium">${escapeHtml(asset.name)}</td>
          <td class="text-sm text-[var(--fg-muted)]">${escapeHtml(priceData?.symbol || '—')}</td>
          <td>${escapeHtml(asset.brokerage)}</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">N/A</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
          <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
        </tr>
      `;
    }

    const price = priceData.price;
    const changePercent = priceData.changePercent;
    const tr = priceData.trailingReturns || {};

    // Day change
    const dayClass = changePercent >= 0 ? 'change-positive' : 'change-negative';
    const dayStr = changePercent !== null && changePercent !== undefined
      ? `<span class="${dayClass}">${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%</span>`
      : '<span class="text-[var(--fg-muted)]">—</span>';

    return `
      <tr>
        <td class="font-medium">${escapeHtml(asset.name)}</td>
        <td class="text-sm text-[var(--fg-muted)]">${escapeHtml(priceData.symbol || '—')}</td>
        <td>${escapeHtml(asset.brokerage)}</td>
        <td class="text-right font-mono">${price.toFixed(2)} ${priceData.currency || 'SEK'}</td>
        <td class="text-right font-mono">${dayStr}</td>
        <td class="text-right font-mono">${fmtReturn(tr.ytd)}</td>
        <td class="text-right font-mono">${fmtReturn(tr.oneMonth)}</td>
        <td class="text-right font-mono">${fmtReturn(tr.threeMonth)}</td>
        <td class="text-right font-mono">${fmtReturn(tr.oneYear)}</td>
        <td class="text-right font-mono">${fmtReturn(tr.threeYear)}</td>
        <td class="text-right font-mono">${fmtReturn(tr.fiveYear)}</td>
        <td class="text-right font-mono">${fmtReturn(tr.tenYear)}</td>
      </tr>
    `;
  }).join('');
}

function loadDemoData() {
  const demoData1 = { 
      date: new Date(2026, 2, 22), 
      dateStr: 'Mar 22, 2026', 
      holdings: [ 
          { name: 'AMF Företagsobligationsfond', brokerage: 'Avanza', category: 'Corporate / Credit', value: 4907776.25, percentage: 23.51, bucket: 2, isScheduled: true }, 
          { name: 'AMF Räntefond Kort', brokerage: 'Avanza', category: 'Short Duration', value: 3551980.95, percentage: 17.02, bucket: 1, isScheduled: true }, 
          { name: 'Avanza Ränta Kort', brokerage: 'Avanza', category: 'Short Duration', value: 2903968.27, percentage: 13.91, bucket: 1, isScheduled: true }, 
          { name: 'AMF Företagsobligationsfond', brokerage: 'Nordnet', category: 'Corporate / Credit', value: 1982381.25, percentage: 9.50, bucket: 0, isScheduled: false }, 
          { name: 'AMF Räntefond Kort', brokerage: 'Nordnet', category: 'Short Duration', value: 1541640.45, percentage: 7.39, bucket: 0, isScheduled: false }, 
          { name: 'SEB FRN Fond A', brokerage: 'Nordnet', category: 'Short Duration', value: 1534563.61, percentage: 7.35, bucket: 1, isScheduled: true }, 
          { name: 'Spiltan Räntefond Sverige', brokerage: 'Nordnet', category: 'Short Duration', value: 1213850.54, percentage: 5.81, bucket: 1, isScheduled: true }, 
          { name: 'Pareto Räntefond A', brokerage: 'Nordnet', category: 'Short Duration', value: 1002001.86, percentage: 4.80, bucket: 2, isScheduled: true }, 
          { name: 'SEB FRN Fond A', brokerage: 'Avanza', category: 'Short Duration', value: 518874.34, percentage: 2.49, bucket: 1, isScheduled: true }, 
          { name: 'Avanza Zero', brokerage: 'Avanza', category: 'Sweden Index', value: 486490.07, percentage: 2.33, bucket: 3, isScheduled: true }, 
          { name: 'Pareto Räntefond A', brokerage: 'Avanza', category: 'Short Duration', value: 371892.10, percentage: 1.78, bucket: 2, isScheduled: true }, 
          { name: 'AMF Räntefond Mix', brokerage: 'Avanza', category: 'Short Duration', value: 239088.07, percentage: 1.15, bucket: 1, isScheduled: true }, 
          { name: 'Cash', brokerage: 'Nordnet', category: 'Cash', value: 176160.11, percentage: 0.84, bucket: 1, isScheduled: true }, 
          { name: 'Nordnet Sverige Index', brokerage: 'Nordnet', category: 'Sweden Index', value: 122526.16, percentage: 0.59, bucket: 3, isScheduled: true }, 
          { name: 'Range Resources', brokerage: 'Avanza', category: 'Energy', value: 120483.68, percentage: 0.58, bucket: 0, isScheduled: true }, 
          { name: 'Avanza Global', brokerage: 'Avanza', category: 'Global Index', value: 111091.27, percentage: 0.53, bucket: 3, isScheduled: true }, 
          { name: 'Nordea Global Passive A Acc SEK', brokerage: 'Nordnet', category: 'Global Index', value: 59593.13, percentage: 0.29, bucket: 3, isScheduled: true }, 
          { name: 'Newmont', brokerage: 'Avanza', category: 'Materials', value: 30430.39, percentage: 0.15, bucket: 0, isScheduled: true } 
      ], 
      totalValue: 20874792.50, 
      nordnetValue: 7632717.11, 
      avanzaValue: 13242075.39 
  };

  snapshots = [demoData1]; 
  currentSnapshot = demoData1; 
  showDashboard();
}

// --- NOTES MODULE ---
const NOTES_LS_KEY = 'portfolioTracker_notes';

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Failed to load notes:', e);
    return [];
  }
}

function saveNotes(notes) {
  try {
    localStorage.setItem(NOTES_LS_KEY, JSON.stringify(notes));
  } catch (e) {
    console.warn('Failed to save notes:', e);
  }
}

function renderNotes() {
  const container = document.getElementById('notesList');
  if (!container) return;
  const notes = loadNotes();
  if (notes.length === 0) {
    container.innerHTML = '<p class="text-center py-8 text-[var(--fg-muted)]">No notes yet. Click "Add Note" to get started.</p>';
    return;
  }
  container.innerHTML = notes.map((note, index) => {
    const dateStr = note.createdAt ? new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-subtle)]">
        <div class="flex items-start justify-between gap-2 mb-2">
          <span class="text-xs text-[var(--fg-muted)]">${dateStr}</span>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button onclick="window.editNote(${index})" class="text-[var(--fg-muted)] hover:text-[var(--accent-primary)]" title="Edit note">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button onclick="window.deleteNote(${index})" class="text-[var(--accent-danger)] hover:text-red-300" title="Delete note">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
        <div class="text-sm whitespace-pre-wrap break-words text-[var(--fg-secondary)]">${escapeHtml(note.text)}</div>
      </div>
    `;
  }).join('');
}

window.addNote = function() {
  const text = prompt('Enter your note:');
  if (text === null || text.trim() === '') return;
  const notes = loadNotes();
  notes.unshift({ text: text.trim(), createdAt: new Date().toISOString() });
  saveNotes(notes);
  renderNotes();
};

window.deleteNote = function(index) {
  if (!confirm('Delete this note?')) return;
  const notes = loadNotes();
  notes.splice(index, 1);
  saveNotes(notes);
  renderNotes();
};

// --- Edit Note ---
let editingNoteIndex = null;

window.editNote = function(index) {
  const notes = loadNotes();
  if (!notes[index]) return;
  editingNoteIndex = index;
  const modal = document.getElementById('noteModal');
  const textarea = document.getElementById('noteTextarea');
  if (modal && textarea) {
    textarea.value = notes[index].text || '';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(function() { textarea.focus(); }, 50);
  }
};

function renderNotesTab() {
  renderNotes();
}

// --- Quick Note Modal ---
window.openNoteModal = function() {
  const modal = document.getElementById('noteModal');
  const textarea = document.getElementById('noteTextarea');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(function() { if (textarea) textarea.focus(); }, 50);
  }
};

window.closeNoteModal = function() {
  editingNoteIndex = null;
  const modal = document.getElementById('noteModal');
  const textarea = document.getElementById('noteTextarea');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
    if (textarea) textarea.value = '';
  }
};

window.saveQuickNote = function() {
  const textarea = document.getElementById('noteTextarea');
  if (!textarea) return;
  const text = textarea.value;
  if (!text || text.trim() === '') return;
  
  const notes = loadNotes();
  if (editingNoteIndex !== null && notes[editingNoteIndex]) {
    // Update existing note
    notes[editingNoteIndex].text = text.trim();
    notes[editingNoteIndex].updatedAt = new Date().toISOString();
  } else {
    // Add new note
    notes.unshift({ text: text.trim(), createdAt: new Date().toISOString() });
  }
  saveNotes(notes);
  renderNotes();
  closeNoteModal();
};
