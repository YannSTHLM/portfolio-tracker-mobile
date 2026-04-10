# Portfolio Tracker — Detailed Description

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & File Structure](#architecture--file-structure)
3. [Technology Stack](#technology-stack)
4. [Progressive Web App (PWA) Implementation](#progressive-web-app-pwa-implementation)
5. [Data Model & State Management](#data-model--state-management)
6. [UI Layout & Navigation](#ui-layout--navigation)
7. [Dashboard Header & Global Controls](#dashboard-header--global-controls)
8. [Upload Zone (Initial State)](#upload-zone-initial-state)
9. [Snapshot Management](#snapshot-management)
10. [Statistics Grid](#statistics-grid)
11. [Tab System](#tab-system)
12. [Overview Tab](#overview-tab)
13. [Reference Table Tab](#reference-table-tab)
14. [All Holdings Tab](#all-holdings-tab)
15. [Rebalancing Tab](#rebalancing-tab)
16. [Evolution Tab](#evolution-tab)
17. [Compare Tab](#compare-tab)
18. [Analytics Tab](#analytics-tab)
19. [Data Import & Export](#data-import--export)
20. [CSV Parsing (Avanza Format)](#csv-parsing-avanza-format)
21. [CSV Parsing (Generic Format)](#csv-parsing-generic-format)
22. [PDF Parsing (Nordnet) & AI Integration](#pdf-parsing-nordnet--ai-integration)
23. [Rebalancing Engine](#rebalancing-engine)
24. [Classification & Categorization System](#classification--categorization-system)
25. [Chart Visualizations](#chart-visualizations)
26. [Correlation & Statistical Analysis](#correlation--statistical-analysis)
27. [Performance Analytics](#performance-analytics)
28. [Local Storage Persistence](#local-storage-persistence)
29. [Styling & Theming](#styling--theming)
30. [Accessibility & Responsiveness](#accessibility--responsiveness)

---

## Project Overview

Portfolio Tracker is a **single-page, client-side Progressive Web App (PWA)** designed for consolidating, visualizing, and planning rebalancing of investment portfolios held across two Swedish brokerage platforms: **Avanza** and **Nordnet**. The application operates entirely in the browser with no backend server requirement — all data is stored in the browser's `localStorage` and can be exported/imported as JSON files.

### Core Value Propositions

- **Multi-brokerage consolidation**: Combines holdings from Avanza and Nordnet into a unified dashboard.
- **Snapshot-based tracking**: Supports multiple portfolio snapshots over time for historical comparison with carry-forward logic for missing broker data.
- **Rebalancing planning**: Provides a 10-month interpolated rebalancing schedule with configurable target allocations and consolidated bucket overview.
- **Performance analytics**: Historical return analysis with correlation matrices, heatmaps, and period comparisons.
- **Smart PDF parsing**: Regex-based Nordnet PDF parsing with optional AI fallback for complex documents.
- **Offline-capable PWA**: Works without network via service worker caching.
- **Asset exclusion**: Ability to exclude specific assets from calculations while preserving data.

---

## Architecture & File Structure

```
portfolio-tracker/
├── index.html          # Complete application (HTML + CSS + JavaScript)
├── manifest.json       # PWA manifest for installability
├── service-worker.js   # Service worker for offline caching
├── DESCRIPTION.MD      # This file
└── README.md           # Project readme
```

The entire application is contained within a **single `index.html` file** (~3,700 lines) that includes all HTML structure, CSS styles (in a `<style>` block), and JavaScript logic (in a `<script>` block). This architecture choice means:

- **Zero build step required** — open `index.html` directly in a browser.
- **No module bundler** — all code is in global scope with function declarations.
- **CDN dependencies** — Tailwind CSS, Chart.js, PDF.js, and Google Fonts are loaded from CDN.
- **Simple deployment** — can be hosted on any static file server (GitHub Pages, Netlify, etc.).

---

## Technology Stack

| Component | Technology | Version/Source |
|-----------|-----------|---------------|
| **Markup** | HTML5 | — |
| **Styling** | Tailwind CSS (CDN) | `cdn.tailwindcss.com` |
| **Custom CSS** | CSS Custom Properties | Inline `<style>` block |
| **Charts** | Chart.js | `cdn.jsdelivr.net/npm/chart.js` |
| **PDF Parsing** | PDF.js | `v3.11.174` from `cdnjs.cloudflare.com` |
| **Fonts** | Google Fonts | DM Sans (400–700), Space Grotesk (400–700) |
| **AI Integration** | REST API (fetch) | Z.ai (GLM) / OpenAI / Custom endpoint |
| **Offline** | Service Worker API | `service-worker.js` |
| **PWA** | Web App Manifest | `manifest.json` |
| **Data Storage** | localStorage API | Browser-native |
| **File I/O** | File API, Blob API, Drag & Drop API | Browser-native |

---

## Progressive Web App (PWA) Implementation

### Manifest (`manifest.json`)

The manifest defines the app as installable with:

- **`name`**: "Portfolio Tracker" (full name)
- **`short_name`**: "Portfolio" (home screen label)
- **`display`**: `"standalone"` — runs without browser chrome
- **`background_color` / `theme_color`**: `#0a0f1a` (dark theme matching)
- **`orientation`**: `"any"` — works in portrait and landscape
- **`icons`**: Inline SVG data URI depicting a bar chart on a green rounded square background
- **`start_url`**: `"./index.html"`

### Service Worker (`service-worker.js`)

Implements a **cache-first for CDN, network-first for local** strategy:

#### Install Event
- Pre-caches three core assets: `./`, `./index.html`, `./manifest.json`
- Calls `self.skipWaiting()` to activate immediately

#### Activate Event
- Deletes old caches that don't match `CACHE_NAME` (`'portfolio-tracker-v1'`)
- Calls `self.clients.claim()` to take control immediately

#### Fetch Event (Routing Logic)

| Request Type | Strategy | Behavior |
|-------------|----------|----------|
| **CDN resources** (different origin) | Cache-first | Check cache → return cached OR fetch → cache response → return |
| **Local files** (same origin) | Network-first | Fetch from network → cache response → return OR fall back to cache |

CDN resources cached include: Tailwind CSS, Chart.js, PDF.js, and Google Fonts CSS. This ensures the app loads fast on repeat visits and works offline (minus AI API calls for PDF parsing).

### PWA Registration (in `index.html`)

```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
```

---

## Data Model & State Management

### Global State Variables

```javascript
let snapshots = [];              // Array of Snapshot objects (chronological order)
let currentSnapshot = null;      // Currently selected snapshot (last by default)
let referenceDate = new Date('2026-03-22');  // Reference point for change calculations
let distributionChart = null;    // Chart.js instance for distribution doughnut
let brokerageChart = null;       // Chart.js instance for brokerage doughnut
let evolutionChart = null;       // Chart.js instance for evolution line chart
let categoryEvolutionChart = null; // Chart.js instance for category evolution
let performanceData = null;      // Historical performance data from analytics CSV
let returnsChart = null;         // Chart.js instance for returns bar chart
let classificationReference = { avanza: [], nordnet: [] }; // Classification lookup table
let rebalancingTargets = { ... }; // Per-asset target percentages
let rebalancingSchedule = { avanza: [], nordnet: [] }; // Computed monthly schedule
let excludedAssets = new Set();  // Set of "assetName|brokerage" keys to exclude from calculations
```

### Snapshot Object Schema

```javascript
{
  date: Date,              // JavaScript Date object
  dateStr: String,         // Formatted date string (e.g., "Mar 22, 2026")
  holdings: [              // Array of Holding objects
    {
      name: String,        // Asset name (e.g., "AMF Företagsobligationsfond")
      brokerage: String,   // "Avanza" or "Nordnet"
      category: String,    // Classification category
      value: Number,       // Market value in SEK
      percentage: Number,  // Percentage of total portfolio
      bucket: Number,      // Bucket assignment (0-3)
      isScheduled: Boolean // Whether included in rebalancing schedule
    }
  ],
  totalValue: Number,      // Sum of all holdings in SEK
  nordnetValue: Number,    // Sum of Nordnet holdings in SEK
  avanzaValue: Number      // Sum of Avanza holdings in SEK
}
```

### Performance Data Schema

```javascript
{
  assets: [
    {
      assetType: String,    // "Aktie" (stock) or fund type
      name: String,         // Asset name
      country: String,      // Country code
      holding: String,      // "Köp" (buy), "Byt" (switch), "Sälj" (sell)
      returns: {
        '1W': Number|null,  // 1-week return %
        '1M': Number|null,  // 1-month return %
        '3M': Number|null,  // 3-month return %
        '1Y': Number|null,  // 1-year return %
        '3Y': Number|null,  // 3-year return %
        '5Y': Number|null   // 5-year return %
      }
    }
  ],
  periodKeys: ['1W', '1M', '3M', '1Y', '3Y', '5Y'],
  periodLabels: ['1 Week', '1 Month', '3 Months', '1 Year', '3 Years', '5 Years']
}
```

---

## UI Layout & Navigation

### Overall Structure

```
┌──────────────────────────────────────────────────┐
│  HEADER (sticky, backdrop-blur, z-50)            │
│  Logo | Title | Last Updated | Actions           │
├──────────────────────────────────────────────────┤
│  UPLOAD ZONE (initial state, centered)            │
│  — OR —                                          │
│  SNAPSHOT CHIPS BAR                              │
│  STATS GRID (4 cards)                            │
│  TAB BAR (7 tabs)                                │
│  TAB CONTENT AREA                                │
└──────────────────────────────────────────────────┘
```

### Background Effects

- **CSS grid overlay**: Subtle green grid lines using `linear-gradient` with `rgba(16, 185, 129, 0.03)` at 40px intervals.
- **Gradient orbs**: Two fixed-position 600×600px circles with 120px blur and 15% opacity, one emerald (top-right), one cyan (bottom-left), creating a subtle ambient glow effect.

---

## Dashboard Header & Global Controls

### Structure

The header is a sticky (`sticky top-0 z-50`) element with semi-transparent background (`bg-[var(--bg-secondary)]/80`) and backdrop blur (`backdrop-blur-lg`).

### Left Side — Branding

- **Logo icon**: 40×40px rounded gradient square (emerald → cyan) containing an SVG bar chart icon.
- **Title**: "Portfolio Tracker" in 18px bold.
- **Subtitle**: "Consolidated Dashboard" in 12px muted text.

### Right Side — Action Buttons (left to right)

| Button | Icon | Function | Visibility |
|--------|------|----------|------------|
| **Last Updated** | — | Text showing `Updated: {date}` | Hidden on mobile (`hidden md:block`) |
| **Template** | Upload arrow | Downloads a pre-filled CSV template file | Label hidden on small screens |
| **Import** | Upload arrow | Opens file picker for `.json` import | Label hidden on small screens |
| **Export** | Download arrow | Exports all snapshots as dated JSON file | Label hidden on small screens |
| **Add Snapshot** | Plus icon | Opens file picker for `.csv` or `.pdf` files | Primary styled button |
| **API** | Gear icon | Opens AI API configuration modal | Label hidden on small screens |

---

## Upload Zone (Initial State)

When no data is loaded, the application displays a centered upload zone occupying `calc(100vh - 12rem)` height:

### Visual Design

- **Dashed border** (2px) with emerald tinted background
- **Hover/drag state**: Border turns emerald, background intensifies
- **Icon**: Cloud upload SVG (64×64px, muted color)
- **Title**: "Import Portfolio Snapshots"
- **Description**: Explains drag-and-drop and Import Data button
- **CTA Button**: "Select CSV Files" (primary styled)
- **Footer**: "Reference point: March 22, 2026"

### Drag & Drop Support

The drop zone listens for:
- `dragover` → adds `.dragover` class (visual feedback)
- `dragleave` → removes `.dragover` class
- `drop` → calls `handleFiles()` with dropped files

---

## Snapshot Management

### Snapshot Chips Bar

Once data is loaded, a horizontal chip bar appears showing all snapshots:

- Each chip displays a calendar icon + formatted date + broker indicators (A/N) + delete (×) icon
- Broker indicators show which brokerages have data: "A" for Avanza (green), "N" for Nordnet (cyan)
- A ↪ symbol indicates data was carried forward from a previous snapshot
- The active/current snapshot chip has a green highlighted style
- Clicking a chip selects that snapshot and refreshes all views
- The × icon deletes a snapshot (with confirmation; prevents deleting the last one)
- A dashed "Add" chip allows adding more snapshots

### Carry-Forward Logic

When a snapshot is missing data for one broker (e.g., only Avanza uploaded), the app automatically carries forward the most recent previous snapshot's data for the missing broker:

1. If both brokers present → no carry-forward needed
2. If Avanza missing → search backwards for previous Avanza data
3. If Nordnet missing → search backwards for previous Nordnet data
4. Carried-forward holdings are marked with a ↪ indicator and reduced opacity
5. Portfolio totals are recalculated with carried-forward data

### Snapshot Selection Logic

When a snapshot is selected:
1. `currentSnapshot` is updated to the selected snapshot
2. Snapshot chips are re-rendered with active state
3. Statistics are recalculated using effective snapshot (with carry-forward)
4. Charts are redrawn
5. Holdings table is refreshed
6. If the rebalancing tab is visible, rebalancing tables are re-rendered

---

## Statistics Grid

Four stat cards displayed in a responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`):

### Card 1: Total Portfolio Value
- **Display**: Formatted SEK value of all holdings combined
- **Subtext**: Change from reference date snapshot (amount + percentage, color-coded green/red) or "Reference point"

### Card 2: Nordnet Holdings
- **Display**: Sum of Nordnet brokerage holdings
- **Subtext**: "{X}% of total"

### Card 3: Avanza Holdings
- **Display**: Sum of Avanza brokerage holdings
- **Subtext**: "{X}% of total"

### Card 4: Number of Holdings
- **Display**: Count of unique holdings
- **Subtext**: "Unique assets"

### Visual Design

Each card has:
- Dark card background with border
- 3px gradient top border (emerald → cyan) via `::before` pseudo-element
- Staggered fade-in animations (100ms, 200ms, 300ms, 400ms delays)

---

## Tab System

Seven tabs rendered as buttons within a pill-shaped container:

| Tab | Label | Default Active |
|-----|-------|---------------|
| `reference` | Reference Table | No |
| `overview` | Overview | **Yes** |
| `holdings` | All Holdings | No |
| `rebalancing` | Rebalancing | No |
| `evolution` | Evolution | No |
| `comparison` | Compare | No |
| `analytics` | Analytics | No |

### Tab Switching Logic

- Active tab button gets `.active` class (elevated background + shadow)
- All tab panels are hidden by default; the active panel is shown
- Each tab triggers specific rendering on activation:
  - **overview**: Renders distribution chart, brokerage chart, category breakdown
  - **holdings**: Renders holdings table
  - **evolution**: Renders value and category evolution charts (requires ≥2 snapshots)
  - **rebalancing**: Renders bucket summary, targets config, and rebalancing tables
  - **comparison**: Populates snapshot selector dropdowns
  - **reference**: Renders editable reference table
  - **analytics**: Renders performance content (if data available)

---

## Overview Tab

Three sections providing portfolio visualization:

### 1. Portfolio Distribution (Doughnut Chart)

- **Chart type**: Doughnut with 65% cutout
- **Data**: Aggregated values per category
- **Colors**: Mapped from `categoryColors` configuration
- **Legend**: Right-aligned with point-style circles
- **Interaction**: Hover offset of 8px

### 2. Holdings by Brokerage (Doughnut Chart)

- **Chart type**: Doughnut with 65% cutout
- **Data**: Two segments — Nordnet value (cyan) and Avanza value (emerald)
- **Legend**: Right-aligned with point-style circles

### 3. Category Breakdown (Progress Bars)

For each category (sorted by value, descending):
- **Badge**: Category name with color-coded background/text
- **Holdings count**: "X holdings"
- **Value**: Large bold SEK formatted amount
- **Percentage**: Right-aligned percentage
- **Progress bar**: 8px height with color fill proportional to percentage

---

## Reference Table Tab

An editable classification reference table that maps asset names to categories and buckets.

### Layout

Two sections side by side on large screens (`grid-cols-1 lg:grid-cols-2`):

#### Section Header
- Title: "Classification Reference Table"
- Subtitle explains the purpose
- Action buttons:
  - **Add Asset (Avanza)**: Adds new row to Avanza section
  - **Add Asset (Nordnet)**: Adds new row to Nordnet section
  - **Export Reference**: Downloads reference table as JSON
  - **Import Reference**: Loads reference table from JSON file
  - **Save Changes**: Persists changes to localStorage and syncs rebalancing targets

#### Per-Asset Row (Grid: `[40px 1fr 180px 160px]`)

| Column | Control | Behavior |
|--------|---------|----------|
| Delete | Red trash icon button | Confirms deletion, removes from array |
| Asset Name | Text input | Updates `name` field on change |
| Category | Select dropdown | Options from `CATEGORIES` array |
| Bucket | Select dropdown | Options: B0 (Sell/Other), B1 (Cash/Short), B2 (Credit), B3 (Equity) |

### Persistence

- Loaded from `localStorage` key `portfolioTracker_reference` on startup
- Falls back to `DEFAULT_REFERENCE` if no saved data
- Saving triggers `syncTargetsFromReference()` to keep rebalancing targets aligned

---

## All Holdings Tab

A filterable, sortable table showing all holdings for the current snapshot.

### Filter Controls

| Filter | Type | Options |
|--------|------|---------|
| **Brokerage** | Select | All Brokerages, Nordnet, Avanza |
| **Category** | Select | All Categories + dynamically populated from current holdings |

### Table Columns

| Column | Description |
|--------|-------------|
| **Exclude** | Checkbox to exclude asset from calculations |
| **Asset Name** | Bold text with carried-forward indicator (↩) if applicable |
| **Brokerage** | "Avanza" or "Nordnet" |
| **Category** | Editable select dropdown with all categories |
| **Bucket** | Editable select dropdown with B0–B3 options |
| **Market Value (SEK)** | Monospace formatted currency |
| **% of Portfolio** | Percentage to 2 decimal places |

### Asset Exclusion Feature

Users can exclude specific assets from all calculations:
- Checkbox in the first column toggles exclusion
- Excluded rows are visually dimmed with strikethrough text
- An info banner shows count of excluded assets with "Clear all" option
- Exclusions are persisted in localStorage under key `portfolioTracker_excludedAssets`
- Excluded assets are ignored in: statistics, charts, rebalancing calculations, and comparisons

### Inline Editing

Category and bucket can be changed directly in the table:
- **Category dropdown**: Select a new category → updates holding and reference table
- **Bucket dropdown**: Select a new bucket → updates holding and reference table
- Changes immediately refresh charts, statistics, and rebalancing tables

### Classification Logic

Each holding is classified at render time:
1. Look up asset name in `classificationReference` for matching brokerage
2. If found → use reference category and bucket
3. If not found → keep CSV category, derive bucket from `categoryRules` mapping

---

## Rebalancing Tab

The most complex tab, providing a full rebalancing planning interface.

### Section 1: Consolidated Bucket Summary Cards

Visual cards showing Avanza and Nordnet bucket allocations side by side.

Each bucket card (0–3) displays:
- **Bucket badge**: Colored badge (B0–B3) with bucket name
- **Avanza bar**: Current allocation with M1 (amber) and Final (emerald) target markers
- **Nordnet bar**: Current allocation with M1 and Final target markers
- **Combined bar**: Weighted average across both brokers
- **Delta indicator**: Shows difference between current and final target (color-coded)

The bars use a visual system with:
- Colored fill showing current allocation percentage
- Amber (▼) marker showing M1 target position
- Emerald (▼) marker showing final target position

### Section 2: Consolidated Bucket Overview Table

A single table showing combined Avanza + Nordnet bucket allocation as percentage of total portfolio:

| Column | Description |
|--------|-------------|
| **Bucket** | Badge with bucket number and name |
| **Current** | Current weighted allocation % |
| **M1 Target** | First month target (highlighted) |
| **Final Target** | Final target allocation (highlighted) |
| **Δ Current → M1** | Difference to M1 target (color-coded) |
| **Δ Current → Final** | Difference to final target (color-coded) |

This provides a quick overview of how the combined portfolio compares to targets.

### Section 2: Final Target Allocation Configuration

Editable grid showing target percentages for each asset per brokerage.

#### Per-Asset Controls
- **Bucket badge**: Small colored B0–B3 badge
- **Asset name**: Truncated text with tooltip
- **Target input**: Number input (0–100, step 0.5) with "%" label
- **Sum display**: Total percentage shown (green if ≈100%, red if not)

#### Actions
- **Reset to Defaults**: Resets both reference table and rebalancing targets to hardcoded defaults (with confirmation)
- **Save Targets**: Validates that each broker's targets sum to ~100% (warns if not), persists to localStorage

#### Live Updates

Changing a target value immediately:
1. Updates the target sum display
2. Recomputes the dynamic rebalancing schedule
3. Re-renders the rebalancing tables and bucket summary

### Section 3: 10-Month Rebalancing Schedule

Separate tables for Avanza and Nordnet, each with:

#### Table Structure

| Column | Description |
|--------|-------------|
| **Asset Name** | Name with bucket badge |
| **Current** | Current allocation percentage |
| **End of Month (M1 Target)** | Highlighted column with target badge |
| **M2–M9** | Interpolated monthly percentages |
| **Final Target** | Highlighted column with target badge |
| **TOTAL row** | Bold row showing column sums (always 100.0%) |

#### Unscheduled Holdings

Assets not in the rebalancing schedule appear below with:
- Muted text styling
- 0.0% for all scheduled months
- Still counted in the TOTAL row's current percentage

---

## Evolution Tab

Two line charts showing portfolio changes over time (requires ≥2 snapshots).

### Portfolio Value Over Time

- **Type**: Line chart with fill
- **Datasets**:
  - Total value (solid emerald line with area fill)
  - Nordnet value (dashed cyan line)
  - Avanza value (dashed emerald line, lighter)
- **Y-axis**: SEK formatted in millions (e.g., "SEK 20.9M")
- **X-axis**: Snapshot date labels

### Category Evolution

- **Type**: Multi-line chart
- **Datasets**: One line per investment category, color-coded
- **Y-axis**: SEK formatted in millions
- **X-axis**: Snapshot date labels

If fewer than 2 snapshots exist, both charts show a placeholder message: "At least 2 snapshots needed to show evolution".

---

## Compare Tab

Side-by-side snapshot comparison with detailed holdings changes.

### Snapshot Selectors

Two dropdown selectors ("From" and "To") populated with all available snapshots. The "To" selector defaults to the latest snapshot.

### Comparison Summary Card

Displays:
- From date and To date
- Starting value and Ending value
- Total change (absolute + percentage, color-coded)

### Holdings Changes Table

| Column | Description |
|--------|-------------|
| **Asset Name** | Bold text |
| **Category** | Color-coded badge |
| **From Value** | SEK formatted (0 if new) |
| **To Value** | SEK formatted (0 if sold) |
| **Change** | NEW/SOLD badge or ±SEK amount |
| **Change %** | +100%/-100% for new/sold, or ±percentage |

#### Change Detection Logic

1. Holdings in "To" snapshot matched by `name + brokerage` key
2. Matched holdings show value change and percentage
3. Holdings in "To" but not "From" → marked as "NEW"
4. Holdings in "From" but not "To" → marked as "SOLD"
5. Results sorted by magnitude of change (descending)

---

## Analytics Tab

Historical performance analysis powered by uploaded CSV data.

### Upload Zone

Similar to the main upload zone but specifically for performance CSVs. Accepts files via:
- File picker button
- Drag and drop

#### Expected CSV Format (European decimal notation)

```csv
Asset Type,Name,Country,Holding,1 Week,1 Month,3 Months,1 Year,3 Years,5 Years
Aktie,Apple,USA,Köp,2,50,3,75,-5,20,15,30,45,60,120,50
```

Return values use **comma as decimal separator** and are split across two fields per period (integer part, decimal part).

### Performance Content (shown after data loaded)

#### 1. Performer Cards (Responsive Grid)

Three cards showing performance for selected periods (1W, 1M, 1Y):

- 🏆 **Best**: Asset name + return percentage (green)
- 📉 **Worst**: Asset name + return percentage (red if negative)
- 📊 **Average**: Asset count + average return

#### 2. Returns Comparison (Horizontal Bar Chart)

- **Type**: Horizontal bar chart
- **Period selector**: 6 buttons (1W, 1M, 3M, 1Y, 3Y, 5Y) with active state
- **Bars**: Green for positive returns, red for negative
- **Sorted**: Descending by return value
- **Tooltips**: Formatted with +/− sign and % suffix
- **Height**: 384px (h-96)

#### 3. Asset Correlation Matrix

A visual matrix computed using **Pearson correlation coefficient**:

- **Input**: Return vectors across available time periods for each asset pair
- **Filter**: Only assets with ≥2 non-null return values are included
- **Color coding**: Green (positive correlation) → Red (negative correlation), intensity proportional to |r|
- **Diagonal**: Always 1.00 with green background
- **Cell size**: Dynamically computed (50–70px) based on number of assets
- **Header labels**: Rotated 180° with vertical writing mode
- **Caveat**: Displayed note about limited data points making correlations indicative

#### 4. Performance Heatmap

A color-coded grid table:

- **Rows**: Assets with country label
- **Columns**: Time periods (1W through 5Y)
- **Colors**: Green intensity for positive returns, red intensity for negative (scaled to maximum absolute value)
- **Format**: "+X.XX%" or "−X.XX%" with rounded cells and 3px spacing
- **Null values**: Displayed as "—" with muted background

#### 5. Detailed Performance Table

Full sortable table with all return data:

| Column | Type | Sortable |
|--------|------|----------|
| **Type** | Badge (STOCK/FUND) | No |
| **Asset Name** | Bold text | No |
| **Country** | Plain text | No |
| **Holding** | Badge (BUY/SWITCH/SELL) | No |
| **1W through 5Y** | Color-coded ±% | Yes (click header) |

**Sorting**: Click a period header to sort descending by that period's returns. Click again to toggle ascending. Sorted column indicated by "⇅" in header.

---

## Data Import & Export

### Export Data (`exportData()`)

Exports a structured bundle (version 1) containing all application data:

```json
{
  "version": 1,
  "exportDate": "2026-04-03T10:30:00.000Z",
  "snapshots": [...],
  "classificationReference": { "avanza": [...], "nordnet": [...] },
  "rebalancingTargets": { "avanza": [...], "nordnet": [...] },
  "excludedAssets": ["assetName|brokerage", ...],
  "performanceData": { "assets": [...], "periodKeys": [...], "periodLabels": [...] }
}
```

Export process:
1. Checks if snapshots exist
2. Bundles all data into structured export object
3. Creates a `Blob` with `application/json` MIME type
4. Generates filename: `portfolio_data_YYYY-MM-DD.json`
5. Creates a temporary `<a>` element, triggers download, cleans up

### Import Data (`handleDataImport()`)

Supports both new structured format and legacy array format:

**New Format (v1)**:
1. Reads JSON file via `FileReader`
2. Parses JSON and validates `version: 1` structure
3. Restores: snapshots, classificationReference, rebalancingTargets, excludedAssets, performanceData
4. Saves all restored data to localStorage
5. Shows dashboard with full data restoration

**Legacy Format (backward compatible)**:
1. Parses JSON as array of snapshots
2. Validates `date` and `holdings` fields
3. Converts date strings back to `Date` objects
4. Sorts snapshots chronologically
5. Sets `currentSnapshot` to the latest
6. Shows dashboard (only snapshots restored)

### Download Template (`downloadTemplate()`)

Generates and downloads a pre-filled CSV template in the pipe-delimited format with semicolon-separated fields, containing sample data for all expected holdings across both brokerages.

---

## CSV Parsing (Avanza Format)

### `parseAvanzaCSV(text, filename)`

Detects Avanza CSV by checking for "Kontonummer" and "Marknadsvärde" in the text.

1. **Date extraction**: Regex matches `YYYY-MM-DD` from filename
2. **Line parsing**: Semicolon-delimited fields; extracts asset name (field index 1) and market value (field index 4)
3. **Filtering**: Skips lines with type "BOLAN" (loans) and zero/negative values
4. **Aggregation**: Sums values for duplicate asset names
5. **Classification**: Each asset is looked up in the Avanza reference table
6. **Output**: Snapshot object with all Avanza holdings, `nordnetValue: 0`

---

## CSV Parsing (Generic Format)

### `parseCSV(text)`

Parses a custom pipe-delimited format with semicolon-separated data fields.

**Line format**:
```
|YYYY-MM-DD;Asset Name;Brokerage;Category;Value;Percentage;Total;NordnetValue;AvanzaValue
```

1. Splits by `|`, then by `;`
2. Extracts date, name, brokerage, category, value, percentage
3. Determines bucket via `findBucketForName()` with CSV category fallback
4. Checks schedule membership via `isInSchedule()`
5. Captures total, Nordnet, and Avanza values from last parsed line

---

## PDF Parsing (Nordnet) & AI Integration

### `parseNordnetPDF(file)`

Uses a multi-stage pipeline with regex-first approach:

1. **PDF text extraction**: PDF.js (`pdfjsLib.getDocument()`) reads all pages and concatenates text content
2. **Regex parsing (primary)**: `parseNordnetPDFText()` attempts to extract holdings using pattern matching:
   - Extracts date from document (format: YYYY-MM-DD)
   - Splits text by account sections (marked by "Le Merle Yann" + account number)
   - Finds fund names and percentages using regex patterns
   - Calculates market value from percentage and section total
   - Extracts cash ("Likvida medel") separately
3. **AI extraction (fallback)**: If regex parsing fails, a debug modal shows extracted text, then optionally calls `callAiForNordnetExtraction()`
4. **Response parsing**: JSON response is parsed, with markdown code fence stripping and multiple repair attempts
5. **Asset aggregation**: Duplicate holdings are summed, "Likvida medel" marked as cash
6. **Classification**: Assets looked up in Nordnet reference table; cash assets default to bucket 1

### Regex Parsing Details

The regex parser handles Swedish number format (space as thousands separator, comma as decimal):
- Pattern 1: Fund name followed by percentage at end of line
- Pattern 2: Alternative with more flexible spacing
- Cash patterns: "Likvida medel" with value and percentage

If regex parsing returns no results, a debug modal appears showing the extracted PDF text, allowing users to copy it for analysis or proceed to AI extraction.

### AI API Configuration

Stored in localStorage with three keys:

| Key | Purpose | Default |
|-----|---------|---------|
| `portfolioTracker_apiProvider` | Provider selection | `"zai"` |
| `portfolioTracker_apiKey` | API key | `""` |
| `portfolioTracker_apiUrl` | Custom URL (if custom) | `""` |
| `portfolioTracker_apiModel` | Custom AI model (if custom) | `""` |

#### Provider Presets

| Provider | API URL | Default Model |
|----------|---------|---------------|
| **Z.ai (GLM)** | `https://api.z.ai/api/paas/v4/chat/completions` | `glm-4.7` |
| **OpenAI** | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| **Custom** | User-defined URL | User-defined model |

**Note**: Z.ai (Zhipu AI) provides the international API endpoint at `api.z.ai`. The China-only endpoint at `open.bigmodel.cn` is not used. Users can select Custom to use any OpenAI-compatible API endpoint with their preferred model (e.g., GLM-4.6V for PDF vision tasks).

#### API Call Format

Standard OpenAI-compatible chat completion:
```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "Return only valid JSON." },
    { "role": "user", "content": "<extraction prompt>" }
  ],
  "temperature": 0.1,
  "max_tokens": 2000
}
```

The extraction prompt instructs the AI to return:
```json
{
  "date": "YYYY-MM-DD",
  "holdings": [
    { "name": "Asset", "value": 12345.67, "isCash": false }
  ]
}
```

### API Settings Modal

A modal dialog with:
- Provider select dropdown (Z.ai, OpenAI, Custom)
- Custom URL and Model fields (shown only for Custom)
- Password-masked API key input
- Save and Cancel buttons
- Current model display

---

## Rebalancing Engine

### Overview

The rebalancing engine computes a **10-month interpolated schedule** that transitions each asset from its current allocation percentage to a configurable final target percentage, following predefined bucket-level trajectories.

### Bucket System

Assets are organized into four buckets with strategic roles:

| Bucket | Name | Investment Role | Color |
|--------|------|----------------|-------|
| **0** | Sell/Other | Assets to be liquidated | Red |
| **1** | Cash/Short | Short-duration, low-risk | Cyan |
| **2** | Credit | Corporate bonds, medium-risk | Amber |
| **3** | Equity | Index funds, higher-risk | Emerald |

### Bucket-Level Monthly Targets

Predefined trajectories for each bucket's total allocation:

| Month | B0 (Sell) | B1 (Cash) | B2 (Credit) | B3 (Equity) |
|-------|-----------|-----------|-------------|-------------|
| M1 | 1.1% | 49.3% | 38.8% | 10.8% |
| M2 | 1.0% | 45.5% | 37.3% | 16.2% |
| M3 | 0.9% | 41.7% | 35.7% | 21.7% |
| M4 | 0.8% | 37.9% | 34.2% | 27.1% |
| M5 | 0.7% | 34.1% | 32.7% | 32.5% |
| M6 | 0.5% | 30.3% | 31.1% | 38.1% |
| M7 | 0.3% | 26.5% | 29.6% | 43.6% |
| M8 | 0.2% | 22.7% | 28.1% | 49.0% |
| M9 | 0.1% | 18.8% | 26.5% | 54.6% |
| M10 | 0.0% | 15.0% | 25.0% | 60.0% |

This represents a strategy of **gradually moving from conservative (mostly cash) to growth-oriented (mostly equity)** over 10 months.

### Schedule Computation (`computeDynamicSchedule(broker)`)

For each broker, the algorithm:

1. **Calculate current percentages**: For each target asset, compute its current share of broker total value
2. **Group by bucket**: Assets sharing a bucket contribute to that bucket's total allocation
3. **Interpolate per-asset schedule**:
   - For each month `m` (0–9):
     - Get bucket-level target percentage `bucketTargets[bucket][m]`
     - Calculate asset's fraction of bucket at current: `fCurrent = asset.current / bucketTotalCurrent`
     - Calculate asset's fraction of bucket at target: `fTarget = asset.target / bucketTotalTarget`
     - Interpolate fraction: `frac = fCurrent + (fTarget - fCurrent) × (m / 9)`
     - Asset's month allocation: `bucketTargets[bucket][m] × frac`
4. **Column sum correction**: Each month's allocations are adjusted so they sum to exactly 100.0% by modifying the largest asset's value

### Rounding

All values rounded to 1 decimal place using `Math.round(v * 10) / 10`.

---

## Classification & Categorization System

### Category Definitions

Nine categories with associated default buckets:

| Category | Default Bucket | Description |
|----------|---------------|-------------|
| Corporate / Credit | 2 | Corporate bond funds |
| Short Duration | 1 | Short-term interest rate funds |
| Sweden Index | 3 | Swedish equity index trackers |
| Global Index | 3 | International equity index trackers |
| Cash | 1 | Liquid cash holdings |
| Energy | 0 | Energy sector stocks (to sell) |
| Materials | 0 | Materials sector stocks (to sell) |
| Other | 0 | Miscellaneous |
| Unassigned | 0 | Not yet classified |

### Classification Flow

When a holding is processed:

1. **Reference table lookup**: Search `classificationReference[broker]` for exact or substring match
2. **Match found**: Use reference category + bucket
3. **No match**: Keep CSV-provided category, derive bucket from `categoryRules`
4. **Final fallback**: Category = "Unassigned", Bucket = 0

### Reference Table Synchronization

When the reference table is saved:
- `syncTargetsFromReference()` ensures every reference asset has a corresponding rebalancing target
- New assets get target = 0%
- Existing targets are preserved by name matching

---

## Chart Visualizations

All charts use **Chart.js** with consistent theming:

### Common Configuration

- **Font**: DM Sans family
- **Grid color**: `rgba(45, 58, 82, 0.5)` (subtle dark border)
- **Tick color**: `#94a3b8` (muted gray)
- **Legend labels**: Muted gray with DM Sans font

### Chart Instances

| Chart | Variable | Type | Canvas ID | Height |
|-------|----------|------|-----------|--------|
| Distribution | `distributionChart` | Doughnut | `distributionChart` | 256px |
| Brokerage | `brokerageChart` | Doughnut | `brokerageChart` | 256px |
| Evolution | `evolutionChart` | Line | `evolutionChart` | 320px |
| Category Evolution | `categoryEvolutionChart` | Line | `categoryEvolutionChart` | 320px |
| Returns | `returnsChart` | Bar (horizontal) | `returnsChart` | 384px |

### Chart Lifecycle

- Each chart variable is checked for existing instance before creation
- If exists, `.destroy()` is called before re-creation
- Charts are rendered with a 100ms `setTimeout` delay to ensure canvas dimensions are settled

---

## Correlation & Statistical Analysis

### Pearson Correlation (`pearsonCorrelation(x, y)`)

Computes the Pearson product-moment correlation coefficient between two return vectors:

$$r = \frac{\sum_{i=1}^{n}(x_i - \bar{x})(y_i - \bar{y})}{\sqrt{\sum_{i=1}^{n}(x_i - \bar{x})^2 \cdot \sum_{i=1}^{n}(y_i - \bar{y})^2}}$$

- Returns 0 for insufficient data or zero denominator
- Only uses overlapping non-null period returns
- Requires ≥2 data points per pair

### Color Mapping

- Positive correlation: Green with opacity `|r| × 0.5`
- Negative correlation: Red with opacity `|r| × 0.5`
- Diagonal: Fixed green background with "1.00"

---

## Performance Analytics

### CSV Parsing (`parsePerformanceCSV(text)`)

Handles European decimal format where `15,30%` is split across two CSV fields as `15` and `30`:

1. Split line by `,` (comma)
2. Fields 0–3: Asset type, name, country, holding recommendation
3. Fields 4+: Pairs of fields representing integer and decimal parts of each period's return
4. Concatenate with `.` and parse as float
5. Empty pairs → `null`

### Sorting

Performance table supports column sorting:
- Click a period header → sort descending by that period
- Click again → toggle to ascending
- State tracked via `perfSortKey` and `perfSortAsc` variables
- Null values always sorted to the bottom

### Data Persistence

Performance data is stored in localStorage under key `portfolioTracker_performance` and restored on page load. It renders when the Analytics tab is activated.

---

## Local Storage Persistence

### Storage Keys

| Key | Content | Loaded On |
|-----|---------|-----------|
| `portfolioTracker_snapshots` | Full snapshot array (JSON) | Startup |
| `portfolioTracker_reference` | Classification reference table | Startup |
| `portfolioTracker_rebalancingTargets` | Per-asset target percentages | Startup |
| `portfolioTracker_performance` | Historical performance data | Startup |
| `portfolioTracker_excludedAssets` | Array of excluded asset keys (JSON) | Startup |
| `portfolioTracker_apiKey` | AI API key | On demand |
| `portfolioTracker_apiUrl` | Custom AI URL | On demand |
| `portfolioTracker_apiModel` | Custom AI model | On demand |

### Auto-Save Behavior

- Snapshots are auto-saved whenever `showDashboard()` is called (after import or restore)
- Reference table and rebalancing targets are saved explicitly via Save buttons
- Performance data is saved immediately after CSV upload

### Startup Sequence

```
DOMContentLoaded
  → setupEventListeners()
    → loadReferenceTable()         // Load or default classification reference
    → loadRebalancingTargets()     // Load or default rebalancing targets
    → loadFromLocalStorage()       // Try restoring snapshots
      → if success: showDashboard()
    → setupPerformanceListeners()  // Wire up analytics drag/drop/file inputs
    → loadPerformanceDataFromStorage()  // Try restoring performance data
```

---

## Styling & Theming

### CSS Custom Properties (Design Tokens)

```css
:root {
  --bg-primary: #0a0f1a;       /* Page background */
  --bg-secondary: #111827;      /* Section backgrounds */
  --bg-card: #1a2234;           /* Card backgrounds */
  --bg-elevated: #232d42;       /* Input/highlight backgrounds */
  --fg-primary: #f1f5f9;        /* Main text */
  --fg-secondary: #94a3b8;      /* Secondary text */
  --fg-muted: #64748b;          /* Muted/disabled text */
  --accent-primary: #10b981;    /* Emerald green (primary accent) */
  --accent-secondary: #06b6d4;  /* Cyan (secondary accent) */
  --accent-warning: #f59e0b;    /* Amber (warning) */
  --accent-danger: #ef4444;     /* Red (danger/negative) */
  --border: #2d3a52;            /* Border color */
  --border-subtle: #1e293b;     /* Subtle borders */
}
```

### Typography

- **Body text**: DM Sans (400, 500, 600, 700 weights)
- **Headings**: Space Grotesk (400, 500, 600, 700 weights)
- **Monospace data**: System monospace (via `font-mono` utility)

### Component Styles

#### Cards (`.card`)
- Dark background with border
- 12px border radius
- Backdrop blur filter

#### Buttons
- **Primary** (`.btn-primary`): Emerald gradient, white text, hover lift with shadow
- **Secondary** (`.btn-secondary`): Elevated background, border, hover darken

#### Badges
- Inline-flex with padding, rounded-full (20px radius)
- 11px font, semibold, uppercase, letter-spaced
- Color variants: bucket-1 (cyan), bucket-2 (amber), bucket-3 (emerald), sell (red), other (gray), unassigned (red), new (green)

#### Tables
- Full-width, collapsed borders
- Sticky headers with secondary background
- Hover row highlight with emerald tint
- Sum rows with emphasized styling

#### Progress Bars
- 8px height, rounded, with animated fill transition (0.5s ease)

### Animations

- **Fade-in**: `translateY(20px) → translateY(0)` with opacity, 0.5s ease
- **Pulse**: Opacity oscillation 1.0 ↔ 0.7, 2s infinite
- **Stagger delays**: 100ms–400ms for sequential card animations
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` disables all animations

### Scrollbar Customization

Custom thin scrollbars (WebKit-only):
- 6px width/height
- Secondary background track
- Border-colored thumb with rounded corners

---

## Accessibility & Responsiveness

### Responsive Breakpoints

| Breakpoint | Grid Behavior | Header Behavior |
|------------|--------------|-----------------|
| **Mobile** (< 640px) | Single column | Button labels hidden |
| **SM** (≥ 640px) | 2-column grids | Button labels shown |
| **LG** (≥ 1024px) | 4-column stats, 2-column layouts | Full display |

### Accessibility Features

- Semantic HTML structure (header, main, table, etc.)
- Focus-visible states on interactive elements
- `prefers-reduced-motion` media query disables animations
- High contrast text on dark backgrounds
- Title/tooltip attributes on icons
- Label elements for form inputs
- Keyboard-navigable tabs and controls

### Mobile Optimizations

- Sticky header with compact layout
- Horizontal scrolling for wide tables (`.table-container` with `overflow-x: auto`)
- Flexible wrapping for button groups (`flex-wrap`)
- Touch-friendly button sizes and spacing

---

## Demo Mode

The application includes a built-in demo mode accessible via URL parameter `?demo`:

```javascript
function checkUrlParams() {
  if (window.location.search.includes('demo')) loadDemoData();
}
```

Demo data includes 18 holdings across both brokerages with a total value of ~SEK 20.9M, dated March 22, 2026.

---

## Summary of Key Design Decisions

1. **Single-file architecture**: Maximizes portability and simplicity at the cost of maintainability for large codebases.
2. **localStorage persistence**: No server needed, but limited to ~5MB storage (sufficient for typical use).
3. **Smart PDF parsing**: Regex-first approach for Nordnet PDFs with AI fallback for complex documents, reducing API costs and improving reliability.
4. **Dynamic schedule computation**: Rebalancing schedules are recalculated on every change, ensuring consistency with current portfolio state.
5. **Client-side correlation**: Statistical analysis runs entirely in-browser using Pearson correlation on available return periods.
6. **Swedish locale formatting**: Currency uses Swedish number format (`sv-SE` locale) with space as thousands separator.
7. **European CSV format**: Performance CSV parsing handles comma-as-decimal notation native to European financial exports.
8. **Carry-forward logic**: Missing broker data in snapshots is automatically filled from previous snapshots, enabling partial uploads.
9. **Asset exclusion**: Users can exclude specific assets from calculations while preserving data, useful for isolating specific holdings.
