"use strict";


// --- AI HOLDINGS ANALYSIS ---
const AI_ANALYSIS_LS_KEY = 'portfolioTracker_aiAnalysis';
let aiAnalysisHistory = []; // { role: 'user'|'assistant', content: '...' }

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
  summary += `- **Nordnet Value:** ${formatCurrency(currentSnapshot.nordnetValue)} (${ft.totalValue > 0 ? ((currentSnapshot.nordnetValue / ft.totalValue) * 100).toFixed(1) : 0}%)\n`;
  summary += `- **Avanza Value:** ${formatCurrency(currentSnapshot.avanzaValue)} (${ft.totalValue > 0 ? ((currentSnapshot.avanzaValue / ft.totalValue) * 100).toFixed(1) : 0}%)\n`;

  // Bucket allocation
  const bucketAlloc = { 1: 0, 2: 0, 3: 0, 0: 0 };
  holdings.forEach(h => { bucketAlloc[h.bucket] = (bucketAlloc[h.bucket] || 0) + h.value; });
  summary += `\n### Bucket Allocation\n`;
  Object.keys(bucketAlloc).forEach(b => {
    if (bucketAlloc[b] > 0) {
      const pct = ft.totalValue > 0 ? ((bucketAlloc[b] / ft.totalValue) * 100).toFixed(1) : 0;
      const bname = BUCKETS[b] ? BUCKETS[b].name : 'Unknown';
      summary += `- **B${b} (${bname}):** ${formatCurrency(bucketAlloc[b])} (${pct}%)\n`;
    }
  });

  // Rebalancing targets
  summary += `\n### Target Allocation\n`;
  ['avanza', 'nordnet'].forEach(broker => {
    const targets = rebalancingTargets[broker];
    if (targets) {
      summary += `**${broker.charAt(0).toUpperCase() + broker.slice(1)}:**\n`;
      targets.forEach(t => {
        if (t.target > 0) summary += `- ${t.name}: ${t.target}%\n`;
      });
    }
  });

  // Individual holdings
  summary += `\n### All Holdings\n`;
  summary += `| Asset | Brokerage | Category | Bucket | Value (SEK) | % of Portfolio |\n`;
  summary += `|-------|-----------|----------|--------|-------------|---------------|\n`;
  holdings.forEach(h => {
    const pct = ft.totalValue > 0 ? ((h.value / ft.totalValue) * 100).toFixed(2) : '0.00';
    const bname = BUCKETS[h.bucket] ? BUCKETS[h.bucket].name : 'Unknown';
    summary += `| ${h.name} | ${h.brokerage} | ${h.category || 'Unassigned'} | B${h.bucket} (${bname}) | ${Math.round(h.value).toLocaleString('sv-SE')} | ${pct}% |\n`;
  });

  // Performance links
  const links = Object.entries(performanceLinks);
  if (links.length > 0) {
    summary += `\n### Performance Links\n`;
    links.forEach(([key, url]) => summary += `- ${key.replace('|', ' (')})}: ${url}\n`);
  }

  // Performance data
  if (performanceData && performanceData.assets) {
    summary += `\n### Historical Performance\n`;
    performanceData.assets.forEach(a => {
      const rets = Object.entries(a.returns || {}).map(([k, v]) => `${k}: ${v !== null ? v + '%' : 'N/A'}`).join(', ');
      summary += `- **${a.name}** (${a.assetType}): ${rets}\n`;
    });
  }

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
      return `<div class="ai-chat-user text-sm"><strong>You:</strong> ${msg.content}</div>`;
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

  const btn = document.getElementById('aiAnalyzeBtn');
  const btnText = document.getElementById('aiAnalyzeBtnText');
  const spinner = document.getElementById('aiLoadingSpinner');
  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Analyzing...';
  if (spinner) spinner.classList.remove('hidden');

  try {
    const portfolioSummary = buildPortfolioSummary();
    const prompt = `You are a professional portfolio analyst. Analyze the following Swedish portfolio and provide actionable insights.

${portfolioSummary}

Please provide your analysis in the following sections using Markdown formatting:

## 1. Portfolio Diversification Assessment
Evaluate how well-diversified the portfolio is across asset classes, sectors, and geographies.

## 2. Risk Analysis
Identify concentration risks, sector exposure issues, and potential vulnerabilities.

## 3. Allocation vs Targets
Compare the current bucket allocation against the target allocation. Highlight significant gaps.

## 4. Actionable Recommendations
Provide 3-5 specific, actionable suggestions for rebalancing or improving the portfolio.

## 5. Market Context
Brief commentary on the overall asset mix and general positioning considerations.

Be specific, reference actual holdings and numbers from the portfolio data. Use SEK for any currency references.`;

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: getApiModel(),
        messages: [
          { role: 'system', content: 'You are a professional portfolio analyst providing clear, actionable investment insights. Always respond in Markdown format. Be specific and reference actual data from the portfolio.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error: ${response.status} - ${errText.substring(0, 200)}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || 'No analysis could be generated.';

    aiAnalysisHistory = [
      { role: 'user', content: 'Analyze my portfolio holdings' },
      { role: 'assistant', content: content }
    ];
    saveAiAnalysis();
    renderAiAnalysisContent(content);

  } catch (err) {
    console.error('AI Holdings Analysis error:', err);
    alert('AI Analysis failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Re-Analyze Holdings';
    if (spinner) spinner.classList.add('hidden');
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
    const systemMsg = { role: 'system', content: 'You are a professional portfolio analyst providing clear, actionable investment insights. Always respond in Markdown format. Be specific and reference actual data when relevant. Keep answers concise.' };
    const contextMsg = { role: 'user', content: `Here is my portfolio summary for context:\n\n${buildPortfolioSummary()}` };
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
  if (tabId === 'analytics') { renderAnalyticsHoldings(); loadAiAnalysis(); }
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
      <div class="grid grid-cols-[40px_1fr_180px_160px] gap-2 items-center py-2 border-b border-[var(--border-subtle)]">
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
        <div class="grid grid-cols-[40px_1fr_180px_160px] gap-2 items-center py-1 border-b border-[var(--border)] text-xs text-[var(--fg-muted)] uppercase font-semibold">
          <div></div><div>Asset Name</div><div>Category</div><div>Bucket</div>
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
