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
