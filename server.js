"use strict";

const express = require('express');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const app = express();

const PORT = 3000;

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files
app.use(express.static(__dirname));

// In-memory cache (15 min TTL)
const priceCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Known ticker mapping for portfolio holdings
const TICKER_MAP = {
  'amf företagsobligationsfond': '0P0001ED4A.ST',
  'amf räntefond kort': '0P00000T7U.ST',
  'amf räntefond mix': '0P0000V3HS.ST',
  'seb frn fond a': '0P0001H70O.ST',
  'seb frn fond': '0P0001H70O.ST',
  'spiltan räntefond sverige': '0P00009NT9.ST',
  'pareto räntefond a': '0P00000F04.ST',
  'pareto räntefond': '0P00000F04.ST',
  'avanza zero': '0P00005U1J.ST',
  'avanza global': '0P0001ECQR.ST',
  'nordnet sverige index': '0P0000J24W.ST',
  'nordea global passive a acc sek': '0P0000XAIN.ST',
  'nordea global passive': '0P0000XAIN.ST',
  'range resources': 'RRC',
  'newmont': 'NEM',
  // ETFs / Funds on European exchanges
  'avanza ränta kort': '0P00019XBG.F',
  'avanza renta kort': '0P00019XBG.F',
  'amundi usa ex mega cap etf': 'XMGAD.XD',
  'xtrackers world ex usa etf': 'EXUS.DE',
  'l&g all commodities etf': 'ETLF.DU',
  'lg all commodities etf': 'ETLF.DU',
  'ubs cmci composite sf etf usd acc': 'CCEUAS.MI',
  'ubs cmci composite sf etf': 'CCEUAS.MI',
};

