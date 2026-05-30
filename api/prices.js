"use strict";

import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// Known ticker mapping
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
  'avanza ränta kort': '0P00019XBG.F',
  'avanza renta kort': '0P00019XBG.F',
  'amundi usa ex mega cap etf': 'XMGAD.XD',
  'xtrackers world ex usa etf': 'EXUS.DE',
  'l&g all commodities etf': 'ETLF.DU',
  'lg all commodities etf': 'ETLF.DU',
  'ubs cmci composite sf etf usd acc': 'CCEUAS.MI',
  'ubs cmci composite sf etf': 'CCEUAS.MI',
};

async function searchYahooTicker(name) {
  try {
    const normalizedName = name.replace(/[äå]/g, 'a').replace(/ö/g, 'o').replace(/[ÄÅ]/g, 'A').replace(/Ö/g, 'O');
    const candidates = [name, `${name}.ST`, normalizedName, `${normalizedName}.ST`];

    for (const candidate of candidates) {
      try {
        const quote = await yahooFinance.quote(candidate);
        if (quote && quote.regularMarketPrice) return candidate;
      } catch (e) { /* next */ }
    }

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=5&newsCount=0`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await response.json();

    if (data.quotes && data.quotes.length > 0) {
      const stMatch = data.quotes.find(q => q.symbol && q.symbol.endsWith('.ST'));
      if (stMatch) return stMatch.symbol;
      const validMatch = data.quotes.find(q => q.symbol && (q.quoteType === 'MUTUALFUND' || q.quoteType === 'ETF' || q.quoteType === 'EQUITY'));
      if (validMatch) return validMatch.symbol;
      if (data.quotes[0].symbol) return data.quotes[0].symbol;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function calculateReturnsFromChart(ticker) {
  try {
    const now = new Date();
    const tenYearsAgo = new Date(now);
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    tenYearsAgo.setDate(1);

    const result = await yahooFinance.chart(ticker, {
      period1: tenYearsAgo.toISOString().split('T')[0],
      period2: now.toISOString().split('T')[0],
      interval: '1mo'
    });

    const quotes = result?.quotes?.filter(q => q.close != null) || [];
    if (quotes.length < 2) return null;

    const latestPrice = quotes[quotes.length - 1].close;
    const latestDate = new Date(quotes[quotes.length - 1].date);

    function findPriceAtDate(targetDate) {
      let closest = null, minDiff = Infinity;
      for (const q of quotes) {
        const qDate = new Date(q.date);
        const diff = Math.abs(qDate - targetDate);
        if (diff < minDiff && q.close != null) { minDiff = diff; closest = q.close; }
      }
      return closest;
    }

    const fiveDaysAgo = new Date(latestDate); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 7);
    const ytdStart = new Date(latestDate.getFullYear(), 0, 1);
    const oneMonthAgo = new Date(latestDate); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const threeMonthsAgo = new Date(latestDate); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneYearAgo = new Date(latestDate); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const threeYearsAgo = new Date(latestDate); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const fiveYearsAgo = new Date(latestDate); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const tenYearsAgoDate = new Date(latestDate); tenYearsAgoDate.setFullYear(tenYearsAgoDate.getFullYear() - 10);

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
  } catch (e) { return null; }
}

async function calculateFiveDayReturn(ticker) {
  try {
    const now = new Date();
    const tenDaysAgo = new Date(now); tenDaysAgo.setDate(tenDaysAgo.getDate() - 12);

    const result = await yahooFinance.chart(ticker, {
      period1: tenDaysAgo.toISOString().split('T')[0],
      period2: now.toISOString().split('T')[0],
      interval: '1d'
    });

    const quotes = result?.quotes?.filter(q => q.close != null) || [];
    if (quotes.length < 2) return null;

    const latestPrice = quotes[quotes.length - 1].close;
    const fiveDaysBack = quotes.length >= 6 ? quotes[quotes.length - 6] : quotes[0];
    if (!fiveDaysBack || fiveDaysBack.close == null || fiveDaysBack.close === 0) return null;

    return ((latestPrice - fiveDaysBack.close) / fiveDaysBack.close) * 100;
  } catch (e) { return null; }
}

async function fetchYahooPrice(ticker, name) {
  try {
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

    let trailingReturns = null;
    try {
      const summary = await yahooFinance.quoteSummary(ticker, { modules: ['fundPerformance'] });
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
      }
    } catch (e) { /* quoteSummary can fail */ }

    if (!trailingReturns) {
      trailingReturns = await calculateReturnsFromChart(ticker);
    }

    if (trailingReturns && (trailingReturns.fiveDay == null || isNaN(trailingReturns.fiveDay))) {
      try {
        const fiveDayReturn = await calculateFiveDayReturn(ticker);
        if (fiveDayReturn != null) {
          if (!trailingReturns) trailingReturns = {};
          trailingReturns.fiveDay = fiveDayReturn;
        }
      } catch (e) { /* ignore */ }
    }

    return {
      name, symbol: quote.symbol || ticker, price, change, changePercent,
      currency: quote.currency || 'SEK', source: 'yahoo',
      trailingReturns, timestamp: new Date().toISOString()
    };
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const timestamp = new Date().toISOString();

    // POST: body with assets array
    if (req.method === 'POST') {
      const { assets } = req.body;
      if (!assets || !Array.isArray(assets)) {
        return res.status(400).json({ error: 'assets array required in body' });
      }

      const results = [];
      const prices = await Promise.all(assets.map(async (asset) => {
        const name = asset.name;
        const key = name.toLowerCase();

        if (key.includes('likvida') || key.includes('cash')) {
          return { name, symbol: 'CASH', price: 1.00, change: 0, changePercent: 0, currency: 'SEK', source: 'cash', timestamp };
        }

        let ticker = asset.symbol || TICKER_MAP[key];
        if (!ticker) {
          const normKey = key.replace(/[äå]/g, 'a').replace(/ö/g, 'o');
          ticker = TICKER_MAP[normKey];
        }
        if (!ticker) {
          ticker = await searchYahooTicker(name);
        }
        if (!ticker) {
          return { name, symbol: null, price: null, change: null, changePercent: null, currency: null, source: 'not_found', error: 'Ticker not found', timestamp };
        }

        const priceData = await fetchYahooPrice(ticker, name);
        return priceData || { name, symbol: ticker, price: null, change: null, changePercent: null, currency: null, source: 'error', error: 'Failed to fetch price', timestamp };
      }));

      prices.forEach(p => { if (p) results.push(p); });
      return res.json({ source: 'Yahoo Finance', timestamp, prices: results });
    }

    // GET: ticker or tickers query param
    if (req.method === 'GET') {
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
      const settled = await Promise.allSettled(tickers.map(async (raw) => {
        const tickerSymbol = raw.trim().toUpperCase();
        if (!tickerSymbol) return { ticker: raw, error: 'Empty ticker' };
        const priceData = await fetchYahooPrice(tickerSymbol, nameParam || tickerSymbol);
        return priceData || { ticker: tickerSymbol, error: 'Failed to fetch price' };
      }));

      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(r.value);
      }

      return res.json({ source: 'Yahoo Finance', timestamp, prices: results });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: error.message });
  }
}