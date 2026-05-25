"use strict";


// --- AVANZA CSV PARSER ---
function parseAvanzaCSV(text, filename) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  const snapshotDate = dateMatch ? parseDate(dateMatch[1]) : new Date();
  const assetTotals = {};
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(';');
    if (fields.length < 5) continue;
    const name = fields[1].trim();
    const marketValueStr = fields[4].trim().replace(/\s/g, '').replace(',', '.');
    const type = fields.length > 10 ? fields[10].trim() : '';
    if (!name || type === 'BOLAN' || !marketValueStr) continue;
    const value = parseFloat(marketValueStr) || 0;
    if (value <= 0) continue;
    if (assetTotals[name]) { assetTotals[name].value += value; }
    else { assetTotals[name] = { name, value }; }
  }
  const totalValue = Object.values(assetTotals).reduce((s, h) => s + h.value, 0);
  const holdings = Object.values(assetTotals).map(h => {
    const cls = getClassificationFromReference(h.name, 'Avanza');
    return { name: h.name, brokerage: 'Avanza', category: cls.found ? cls.category : 'Unassigned', value: h.value, percentage: (h.value / totalValue) * 100, bucket: cls.found ? cls.bucket : 0 };
  }).sort((a, b) => b.value - a.value);
  if (holdings.length === 0) return null;
  return { date: snapshotDate, dateStr: formatDate(snapshotDate), holdings, totalValue, nordnetValue: 0, avanzaValue: totalValue };
}

// --- NORDNET PDF PARSER (Percentage-based, no AI required) ---
function parseNordnetPDFText(text) {
  // Helper: Parse Swedish number format (space as thousands separator, comma as decimal)
  const parseSwedishNumber = (str) => {
    if (!str) return 0;
    return parseFloat(str.replace(/\s/g, '').replace(',', '.')) || 0;
  };

  // Extract date from document (format: YYYY-MM-DD)
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const snapshotDate = dateMatch ? parseDate(dateMatch[1]) : new Date();

  const assetTotals = {};
  let totalValue = 0;

  // Split text by account sections (marked by "Le Merle Yann" + account number)
  const accountSections = text.split(/Le Merle Yann\s+\d+\s*‧\s*Kontonr\s+\d+/);
  
  for (const section of accountSections) {
    if (!section || section.trim().length === 0) continue;
    
    // Extract total from this section (marked with "Totalt")
    const totalMatch = section.match(/Totalt([\d\s]+,\d{2})/);
    const sectionTotal = totalMatch ? parseSwedishNumber(totalMatch[1]) : 0;
    
    // Extract fund names and their percentages
    // Format: "FundName ... percentage%"
    // Example: "Aktiespararna Topp Sverige A   38,08   SEK   36,68   1 090,58   41 529,38   +1 529,38   8,23 %"
    // Strategy: Find fund name, then find percentage at end of line
    
    // Pattern 1: Find fund name followed by percentage (last number before %)
    const fundPattern = /([A-ZÅÄÖa-zåäö][A-ZÅÄÖa-zåäö\s\-\.]{2,}?)\s+[\d\s,]+\s+SEK\s+[\d\s,]+\s+[\d\s,]+\s+[\d\s,]+\s+[+-][\d\s,]+\s+(\d+,\d{2})\s*%/g;
    let match;
    while ((match = fundPattern.exec(section)) !== null) {
      const fundName = match[1].trim();
      const percentage = parseSwedishNumber(match[2]); // e.g., 8.23
      
      if (percentage > 0 && fundName.length > 2 && !fundName.match(/^\d/) && !fundName.includes('Totalt') && !fundName.includes('Likvida')) {
        // Calculate market value from percentage and section total
        const marketValue = sectionTotal > 0 ? (sectionTotal * percentage / 100) : 0;
        
        if (marketValue > 0) {
          if (assetTotals[fundName]) {
            assetTotals[fundName].value += marketValue;
          } else {
            assetTotals[fundName] = { name: fundName, value: marketValue, isCash: false };
          }
        }
      }
    }
    
    // Pattern 2: Alternative - find fund name with more flexible spacing
    const altFundPattern = /([A-ZÅÄÖa-zåäö][A-ZÅÄÖa-zåäö\s\-\.]{2,}?)\s+[\d\s,]+\s+SEK[\d\s,]+\d+,\d{2}\s*[+-][\d\s,]+\s+(\d+,\d{2})\s*%/g;
    while ((match = altFundPattern.exec(section)) !== null) {
      const fundName = match[1].trim();
      const percentage = parseSwedishNumber(match[2]);
      
      if (percentage > 0 && fundName.length > 2 && !fundName.match(/^\d/) && !fundName.includes('Totalt') && !fundName.includes('Likvida')) {
        const marketValue = sectionTotal > 0 ? (sectionTotal * percentage / 100) : 0;
        
        if (marketValue > 0 && !assetTotals[fundName]) {
          assetTotals[fundName] = { name: fundName, value: marketValue, isCash: false };
        }
      }
    }
    
    // Extract cash (Likvida medel) - extract value directly
    // Format 1: "Likvida medel   33 817,98   6,70 %"
    // Format 2: "Likvida medel33 817,986,70%"
    const cashPatterns = [
      /Likvida medel\s+([\d\s,]+)\s+(\d+,\d{2})\s*%/g,
      /Likvida medel([\d\s,]+)(\d+,\d{2})%/g
    ];
    for (const cashPattern of cashPatterns) {
      while ((match = cashPattern.exec(section)) !== null) {
        const cashValue = parseSwedishNumber(match[1]);
        if (cashValue > 0) {
          if (assetTotals['Likvida medel']) {
            assetTotals['Likvida medel'].value += cashValue;
          } else {
            assetTotals['Likvida medel'] = { name: 'Likvida medel', value: cashValue, isCash: true };
          }
        }
      }
    }
    
    // Add section total to overall total
    if (sectionTotal > 0) {
      totalValue += sectionTotal;
    }
  }

  // Build holdings array
  const holdings = Object.values(assetTotals).map(h => {
    const cls = getClassificationFromReference(h.name, 'Nordnet');
    return {
      name: h.name,
      brokerage: 'Nordnet',
      category: cls.found ? cls.category : (h.isCash ? 'Cash' : 'Unassigned'),
      value: h.value,
      percentage: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
      bucket: cls.found ? cls.bucket : (h.isCash ? 1 : 0)
    };
  }).sort((a, b) => b.value - a.value);

  // Calculate total if not found in PDF
  if (totalValue === 0) {
    totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  }

  if (holdings.length === 0) return null;

  return {
    date: snapshotDate,
    dateStr: formatDate(snapshotDate),
    holdings,
    totalValue,
    nordnetValue: totalValue,
    avanzaValue: 0
  };
}