// Search Yahoo Finance for an unknown ticker
async function searchYahooTicker(name) {
  try {
    // Normalize Swedish characters for search (ä→a, ö→o, å→a)
    const normalizedName = name.replace(/[äå]/g, 'a').replace(/ö/g, 'o').replace(/[ÄÅ]/g, 'A').replace(/Ö/g, 'O');

    // Try Yahoo Finance search via quoteSummary with the name
    // First try common Swedish suffix patterns
    const candidates = [
      name,
      `${name}.ST`,
      normalizedName,
      `${normalizedName}.ST`,
    ];

    for (const candidate of candidates) {
      try {
        const quote = await yahooFinance.quote(candidate);
        if (quote && quote.regularMarketPrice) {
          return candidate;
        }
      } catch (e) {
        // Not found, try next
      }
    }

    // Try using Yahoo search API
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=5&newsCount=0`;
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

    if (data.quotes && data.quotes.length > 0) {
      // Prefer .ST (Stockholm) results
      const stMatch = data.quotes.find(q => q.symbol && q.symbol.endsWith('.ST'));
      if (stMatch) return stMatch.symbol;
      // Otherwise take first valid result
      const validMatch = data.quotes.find(q => q.symbol && q.quoteType === 'MUTUALFUND' || q.quoteType === 'ETF' || q.quoteType === 'EQUITY');
      if (validMatch) return validMatch.symbol;
      if (data.quotes[0].symbol) return data.quotes[0].symbol;
    }

    return null;
  } catch (e) {
    console.error(`    Search failed for "${name}":`, e.message);
    return null;
  }
}

// Calculate trailing returns from historical chart data (works for stocks + funds)
async function calculateReturnsFromChart(ticker) {
  try {
    const now = new Date();
    const tenYearsAgo = new Date(now);
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    tenYearsAgo.setDate(1); // start of month

    const result = await yahooFinance.chart(ticker, {
      period1: tenYearsAgo.toISOString().split('T')[0],
      period2: now.toISOString().split('T')[0],
      interval: '1mo'
    });

    const quotes = result?.quotes?.filter(q => q.close != null) || [];
    if (quotes.length < 2) return null;

    const latestPrice = quotes[quotes.length - 1].close;
    const latestDate = new Date(quotes[quotes.length - 1].date);

    // Helper: find price closest to a target date
    function findPriceAtDate(targetDate) {
      let closest = null;
      let minDiff = Infinity;
      for (const q of quotes) {
        const qDate = new Date(q.date);
        const diff = Math.abs(qDate - targetDate);
        if (diff < minDiff && q.close != null) {
          minDiff = diff;
          closest = q.close;
        }
      }
      return closest;
    }

    const fiveDaysAgo = new Date(latestDate);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 7); // 5 trading days ≈ 7 calendar days
    const ytdStart = new Date(latestDate.getFullYear(), 0, 1);
    const oneMonthAgo = new Date(latestDate);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const threeMonthsAgo = new Date(latestDate);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneYearAgo = new Date(latestDate);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const threeYearsAgo = new Date(latestDate);
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const fiveYearsAgo = new Date(latestDate);
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const tenYearsAgoDate = new Date(latestDate);
    tenYearsAgoDate.setFullYear(tenYearsAgoDate.getFullYear() - 10);

    function calcReturn(pastPrice) {
      if (pastPrice == null || pastPrice === 0) return null;
      return ((latestPrice - pastPrice) / pastPrice) * 100;
    }

    return {
      fiveDay: calcReturn(findPriceAtDate(fiveDaysAgo)),
      ytd: calcReturn(findPriceAtDate(ytdStart)),
      oneMonth: calcReturn(findPriceAtDate(oneMonthAgo)),
      threeMonth: calcReturn(findPriceAtDate(threeMonthsAgo)),
      oneYear: calcReturn(findPriceAtDate(oneYearAgo)),
      threeYear: calcReturn(findPriceAtDate(threeYearsAgo)),
      fiveYear: calcReturn(findPriceAtDate(fiveYearsAgo)),
      tenYear: calcReturn(findPriceAtDate(tenYearsAgoDate))
    };
  } catch (e) {
    console.error(`      chart() failed for ${ticker}:`, e.message);
    return null;
  }
}

// Calculate 5-day return using daily chart data (more accurate than monthly for short-term)
async function calculateFiveDayReturn(ticker) {
  try {
    const now = new Date();
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 12); // 5 trading days ≈ 7-12 calendar days (account for weekends/holidays)

    const result = await yahooFinance.chart(ticker, {
      period1: tenDaysAgo.toISOString().split('T')[0],
      period2: now.toISOString().split('T')[0],
      interval: '1d'
    });

    const quotes = result?.quotes?.filter(q => q.close != null) || [];
    if (quotes.length < 2) return null;

    const latestPrice = quotes[quotes.length - 1].close;
    // Use the 6th data point from the end (5 trading days back)
    const fiveDaysBack = quotes.length >= 6 ? quotes[quotes.length - 6] : quotes[0];
    if (!fiveDaysBack || fiveDaysBack.close == null || fiveDaysBack.close === 0) return null;

    return ((latestPrice - fiveDaysBack.close) / fiveDaysBack.close) * 100;
  } catch (e) {
    return null;
  }
}

// Fetch price + period returns for a single ticker from Yahoo Finance
async function fetchYahooPrice(ticker, name) {
  try {
    // Step 1: Get current price via simple quote (most reliable)
    const quote = await yahooFinance.quote(ticker).catch(() => null);
    if (!quote || !quote.regularMarketPrice) return null;

    const price = quote.regularMarketPrice;
    const prevClose = quote.regularMarketPreviousClose || quote.previousClose;
    const changePercent = quote.regularMarketChangePercent
      ? quote.regularMarketChangePercent
      : (prevClose ? ((price - prevClose) / prevClose * 100) : 0);
    const change = quote.regularMarketChange
      ? quote.regularMarketChange
      : (prevClose ? price - prevClose : 0);

    // Step 2: Try to get trailing returns from quoteSummary (works for mutual funds/ETFs)
    let trailingReturns = null;
    try {
      const summary = await yahooFinance.quoteSummary(ticker, {
        modules: ['fundPerformance']
      });
      const tr = summary?.fundPerformance?.trailingReturns;
      if (tr) {
        trailingReturns = {
          ytd: tr.ytd != null ? tr.ytd * 100 : null,
          oneMonth: tr.oneMonth != null ? tr.oneMonth * 100 : null,
          threeMonth: tr.threeMonth != null ? tr.threeMonth * 100 : null,
          oneYear: tr.oneYear != null ? tr.oneYear * 100 : null,
          threeYear: tr.threeYear != null ? tr.threeYear * 100 : null,
          fiveYear: tr.fiveYear != null ? tr.fiveYear * 100 : null,
          tenYear: tr.tenYear != null ? tr.tenYear * 100 : null
        };
        console.log(`      trailingReturns from quoteSummary`);
      }
    } catch (e) {
      // quoteSummary can fail with schema validation errors - that's OK
      console.log(`      quoteSummary failed (${e.message.substring(0, 50)}), trying chart()...`);
    }

    // Step 3: If no trailing returns from quoteSummary, calculate from historical chart data
    if (!trailingReturns) {
      trailingReturns = await calculateReturnsFromChart(ticker);
      if (trailingReturns) {
        console.log(`      trailingReturns from chart()`);
      }
    }

    // Step 4: Supplement fiveDay from daily chart if missing (quoteSummary doesn't provide it)
    if (trailingReturns && (trailingReturns.fiveDay == null || isNaN(trailingReturns.fiveDay))) {
      try {
        const fiveDayReturn = await calculateFiveDayReturn(ticker);
        if (fiveDayReturn != null) {
          if (!trailingReturns) trailingReturns = {};
          trailingReturns.fiveDay = fiveDayReturn;
          console.log(`      fiveDay supplemented from daily chart()`);
        }
      } catch (e) { /* ignore */ }
    }

    return {
      name: name,
      symbol: quote.symbol || ticker,
      price: price,
      change: change,
      changePercent: changePercent,
      currency: quote.currency || 'SEK',
      source: 'yahoo',
      trailingReturns: trailingReturns,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    console.error(`    ✗ ${name} (${ticker}):`, e.message);
    return null;
  }
}

// Main API endpoint (POST)
app.post('/api/prices', async (req, res) => {
  try {
    const { assets } = req.body;

    if (!assets || !Array.isArray(assets)) {
      return res.status(400).json({ error: 'assets array required in body' });
    }

    const results = [];
    const timestamp = new Date().toISOString();

    console.log(`\n📊 Fetching prices for ${assets.length} assets from Yahoo Finance...`);

    // Resolve tickers for all assets
      const assetTasks = assets.map(async (asset) => {
      const name = asset.name;
      const key = name.toLowerCase();

      // Check cache
      const cached = priceCache.get(key);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`  ✓ ${name} (cached)`);
        return cached.data;
      }

      // Skip cash
      if (key.includes('likvida') || key.includes('cash')) {
        const data = {
          name, symbol: 'CASH', price: 1.00, change: 0,
          changePercent: 0, currency: 'SEK', source: 'cash', timestamp
        };
        priceCache.set(key, { timestamp: Date.now(), data });
        return data;
      }

      // Use symbol from client if provided, otherwise look up ticker
      let ticker = asset.symbol || null;
      if (!ticker) {
        ticker = TICKER_MAP[key];
        // Try normalized key (ä→a, ö→o, å→a) if exact match fails
        if (!ticker) {
          const normKey = key.replace(/[äå]/g, 'a').replace(/ö/g, 'o');
          ticker = TICKER_MAP[normKey];
        }
      } else {
        console.log(`  📌 ${name} - using client symbol: ${ticker}`);
      }

      if (!ticker) {
        // Try to search Yahoo Finance
        console.log(`  🔍 ${name} - searching Yahoo Finance...`);
        ticker = await searchYahooTicker(name);
        if (ticker) {
          console.log(`    → Found: ${ticker}`);
          // Cache the mapping for future use
          TICKER_MAP[key] = ticker;
        }
      }

      if (!ticker) {
        console.log(`  ✗ ${name} - no ticker found`);
        return {
          name, symbol: null, price: null, change: null,
          changePercent: null, currency: null, source: 'not_found',
          error: 'Ticker not found', timestamp
        };
      }

      // Fetch price
      const priceData = await fetchYahooPrice(ticker, name);
      if (priceData) {
        priceCache.set(key, { timestamp: Date.now(), data: priceData });
        console.log(`  ✓ ${name} (${ticker}): ${priceData.price} ${priceData.currency}`);
        return priceData;
      }

      return {
        name, symbol: ticker, price: null, change: null,
        changePercent: null, currency: null, source: 'error',
        error: 'Failed to fetch price', timestamp
      };
    });

    // Fetch all in parallel
    const prices = await Promise.all(assetTasks);
    prices.forEach(p => { if (p) results.push(p); });

    console.log(`\n✅ Done! ${results.filter(r => r.price).length}/${results.length} prices fetched.\n`);

    res.json({
      source: 'Yahoo Finance',
      timestamp,
      prices: results
    });

  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET endpoint — accepts ticker or tickers query param, with optional name
app.get('/api/prices', async (req, res) => {
  try {
    const tickerParam = req.query.ticker;
    const tickersParam = req.query.tickers;
    const nameParam = req.query.name;

    const tickers = tickerParam
      ? (Array.isArray(tickerParam) ? tickerParam : [tickerParam])
      : (tickersParam ? tickersParam.split(',').map(t => t.trim()) : []);

    if (!tickers.length) {
      return res.status(400).json({ error: 'ticker or tickers query param required' });
    }

    const results = [];
    const timestamp = new Date().toISOString();

    console.log(`\n📊 (GET) Fetching prices for ${tickers.length} ticker(s) from Yahoo Finance...`);

    const tasks = tickers.map(async (raw, i) => {
      const tickerSymbol = raw.trim().toUpperCase();
      if (!tickerSymbol) return { ticker: raw, error: 'Empty ticker' };

      // Check cache
      const cached = priceCache.get(tickerSymbol);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`  ✓ ${tickerSymbol} (cached)`);
        return cached.data;
      }

      try {
        const priceData = await fetchYahooPrice(tickerSymbol, nameParam || tickerSymbol);
        if (priceData) {
          priceCache.set(tickerSymbol, { timestamp: Date.now(), data: priceData });
          console.log(`  ✓ ${tickerSymbol}: ${priceData.price} ${priceData.currency}`);
          return priceData;
        }
        return { ticker: tickerSymbol, error: 'Failed to fetch price' };
      } catch (e) {
        console.error(`  ✗ ${tickerSymbol}:`, e.message);
        return { ticker: tickerSymbol, error: e.message };
      }
    });

    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
    }

    res.json({ source: 'Yahoo Finance', timestamp, prices: results });
  } catch (error) {
    console.error('GET /api/prices error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health ping endpoint for server status detection
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Shutdown endpoint
app.post('/api/shutdown', (req, res) => {
  res.json({ status: 'shutting down' });
  setTimeout(() => process.exit(0), 100);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Portfolio Tracker Server running at http://localhost:${PORT}`);
  console.log(`📊 Live prices via Yahoo Finance at http://localhost:${PORT}/api/prices\n`);
});
