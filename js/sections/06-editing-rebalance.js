"use strict";


// --- EDITING LOGIC ---

function handleCategoryChange(name, brokerage, newCategory) {
    if (!currentSnapshot) return;
    const holding = currentSnapshot.holdings.find(h => h.name === name && h.brokerage === brokerage);
    if (holding) {
        holding.category = newCategory;
        holding.bucket = categoryRules[newCategory] !== undefined ? categoryRules[newCategory] : holding.bucket;
    }
    // Also update the reference table so the change persists across renders
    const refKey = brokerage.toLowerCase() === 'nordnet' ? 'nordnet' : 'avanza';
    const refEntry = classificationReference[refKey]?.find(r => r.name === name);
    if (refEntry) {
        refEntry.category = newCategory;
        refEntry.bucket = categoryRules[newCategory] !== undefined ? categoryRules[newCategory] : refEntry.bucket;
    } else {
        // Add new entry to reference table if not found
        if (!classificationReference[refKey]) classificationReference[refKey] = [];
        classificationReference[refKey].push({ name, category: newCategory, bucket: categoryRules[newCategory] !== undefined ? categoryRules[newCategory] : 0 });
    }
    populateFilters();
    renderCategoryBreakdown();
    renderDistributionChart();
    renderHoldingsTable();
}

function handleBucketChange(name, brokerage, newBucket) {
    if (!currentSnapshot) return;
    const holding = currentSnapshot.holdings.find(h => h.name === name && h.brokerage === brokerage);
    if (holding) {
        holding.bucket = parseInt(newBucket);
    }
    // Also update the reference table so the change persists across renders
    const refKey = brokerage.toLowerCase() === 'nordnet' ? 'nordnet' : 'avanza';
    const refEntry = classificationReference[refKey]?.find(r => r.name === name);
    if (refEntry) {
        refEntry.bucket = parseInt(newBucket);
    } else {
        if (!classificationReference[refKey]) classificationReference[refKey] = [];
        classificationReference[refKey].push({ name, category: holding?.category || 'Unassigned', bucket: parseInt(newBucket) });
    }
    renderRebalancingTables();
    renderHoldingsTable();
}

// --- END EDITING LOGIC ---

function calculateBrokerCurrents(broker) {
    if(!currentSnapshot) return { assets: {}, unscheduled: [], totalBrokerValue: 0 };
    
    const effective = getEffectiveSnapshot(currentSnapshot);
    const filteredHoldings = getFilteredHoldings(effective);
    const brokerHoldings = filteredHoldings.filter(h => h.brokerage === broker);
    const ft = calculateFilteredTotals(effective);
    const totalBrokerValue = broker === 'Nordnet' ? ft.nordnetValue : ft.avanzaValue;
    
    const assets = {};
    const unscheduled = [];
    
    const scheduleKeys = rebalancingSchedule[broker.toLowerCase()].map(s => s.name);
    
    brokerHoldings.forEach(h => {
        const match = scheduleKeys.find(key => namesMatch(key, h.name));
        
        if (match) {
            if(!assets[match]) assets[match] = 0;
            assets[match] += (h.value / totalBrokerValue) * 100;
        } else {
            unscheduled.push({
                name: h.name,
                bucket: h.bucket || 0,
                val: (h.value / totalBrokerValue) * 100
            });
        }
    });
    
    return { assets, unscheduled, totalBrokerValue };
}

