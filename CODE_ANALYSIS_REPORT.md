# Portfolio Tracker — Code Analysis & Site Review Report

**Date:** 2026-05-25 (updated)  
**Reviewer:** Automated Code Review  
**Version:** 1.0.0

---

## EXECUTIVE SUMMARY

The Portfolio Tracker is a feature-rich single-page application (SPA) for consolidating, visualizing, and planning the rebalancing of investment portfolios across Avanza and Nordnet Swedish brokerages. The application has been successfully refactored from a monolithic bundle into 13 modular JavaScript section files. The codebase is functional, well-organized, and covers an impressive range of financial features. No critical (P0) issues remain.

**Overall Rating: B+ (Good)** — Solid architecture with room for improvement in code quality, type safety, and documentation consistency.

---

## 1. PROJECT ARCHITECTURE

### 1.1 File Structure
```
/
├── index.html              # SPA entry point (~3,700 lines)
├── server.js               # Express backend (Yahoo Finance proxy, 386 lines)
├── package.json            # Node.js project config
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline caching (v2, 76 lines)
├── start.command           # macOS launcher
├── stop.command            # macOS stopper
├── DESCRIPTION.MD          # Detailed architecture docs
├── README.md               # User-facing documentation
├── import-data.md          # Data import instructions
├── CODE_ANALYSIS_REPORT.md # This report
├── css/
│   └── styles.css          # 825 lines, custom properties + components
└── js/
    ├── app-bundle.js       # Built concatenation of sections (268 KB)
    └── sections/
        ├── 00-core.js             # Config, state, utilities (~485 lines)
        ├── 01-carryforward.js     # Broker carry-forward logic (~130 lines)
        ├── 02-rebalancing.js      # Schedule & bucket strategy (~414 lines)
        ├── 03-import-export.js    # File I/O, CSV/JSON parsing (~339 lines)
        ├── 04-parsers.js          # Avanza/Nordnet PDF/CSV parsers (~330 lines)
        ├── 05-api-dashboard.js    # Dashboard & tab orchestration (295 lines)
        ├── 06-editing-rebalance.js # Holdings editing & rebalancing UI (748 lines)
        ├── 07-charts.js           # Chart.js visualizations (~430 lines)
        ├── 08-analytics.js        # Performance analytics & correlation (~807 lines)
        ├── 09-ai-holdings.js      # Z.ai AI integration (696 lines)
        ├── 10-retirement-prices.js # Retirement + live pricing (~928 lines)
        ├── 11-momentum.js         # Momentum scoring & perf display (~310 lines)
        └── 12-notes.js            # Notes, demo data, momentum snapshots (~410 lines)
```

### 1.2 Architecture Pattern
- **No module system.** All 13 JS files are loaded via `<script>` tags in index.html (lines 1824–1836). Variables and functions declared at the global scope in earlier files are accessible to later files.
- **No IIFE wrapping.** Global namespace pollution is a deliberate design choice.
- **No build step required.** The `build` script in package.json simply concatenates the 13 section files in order using `cat`.
- **CDN dependencies:** Tailwind CSS, Chart.js 4.x, PDF.js 3.11, Google Fonts (DM Sans, Space Grotesk).

### 1.3 Technology Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| Styling | Tailwind CSS (CDN) + custom CSS (825 lines) |
| Charts | Chart.js 4.x (CDN) |
| PDF Parsing | PDF.js 3.11 (CDN) + custom regex + Z.ai AI fallback |
| Backend | Node.js + Express (server.js, port 3000) |
| Live Prices | Yahoo Finance API via `yahoo-finance2` npm package |
| AI | Z.ai API (`glm-4.7` model) |
| PWA | Service worker + manifest.json |
| Storage | localStorage (9 keys) |
| Fonts | DM Sans, Space Grotesk (Google Fonts CDN) |

---

## 2. MODULE-BY-MODULE REVIEW

### 2.1 `index.html` — Main Entry Point
**Lines:** ~3,700  
**Quality:** B+

**Strengths:**
- Comprehensive PWA meta tags (apple-mobile-web-app, theme-color, manifest)
- Clean dark-theme design with decorative gradient orbs and grid background
- 11 well-organized tabs: Overview, Holdings, Evolution, Rebalancing, Comparison, Reference, Snapshots, Retirement, Notes, Live Prices, AI Analysis
- All 13 section scripts loaded in correct dependency order (lines 1824–1836)
- Inline `<script>` block (line 15) initializes app on DOMContentLoaded
- Inline SVG icons for UI elements (financial-themed tab icons)

