"use strict";


// --- RETIREMENT PLANNING ---
const RETIREMENT_LS_KEY = 'portfolioTracker_retirement';
let retirementData = { manualPortfolioValue: null, withdrawalRate: CONFIG.DEFAULT_WITHDRAWAL_RATE, yearOverrides: {} };
let pensionProjectionChart = null;
let retirementListenersAttached = false;

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
  if (!retirementListenersAttached) {
    const portfolioValueInput = document.getElementById('retirementTotalValueInput');
    if (portfolioValueInput) {
      portfolioValueInput.addEventListener('input', updateRetirementTab);
      portfolioValueInput.addEventListener('change', updateRetirementTab);
    }
    retirementListenersAttached = true;
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
  if (retirementData.yearOverrides && Object.keys(retirementData.yearOverrides).length > 0) {
    if (!confirm('This will overwrite all per-year custom WR% overrides. Continue?')) return;
  }
  document.getElementById('retirementDefaultWR').value = wr;
  if (!retirementData.yearOverrides) retirementData.yearOverrides = {};
  Object.keys(retirementData.yearOverrides).forEach(y => { retirementData.yearOverrides[y].wr = wr; });
  saveRetirementData();
  updateRetirementTab();
}

function applyDefaultTax(val) {
  const tax = parseFloat(val) || 15;
  if (retirementData.yearOverrides && Object.keys(retirementData.yearOverrides).length > 0) {
    if (!confirm('This will overwrite all per-year custom Tax% overrides. Continue?')) return;
  }
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
  const projection = computeRetirementProjection(pv);
  renderRetirementChart(pv, projection);
  renderRetirementTable(pv, projection);
}

function setYearTax(year, val) {
  if (!retirementData.yearOverrides) retirementData.yearOverrides = {};
  if (!retirementData.yearOverrides[year]) retirementData.yearOverrides[year] = {};
  retirementData.yearOverrides[year].tax = parseFloat(val) || 0;
  saveRetirementData();
  const pv = parseFloat(document.getElementById('retirementTotalValueInput').value) || 0;
  const projection = computeRetirementProjection(pv);
  renderRetirementChart(pv, projection);
  renderRetirementTable(pv, projection);
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
  // Compute projection once and pass to both renderers (avoids double computation)
  const projection = computeRetirementProjection(portfolioValue);
  renderRetirementChart(portfolioValue, projection);
  renderRetirementTable(portfolioValue, projection);
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
      // Note: Uses default WR% for private pension amortization
      const defWR = parseFloat(document.getElementById('retirementDefaultWR').value) || 4.7;
      karinMonthly += PENSION_DATA.karin.privat.capital * (defWR / 100) / 12;
    }
    PENSION_DATA.karin.policies.forEach(p => {
      if (isPolicyActive(p, karinAge)) karinMonthly += getPolicyMonthly(p, wrPct);
    });

    let yannMonthly = 0;
    if (yannAge >= 65) {
      yannMonthly += calculateAllmanMonthly(PENSION_DATA.yann.allman.capital);
    }
    PENSION_DATA.yann.policies.forEach(p => {
      if (isPolicyActive(p, yannAge)) yannMonthly += getPolicyMonthly(p, wrPct);
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

function renderRetirementChart(portfolioValue, precomputedProjection) {
  const ctx = document.getElementById('pensionProjectionChart');
  if (!ctx) return;
  if (pensionProjectionChart) pensionProjectionChart.destroy();

  const projection = precomputedProjection || computeRetirementProjection(portfolioValue);
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

function renderRetirementTable(portfolioValue, precomputedProjection) {
  const tbody = document.getElementById('retirementProjectionTable');
  if (!tbody) return;

  const projection = precomputedProjection || computeRetirementProjection(portfolioValue);
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
