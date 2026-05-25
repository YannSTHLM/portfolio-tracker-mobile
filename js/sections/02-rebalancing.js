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