**Concerns:**
- ~3,700 lines is quite large for a single HTML file. Some inline SVG icons and HTML templates could be moved to separate files
- Inline `<style>` block duplicates some CSS custom properties already in `styles.css`
- The sheer number of DOM elements with inline Tailwind classes makes the HTML dense
- No heading hierarchy — uses `<h2>` for the main title but no clear document outline

### 2.2 `00-core.js` — Foundation Module
**Lines:** ~485  
**Quality:** A-

**Strengths:**
- Well-organized config constants (`CONFIG` — API_URL, API_MODEL)
- Comprehensive category definitions (`CATEGORIES`) with color mappings and rules
- Bucket definitions (`BUCKETS`) with colors and descriptions (Investment, Stability, High Growth, Sell)
- Global state clearly declared at the top (snapshots, currentSnapshot, referenceDate)
- Robust utility functions: `formatCurrency()`, `escapeHtml()`, `namesMatch()`, `findAssetInReference()`, `getClassificationFromReference()`, `updateCategories()`, `updateStats()`
- Smart `namesMatch()` using normalization (diacritic folding, whitespace collapse, lowercase)
- `classifyAsset()` with bucket/category rule engine
- `classificationReference` with `loadReferenceTable()`/`saveReferenceTable()` localStorage persistence
- `excludedAssets` with `loadExcludedAssets()`/`saveExcludedAssets()`/`toggleAssetExclusion()`/`isAssetExcluded()`
- `loadReferenceDate()`/`saveReferenceDate()` persistence
- `hooks` system (`beforeIsInSchedule`, `beforeFindBucketForName`, `afterShowDashboard`, `afterSwitchTab`) allowing extensibility

**Concerns:**
- Global Chart.js instance variables declared but some (bucket evolution charts) may not be fully utilized yet
- `findAssetInReference()` returns the first match even with multiple brokers having same asset name — could be ambiguous
- No JSDoc type annotations on key functions
- `categoryRules` defined here but empty object — actual rules are in `02-rebalancing.js`

### 2.3 `01-carryforward.js` — Broker Carry-Forward
**Lines:** ~130  
**Quality:** A

**Strengths:**
- Clean implementation of a sophisticated data integrity feature
- When a snapshot only has data for one broker, missing broker data is carried forward from the most recent previous snapshot
- `getEffectiveSnapshot()` returns a synthesized clone without mutating originals
- Properly handles edge cases (no previous data, both brokers missing)
- Deep cloning of carried-forward holdings with `JSON.parse(JSON.stringify())`
- Snapshot chip badges visually indicate carried-forward data (↩ symbol)

**Concerns:**
- `getSnapshotBrokerInfo()` checks both `value > 0` AND at least one holding — this is correct but could have edge cases if a broker has exactly 0 value
- The `brokerage === 'Avanza'` string comparison is used in many places — a constant would reduce typos

### 2.4 `02-rebalancing.js` — Rebalancing Engine
**Lines:** ~414  
**Quality:** A-

**Strengths:**
- Well-defined `categoryRules` lookup table mapping categories to buckets
- `DEFAULT_REBALANCING_TARGETS` with complete target allocations for both Avanza and Nordnet (each summing to 100%)
- `generateRebalancingMonths()` creates 10-month interpolated schedule using linear interpolation
- `getScheduleForMonth()`, `getCurrentAllocations()`, `calculateRebalancingDiff()` provide clean API
- `renderRebalancingSchedule()`, `renderRebalancingTables()`, `renderBucketSummary()` for complete UI
- `isInSchedule()` and `findBucketForName()` with hook-based override support
- Schedule auto-persists to localStorage
- `referencesRebalancingHooks()` function for external system integration

**Concerns:**
- The interpolation logic is hardcoded to 10 months with a specific equity ramp — abstraction would allow different schedules
- Some magic numbers in the schedule generation (e.g., `Math.round(interpolated * 10) / 10`)
- `renderRebalancingTables()` is quite long and could be split into sub-functions

### 2.5 `03-import-export.js` — Data I/O
**Lines:** ~339  
**Quality:** B+

**Strengths:**
- Handles both CSV (Avanza format) and JSON (exported sessions)
- Drag-and-drop support with visual feedback (`.dragover` class)
- Demo mode via URL parameter (`?demo`)
- Complete `handleDataImport()` with validation and localStorage restoration
- `exportData()` produces a clean JSON with all configuration