function renderRebalanceTable(body, broker, scheduleData) {
    const currentData = calculateBrokerCurrents(broker);
    body.innerHTML = '';
    
    let currentSum = 0;

    scheduleData.forEach(item => {
        const currentVal = currentData.assets[item.name] || 0;
        currentSum += currentVal;
        
        const row = document.createElement('tr');
        let cells = `<td class="font-medium">${escapeHtml(item.name)} <span class="badge ${BUCKETS[item.bucket].class} ml-2">B${item.bucket}</span></td>`;
        
        cells += `<td class="text-right font-mono">${currentVal.toFixed(1)}%</td>`;
        item.schedule.forEach((val, idx) => {
            const isHighlight = (idx === currentRebalancingMonth - 1 || idx === REBALANCING_MONTHS - 1);
            cells += `<td class="text-right font-mono ${isHighlight ? 'highlight-col' : 'text-[var(--fg-muted)]'}">${val.toFixed(1)}%</td>`;
        });
        
        row.innerHTML = cells;
        body.appendChild(row);
    });

    // Unscheduled Holdings
    currentData.unscheduled
      .sort((a, b) => {
          if (a.bucket !== b.bucket) return a.bucket - b.bucket;
          return a.name.localeCompare(b.name);
      })
      .forEach(item => {
          currentSum += item.val;
          
          const bucket = BUCKETS[item.bucket];
          const otherRow = document.createElement('tr');
          let otherCells = `<td class="font-medium text-[var(--fg-muted)]">${escapeHtml(item.name)} <span class="badge ${bucket.class} ml-2">B${item.bucket}</span></td>`;
          
          otherCells += `<td class="text-right font-mono">${item.val.toFixed(1)}%</td>`;
          
          for(let i=0; i<REBALANCING_MONTHS; i++) {
              const isHighlight = (i === currentRebalancingMonth - 1 || i === REBALANCING_MONTHS - 1);
              otherCells += `<td class="text-right font-mono ${isHighlight ? 'highlight-col' : 'text-[var(--fg-muted)]'}">0.0%</td>`;
          }
          otherRow.innerHTML = otherCells;
          body.appendChild(otherRow);
      });

    const sumRow = document.createElement('tr');
    sumRow.className = 'sum-row';
    let sumCells = `<td>TOTAL</td>`;
    sumCells += `<td class="text-right font-mono">${currentSum.toFixed(1)}%</td>`;
    for(let i=0; i<REBALANCING_MONTHS; i++) {
        const isHighlight = (i === currentRebalancingMonth - 1 || i === REBALANCING_MONTHS - 1);
        sumCells += `<td class="text-right font-mono ${isHighlight ? 'highlight-col' : ''}">100.0%</td>`;
    }
    sumRow.innerHTML = sumCells;
    body.appendChild(sumRow);
}

function renderRebalancingTables() {
    syncTargetsFromReference();
    refreshRebalancingSchedule();
    renderTargetsConfig();
    const avanzaBody = document.getElementById('avanzaRebalanceTable');
    const nordnetBody = document.getElementById('nordnetRebalanceTable');

    renderRebalanceTable(avanzaBody, 'Avanza', rebalancingSchedule.avanza);
    renderRebalanceTable(nordnetBody, 'Nordnet', rebalancingSchedule.nordnet);
    
    // Render bucket summary cards
    renderBucketSummaryCards();
    
    // Render consolidated bucket overview table
    renderConsolidatedBucketTable();

    // Update consolidated table headers to show selected month
    const monthHeaderEl = document.getElementById('consolidatedMonthHeader');
    if (monthHeaderEl) monthHeaderEl.textContent = getMonthShortLabel(currentRebalancingMonth) + ' 2026 Target';
    const monthDeltaHeaderEl = document.getElementById('consolidatedMonthDeltaHeader');
    if (monthDeltaHeaderEl) monthDeltaHeaderEl.textContent = 'Δ Current → ' + getMonthShortLabel(currentRebalancingMonth) + ' 2026';

    // Update schedule table headers with real month names
    updateScheduleTableHeaders();

    // Populate and update Return Target Rebalancing Calculator
    updateReturnTargetCalculator();

    // Render holdings allocation tables in SEK
    renderHoldingsAllocationSek('avanzaSekTable', 'Avanza');
    renderHoldingsAllocationSek('nordnetSekTable', 'Nordnet');

    // Update SEK table month headers
    const avanzaMonthHdr = document.getElementById('avanzaSekMonthHeader');
    if (avanzaMonthHdr) avanzaMonthHdr.textContent = getMonthShortLabel(currentRebalancingMonth) + ' 2026 Target (SEK)';
    const nordnetMonthHdr = document.getElementById('nordnetSekMonthHeader');
    if (nordnetMonthHdr) nordnetMonthHdr.textContent = getMonthShortLabel(currentRebalancingMonth) + ' 2026 Target (SEK)';

    // Render rebalancing projection charts
    renderRebalancingCharts();
}

