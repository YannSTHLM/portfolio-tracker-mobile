

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

// Weighted Momentum Score chart instance
let momentumScoreChart = null;

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

  // Refresh weighted momentum score chart
  renderMomentumScoreChart();
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

  // Refresh weighted momentum score chart when snapshots change
  renderMomentumScoreChart();
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

// --- WEIGHTED MOMENTUM SCORE CHART ---

function renderMomentumScoreChart() {
  const canvas = document.getElementById('momentumScoreChart');
  const container = document.getElementById('momentumScoreChartContainer');
  const emptyMsg = document.getElementById('momentumScoreChartEmpty');
  if (!canvas || !container) return;

  const analyticsSnapshots = loadAnalyticsSnapshotsFromLocalStorage();

  // Need at least 1 snapshot with data
  if (!analyticsSnapshots || analyticsSnapshots.length === 0) {
    container.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = '';
    if (momentumScoreChart) { momentumScoreChart.destroy(); momentumScoreChart = null; }
    return;
  }

  // Sort chronologically (oldest → newest)
  const sorted = [...analyticsSnapshots].sort((a, b) => (a.id || 0) - (b.id || 0));

  // Build X-axis labels (date strings)
  const labels = sorted.map(s => {
    try {
      const d = new Date(s.timestamp);
      return d.toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' });
    } catch { return s.dateLabel || '?'; }
  });

  // Collect all unique asset names across all snapshots
  const assetNames = new Set();
  sorted.forEach(s => {
    if (!s.buckets) return;
    [1, 2, 3].forEach(b => {
      const bucket = s.buckets[b];
      if (bucket && bucket.assets) {
        bucket.assets.forEach(a => {
          if (a.compositeScore !== null) assetNames.add(a.name);
        });
      }
    });
  });

  if (assetNames.size === 0) {
    container.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = '';
    if (momentumScoreChart) { momentumScoreChart.destroy(); momentumScoreChart = null; }
    return;
  }

  // Build a lookup: for each snapshot, map assetName → compositeScore
  const scoreLookup = sorted.map(s => {
    const map = {};
    if (!s.buckets) return map;
    [1, 2, 3].forEach(b => {
      const bucket = s.buckets[b];
      if (bucket && bucket.assets) {
        bucket.assets.forEach(a => {
          map[a.name] = a.compositeScore; // may be null
        });
      }
    });
    return map;
  });

  // Get latest non-null compositeScore per asset for sorting
  const latestScores = {};
  [...sorted].reverse().forEach(s => {
    if (!s.buckets) return;
    [1, 2, 3].forEach(b => {
      const bucket = s.buckets[b];
      if (bucket && bucket.assets) {
        bucket.assets.forEach(a => {
          if (a.compositeScore !== null && latestScores[a.name] === undefined) {
            latestScores[a.name] = a.compositeScore;
          }
        });
      }
    });
  });

  // Sort asset names by latest compositeScore descending (best performer first)
  const sortedAssetNames = [...assetNames].sort((a, b) => {
    const sa = latestScores[a] !== undefined ? latestScores[a] : -Infinity;
    const sb = latestScores[b] !== undefined ? latestScores[b] : -Infinity;
    return sb - sa;
  });

  // 15-color palette: blues, pinks, greens, yellows, oranges, purples
  const palette = [
    '#60a5fa', // blue
    '#818cf8', // indigo
    '#c084fc', // purple
    '#e879f9', // pink
    '#f472b6', // rose
    '#fb7185', // red-pink
    '#34d399', // emerald
    '#4ade80', // green
    '#a3e635', // lime
    '#facc15', // yellow
    '#fbbf24', // amber
    '#fb923c', // orange
    '#f97316', // deep orange
    '#a78bfa', // violet
    '#22d3ee'  // cyan
  ];

  // Build datasets
  const datasets = sortedAssetNames.map((name, i) => {
    const color = palette[i % palette.length];
    const data = scoreLookup.map(map => {
      const val = map[name];
      return val !== undefined && val !== null ? val : null;
    });

    return {
      label: name,
      data,
      borderColor: color,
      backgroundColor: color,
      fill: false,
      spanGaps: true,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
      tension: 0.1
    };
  });

  // Destroy previous chart
  if (momentumScoreChart) {
    momentumScoreChart.destroy();
    momentumScoreChart = null;
  }

  // Show chart, hide empty message
  container.style.display = '';
  if (emptyMsg) emptyMsg.style.display = 'none';

  const ctx = canvas.getContext('2d');
  momentumScoreChart = new Chart(ctx, {
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
            pointStyle: 'circle',
            padding: 16,
            font: { family: 'DM Sans', size: 11 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(26, 34, 52, 0.95)',
          borderColor: 'rgba(45, 58, 82, 0.8)',
          borderWidth: 1,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          padding: 10,
          titleFont: { family: 'DM Sans', weight: '600' },
          bodyFont: { family: 'DM Sans' },
          callbacks: {
            label: function(context) {
              const val = context.parsed.y;
              if (val === null || val === undefined) return null;
              const sign = val >= 0 ? '+' : '';
              return `${context.dataset.label}: ${sign}${val.toFixed(2)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(45, 58, 82, 0.4)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'DM Sans', size: 11 },
            maxRotation: 45,
            minRotation: 0
          }
        },
        y: {
          grid: { color: 'rgba(45, 58, 82, 0.4)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'DM Sans', size: 11 },
            callback: function(value) { return value.toFixed(1) + '%'; }
          },
          title: {
            display: true,
            text: 'Wtd Score — Weighted Momentum Score',
            color: '#94a3b8',
            font: { family: 'DM Sans', size: 12 }
          }
        }
      }
    }
  });
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