**Concerns:**
- `parseCSV()` handles pipe-delimited format but the README says pipes — inconsistent with actual CSV parsing logic
- JSON import validation is basic (checks for `snapshots` array but not deep schema)
- No progress indication during large file imports
- `handleFileSelect` and `handleFiles` have some duplicated logic

### 2.6 `04-parsers.js` — Avanza/Nordnet Parsers
**Lines:** ~330  
**Quality:** A

**Strengths:**
- `parseAvanzaCSV()` — clean semicolon-delimited parsing with date extraction from filename
- `parseNordnetCSV()` — handles Nordnet's specific format with currency normalization (`SEK` detection)
- `parsePdfText()` — regex-based Nordnet PDF parsing with multi-line holdings extraction
- `repairJsonText()` and `repairJsonFallback()` — robust JSON repair utilities for AI responses
- `extractHoldingsWithAI()` — Z.ai API integration for PDF fallback parsing with retry logic (2 retries)
- Proper filtering of loans (`BOLAN` type), zero/negative values, and empty names
- Aggregation of same-named assets
- Classification via `getClassificationFromReference()` on parsed holdings

**Concerns:**
- `parsePdfText()` regex patterns are complex and brittle — any Nordnet PDF format change would break them
- AI fallback has a hardcoded API key pattern expectation — no key management
- `repairJsonFallback()` is a best-effort regex extraction — could lose data silently

### 2.7 `05-api-dashboard.js` — Dashboard Orchestration
**Lines:** 295  
**Quality:** B+

**Strengths:**
- Clean tab switching with `switchTab()` handling 11 tabs
- AI settings modal (`showApiSettings`, `saveApiSettings`) with localStorage persistence
- `showDashboard()` orchestrates full dashboard render
- Snapshot chips and snapshot management UI with broker badges (Avanza/Nordnet indicators)
- `updateStats()` with filtered totals and reference date comparison
- `migrateOldApiSettings()` for backward compatibility
- `renderSnapshotsTab()` — comprehensive snapshot list with select/delete

**Concerns:**
- `switchTab()` has a long if-else chain — a tab registry object would be cleaner
- AI settings use their own localStorage keys separate from the core module pattern — inconsistent
- `parseCSV()` duplicates logic also found in `04-parsers.js`'s `parseAvanzaCSV()`

### 2.8 `06-editing-rebalance.js` — Editing & Rebalancing UI
**Lines:** 748  
**Quality:** B+

**Strengths:**
- `handleCategoryChange()` and `handleBucketChange()` with proper persistence to classification reference
- `calculateBrokerCurrents()` computes current allocations per broker per bucket
- Complete rebalancing table rendering with diff calculations
- `renderRebalancingCharts()` — stacked area charts for Avanza/Nordnet bucket projections with current-month dashed line indicator
- `renderHoldingsAllocationSek()` — holdings allocation in SEK with current, diff, month target, and final target columns
- **Return Target Calculator** (`updateReturnTargetCalculator`, `calculateBuyAmount`) — generic formula `(Profit ÷ Target Return) - Cost Basis` with negative target support
- `renderConsolidatedBucketTable()` — combined Avanza+Nordnet bucket overview weighted by portfolio share
- `renderBucketSummaryCards()` — bullet chart visualization per bucket

**Concerns:**
- This is the largest section file at 748 lines — could benefit from further modularization
- Category and bucket change handlers have near-identical structure — could be refactored into a shared helper
- Documentation of the rebalancing diff display format is sparse
- `calculateBuyAmount()` returns -1 for impossible scenarios but calling code doesn't always check for this sentinel

### 2.9 `07-charts.js` — Chart.js Visualizations
**Lines:** ~430  
**Quality:** A-

**Strengths:**
- 10 well-named chart rendering functions
- Proper Chart.js instance management — destroys existing charts before re-rendering to prevent memory leaks
- `renderDistributionChart()` — doughnut chart with category colors
- `renderBrokerageChart()` — brokerage allocation pie chart
- `renderEvolutionChart()` — portfolio value over time line chart
- `renderCategoryEvolutionChart()` — category allocation changes over time
- `renderBucketEvolutionChart()` — bucket allocation evolution
- Bucket holdings charts (`bucket1HoldingsChart`, `bucket2HoldingsChart`, `bucket3HoldingsChart`)
- `renderHoldingsTable()` — comprehensive sortable/filterable table
- `renderComparisonTable()` — side-by-side snapshot comparison
- `renderCategoryBreakdown()` — category progress bars with percentages
- Proper filtering via `getFilteredHoldings()` and `calculateFilteredTotals()`

**Concerns:**
- Chart configurations are verbose and have significant duplication (color arrays, options)
- `renderHoldingsTable()` is very long and handles both rendering logic and comparison logic
- Google Fonts chart font family is hardcoded in every chart config

### 2.10 `08-analytics.js` — Performance Analytics
**Lines:** ~807  
**Quality:** B+

**Strengths:**
- `parseAvanzaPerformancePDFText()` — comprehensive Avanza performance report PDF parser with fuzzy name matching
- `parseNordnetPerformancePDFText()` — Nordnet performance PDF parsing
- `loadPerformanceDataFromPdf()` — high-level orchestration
- Complete returns calculation engine supporting YTD, 1M, 3M, 1Y, 3Y periods
- Correlation matrix computation with heatmap rendering
- `calculatePortfolioMetrics()` — Sharpe ratio, volatility, max drawdown
- Performance table with sortable columns
- localStorage persistence for performance data

**Concerns:**
- The second-largest section at 807 lines — could be split into parsing, computation, and rendering modules
- `fuzzyIndexOf()` with multi-strategy matching is clever but hard to debug when it fails
- Correlation matrix rendering creates inline-styled divs — would be cleaner with CSS classes
- Hardcoded Swedish financial terms in parsing logic limit internationalization

### 2.11 `09-ai-holdings.js` — AI Holdings Analysis
**Lines:** 696  
**Quality:** B+

**Strengths:**
- Complete chat-style AI analysis interface with message history
- `buildPortfolioSummary()` generates comprehensive Markdown portfolio summary with holdings table, bucket allocation, broker split
- `simpleMarkdownToHtml()` — lightweight custom Markdown renderer (headers, bold/italic, code, blockquotes, lists)
- Message persistence via `loadAiAnalysis()`/`saveAiAnalysis()` in localStorage
- `analyzeHoldingsWithAI()` with structured prompt requesting 5 analysis sections
- `askFollowUpQuestion()` with full conversation context (system message, portfolio summary, previous analysis)
- Z.ai API integration using `CONFIG.API_URL` and `CONFIG.API_MODEL`
- Loading states with disabled buttons and spinner indicators

**Concerns:**
- `simpleMarkdownToHtml()` is a basic parser — doesn't handle nested formatting, links, or tables
- AI API key is in localStorage with no encryption
- No token limit enforcement on AI requests — very large portfolios could exceed model context limits
- Follow-up conversation grows unboundedly (limited to last 6 exchanges but initial context always included)

### 2.12 `10-retirement-prices.js` — Retirement & Live Prices
**Lines:** ~928  
**Quality:** B

**Strengths:**
- **Retirement Planning:** Complete pension projection with hardcoded Swedish pension data (allmän pension, tjänstepension, private pension) for two individuals
- Compound growth calculations with configurable withdrawal rates and tax rates
- Year-override system for custom withdrawal/tax rates per year
- Chart.js projection chart with income breakdown (pension, portfolio withdrawals, total)
- **Live Prices:** `initPerfTrackedHoldings()`, `loadPerfLiveData()`, `renderPerfLivePricesTable()`
- Server communication via `fetch('/api/prices')` and `fetch('/api/prices/refresh')`
- Manual price entry/override capability
- `checkServerStatus()` with visual indicator

**Concerns:**
- **Largest section at 928 lines** — severely needs modularization (split into retirement.js and live-prices.js)
- Pension data is hardcoded with personal information (names, birth years) — should be in a data file or config
- Live price polling interval is implicit — could hammer the server
- `renderPerfLivePricesTable()` has significant HTML template string complexity
- Retirement calculations mix presentation (currency formatting) with computation logic

### 2.13 `11-momentum.js` — Momentum Analysis
**Lines:** ~310  
**Quality:** B+

**Strengths:**
- `renderPerfSummaryCards()` — 4 summary cards (YTD avg, best, worst, positive ratio)
- `renderPerfTable()` — sortable performance table with YTD, 1M, 3M, 1Y, 3Y columns
- `renderPerfBarChart()` — YTD bar chart with positive/negative color coding
- Momentum scoring engine: composite scores based on multiple timeframes
- `renderMomentumTab()` — complete momentum tab rendering

