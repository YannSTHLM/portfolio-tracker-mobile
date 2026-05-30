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

// ===== MOBILE NAVIGATION =====

// Tabs accessible via the "More" sheet
const MORE_TABS = ['reference', 'evolution', 'comparison', 'snapshots', 'analytics', 'retirement', 'notes'];

function mobileSwitchTab(tabName) {
  // Use the existing switchTab function
  if (typeof switchTab === 'function') {
    switchTab(tabName);
  }
  // Update mobile nav active state
  updateMobileNavActive(tabName);
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateMobileNavActive(tabName) {
  const moreBtn = document.querySelector('.mobile-bottom-nav .nav-item:last-child');
  const isMoreTab = MORE_TABS.includes(tabName);
  document.querySelectorAll('.mobile-bottom-nav .nav-item').forEach(btn => {
    btn.classList.remove('active', 'more-active');
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    }
  });
  // Highlight the "More" button when a More tab is active
  if (isMoreTab && moreBtn) {
    moreBtn.classList.add('more-active');
  }
}

function openMobileMoreSheet() {
  const sheet = document.getElementById('mobileMoreSheet');
  const overlay = document.getElementById('mobileMoreOverlay');
  if (sheet) {
    sheet.style.display = 'block';
    requestAnimationFrame(() => sheet.classList.add('visible'));
  }
  if (overlay) overlay.classList.add('visible');
}

function closeMobileMoreSheet() {
  const sheet = document.getElementById('mobileMoreSheet');
  const overlay = document.getElementById('mobileMoreOverlay');
  if (sheet) {
    sheet.classList.remove('visible');
    setTimeout(() => { sheet.style.display = 'none'; }, 300);
  }
  if (overlay) overlay.classList.remove('visible');
}

function toggleMobileActionDrawer() {
  const drawer = document.getElementById('mobileActionDrawer');
  const overlay = document.getElementById('mobileActionDrawerOverlay');
  if (!drawer || !overlay) return;
  const isOpen = drawer.classList.contains('visible');
  if (isOpen) {
    drawer.classList.remove('visible');
    overlay.classList.remove('visible');
    setTimeout(() => { drawer.style.display = 'none'; overlay.style.display = 'none'; }, 300);
  } else {
    drawer.style.display = 'block';
    overlay.style.display = 'block';
    requestAnimationFrame(() => {
      drawer.classList.add('visible');
      overlay.classList.add('visible');
    });
  }
}

// Swipe-to-dismiss for bottom sheets and side drawers
(function initSwipeGestures() {
  // Swipe down to close the "More" sheet
  const sheet = document.getElementById('mobileMoreSheet');
  if (sheet) {
    let startY = 0, currentY = 0, isDragging = false;
    sheet.addEventListener('touchstart', e => {
      // Only track if scrolled to top within the sheet
      if (sheet.scrollTop <= 0) {
        startY = e.touches[0].clientY;
        isDragging = true;
      }
    }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      if (diff > 0) {
        // Dragging down - follow finger
        sheet.style.transition = 'none';
        sheet.style.transform = 'translateY(' + diff + 'px)';
      }
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      const diff = currentY - startY;
      sheet.style.transition = '';
      sheet.style.transform = '';
      // If dragged more than 100px or 30% of sheet height, close
      if (diff > 100 || diff > sheet.offsetHeight * 0.3) {
        closeMobileMoreSheet();
      }
      startY = 0;
      currentY = 0;
    }, { passive: true });
  }

  // Swipe right to close the action drawer
  const drawer = document.getElementById('mobileActionDrawer');
  if (drawer) {
    let startX = 0, currentX = 0, isDragging = false;
    drawer.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      isDragging = true;
    }, { passive: true });
    drawer.addEventListener('touchmove', e => {
      if (!isDragging) return;
      currentX = e.touches[0].clientX;
      const diff = startX - currentX;
      if (diff > 0) {
        // Swiping left (closing right drawer)
        drawer.style.transition = 'none';
        drawer.style.transform = 'translateX(' + (-diff) + 'px)';
      }
    }, { passive: true });
    drawer.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      const diff = startX - currentX;
      drawer.style.transition = '';
      drawer.style.transform = '';
      // If swiped more than 80px or 30% of drawer width, close
      if (diff > 80 || diff > drawer.offsetWidth * 0.3) {
        toggleMobileActionDrawer();
      }
      startX = 0;
      currentX = 0;
    }, { passive: true });
  }
})();

// Sync mobile nav active state when switchTab is called from desktop
registerHook('afterSwitchTab', function(tabName) {
  updateMobileNavActive(tabName);
});
