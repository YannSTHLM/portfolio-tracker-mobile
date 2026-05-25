# How to Import Portfolio Data

The application already supports importing JSON data files via the **Import Data** button in the header.

## Steps to Import Your File

1. Open `index.html` in a browser
2. Click the **Import Data** button in the top-right header
3. Select the file: `/Users/yannlemerle/Sync/Finance/portfolio_data_2026-05-24.json`
4. The data will be loaded including all 44 snapshots, classification references, rebalancing targets, and retirement settings

## What Gets Imported

The JSON file you attached contains:
- **44 portfolio snapshots** from Mar 22 to May 23, 2026
- **Classification reference table** for both Avanza and Nordnet
- **Rebalancing targets** for both brokerages
- **Excluded assets** (BRF WOTAN LGH 1202, Avanza Ränta Kort)
- **Retirement projection data** (manual portfolio value, withdrawal rates, etc.)

## Technical Details

The `handleDataImport()` function in `js/main.js` reads the JSON file, validates it matches the expected structure (has `snapshots` array, etc.), then:
- Loads all snapshots into localStorage
- Loads classification reference
- Loads rebalancing targets  
- Loads excluded assets
- Loads retirement data
- Re-renders the UI

No code changes needed - the import functionality already works.