function renderRebalancingCharts() {
    const bucketColors = {
        0: '#f87171', // Red for Bucket 0 (Sell)
        1: '#22d3ee', // Cyan for Bucket 1
        2: '#fbbf24', // Amber for Bucket 2
        3: '#34d399'  // Emerald for Bucket 3
    };
    const bucketOrder = [0, 1, 2, 3];

    ['avanza', 'nordnet'].forEach(broker => {
        const canvasId = broker + 'RebalanceChart';
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const schedule = rebalancingSchedule[broker];
        if (!schedule || schedule.length === 0) return;

        const months = REBALANCING_MONTHS;
        const labels = [];
        for (let m = 1; m <= months; m++) {
            labels.push(getMonthShortLabel(m));
        }

        // Aggregate schedule by bucket per month
        const bucketSchedules = {};
        bucketOrder.forEach(b => { bucketSchedules[b] = new Array(months).fill(0); });
        schedule.forEach(item => {
            const b = item.bucket;
            if (bucketSchedules[b]) {
                item.schedule.forEach((val, idx) => {
                    bucketSchedules[b][idx] += val;
                });
            }
        });

        // Build stacked area datasets — one per bucket, filled from the bucket below
        const datasets = bucketOrder.map(b => ({
            label: (BUCKETS[b]?.name || 'Bucket ' + b).split('—')[0]?.trim() || ('Bucket ' + b),
            data: bucketSchedules[b],
            backgroundColor: bucketColors[b] + '50',
            borderColor: bucketColors[b],
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: bucketColors[b],
            pointBorderColor: 'transparent'
        }));

        const ctx = canvas.getContext('2d');

        // Destroy existing chart if any
        if (broker === 'avanza' && avanzaRebalanceChart) avanzaRebalanceChart.destroy();
        if (broker === 'nordnet' && nordnetRebalanceChart) nordnetRebalanceChart.destroy();

        const currentMonthIdx = currentRebalancingMonth - 1;

        // Custom plugin: dashed vertical line + label at the current month
        const currentMonthLinePlugin = {
            id: 'currentMonthDashedLine',
            afterDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                if (!meta || !chart.scales.x || !chart.scales.y) return;
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                if (currentMonthIdx < 0 || currentMonthIdx >= labels.length) return;

                const x = xScale.getPixelForValue(currentMonthIdx);
                const ctx = chart.ctx;

                // Dashed vertical line
                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([6, 4]);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
                ctx.lineWidth = 2;
                ctx.moveTo(x, yScale.top);
                ctx.lineTo(x, yScale.bottom);
                ctx.stroke();
                ctx.restore();

                // "Current" label above the line
                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.70)';
                ctx.font = 'bold 11px "DM Sans", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(labels[currentMonthIdx], x, yScale.top - 4);
                ctx.restore();
            }
        };

        const chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    intersect: true
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: { color: '#94a3b8', font: { size: 10 } }
                    },
                    y: {
                        stacked: true,
                        max: 100,
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 },
                            callback: (v) => v + '%'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#cbd5e1',
                            boxWidth: 12,
                            padding: 10,
                            font: { size: 10 },
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`
                        }
                    }
                }
            },
            plugins: [currentMonthLinePlugin]
        });

        if (broker === 'avanza') avanzaRebalanceChart = chartInstance;
        if (broker === 'nordnet') nordnetRebalanceChart = chartInstance;
    });
}

function renderHoldingsAllocationSek(tbodyId, broker) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody || !currentSnapshot) return;

    const brokerKey = broker.toLowerCase();
    const currentData = calculateBrokerCurrents(broker);
    const totalBrokerValue = currentData.totalBrokerValue;
    const scheduleData = rebalancingSchedule[brokerKey] || [];

    tbody.innerHTML = '';

    let sumCurrent = 0;
    let sumDiff = 0;
    let sumMonthTarget = 0;
    let sumFinalTarget = 0;

    // Scheduled assets
    scheduleData.forEach(item => {
        const currentPct = currentData.assets[item.name] || 0;
        const currentSek = (currentPct / 100) * totalBrokerValue;
        const monthPct = item.schedule[currentRebalancingMonth - 1] || 0;
        const monthSek = (monthPct / 100) * totalBrokerValue;
        const finalPct = item.schedule[REBALANCING_MONTHS - 1] || 0;
        const finalSek = (finalPct / 100) * totalBrokerValue;
        const diffSek = monthSek - currentSek;

        sumCurrent += currentSek;
        sumDiff += diffSek;
        sumMonthTarget += monthSek;
        sumFinalTarget += finalSek;

        const diffClass = diffSek >= 0 ? 'change-positive' : 'change-negative';
        const diffSign = diffSek >= 0 ? '+' : '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="font-medium">${escapeHtml(item.name)} <span class="badge ${BUCKETS[item.bucket].class} ml-2">B${item.bucket}</span></td>
            <td class="text-right font-mono">${formatCurrency(Math.round(currentSek))}</td>
            <td class="text-right font-mono ${diffClass}">${diffSign}${formatCurrency(Math.round(Math.abs(diffSek)))}</td>
            <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(monthSek))}</td>
            <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(finalSek))}</td>
        `;
        tbody.appendChild(row);
    });

    // Unscheduled holdings
    currentData.unscheduled
        .sort((a, b) => {
            if (a.bucket !== b.bucket) return a.bucket - b.bucket;
            return a.name.localeCompare(b.name);
        })
        .forEach(item => {
            const currentSek = (item.val / 100) * totalBrokerValue;
            sumCurrent += currentSek;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="font-medium text-[var(--fg-muted)]">${escapeHtml(item.name)} <span class="badge ${BUCKETS[item.bucket].class} ml-2">B${item.bucket}</span></td>
                <td class="text-right font-mono">${formatCurrency(Math.round(currentSek))}</td>
                <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
                <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
                <td class="text-right font-mono text-[var(--fg-muted)]">—</td>
            `;
            tbody.appendChild(row);
        });

    // Sum row
    const sumDiffClass = sumDiff >= 0 ? 'change-positive' : 'change-negative';
    const sumDiffSign = sumDiff >= 0 ? '+' : '';

    const sumRow = document.createElement('tr');
    sumRow.className = 'sum-row';
    sumRow.innerHTML = `
        <td>TOTAL</td>
        <td class="text-right font-mono">${formatCurrency(Math.round(sumCurrent))}</td>
        <td class="text-right font-mono ${sumDiffClass}">${sumDiffSign}${formatCurrency(Math.round(Math.abs(sumDiff)))}</td>
        <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(sumMonthTarget))}</td>
        <td class="text-right font-mono highlight-col">${formatCurrency(Math.round(sumFinalTarget))}</td>
    `;
    tbody.appendChild(sumRow);
}

// --- RETURN TARGET REBALANCING CALCULATOR ---

function updateReturnTargetCalculator() {
    const costBasisInput = document.getElementById('costBasisInput');
    const marketValueInput = document.getElementById('marketValueInput');
    const currentProfitInput = document.getElementById('currentProfitInput');

    if (!costBasisInput || !marketValueInput || !currentProfitInput) return;

    // Get current portfolio value from snapshot
    let currentPortfolioValue = 0;
    if (currentSnapshot) {
        const effective = getEffectiveSnapshot(currentSnapshot);
        const ft = calculateFilteredTotals(effective);
        currentPortfolioValue = ft.totalValue;
    }

    // Set initial values if inputs are empty (only on first load)
    if (!costBasisInput.value && currentPortfolioValue > 0) {
        costBasisInput.value = Math.round(currentPortfolioValue);
    }
    if (!marketValueInput.value && currentPortfolioValue > 0) {
        marketValueInput.value = Math.round(currentPortfolioValue);
    }

    // Calculate and update
    calculateReturnTargetAmounts();
}

function calculateReturnTargetAmounts() {
    const costBasis = parseFloat(document.getElementById('costBasisInput').value) || 0;
    const marketValue = parseFloat(document.getElementById('marketValueInput').value) || 0;
    const currentProfit = marketValue - costBasis;

    // Update current profit display - show negative values
    document.getElementById('currentProfitInput').value = currentProfit !== 0 ? Math.round(currentProfit) : 0;

    // Quick reference table amounts - include negative targets
    const targets = [-0.10, -0.05, -0.02, 0.04, 0.05, 0.07, 0.10];
    const elementIds = ['buyAmount-10', 'buyAmount-5', 'buyAmount-2', 'buyAmount4', 'buyAmount5', 'buyAmount7', 'buyAmount10'];

    targets.forEach((targetReturn, index) => {
        const buyAmount = calculateBuyAmount(costBasis, currentProfit, targetReturn);
        const el = document.getElementById(elementIds[index]);
        if (el) {
            if (buyAmount >= 0) {
                el.textContent = formatCurrency(Math.round(buyAmount));
                el.className = 'text-right py-3 font-mono';
            } else if (targetReturn > 0 && currentProfit > 0) {
                // Should buy but formula gives negative - impossible scenario
                el.textContent = 'N/A';
                el.className = 'text-right py-3 font-mono text-[var(--fg-muted)]';
            } else {
                // Negative buy amount means SELL - display negative value in red
                el.textContent = '-' + formatCurrency(Math.round(Math.abs(buyAmount)));
                el.className = 'text-right py-3 font-mono change-negative';
            }
        }
    });

    // Custom target return calculator - allow negative targets
    const customTargetReturnInput = document.getElementById('customTargetReturnInput');
    const customResultEl = document.getElementById('customBuyAmountResult');
    if (customTargetReturnInput && customTargetReturnInput.value && customResultEl) {
        const customTargetReturn = parseFloat(customTargetReturnInput.value) / 100; // Supports negative values
        const customBuyAmount = calculateBuyAmount(costBasis, currentProfit, customTargetReturn);
        if (customBuyAmount >= 0) {
            customResultEl.textContent = formatCurrency(Math.round(customBuyAmount));
            customResultEl.className = 'text-xl font-bold font-mono text-[var(--accent-primary)]';
        } else if (customTargetReturn > 0 && currentProfit > 0) {
            customResultEl.textContent = 'N/A';
            customResultEl.className = 'text-xl font-bold font-mono text-[var(--fg-muted)]';
        } else {
            customResultEl.textContent = '-' + formatCurrency(Math.round(Math.abs(customBuyAmount)));
            customResultEl.className = 'text-xl font-bold font-mono change-negative';
        }
    } else if (customResultEl) {
        customResultEl.textContent = '--';
        customResultEl.className = 'text-xl font-bold font-mono text-[var(--accent-primary)]';
    }
}

function calculateBuyAmount(costBasis, currentProfit, targetReturn) {
    // Generic formula: Buy Amount = (Profit ÷ Target Return) - Cost Basis
    // Works for all scenarios: positive/negative profit, positive/negative target return
    // Returns -1 for impossible scenarios (target return = 0 or no profit to achieve positive target when underwater)
    if (targetReturn === 0) {
        return -1; // Cannot divide by zero
    }
    return (currentProfit / targetReturn) - costBasis;
}

// Setup event listeners for the return target calculator
function setupReturnTargetCalculatorListeners() {
    const costBasisInput = document.getElementById('costBasisInput');
    const marketValueInput = document.getElementById('marketValueInput');
    const customTargetReturnInput = document.getElementById('customTargetReturnInput');

    if (costBasisInput) {
        costBasisInput.addEventListener('input', calculateReturnTargetAmounts);
    }
    if (marketValueInput) {
        marketValueInput.addEventListener('input', calculateReturnTargetAmounts);
    }
    if (customTargetReturnInput) {
        customTargetReturnInput.addEventListener('input', calculateReturnTargetAmounts);
    }
}

function renderConsolidatedBucketTable() {
    const tbody = document.getElementById('consolidatedBucketTable');
    if (!tbody || !currentSnapshot) return;

    const effective = getEffectiveSnapshot(currentSnapshot);
    const conFt = calculateFilteredTotals(effective);
    const totalPortfolio = conFt.totalValue;
    const avanzaWeight = conFt.avanzaValue / totalPortfolio;
    const nordnetWeight = conFt.nordnetValue / totalPortfolio;

    const bucketNames = {
        1: { name: 'Bucket 1 — ' + BUCKETS[1].name, color: '#22d3ee', class: 'badge-bucket-1' },
        2: { name: 'Bucket 2 — ' + BUCKETS[2].name, color: '#fbbf24', class: 'badge-bucket-2' },
        3: { name: 'Bucket 3 — ' + BUCKETS[3].name, color: '#34d399', class: 'badge-bucket-3' },
        0: { name: 'Bucket 0 — ' + BUCKETS[0].name, color: '#f87171', class: 'badge-sell' }
    };

    // Calculate current bucket allocations (weighted by portfolio share)
    const calcCurrentBuckets = (broker) => {
        const brokerKey = broker.toLowerCase();
        const holdings = getFilteredHoldings(effective).filter(h => h.brokerage === broker);
        const cbFt = calculateFilteredTotals(effective);
        const brokerValue = broker === 'Avanza' ? cbFt.avanzaValue : cbFt.nordnetValue;
        const scheduleData = rebalancingSchedule[brokerKey] || [];
        const scheduleKeys = scheduleData.map(s => s.name);
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        holdings.forEach(h => {
            const match = scheduleKeys.find(key => namesMatch(key, h.name));
            let bucket = h.bucket || 0;
            if (match) {
                const item = scheduleData.find(s => s.name === match);
                bucket = item.bucket;
            }
            buckets[bucket] += (h.value / brokerValue) * 100;
        });
        return buckets;
    };

    const avanzaCurrent = calcCurrentBuckets('Avanza');
    const nordnetCurrent = calcCurrentBuckets('Nordnet');

    // M1 targets from bucketTargets (same for both brokers)
    // Final targets from rebalancingTargets per broker
    const calcFinalTargets = (broker) => {
        const targets = rebalancingTargets[broker] || [];
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        targets.forEach(t => { buckets[t.bucket] += t.target; });
        return buckets;
    };

    const avanzaFinal = calcFinalTargets('avanza');
    const nordnetFinal = calcFinalTargets('nordnet');

    // Build rows for buckets 1, 2, 3 (skip 0 if empty)
    const rows = [];
    let totalCurrent = 0, totalM1 = 0, totalFinal = 0;

    [1, 2, 3, 0].forEach(b => {
        const current = (avanzaCurrent[b] * avanzaWeight) + (nordnetCurrent[b] * nordnetWeight);
        const selectedMonthTarget = getBucketTargets(REBALANCING_MONTHS)[b][currentRebalancingMonth - 1]; // Selected month target
        const finalTarget = (avanzaFinal[b] * avanzaWeight) + (nordnetFinal[b] * nordnetWeight);
        const info = bucketNames[b];

        totalCurrent += current;
        totalM1 += selectedMonthTarget;
        totalFinal += finalTarget;

        const deltaM1 = current - selectedMonthTarget;
        const deltaFinal = current - finalTarget;

        rows.push(`
            <tr>
                <td><span class="badge ${info.class}">B${b}</span> <span class="text-sm">${info.name.split('—')[1]?.trim() || info.name}</span></td>
                <td class="text-right font-mono">${current.toFixed(1)}%</td>
                <td class="text-right font-mono highlight-col">${selectedMonthTarget.toFixed(1)}%</td>
                <td class="text-right font-mono highlight-col">${finalTarget.toFixed(1)}%</td>
                <td class="text-right font-mono ${deltaM1 >= 0 ? 'change-positive' : 'change-negative'}">${deltaM1 >= 0 ? '+' : ''}${deltaM1.toFixed(1)}%</td>
                <td class="text-right font-mono ${deltaFinal >= 0 ? 'change-positive' : 'change-negative'}">${deltaFinal >= 0 ? '+' : ''}${deltaFinal.toFixed(1)}%</td>
            </tr>
        `);
    });

    // Total row
    const totalDeltaM1 = totalCurrent - totalM1;
    const totalDeltaFinal = totalCurrent - totalFinal;
    rows.push(`
        <tr class="sum-row">
            <td class="font-bold">TOTAL</td>
            <td class="text-right font-mono">${totalCurrent.toFixed(1)}%</td>
            <td class="text-right font-mono highlight-col">${totalM1.toFixed(1)}%</td>
            <td class="text-right font-mono highlight-col">${totalFinal.toFixed(1)}%</td>
            <td class="text-right font-mono ${totalDeltaM1 >= 0 ? 'change-positive' : 'change-negative'}">${totalDeltaM1 >= 0 ? '+' : ''}${totalDeltaM1.toFixed(1)}%</td>
            <td class="text-right font-mono ${totalDeltaFinal >= 0 ? 'change-positive' : 'change-negative'}">${totalDeltaFinal >= 0 ? '+' : ''}${totalDeltaFinal.toFixed(1)}%</td>
        </tr>
    `);

    tbody.innerHTML = rows.join('');
}

function renderBucketSummaryCards() {
    const container = document.getElementById('bucketSummaryCards');
    if (!container || !currentSnapshot) return;

    const effective = getEffectiveSnapshot(currentSnapshot);
    const ft = calculateFilteredTotals(effective);
    const totalPortfolio = ft.totalValue;
    const avanzaWeight = ft.avanzaValue / totalPortfolio;
    const nordnetWeight = ft.nordnetValue / totalPortfolio;

    const bucketMeta = {
        1: { shortName: BUCKETS[1].name, color: '#22d3ee', class: 'badge-bucket-1' },
        2: { shortName: BUCKETS[2].name, color: '#fbbf24', class: 'badge-bucket-2' },
        3: { shortName: BUCKETS[3].name, color: '#34d399', class: 'badge-bucket-3' },
        0: { shortName: BUCKETS[0].name, color: '#f87171', class: 'badge-sell' }
    };

    // Calculate current bucket % for a broker
    const calcBrokerBuckets = (broker) => {
        const brokerKey = broker.toLowerCase();
        const holdings = getFilteredHoldings(effective).filter(h => h.brokerage === broker);
        const brokerValue = broker === 'Avanza' ? ft.avanzaValue : ft.nordnetValue;
        const scheduleData = rebalancingSchedule[brokerKey] || [];
        const scheduleKeys = scheduleData.map(s => s.name);
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        holdings.forEach(h => {
            const match = scheduleKeys.find(key => namesMatch(key, h.name));
            let bucket = h.bucket || 0;
            if (match) {
                const item = scheduleData.find(s => s.name === match);
                bucket = item.bucket;
            }
            buckets[bucket] += (h.value / brokerValue) * 100;
        });
        return buckets;
    };

    const calcFinalTargets = (broker) => {
        const targets = rebalancingTargets[broker] || [];
        const buckets = { 0: 0, 1: 0, 2: 0, 3: 0 };
        targets.forEach(t => { buckets[t.bucket] += t.target; });
        return buckets;
    };

    const avanzaCurrent = calcBrokerBuckets('Avanza');
    const nordnetCurrent = calcBrokerBuckets('Nordnet');
    const avanzaFinal = calcFinalTargets('avanza');
    const nordnetFinal = calcFinalTargets('nordnet');

    const _bt = getBucketTargets(REBALANCING_MONTHS);
    const getSelectedMonthTarget = (b) => _bt[b] ? _bt[b][currentRebalancingMonth - 1] : 0;

    // Determine which buckets to show
    const bucketsToShow = [1, 2, 3];
    const b0combined = (avanzaCurrent[0] * avanzaWeight) + (nordnetCurrent[0] * nordnetWeight);
    if (b0combined > 0.5) bucketsToShow.push(0);

    // Bullet chart: single horizontal bar with target markers
    const renderBullet = (current, m1Target, finalTarget, color, scaleMax) => {
        const toPct = (v) => Math.min(Math.max((v / scaleMax) * 100, 0), 100);
        const cP = toPct(current);
        const m1P = toPct(m1Target);
        const fP = toPct(finalTarget);
        return `<div class="relative" style="height:28px;">
            <!-- Background range -->
            <div class="absolute top-2 left-0 right-0 h-5 rounded-full" style="background:var(--bg-secondary);">
                <!-- Subtle range to final target -->
                <div class="absolute top-0 left-0 h-full rounded-full" style="width:${Math.max(cP, fP)}%;background:rgba(148,163,184,0.08);"></div>
                <!-- Current fill -->
                <div class="absolute top-0 left-0 h-full rounded-full transition-all duration-700" style="width:${cP}%;background:${color};opacity:0.6;"></div>
                <!-- M1 target line -->
                <div class="absolute" style="left:${m1P}%;top:-3px;bottom:-3px;width:2px;background:#fbbf24;border-radius:1px;z-index:2;"></div>
                <!-- Final target line -->
                <div class="absolute" style="left:${fP}%;top:-3px;bottom:-3px;width:2px;background:#34d399;border-radius:1px;z-index:2;"></div>
            </div>
            <!-- Current value label -->
            <div class="absolute text-[10px] font-mono font-bold" style="left:${Math.min(cP + 1, 90)}%;top:4px;color:${color};white-space:nowrap;">${current.toFixed(1)}%</div>
        </div>`;
    };

    // Build a single card with all bullet charts stacked vertically
    const bulletRows = bucketsToShow.map(b => {
        const meta = bucketMeta[b];
        const monthTarget = getSelectedMonthTarget(b);
        const aC = avanzaCurrent[b];
        const nC = nordnetCurrent[b];
        const aT = avanzaFinal[b];
        const nT = nordnetFinal[b];
        const combined = (aC * avanzaWeight) + (nC * nordnetWeight);
        const combinedTarget = (aT * avanzaWeight) + (nT * nordnetWeight);
        const scaleMax = Math.max(combined, monthTarget, combinedTarget, 10) * 1.25;
        const delta = combined - combinedTarget;
        const deltaSign = delta >= 0 ? '+' : '';
        const deltaColor = Math.abs(delta) < 2 ? 'text-emerald-400' : (delta > 0 ? 'text-amber-400' : 'text-amber-400');

        return `<div class="py-3 ${b !== bucketsToShow[bucketsToShow.length - 1] ? 'border-b border-[var(--border-subtle)]' : ''}">
            <!-- Bucket header -->
            <div class="flex items-center justify-between mb-1.5">
                <div class="flex items-center gap-2">
                    <span class="badge ${meta.class} text-xs">B${b}</span>
                    <span class="text-sm font-semibold">${meta.shortName}</span>
                </div>
                <div class="flex items-center gap-4 text-xs">
                    <span class="text-[var(--fg-muted)]">Avanza <span class="font-mono">${aC.toFixed(1)}%</span></span>
                    <span class="text-[var(--fg-muted)]">Nordnet <span class="font-mono">${nC.toFixed(1)}%</span></span>
                    <span class="font-mono font-bold ${deltaColor}">${deltaSign}${delta.toFixed(1)}%</span>
                </div>
            </div>
            <!-- Bullet chart -->
            ${renderBullet(combined, monthTarget, combinedTarget, meta.color, scaleMax)}
            <!-- Target legend -->
            <div class="flex items-center gap-4 mt-1 text-[10px] text-[var(--fg-muted)]">
                <span>${getMonthShortLabel(currentRebalancingMonth)} Target <span class="font-mono" style="color:#fbbf24;">${monthTarget.toFixed(1)}%</span></span>
                <span>Final <span class="font-mono" style="color:#34d399;">${combinedTarget.toFixed(1)}%</span></span>
            </div>
        </div>`;
    }).join('');

    // Global legend
    const legend = `<div class="flex items-center gap-6 mb-4 text-xs text-[var(--fg-muted)] px-1">
        <span class="flex items-center gap-1.5"><span style="display:inline-block;width:12px;height:6px;border-radius:3px;opacity:0.6;background:#94a3b8;"></span> Current allocation</span>
        <span class="flex items-center gap-1.5"><span style="display:inline-block;width:2px;height:10px;background:#fbbf24;border-radius:1px;"></span> ${getMonthShortLabel(currentRebalancingMonth)} Target</span>
        <span class="flex items-center gap-1.5"><span style="display:inline-block;width:2px;height:10px;background:#34d399;border-radius:1px;"></span> Final Target</span>
    </div>`;

    container.innerHTML = `<div class="card p-5 col-span-1 lg:col-span-2">
        ${legend}
        ${bulletRows}
    </div>`;
}