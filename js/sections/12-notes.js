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
