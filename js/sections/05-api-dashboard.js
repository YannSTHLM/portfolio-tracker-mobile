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
