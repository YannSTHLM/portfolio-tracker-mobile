const YF = require('yahoo-finance2').default;

async function test() {
  // Try different validation approaches for the failing ticker
  console.log('=== Test 1: validation throwErrors:false ===');
  try {
    const yf1 = new YF({ 
      suppressNotices: ['yahooSurvey'],
      validation: { logErrors: false, logOptionsErrors: false }
    });
    const r = await yf1.quoteSummary('0P0001ED4A.ST', {
      modules: ['price','fundPerformance']
    });
    console.log('SUCCESS, trailingReturns:', r?.fundPerformance?.trailingReturns);
  } catch(e) { 
    console.log('CAUGHT:', e.message.substring(0, 80)); 
  }

  // Test chart() for stocks - calculate returns from historical data
  console.log('\n=== Test 2: chart() for RRC stock ===');
  try {
    const yf2 = new YF({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
    const result = await yf2.chart('RRC', { 
      period1: '2021-01-01',
      period2: new Date().toISOString().split('T')[0],
      interval: '1mo'  // monthly data
    });
    console.log('Chart meta:', result?.meta?.symbol, 'currency:', result?.meta?.currency);
    console.log('Quotes count:', result?.quotes?.length);
    if (result?.quotes?.length > 0) {
      // Show first and last few quotes
      const quotes = result.quotes.filter(q => q.close);
      console.log('Valid quotes:', quotes.length);
      console.log('First:', quotes[0]?.date?.toISOString?.()?.split('T')?.[0], 'close:', quotes[0]?.close);
      console.log('Last:', quotes[quotes.length-1]?.date?.toISOString?.()?.split('T')?.[0], 'close:', quotes[quotes.length-1]?.close);
    }
  } catch(e) { 
    console.log('ERROR:', e.message.substring(0, 100)); 
  }

  // Test chart for a mutual fund too
  console.log('\n=== Test 3: chart() for 0P0001ED4A.ST ===');
  try {
    const yf3 = new YF({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
    const result = await yf3.chart('0P0001ED4A.ST', { 
      period1: '2021-01-01',
      period2: new Date().toISOString().split('T')[0],
      interval: '1mo'
    });
    console.log('Chart meta:', result?.meta?.symbol, 'currency:', result?.meta?.currency);
    const quotes = result?.quotes?.filter(q => q.close) || [];
    console.log('Valid quotes:', quotes.length);
    if (quotes.length > 0) {
      console.log('First:', quotes[0]?.date?.toISOString?.()?.split('T')?.[0], 'close:', quotes[0]?.close);
      console.log('Last:', quotes[quotes.length-1]?.date?.toISOString?.()?.split('T')?.[0], 'close:', quotes[quotes.length-1]?.close);
    }
  } catch(e) { 
    console.log('ERROR:', e.message.substring(0, 100)); 
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });