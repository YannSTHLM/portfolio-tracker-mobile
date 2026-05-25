"use strict";

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
