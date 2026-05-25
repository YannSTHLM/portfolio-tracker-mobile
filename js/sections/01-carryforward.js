"use strict";


// --- CARRY-FORWARD LOGIC ---
// When a snapshot is missing data for a broker, carry forward the most recent
// previous snapshot's data for that broker.

function getSnapshotBrokerInfo(snapshot) {
  const hasAvanza = snapshot.avanzaValue > 0 && snapshot.holdings.some(h => h.brokerage === 'Avanza');
  const hasNordnet = snapshot.nordnetValue > 0 && snapshot.holdings.some(h => h.brokerage === 'Nordnet');
  return { hasAvanza, hasNordnet };
}

function getEffectiveSnapshot(snapshot) {
  if (!snapshot) return null;
  const { hasAvanza, hasNordnet } = getSnapshotBrokerInfo(snapshot);

  // If both brokers are present, no carry-forward needed
  if (hasAvanza && hasNordnet) return snapshot;

  // Find the snapshot's index to search backwards
  const snapIdx = snapshots.indexOf(snapshot);

  // Clone the snapshot to avoid mutating original
  const effective = {
    date: snapshot.date,
    dateStr: snapshot.dateStr,
    holdings: [...snapshot.holdings.map(h => ({ ...h }))],
    totalValue: snapshot.totalValue,
    nordnetValue: snapshot.nordnetValue,
    avanzaValue: snapshot.avanzaValue,
    _carriedForward: {} // track which brokers were carried forward
  };

  // Search backwards for missing broker data
  if (!hasAvanza && snapIdx > 0) {
    for (let i = snapIdx - 1; i >= 0; i--) {
      const prev = snapshots[i];
      if (prev.avanzaValue > 0 && prev.holdings.some(h => h.brokerage === 'Avanza')) {
        // Carry forward Avanza holdings
        const avanzaHoldings = prev.holdings
          .filter(h => h.brokerage === 'Avanza')
          .map(h => ({ ...h, carriedForward: true, carriedFromDate: prev.dateStr }));
        effective.holdings = effective.holdings.concat(avanzaHoldings);
        effective.avanzaValue = prev.avanzaValue;
        effective._carriedForward.avanza = prev.dateStr;
        break;
      }
    }
  }

  if (!hasNordnet && snapIdx > 0) {
    for (let i = snapIdx - 1; i >= 0; i--) {
      const prev = snapshots[i];
      if (prev.nordnetValue > 0 && prev.holdings.some(h => h.brokerage === 'Nordnet')) {
        // Carry forward Nordnet holdings
        const nordnetHoldings = prev.holdings
          .filter(h => h.brokerage === 'Nordnet')
          .map(h => ({ ...h, carriedForward: true, carriedFromDate: prev.dateStr }));
        effective.holdings = effective.holdings.concat(nordnetHoldings);
        effective.nordnetValue = prev.nordnetValue;
        effective._carriedForward.nordnet = prev.dateStr;
        break;
      }
    }
  }

  // Recalculate total
  effective.totalValue = effective.avanzaValue + effective.nordnetValue;

  // Recalculate percentages
  if (effective.totalValue > 0) {
    effective.holdings.forEach(h => {
      h.percentage = (h.value / effective.totalValue) * 100;
    });
  }

  // Sort holdings by value descending
  effective.holdings.sort((a, b) => b.value - a.value);

  return effective;
}

// Get effective snapshots for ALL snapshots (for charts)
function getAllEffectiveSnapshots() {
  return snapshots.map(s => getEffectiveSnapshot(s));
}

// Category rules for assets not in reference
