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