async function parseNordnetPDF(file) {
  if (typeof pdfjsLib === 'undefined') { alert('PDF.js library not loaded.'); return null; }
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) { 
      const page = await pdf.getPage(i); 
      const content = await page.getTextContent(); 
      fullText += content.items.map(item => item.str).join(' ') + '\n'; 
    }

    console.log('=== NORDNET PDF EXTRACTED TEXT ===');
    console.log(fullText);
    console.log('=== END EXTRACTED TEXT ===');

    // Parse using regex (no AI required)
    const result = parseNordnetPDFText(fullText);
    if (!result) {
      // Show debug modal with extracted text for debugging
      const debugProceed = await showPdfDebugModal(fullText, file.name);
      if (!debugProceed) return null;
      // Try parsing again after user sees the text
      const retryResult = parseNordnetPDFText(fullText);
      if (!retryResult) {
        return null;
      }
      return retryResult;
    }

    console.log('Parsed Nordnet PDF:', result);
    return result;
  } catch (err) { 
    console.error('PDF parsing error:', err); 
    alert('Failed to parse Nordnet PDF: ' + err.message); 
    return null; 
  }
}

function showPdfDebugModal(text, filename) {
  return new Promise((_resolve) => {
    window._pdfDebugResolve = _resolve;
    const modal = document.createElement('div');
    modal.id = 'pdfDebugModal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60';
    modal.innerHTML = `
      <div class="card p-6 w-full max-w-3xl mx-4" style="max-height:80vh;display:flex;flex-direction:column;">
        <h3 class="text-lg font-semibold mb-2">📄 PDF Debug: ${filename}</h3>
        <p class="text-sm text-[var(--fg-muted)] mb-4">Extracted text from PDF. Copy this to share for analysis.</p>
        <textarea id="pdfDebugText" readonly style="flex:1;min-height:300px;background:var(--bg-secondary);color:var(--fg-primary);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;resize:vertical;">${text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')}</textarea>
        <div class="flex gap-3 mt-4">
          <button onclick="navigator.clipboard.writeText(document.getElementById('pdfDebugText').value);this.textContent='Copied!'" class="btn-secondary flex-1">📋 Copy to Clipboard</button>
          <button onclick="document.getElementById('pdfDebugModal').remove();window._pdfDebugResolve(true)" class="btn-primary flex-1">Continue to AI</button>
          <button onclick="document.getElementById('pdfDebugModal').remove();window._pdfDebugResolve(false)" class="btn-secondary flex-1" style="color:var(--accent-danger)">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); _resolve(false); } });
  });
}

function repairJsonString(str) {
  // Remove markdown code fences
  str = str.trim();
  str = str.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  // Remove trailing commas before ] or }
  str = str.replace(/,\s*([\]}])/g, '$1');
  // Remove JavaScript-style comments
  str = str.replace(/\/\/.*$/gm, '');
  str = str.replace(/\/\*[\s\S]*?\*\//g, '');
  // Fix single quotes to double quotes (simple cases)
  // Fix missing quotes around keys (common AI mistake)
  // Fix unquoted numeric values that are actually strings with spaces
  // Replace smart quotes with standard quotes
  str = str.replace(/[\u201C\u201D]/g, '"');
  str = str.replace(/[\u2018\u2019]/g, "'");
  return str;
}

function attemptJsonParse(str) {
  // Try direct parse first
  try { return JSON.parse(str); } catch(e) {}

  // Try extracting JSON object with regex
  const match = str.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch(e) {}
  }

  // Try more aggressive repairs
  let repaired = str;
  
  // Remove any text before first { and after last }
  const firstBrace = repaired.indexOf('{');
  const lastBrace = repaired.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    repaired = repaired.substring(firstBrace, lastBrace + 1);
  }

  // Fix trailing commas (multiple passes)
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');

  // Fix missing commas between array/object elements
  // e.g., "} {" -> "}, {" and "] [" -> "], ["
  repaired = repaired.replace(/}\s*{/g, '}, {');
  repaired = repaired.replace(/]\s*\[/g, '], [');

  try { return JSON.parse(repaired); } catch(e) {}

  // Last resort: try to fix individual lines in the JSON
  // Sometimes AI outputs JSON with extra whitespace or newlines in wrong places
  repaired = repaired.replace(/\r\n/g, '\n');
  // Remove newlines inside string values (between quotes)
  repaired = repaired.replace(/(?<=":[\s]*)\n/g, '');

  try { return JSON.parse(repaired); } catch(e) {}

  return null;
}

async function callAiForNordnetExtraction(text, filename) {
  const apiKey = getApiKey();
  const apiUrl = getApiUrl();

  // Count approximate number of holdings in text to help AI
  const holdingCountHint = (text.match(/SEK|kr|Marknadsvärde|Marknadsvärde|Kursvärde/gi) || []).length;

  const prompt = `CRITICAL TASK: Extract ALL holdings from this Nordnet portfolio PDF text. There are approximately ${holdingCountHint} value references. You MUST find EVERY single holding - do not stop until you have listed them all.

Return ONLY valid JSON with this EXACT format (no extra text, no markdown, no comments):

{"date":"YYYY-MM-DD","holdings":[{"name":"Asset Name","value":12345.67,"isCash":false}]}

MANDATORY RULES:
1. Extract the portfolio date (look for dates near the top of the document)
2. List EVERY holding you can find - funds, stocks, cash, everything
3. For each holding extract: exact name and total market value in SEK (numbers only, no quotes)
4. "Likvida medel" or any cash balance must have isCash:true, all others isCash:false
5. If the same fund appears multiple times, AGGREGATE (sum) their values into one entry
6. Include ALL holdings - do not skip any, even small ones
7. No trailing commas anywhere in the JSON
8. Count your holdings before responding - a typical Nordnet portfolio has 7-10 holdings

TEXT FROM ${filename}:
${text}`;

  try {
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify({ model: getApiModel(), messages: [{ role: 'system', content: 'You are a precise data extraction assistant. Your ONLY job is to extract ALL holdings from financial documents and return them as valid JSON. You must be COMPLETE - list every single holding without exception. Return ONLY valid JSON. No markdown. No code blocks. No trailing commas. No explanations. No text before or after the JSON.' }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4000 }) });
    if (!response.ok) { const errBody = await response.text(); throw new Error('API returned ' + response.status + ': ' + errBody); }
    const result = await response.json();
    let jsonStr = (result.choices?.[0]?.message?.content || '').trim();
    if (!jsonStr) {
      const errMsg = result.error?.message || result.message || 'Empty response from API (possible rate limit or insufficient balance)';
      throw new Error(errMsg);
    }

    // Repair and parse JSON
    jsonStr = repairJsonString(jsonStr);
    const parsed = attemptJsonParse(jsonStr);
    if (parsed) return parsed;

    // If first attempt fails, try a retry with stricter prompt
    console.warn('First JSON parse attempt failed, retrying with stricter prompt...');
    const retryResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify({ model: getApiModel(), messages: [{ role: 'system', content: 'Return ONLY valid JSON. No markdown. No code blocks. No trailing commas.' }, { role: 'user', content: 'The previous response had invalid JSON syntax. Please fix it and return ONLY valid JSON:\n\n' + jsonStr }], temperature: 0.0, max_tokens: 2000 }) });
    if (retryResponse.ok) {
      const retryResult = await retryResponse.json();
      let retryStr = (retryResult.choices?.[0]?.message?.content || '').trim();
      if (retryStr) {
        retryStr = repairJsonString(retryStr);
        const retryParsed = attemptJsonParse(retryStr);
        if (retryParsed) return retryParsed;
      }
    }

    throw new Error('Could not parse AI response as JSON after multiple attempts. Raw response: ' + jsonStr.substring(0, 300));
  } catch (err) { console.error('AI API error:', err); alert('AI API error: ' + err.message); return null; }
}
