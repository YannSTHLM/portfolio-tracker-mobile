"use strict";


// --- ANALYTICS: Historical Performance ---
let performanceData = null;
let returnsChart = null;
let perfSortKey = null;
let perfSortAsc = true;

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
