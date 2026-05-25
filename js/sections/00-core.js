"use strict";

const CONFIG = {
  REFERENCE_DATE: '2026-03-22',
  API_URL: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
  API_MODEL: 'glm-4.7',
  DEFAULT_WITHDRAWAL_RATE: 0.047,
};

// Data store
let snapshots = [];
let currentSnapshot = null;

// Reference date — load from localStorage or fall back to CONFIG default
const REF_DATE_LS_KEY = 'portfolioTracker_referenceDate';
function loadReferenceDate() {
  try {
    const raw = localStorage.getItem(REF_DATE_LS_KEY);
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
  } catch (e) { /* ignore */ }
  return new Date(CONFIG.REFERENCE_DATE);
}
function saveReferenceDate(date) {
  try {
    localStorage.setItem(REF_DATE_LS_KEY, date.toISOString().slice(0, 10));
  } catch (e) { /* ignore */ }
}
let referenceDate = loadReferenceDate();
let distributionChart = null;
let brokerageChart = null;
let evolutionChart = null;
let categoryEvolutionChart = null;
let bucketEvolutionChart = null;
let bucket1HoldingsChart = null;
let bucket2HoldingsChart = null;
let bucket3HoldingsChart = null;
let momentumEvolutionChart = null;
let avanzaRebalanceChart = null;
let nordnetRebalanceChart = null;

// Configuration
const BUCKETS = {
    1: { name: 'Cash/Short', class: 'badge-bucket-1' },
    2: { name: 'Fixed Income/Commodities', class: 'badge-bucket-2' },
    3: { name: 'Equity', class: 'badge-bucket-3' },
    0: { name: 'Sell/Other', class: 'badge-sell' }
};

const DEFAULT_CATEGORIES = [
    'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy', 'Financials', 'Health Care', 'Industrials', 'Information Technology', 'Materials', 'Real Estate', 'Utilities', 'Global Index', 'Sweden Index',
    'Credit', 'Long Term Bond', 'Mix Term Bond',
    'Precious Metals', 'Base Metals', 'Energy', 'Agriculture', 'Livestock',
    'Cash', 'Corporate / Credit', 'Short Duration', 'Other', 'Unassigned'
];

let CATEGORIES = [...DEFAULT_CATEGORIES];

function updateCategories() {
  const holdingsCategories = snapshots.flatMap(s => s.holdings.map(h => h.category).filter(Boolean));
  const refCategories = [
    ...classificationReference.avanza.map(r => r.category).filter(Boolean),
    ...classificationReference.nordnet.map(r => r.category).filter(Boolean)
  ];
  const all = [...new Set([...DEFAULT_CATEGORIES, ...holdingsCategories, ...refCategories])].sort();
  // Keep 'Unassigned' at the end
  if (all.includes('Unassigned')) {
    const idx = all.indexOf('Unassigned');
    all.splice(idx, 1);
    all.push('Unassigned');
  }
  CATEGORIES = all;
}

// Classification Reference Table (Editable)
const DEFAULT_REFERENCE = {
  avanza: [
    { name: 'AMF Företagsobligationsfond', category: 'Corporate / Credit', bucket: 2 },
    { name: 'AMF Räntefond Kort', category: 'Short Duration', bucket: 1 },
    { name: 'Avanza Ränta Kort', category: 'Short Duration', bucket: 1 },
    { name: 'SEB FRN Fond A', category: 'Short Duration', bucket: 1 },
    { name: 'Avanza Zero', category: 'Sweden Index', bucket: 3 },
    { name: 'Pareto Räntefond A', category: 'Short Duration', bucket: 1 },
    { name: 'AMF Räntefond Mix', category: 'Corporate / Credit', bucket: 2 },
    { name: 'Range Resources', category: 'Energy', bucket: 3 },
    { name: 'Avanza Global', category: 'Global Index', bucket: 3 },
    { name: 'Newmont', category: 'Materials', bucket: 3 }
  ],
  nordnet: [
    { name: 'AMF Företagsobligationsfond', category: 'Corporate / Credit', bucket: 2 },
    { name: 'AMF Räntefond Kort', category: 'Short Duration', bucket: 1 },
    { name: 'SEB FRN Fond A', category: 'Short Duration', bucket: 1 },
    { name: 'Spiltan Räntefond Sverige', category: 'Short Duration', bucket: 1 },
    { name: 'Pareto Räntefond A', category: 'Short Duration', bucket: 1 },
    { name: 'Nordnet Sverige Index', category: 'Sweden Index', bucket: 3 },
    { name: 'Cash', category: 'Cash', bucket: 1 },
    { name: 'Nordea Global Passive A Acc SEK', category: 'Global Index', bucket: 3 }
  ]
};

let classificationReference = {
  avanza: [],
  nordnet: []
};

// Excluded assets tracking (assetName|brokerage format)
let excludedAssets = new Set();
const EXCLUDED_LS_KEY = 'portfolioTracker_excludedAssets';

function loadExcludedAssets() {
  try {
    const raw = localStorage.getItem(EXCLUDED_LS_KEY);
    if (raw) {
      excludedAssets = new Set(JSON.parse(raw));
    }
  } catch (e) { console.warn('Failed to load excluded assets:', e); }
}

function saveExcludedAssets() {
  try {
    localStorage.setItem(EXCLUDED_LS_KEY, JSON.stringify([...excludedAssets]));
  } catch (e) { console.warn('Failed to save excluded assets:', e); }
}

function getAssetKey(name, brokerage) {
  return `${name}|${brokerage}`;
}

function isAssetExcluded(name, brokerage) {
  return excludedAssets.has(getAssetKey(name, brokerage));
}

function toggleAssetExclusion(name, brokerage) {
  const key = getAssetKey(name, brokerage);
  if (excludedAssets.has(key)) {
    excludedAssets.delete(key);
  } else {
    excludedAssets.add(key);
  }
  saveExcludedAssets();
}

function getFilteredHoldings(snapshot) {
  if (!snapshot) return [];
  return snapshot.holdings.filter(h => !isAssetExcluded(h.name, h.brokerage));
}

function calculateFilteredTotals(snapshot) {
  const filtered = getFilteredHoldings(snapshot);
  const totalValue = filtered.reduce((sum, h) => sum + h.value, 0);
  const nordnetValue = filtered.filter(h => h.brokerage === 'Nordnet').reduce((sum, h) => sum + h.value, 0);
  const avanzaValue = filtered.filter(h => h.brokerage === 'Avanza').reduce((sum, h) => sum + h.value, 0);
  return { totalValue, nordnetValue, avanzaValue, holdingsCount: filtered.length };
}

// --- UTILITY ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Hook system — allows sections to subscribe to lifecycle events
// without monkey-patching global functions
const hooks = {
  afterSwitchTab: [],
  afterShowDashboard: [],
  afterSetupEventListeners: [],
  beforeFindBucketForName: [],  // subscribers can return a bucket override
  beforeIsInSchedule: []         // subscribers can return a schedule override
};
function registerHook(name, fn) {
  if (hooks[name]) hooks[name].push(fn);
}