**Concerns:**
- Momentum scoring formula has magic weights — would benefit from configurable parameters
- Summary cards have hardcoded CSS classes inline
- `renderPerfTable()` sort handler uses string comparison for some columns — could have numeric sorting issues

### 2.14 `12-notes.js` — Notes, Demo & Momentum Snapshots
**Lines:** ~410  
**Quality:** B

**Strengths:**
- **Momentum Snapshots:** `saveMomentumSnapshot()`, `loadMomentumSnapshots()` with 365-day cap, `renderMomentumEvolutionChart()`
- **Demo Data:** `loadDemoData()` with realistic sample data across Avanza and Nordnet
- **Notes System:** CRUD operations with localStorage persistence, `renderNotesTab()`, progress tracking with checkboxes, inline event handlers

**Concerns:**
- **Multiple unrelated features in one file** — momentum snapshots, demo data, and notes don't belong together
- Notes use `window.handleNoteToggle`, `window.handleNoteDelete`, `window.handleAddNote` — polluting global namespace
- Demo data is hardcoded with ~30 holdings — this is maintenance burden
- `loadDemoData()` duplicates logic found in `03-import-export.js`'s JSON import

### 2.15 `server.js` — Express Backend
**Lines:** ~386  
**Quality:** A-

**Strengths:**
- Clean Express server with CORS middleware
- Yahoo Finance integration via `yahoo-finance2` npm package
- `TICKER_MAP` with ~25 Swedish mutual fund/ETF tickers with diacritic-insensitive fallback
- Two endpoints: `GET /api/prices` (cached), `POST /api/prices/refresh` (force refresh)
- 15-minute in-memory `priceCache` with TTL
- `getPriceWithTickerMap()` — sophisticated ticker resolution with asset name lookup, diacritic folding, and best-effort search
- Graceful handling of Yahoo Finance API errors

**Concerns:**
- `TICKER_MAP` is hardcoded — new assets require code changes
- No authentication on API endpoints — anyone on the network can access
- Cache is in-memory only — restarting the server loses all cached prices
- Yahoo Finance API has rate limits — no throttling mechanism
- `getPriceWithTickerMap()` has a `bestEffort` fallback that searches all tickers — could trigger many API calls

### 2.16 `service-worker.js` — PWA Offline Support
**Lines:** 76  
**Quality:** A-

**Strengths:**
- Versioned cache (`portfolio-tracker-v2`) for easy cache busting
- 22 assets precached during `install`
- `skipWaiting()` for immediate activation
- Clean old caches during `activate`
- Cache-first strategy for CDN resources (Tailwind, Chart.js, PDF.js, Google Fonts)
- Network-first strategy for local files with cache fallback
- Skips non-GET requests (AI API POST calls) — avoids Cache API errors

**Concerns:**
- The 22 precached assets are hardcoded — adding new section files requires updating the `ASSETS` array
- No cache size limit — could grow large with CDN resources
- Only one cache strategy per origin — all CDN resources treated identically

### 2.17 `css/styles.css` — Custom Styles
**Lines:** ~825  
**Quality:** A-

**Strengths:**
- Well-organized with clear section headers
- CSS custom properties (`:root`) for all design tokens — easy theming
- Dark theme with good contrast ratios
- `.bg-grid` subtle grid overlay, `.gradient-orb` decorative elements
- Card, button, upload zone, table, filter, tab components
- Animation keyframes (fadeIn, slideUp, pulse)
- Responsive breakpoints (768px, 640px)
- Scrollbar styling for WebKit browsers
- Print styles

**Concerns:**
- Some inline styles in the HTML could be migrated here
- Animation durations are hardcoded — could use custom properties
- No dark/light mode toggle — permanently dark

### 2.18 `start.command` / `stop.command` — macOS Launchers
**Quality:** B+

**Strengths:**
- Convenient one-click server start/stop for non-technical macOS users
- Port conflict detection and resolution
- Server readiness polling with timeout
- Auto-opens browser

**Concerns:**
- Uses `kill -9` (SIGKILL) which doesn't allow graceful shutdown
- Hardcoded port 3000

### 2.19 `manifest.json` — PWA Manifest
**Quality:** A-

**Strengths:**
- Complete PWA configuration
- Standalone display mode
- Dark theme colors matching app
- Inline SVG icon (bar chart on green background)
- Maskable icon support

