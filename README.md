# Portfolio Tracker (HTML)

A standalone, single-file HTML application for tracking and analyzing investment portfolio performance across multiple brokerage accounts. Built with vanilla JavaScript, Chart.js, and Tailwind CSS, it provides a complete dashboard for portfolio management without requiring any build tools or servers.

![Portfolio Tracker](https://img.shields.io/badge/Version-1.0.0-green)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/License-Private-red)

## 🌟 Features

### Dashboard Overview
- **Total Portfolio Value** with real-time calculations
- **Brokerage Breakdown** - Track holdings across Nordnet and Avanza
- **Holdings Count** - Monitor number of unique assets
- **Reference Point Tracking** - Compare against a baseline date (default: March 22, 2026)

### Portfolio Analysis
- **Portfolio Distribution Chart** - Visual breakdown by category
- **Brokerage Allocation** - Pie chart showing Nordnet vs Avanza split
- **Category Breakdown** - Detailed view with progress bars and percentages

### Holdings Management
- **Complete Holdings Table** with sortable data
- **Editable Categories** - Update asset classifications on the fly
- **Editable Buckets** - Assign holdings to 3-bucket strategy
- **Filter by Brokerage** - View Nordnet or Avanza holdings separately
- **Filter by Category** - Focus on specific asset classes
- **Change Tracking** - See value changes from reference point

### 3-Bucket Rebalancing Strategy
- **10-Month Rebalancing Schedule** - Pre-configured target allocations
- **Bucket Summary** - Cash/Short, Credit, and Equity buckets
- **Consolidated View** - See both accounts' rebalancing targets
- **Current vs Target Comparison** - Identify over/under-allocated assets
- **Unscheduled Holdings** - Highlight assets not in the schedule

### Evolution Tracking
- **Portfolio Value Over Time** - Line chart showing historical performance
- **Category Evolution** - Track how allocations change over time
- **Multi-Snapshot Support** - Upload multiple CSV files to track progress

### Comparison Tools
- **Snapshot Comparison** - Compare any two snapshots side-by-side
- **Value Changes** - See exact differences between time periods
- **New/Sold Holdings** - Easily identify added or removed positions
- **Percentage Changes** - Calculate growth rates

### Data Management
- **CSV Import** - Upload brokerage export files
- **Drag & Drop Support** - Easy file handling
- **JSON Export** - Save your session data for later
- **JSON Import** - Restore previous sessions
- **Demo Mode** - Load sample data to explore features

## 🚀 Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, Edge)
- No server or build process required

### Installation

1. **Download the file**
   ```bash
   # Clone the repository
   git clone https://github.com/YannSTHLM/portfolio-tracker-html.git
   cd portfolio-tracker-html
   ```

2. **Open in Browser**
   Simply open `index.html` in your web browser:
   ```bash
   # On macOS
   open index.html
   
   # On Windows/Linux
   start index.html  # Windows
   xdg-open index.html  # Linux
   ```

3. **Or use a local server (optional)**
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx serve
   ```

Then visit `http://localhost:8000` in your browser.

## 📖 How to Use

### 1. Import Your Data

**CSV File Format:**
The tracker expects CSV files with the following pipe-delimited format:
```
|Date|Asset Name|Brokerage|Category|Value|Percentage|Total|Nordnet Value|Avanza Value|
|2026-03-22|AMF Företagsobligationsfond|Avanza|Corporate / Credit|4907776.25|23.51|20874792.50|0|13242075.39|
```

**Steps:**
1. Click the "Add Snapshot" button or drag & drop CSV files
2. Import multiple files to create a timeline
3. The first file imported will be your reference point

### 2. Navigate the Dashboard

**Overview Tab:**
- View portfolio distribution charts
- Check brokerage breakdown
- Review category allocations

**All Holdings Tab:**
- Browse all your holdings
- Edit categories using dropdown menus
- Assign buckets for rebalancing strategy
- Filter by brokerage or category

**Rebalancing Tab:**
- View 10-month rebalancing schedule
- Compare current vs target allocations
- See bucket summaries for each account
- Identify unscheduled holdings

**Evolution Tab:**
- Track portfolio value over time
- View category evolution charts
- Requires 2+ snapshots

**Comparison Tab:**
- Select two snapshots to compare
- See detailed breakdown of changes
- Identify new, sold, and modified holdings

### 3. Save and Restore Your Data

**Export Data:**
1. Click "Export Data" button
2. Download JSON file with all snapshots
3. Store backup safely

**Import Data:**
1. Click "Import Data" button
2. Select previously exported JSON file
3. Restore all snapshots and settings

### 4. Edit Holdings

1. Go to "All Holdings" tab
2. Use dropdown menus to change:
   - Category (Corporate / Credit, Global Index, etc.)
   - Bucket (1: Cash/Short, 2: Credit, 3: Equity, 0: Sell/Other)
3. Changes reflect immediately in charts and tables

## 🎯 Categories

The tracker supports the following asset categories:

- **Corporate / Credit** - Corporate bond funds and credit instruments
- **Short Duration** - Short-term fixed income and money market funds
- **Sweden Index** - Swedish stock market index funds
- **Global Index** - International stock market index funds
- **Cash** - Cash holdings and cash equivalents
- **Energy** - Energy sector holdings
- **Materials** - Materials sector holdings
- **Other** - Other asset classes
- **Unassigned** - Holdings without category assignment

## 📊 3-Bucket Strategy

The tracker implements a 10-month rebalancing strategy moving from a conservative to equity-heavy allocation:

### Buckets
1. **Bucket 1 - Cash/Short** (Cyan)
   - Short-term fixed income
   - Money market funds
   - Cash equivalents

2. **Bucket 2 - Credit** (Amber)
   - Corporate bond funds
   - Credit instruments
   - Medium-term fixed income

3. **Bucket 3 - Equity** (Emerald)
   - Stock market indices
   - Equity funds
   - Growth investments

4. **Bucket 0 - Sell/Other** (Red)
   - Holdings to be reduced or sold
   - Non-strategic positions

### Schedule
The rebalancing schedule runs from Month 1 to Month 10, gradually:
- Reducing Cash/Short allocations
- Maintaining Credit exposure
- Increasing Equity exposure
- Selling off Other holdings

## 💾 Data Format

### CSV Import Format

Your CSV files should use pipe (`|) as delimiter with the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| Date | Snapshot date (YYYY-MM-DD) | 2026-03-22 |
| Asset Name | Name of holding | AMF Företagsobligationsfond |
| Brokerage | Brokerage name | Avanza, Nordnet |
| Category | Asset category | Corporate / Credit |
| Value | Market value in SEK | 4907776.25 |
| Percentage | % of portfolio | 23.51 |
| Total | Total portfolio value | 20874792.50 |
| Nordnet Value | Total Nordnet holdings | 7632717.11 |
| Avanza Value | Total Avanza holdings | 13242075.39 |

### JSON Export Format

The export includes all snapshots in JSON format:
```json
[
  {
    "date": "2026-03-22T00:00:00.000Z",
    "dateStr": "Mar 22, 2026",
    "holdings": [
      {
        "name": "AMF Företagsobligationsfond",
        "brokerage": "Avanza",
        "category": "Corporate / Credit",
        "value": 4907776.25,
        "percentage": 23.51,
        "bucket": 2,
        "isScheduled": true
      }
    ],
    "totalValue": 20874792.50,
    "nordnetValue": 7632717.11,
    "avanzaValue": 13242075.39
  }
]
```

## 🎨 Features Breakdown

### Charts
- **Distribution Chart** - Doughnut chart showing category breakdown
- **Brokerage Chart** - Doughnut chart showing Nordnet vs Avanza split
- **Evolution Chart** - Line chart tracking portfolio value over time
- **Category Evolution** - Line chart showing how categories change

### Interactive Tables
- **Sortable Holdings** - Sort by value, percentage, or name
- **Editable Cells** - Change categories and buckets inline
- **Filterable** - Filter by brokerage or category
- **Responsive** - Works on desktop and mobile

### Rebalancing Tools
- **Schedule Display** - Shows 10-month target schedule
- **Current vs Target** - Compare actual allocations to targets
- **Bucket Summaries** - See overall bucket allocation by account
- **Unscheduled Detection** - Highlights holdings not in schedule

### Data Persistence
- **Session Export** - Save all data as JSON
- **Session Import** - Restore from JSON backup
- **Multiple Snapshots** - Track portfolio over time
- **Reference Point** - Set baseline for comparisons

## 🔧 Technical Details

### Tech Stack
- **HTML5** - Markup structure
- **CSS3** - Styling with custom CSS variables
- **Vanilla JavaScript** - Application logic (no frameworks)
- **Tailwind CSS** - Utility-first CSS (via CDN)
- **Chart.js** - Data visualization (via CDN)
- **Google Fonts** - DM Sans and Space Grotesk typography

### Browser Compatibility
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Opera 76+

### Performance
- **File Size:** ~45 KB (uncompressed)
- **Load Time:** < 1 second
- **No Dependencies:** No npm install or build process
- **Offline Capable:** Works without internet after initial load

### Customization
- **Color Scheme:** Modify CSS variables in `:root` section
- **Categories:** Add or remove categories in `CATEGORIES` array
- **Buckets:** Update `BUCKETS` object configuration
- **Schedule:** Modify `rebalancingSchedule` object for custom targets

## 📝 Demo Mode

To explore the tracker without your own data:

1. Open the application
2. Add `?demo` to the URL: `index.html?demo`
3. The tracker will load sample data

Or use the "Import Data" button with the included sample CSV file.

## 🤝 Support

### Getting Help
- **Documentation:** This README file
- **Issues:** Report bugs via GitHub Issues
- **Features:** Request features via GitHub Issues

### Common Issues

**Q: My CSV file isn't importing**
- A: Ensure the file uses pipe (`|) as delimiter
- A: Check that all required columns are present
- A: Verify date format is YYYY-MM-DD

**Q: Charts aren't displaying**
- A: Ensure you have internet connection (CDN loading)
- A: Check browser console for errors
- A: Try refreshing the page

**Q: Changes aren't saving**
- A: Use "Export Data" to save your session
- A: Import your exported JSON file to restore
- A: Browser localStorage is not used for persistence

## 📄 License

This is a private repository. All rights reserved.

## 🔮 Future Enhancements

Potential features for future versions:
- [ ] Local storage for automatic session saving
- [ ] Additional chart types (candlestick, heatmap)
- [ ] Performance metrics (CAGR, volatility, Sharpe ratio)
- [ ] Dividend tracking
- [ ] Tax reporting exports
- [ ] Mobile app version
- [ ] Multi-currency support
- [ ] Real-time price updates via API
- [ ] Automated rebalancing recommendations

## 📞 Contact

For questions, suggestions, or issues:
- **Repository:** https://github.com/YannSTHLM/portfolio-tracker-html
- **Author:** YannSTHLM

---

**Built with ❤️ for tracking investment portfolios**