**Concerns:**
- Single icon size (SVG is scalable, but some platforms need specific PNG sizes)
- Short name "Portfolio" could be more descriptive

---

## 3. CROSS-CUTTING CONCERNS

### 3.1 Code Organization
**Status: Good, with issues**

The 13-file modularization is a significant improvement over the original monolithic bundle. However:
- **Stale bundle confirmed:** `js/app-bundle.js` was built at 15:17 on May 25. `06-editing-rebalance.js` was modified at 16:59 — the bundle is 1 hour 42 minutes stale. Other section files are current.
- Files 10, 12 contain multiple unrelated features that should be separate modules
- No clear separation between data layer, business logic, and presentation logic within each file

### 3.2 Global Namespace Pollution
**Status: Intentional, but risky**

All variables and functions are global. With 13 files and hundreds of functions, naming collisions are a real risk. There is an informal naming convention (camelCase functions, descriptive names) but no enforcement. Recommended: wrap each section in an IIFE or use a namespace object pattern.

### 3.3 Error Handling
**Status: Inconsistent**

- Some functions have try-catch blocks (API calls, file parsing)
- Many DOM operations assume elements exist — returns early if missing
- AI API calls have retry logic (2 retries in `04-parsers.js`)
- But many helper functions lack error handling and could throw uncaught exceptions
- `calculateBuyAmount()` in `06-editing-rebalance.js` returns sentinel value -1 for impossible scenarios

### 3.4 localStorage Usage
**Status: Heavy, but organized**

| Key | Module | Purpose |
|-----|--------|---------|
| `portfolioTracker_referenceDate` | 00-core | Reference date |
| `portfolioTracker_classification` | 00-core | Category/bucket assignments |
| `portfolioTracker_excludedAssets` | 00-core | Excluded assets |
| `portfolioTracker_rebalancingTargets` | 02-rebalancing | Custom targets |
| `portfolioTracker_apiKey` | 05-api-dashboard | AI API key |
| `portfolioTracker_apiUrl` | 05-api-dashboard | AI API URL |
| `portfolioTracker_apiModel` | 05-api-dashboard | AI model |
| `portfolioTracker_aiAnalysis` | 09-ai-holdings | AI chat history |
| `portfolioTracker_retirement` | 10-retirement | Retirement projections |
| `portfolioTracker_performance` | 08-analytics | Performance data |
| `portfolioTracker_momentumSnapshots` | 12-notes | Momentum history |
| `portfolioTracker_notes` | 12-notes | User notes |
| `perf_live_prices` | 10-retirement-prices | Cached live prices |

No data migration or versioning strategy. Key naming is consistent but fragile — a single typo breaks persistence.

### 3.5 Security
**Status: Acceptable for local use**

- XSS vulnerabilities resolved — all user data rendered via `escapeHtml()` (defined in `00-core.js`)
- API keys stored in localStorage (not encrypted) — acceptable for local-only use
- No authentication on Express server endpoints
- CORS enabled for all origins (`*`) — only a concern if exposed to a network

### 3.6 Performance
**Status: Good**

- No framework overhead — vanilla JS
- CDN dependencies with service worker caching
- Chart.js instance reuse (destroy before recreate)
- PDF parsing is client-side — large PDFs could block the main thread
- No lazy loading or code splitting

### 3.7 Accessibility
**Status: Needs improvement**

- No ARIA labels or roles on interactive elements
- Color alone is used to convey information (positive/negative values in red/green via `.change-positive` / `.change-negative` classes)
- No keyboard navigation support for custom interactive elements
- Font sizes use relative units (rem) — good for zoom
- No focus indicators on custom buttons (e.g., snapshot chips)

---

## 4. KEY FINDINGS

### Critical (P0) — None
All previously identified critical issues have been resolved:
- ✅ Section files wired into index.html (lines 1824–1836)
- ✅ Stale root-level JS files deleted
- ✅ All 13 section files have `"use strict"`
- ✅ All `innerHTML` XSS vulnerabilities fixed via `escapeHtml()`
- ✅ Monkey-patching resolved — replaced with `hooks` system
- ✅ `categoryRules` properly defined in `02-rebalancing.js`

### High Priority (P1)
1. **Stale app-bundle.js** — `06-editing-rebalance.js` was modified at 16:59, bundle built at 15:17. Run `npm run build` to regenerate.
2. **File 10 too large** — `10-retirement-prices.js` at 928 lines combines two unrelated features (retirement planning and live prices). Should be split.
3. **File 12 feature overload** — Combines momentum snapshots, demo data, and notes in one file. Should be separated.
4. **Hardcoded personal data** — Pension data in `10-retirement-prices.js` contains personal names and birth years.

### Medium Priority (P2)
5. **Duplicate CSV parsing logic** — Both `05-api-dashboard.js` and `04-parsers.js` have CSV parsing code.
6. **Chart configuration duplication** — Font families, color arrays, and tooltip callbacks repeated across chart functions.
7. **Service worker asset list** — Requires manual updates when adding new section files.
8. **No TypeScript/JSDoc** — No type annotations anywhere.
9. **`switchTab()` long if-else chain** — Should use a registry pattern.

### Low Priority (P3)
10. **Magic numbers** — Momentum weights, withdrawal rate default, interpolation steps are hardcoded.
11. **`simpleMarkdownToHtml()` limitations** — No link, table, or nested formatting support.
12. **No automated tests** — Zero test coverage.
13. **Inline event handlers** — `window.handleNoteToggle` etc. in notes module.
14. **No dark/light mode toggle** — Permanently dark theme.
15. **No data migration strategy** — localStorage keys could change between versions.
16. **Pension data exposure** — Hardcoded personal information in code.

---

## 5. METRICS

| Metric | Value |
|--------|-------|
| Total source files | 20 |
| Total JS lines | ~6,500 across 13 section files |
| Average JS file size | ~500 lines |
| Largest file | `10-retirement-prices.js` (928 lines) |
| Smallest file | `01-carryforward.js` (~130 lines) |
| CDN dependencies | 4 (Tailwind, Chart.js, PDF.js, Google Fonts) |
| npm dependencies | 2 (express, yahoo-finance2) |
| localStorage keys | 13 |
| Chart.js instances | 10+ |
| Browser tabs | 11 |
| API endpoints | 2 (GET /api/prices, POST /api/prices/refresh) |
| Service worker cached assets | 22 (15 local + CDN) |
| Stale files | 1 (`app-bundle.js` — 1h42m behind `06-editing-rebalance.js`) |

---

## 6. RECOMMENDATIONS

### Immediate Actions
1. **Run `npm run build`** to regenerate `js/app-bundle.js` with latest changes from `06-editing-rebalance.js`
2. **Split `10-retirement-prices.js`** into `10-retirement.js` and a new `xx-live-prices.js` (requires updating index.html, build script, and service worker)
3. **Extract demo data** from `12-notes.js` into a separate `data/demo-data.js` file
4. **Split notes** from `12-notes.js` into a dedicated `13-notes.js` and keep `12-notes.js` for momentum snapshots

### Short-Term Improvements
5. **Create a namespace object** (e.g., `window.App = {}`) to reduce global scope pollution
6. **Add JSDoc annotations** to key functions for better IDE support
7. **Implement a tab registry** in `05-api-dashboard.js` instead of the if-else chain
8. **Extract chart configuration defaults** to reduce duplication in `07-charts.js`
9. **Add ARIA labels** to interactive elements for accessibility

### Long-Term Considerations
10. **Add automated tests** — at minimum, unit tests for parsing logic and financial calculations
11. **Consider TypeScript migration** — would catch many bugs at compile time
12. **Implement a proper module system** — ES modules or a bundler (but this adds build complexity)
13. **Add a data migration system** for localStorage keys
14. **Consider a proper state management pattern** — observer/pub-sub instead of direct DOM manipulation after every state change
15. **Add internationalization support** — currently hardcoded to Swedish financial terms and SEK currency

---

## 7. CONCLUSION

The Portfolio Tracker is a well-built, feature-complete application that successfully consolidates investment data from two Swedish brokerages. The recent refactoring from a monolithic bundle into 13 section files has significantly improved maintainability. The application handles complex financial workflows (carry-forward, rebalancing interpolation, performance analytics, AI-assisted parsing) with relatively clean code.

The primary areas for improvement are reducing file sizes through further modularization, adding type safety, improving accessibility, and establishing a more robust state management pattern. No critical issues remain, and the application is production-ready for personal use.

**One actionable item:** `npm run build` needs to be run to sync `app-bundle.js` with the latest `06-editing-rebalance.js` changes.

---

*This report was generated by code review on 2026-05-25. Updated with fresh findings.*