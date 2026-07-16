const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const ollama = require('ollama').default || require('ollama');

const turndownService = new TurndownService();

const port = Number(process.env.PORT || 3000);
const rootDir = __dirname;
const scrapesDir = process.env.SCRAPES_DIR || path.join(rootDir, 'scrapes');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173,http://localhost:5174,http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function configureCors(req, res) {
  const origin = req.headers.origin;

  if (!origin) return true;
  if (!allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) return false;

  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  return true;
}

function normalizePublicUrl(value) {
  const candidate = String(value || '').trim();
  const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isPrivateIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) && (() => {
    const [first, second] = hostname.split('.').map(Number);
    return first === 10 || first === 127 || first === 0 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254);
  })();

  if (!['http:', 'https:'].includes(url.protocol) ||
      hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local') || isPrivateIpv4) {
    throw new Error('Please provide a public http or https URL.');
  }

  return url.toString();
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url.split('?')[0];

  if (!configureCors(req, res)) {
    return sendJson(res, 403, { success: false, error: 'This origin is not allowed to call the API.' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && rawUrl === '/health') {
    return sendJson(res, 200, { success: true, status: 'ok' });
  }

  // Standard scrape endpoint. Fetching from the backend avoids browser CORS proxy dependencies.
  if (req.method === 'POST' && rawUrl === '/api/scrape') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const targetUrl = normalizePublicUrl(payload.url);
        const startedAt = Date.now();
        const response = await axios.get(targetUrl, {
          responseType: 'text',
          timeout: 30000,
          maxRedirects: 5,
          maxContentLength: 4 * 1024 * 1024,
          headers: {
            'User-Agent': 'WebSpy/1.0 (+https://github.com/)',
            'Accept': 'text/html,application/xhtml+xml'
          },
          validateStatus: status => status >= 200 && status < 400
        });
        const html = typeof response.data === 'string' ? response.data : String(response.data || '');

        if (!html.trim()) {
          throw new Error('The target website returned an empty response.');
        }

        return sendJson(res, 200, {
          success: true,
          html,
          stats: {
            loadTime: `${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
            pageSize: `${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`
          }
        });
      } catch (error) {
        console.error('Standard scrape failed:', error.message);
        return sendJson(res, 400, { success: false, error: error.message || 'Unable to fetch the target URL.' });
      }
    });
    return;
  }

  // API Endpoint to save scraped page content as a local JSON file
  if (req.method === 'POST' && rawUrl === '/api/save') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const domain = String(payload.domain || 'page').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'page';
        const timestamp = Date.now();
        const filename = `scraped_${domain}_${timestamp}.json`;
        
        fs.mkdirSync(scrapesDir, { recursive: true });
        
        const filePath = path.join(scrapesDir, filename);
        fs.writeFile(filePath, JSON.stringify(payload, null, 2), (err) => {
          if (err) {
            console.error('Error saving file:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Failed to write file' }));
          }
          console.log(`Saved scrape to ${filePath}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, filename: filename }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // API Endpoint to perform AI-driven web scraping using Playwright and Ollama
  if (req.method === 'POST' && rawUrl === '/api/scrape-ai') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      let browser;
      try {
        const payload = JSON.parse(body);
        const { url: requestedUrl, query, schema } = payload;
        const url = normalizePublicUrl(requestedUrl);

        console.log(`Starting AI scrape for URL: ${url}, Query: "${query || ''}"`);

        // 1. Launch Playwright
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Navigate to the target page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 2. Perform search if query is provided
        if (query) {
          console.log(`Locating search inputs on page for query: "${query}"`);
          const searchInputSelectors = [
            'input[type="search"]',
            'input[placeholder*="search" i]',
            'input[placeholder*="find" i]',
            'input[name="q" i]',
            'input[name="query" i]',
            'input[id*="search" i]',
            'input[class*="search" i]',
            'input[type="text"]'
          ];
          
          let searchInput = null;
          for (const selector of searchInputSelectors) {
            try {
              const el = await page.$(selector);
              if (el && await el.isVisible()) {
                searchInput = el;
                console.log(`Found search input with selector: ${selector}`);
                break;
              }
            } catch (e) {}
          }

          if (searchInput) {
            await searchInput.click();
            await searchInput.fill(query);
            await page.keyboard.press('Enter');
            console.log('Submitted search query. Waiting for navigation/load...');
            
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
              console.log('Network idle wait timed out, continuing...');
            });
          } else {
            console.log('No search input found on page. Proceeding with current page HTML.');
          }
        }

        // Auto-scroll to trigger lazy loading of lists
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 150;
            let timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= scrollHeight || totalHeight > 3000) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          });
        });

        // Get fully rendered HTML
        const html = await page.content();
        await browser.close();
        browser = null;

        // 3. Clean HTML using Cheerio
        const $ = cheerio.load(html);
        $('script, style, svg, iframe, noscript, link, meta, header, footer, nav, aside').remove();
        const cleanedHtml = $('body').html() || '';

        // 4. Convert HTML to Markdown
        const fullMarkdown = turndownService.turndown(cleanedHtml);
        const markdown = fullMarkdown.substring(0, 12000);
        console.log(`Cleaned HTML markdown size: ${markdown.length} characters (truncated from ${fullMarkdown.length})`);

        // 5. Send to Local Ollama
        const systemPrompt = `You are a precise data extraction agent. Extract search list items from the provided markdown content according to the requested data fields.
Return a valid JSON array of objects. Each object should have keys matching the requested data fields. Do not include markdown wraps (like \`\`\`json) in your response. Only return the raw JSON array string.

Requested fields to extract: ${schema || 'Name, Price, Rating'}`;

        const userPrompt = `Target Markdown Content:\n\n${markdown}`;

        console.log('Sending markdown to local Ollama llama3.1:latest...');
        const ollamaResponse = await ollama.chat({
          model: 'llama3.1:latest',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          format: 'json',
          options: {
            temperature: 0.1,
            num_ctx: 4096
          }
        });

        const outputText = ollamaResponse.message.content.trim();
        console.log('Ollama response received successfully.');

        let parsedJson;
        try {
          parsedJson = JSON.parse(outputText);
        } catch (e) {
          console.warn('Ollama output is not pure JSON, trying to extract it:', e);
          const cleanText = outputText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
          parsedJson = JSON.parse(cleanText);
        }

        // Format parsedJson array of objects into paragraphs tab lines
        const paragraphs = [];
        if (Array.isArray(parsedJson)) {
          parsedJson.forEach(item => {
            const parts = Object.entries(item).map(([k, v]) => `${k}: ${v}`);
            paragraphs.push(parts.join(' | '));
          });
        } else if (typeof parsedJson === 'object' && parsedJson !== null) {
          Object.entries(parsedJson).forEach(([k, v]) => {
            if (Array.isArray(v)) {
              v.forEach(subItem => {
                if (typeof subItem === 'object') {
                  const parts = Object.entries(subItem).map(([sk, sv]) => `${sk}: ${sv}`);
                  paragraphs.push(parts.join(' | '));
                } else {
                  paragraphs.push(`${k}: ${subItem}`);
                }
              });
            } else {
              paragraphs.push(`${k}: ${v}`);
            }
          });
        }

        // 6. Save output JSON file locally in /scrapes
        const domain = url.replace('www.', '').split('.')[0] || 'page';
        const timestamp = Date.now();
        const filename = `scraped_${domain}_ai_${timestamp}.json`;
        
        fs.mkdirSync(scrapesDir, { recursive: true });

        const formattedData = {
          title: `AI Search: ${query || url}`,
          description: `AI Extracted items for query: "${query || ''}" using schema: "${schema || 'Name, Price, Rating'}"`,
          keywords: '',
          stats: {
            loadTime: 'AI Engine',
            pageSize: `${(markdown.length / 1024).toFixed(1)} KB`
          },
          ogTags: [],
          headings: [],
          links: [],
          images: [],
          paragraphs: paragraphs
        };

        const filePayload = {
          url,
          query,
          schema,
          timestamp,
          data: formattedData,
          rawAiOutput: parsedJson
        };

        const filePath = path.join(scrapesDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(filePayload, null, 2));
        console.log(`Saved AI scrape results to: ${filePath}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, filename, data: formattedData }));

      } catch (err) {
        console.error('Error during AI scraping:', err);
        if (browser) {
          await browser.close().catch(() => {});
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'An error occurred during AI scrape.' }));
      }
    });
    return;
  }

  // Chatbot Assistant endpoint using local Ollama (llama3.1)
  if (req.method === 'POST' && rawUrl === '/api/chat') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { messages, context } = payload;

        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Messages are required' }));
        }

        console.log('Sending message history to Ollama chat...');
        
        let systemPrompt = "You are AuraScrape AI, a helpful web scraping assistant running on a local LLM (Llama 3.1). You can answer general questions, explain how to use the app, and answer questions about the scraped website content.";
        
        if (context) {
          systemPrompt += `\n\nActive Scrape Context (from the currently viewed page):\nURL: ${context.source || 'N/A'}\nTitle: ${context.title || 'N/A'}\nDescription: ${context.description || 'N/A'}\n\nScraped Paragraphs:\n${(context.textParagraphs || []).slice(0, 15).join('\n')}\n\nScraped Links:\n${(context.links || []).slice(0, 20).map(l => `${l.text}: ${l.url}`).join('\n')}`;
        }

        const ollamaMessages = [
          { role: 'system', content: systemPrompt },
          ...messages
        ];

        const chatResponse = await ollama.chat({
          model: 'llama3.1:latest',
          messages: ollamaMessages,
          options: {
            temperature: 0.7
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, response: chatResponse.message.content }));

      } catch (err) {
        console.error('Error in chat API:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'Error communicating with Ollama' }));
      }
    });
    return;
  }

  // GST Number Scraper endpoint (Playwright + Regex Parsing, NO AI)
  if (req.method === 'POST' && rawUrl === '/api/scrape-gst') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      let browser;
      try {
        const payload = JSON.parse(body);
        const { gstin } = payload;
        
        if (!gstin || gstin.length !== 15) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Valid 15-digit GSTIN is required' }));
        }

        console.log(`Starting headless GST search for: ${gstin}`);

        // Launch Playwright
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        let details = null;
        let scrapeSource = '';

        // --- TRY PORTAL 1: ClearTax ---
        try {
          console.log('Attempting lookup on ClearTax...');
          await page.goto('https://cleartax.in/s/gst-number-search', { waitUntil: 'domcontentloaded', timeout: 20000 });
          
          const searchInput = await page.$('#input');
          if (searchInput) {
            await searchInput.click();
            await searchInput.fill(gstin);
            
            const searchBtn = await page.$('button:has-text("SEARCH")');
            if (searchBtn) {
              await searchBtn.click();
            } else {
              await page.keyboard.press('Enter');
            }
            
            // Wait 5 seconds for results
            await new Promise(r => setTimeout(r, 5000));
            const pageText = await page.innerText('body');
            
            if (pageText.includes('BUSINESS NAME') && !pageText.includes('No records found')) {
              console.log('ClearTax lookup successful. Parsing details...');
              
              const extractClearTaxField = (field) => {
                const regex = new RegExp(`${field}\\r?\\n([^\\r\\n]+)`, 'i');
                const match = pageText.match(regex);
                return match && match[1] ? match[1].trim() : 'Not Found';
              };

              details = {
                gstin: gstin,
                businessName: extractClearTaxField('BUSINESS NAME'),
                legalName: extractClearTaxField('BUSINESS NAME'),
                status: 'Active (Record Found)',
                entityType: extractClearTaxField('ENTITY TYPE'),
                natureOfBusiness: extractClearTaxField('NATURE OF BUSINESS'),
                registrationType: extractClearTaxField('REGISTRATION TYPE'),
                registrationDate: extractClearTaxField('REGISTRATION DATE'),
                address: `${extractClearTaxField('ADDRESS')}, PIN: ${extractClearTaxField('PINCODE')}`
              };
              scrapeSource = 'ClearTax';
            }
          }
        } catch (cleartaxErr) {
          console.warn('ClearTax lookup encountered an error:', cleartaxErr.message);
        }

        // --- TRY PORTAL 2 (FALLBACK): KnowYourGST ---
        if (!details) {
          try {
            console.log('ClearTax lookup failed/empty. Attempting fallback on KnowYourGST...');
            await page.goto('https://www.knowyourgst.com/gst-number-search/', { waitUntil: 'domcontentloaded', timeout: 20000 });
            
            const searchInput = await page.$('#gstnumber');
            if (searchInput) {
              await page.fill('#gstnumber', gstin);
              
              await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
                page.evaluate(() => {
                  const form = document.querySelector('#gstnumber').closest('form');
                  if (form) form.submit();
                })
              ]);
              
              // Wait additional time just in case
              await new Promise(r => setTimeout(r, 4000));
              const pageText = await page.innerText('body');
              
              if (pageText.includes('Business Name') && !pageText.includes('Please check the number')) {
                console.log('KnowYourGST lookup successful. Parsing details...');
                
                const extractKnowYourGstField = (pattern) => {
                  const match = pageText.match(pattern);
                  return match && match[1] ? match[1].trim() : 'Not Found';
                };

                details = {
                  gstin: gstin,
                  businessName: extractKnowYourGstField(/business name\s+([^\n\r]+)/i),
                  legalName: extractKnowYourGstField(/legal name\s+([^\n\r]+)/i),
                  status: 'Active (Record Found)',
                  entityType: extractKnowYourGstField(/entity type\s+([^\n\r]+)/i),
                  natureOfBusiness: extractKnowYourGstField(/nature of business\s+([^\n\r]+)/i),
                  registrationType: extractKnowYourGstField(/registration type\s+([^\n\r]+)/i),
                  registrationDate: extractKnowYourGstField(/registration date\s+([^\n\r]+)/i),
                  address: extractKnowYourGstField(/address\s+([^\n\r]+)/i)
                };
                scrapeSource = 'KnowYourGST';
              }
            }
          } catch (knowyourgstErr) {
            console.warn('KnowYourGST fallback encountered an error:', knowyourgstErr.message);
          }
        }

        await browser.close();
        browser = null;

        if (!details) {
          throw new Error('GST taxpayer details could not be found or retrieved from any public registry.');
        }

        console.log(`GST Details Extracted from ${scrapeSource}:`, details);

        // Standardize output payload matching client-side expectations
        const paragraphs = [
          `GSTIN: ${details.gstin}`,
          `Business Name / Trade Name: ${details.businessName}`,
          `Legal Name: ${details.legalName}`,
          `Status: ${details.status}`,
          `Business Type (Entity Type): ${details.entityType}`,
          `Registration Type: ${details.registrationType}`,
          `Registration Date: ${details.registrationDate}`,
          `Nature of Business Operations: ${details.natureOfBusiness}`,
          `Registered Address: ${details.address}`,
          `Note: Contact details like phone number and email are not publicly accessible in the government GSTN registry due to privacy laws.`
        ];

        const formattedData = {
          title: `GSTIN Lookup: ${gstin}`,
          description: `Business details for GSTIN: ${gstin}`,
          keywords: '',
          stats: {
            loadTime: `Scraped via ${scrapeSource}`,
            pageSize: 'N/A'
          },
          ogTags: [],
          headings: [],
          links: [],
          images: [],
          paragraphs: paragraphs
        };

        // Save local JSON file
        const timestamp = Date.now();
        const filename = `scraped_gst_${gstin}_${timestamp}.json`;
        fs.mkdirSync(scrapesDir, { recursive: true });

        const filePayload = {
          gstin,
          scrapeSource,
          timestamp,
          data: formattedData,
          details
        };

        const filePath = path.join(scrapesDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(filePayload, null, 2));
        console.log(`Saved GST results to: ${filePath}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, filename, data: formattedData }));

      } catch (err) {
        console.error('Error during GST lookup:', err);
        if (browser) {
          await browser.close().catch(() => {});
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'An error occurred during GST lookup.' }));
      }
    });
    return;
  }

  // Company Intelligence Extractor endpoint (Playwright + Regex, NO AI)
  if (req.method === 'POST' && rawUrl === '/api/scrape-intel') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      let browser;
      try {
        const payload = JSON.parse(body);
        const url = normalizePublicUrl(payload.url);

        console.log(`Starting Company Intel scrape for: ${url}`);

        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // --- Helper: extract text from a page ---
        const extractPageData = async (pageUrl) => {
          try {
            const resp = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            if (!resp || resp.status() >= 400) return { text: '', links: [] };
            await new Promise(r => setTimeout(r, 2000));
            const text = await page.innerText('body');
            const links = await page.evaluate(() =>
              Array.from(document.querySelectorAll('a')).map(a => ({
                text: a.textContent?.trim() || '',
                href: a.href || ''
              }))
            );
            return { text, links };
          } catch (e) {
            console.warn(`Could not load ${pageUrl}: ${e.message}`);
            return { text: '', links: [] };
          }
        };

        // Parse base URL
        let baseUrl = url;
        if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'https://' + baseUrl;
        const urlObj = new URL(baseUrl);
        const domain = urlObj.hostname.replace('www.', '');

        // --- Crawl multiple pages ---
        const pagesToCrawl = [
          baseUrl,
          new URL('/contact', baseUrl).href,
          new URL('/contact-us', baseUrl).href,
          new URL('/about', baseUrl).href,
          new URL('/about-us', baseUrl).href,
          new URL('/partners', baseUrl).href
        ];

        let allText = '';
        let allLinks = [];
        let companyName = '';

        for (const pageUrl of pagesToCrawl) {
          console.log(`  Crawling: ${pageUrl}`);
          const data = await extractPageData(pageUrl);
          allText += '\n' + data.text;
          allLinks = allLinks.concat(data.links);

          // Grab title from main page
          if (pageUrl === baseUrl && !companyName) {
            try {
              companyName = await page.title();
            } catch (e) {}
          }
        }

        await browser.close();
        browser = null;

        console.log(`Crawled ${pagesToCrawl.length} pages. Total text: ${allText.length} chars, ${allLinks.length} links`);

        // --- REGEX EXTRACTORS ---

        // Phone numbers (Indian & international formats)
        const phoneRegex = /(?:\+91[\s-]?\d{5}[\s-]?\d{5}|\+91[\s-]?\d{10}|\+\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\b\d{4}[-.\s]?\d{3}[-.\s]?\d{3}\b|\b\d{5}[\s-]?\d{5}\b)/g;
        const phones = [...new Set((allText.match(phoneRegex) || []).map(p => p.trim()))];

        // Email addresses
        const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
        const emails = [...new Set((allText.match(emailRegex) || []).filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.svg')))];

        // GSTIN numbers (15-digit Indian format)
        const gstinRegex = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z\d]\b/g;
        const gstins = [...new Set(allText.match(gstinRegex) || [])];

        // PAN numbers
        const panRegex = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
        const pans = [...new Set((allText.match(panRegex) || []).filter(p => !gstins.some(g => g.includes(p))))];

        // Social Media Links
        const socialPatterns = {
          'LinkedIn': /linkedin\.com/i,
          'Facebook': /facebook\.com/i,
          'Twitter/X': /twitter\.com|x\.com/i,
          'Instagram': /instagram\.com/i,
          'YouTube': /youtube\.com/i,
          'GitHub': /github\.com/i
        };
        const socialLinks = {};
        const uniqueSocialUrls = new Set();
        allLinks.forEach(link => {
          for (const [platform, regex] of Object.entries(socialPatterns)) {
            if (regex.test(link.href) && !uniqueSocialUrls.has(link.href)) {
              uniqueSocialUrls.add(link.href);
              if (!socialLinks[platform]) socialLinks[platform] = [];
              socialLinks[platform].push(link.href);
            }
          }
        });

        // Address patterns (Indian pincode-based)
        const addressRegex = /[\w\s,.\-#/]+(?:\d{6})\b/g;
        const addresses = [...new Set((allText.match(addressRegex) || []).map(a => a.trim()).filter(a => a.length > 15 && a.length < 300))];

        // CIN (Corporate Identification Number)
        const cinRegex = /\b[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/g;
        const cins = [...new Set(allText.match(cinRegex) || [])];

        // Partner / Client mentions (look for known brand patterns near keywords)
        const partnerKeywords = /(?:partners?|clients?|customers?|trusted by|powered by|associated with|collaborat)/i;
        const partnerSection = allText.split('\n').filter(line => partnerKeywords.test(line)).join(' ');

        console.log('Intel extraction complete.');
        console.log(`  Phones: ${phones.length}, Emails: ${emails.length}, GSTINs: ${gstins.length}, Social: ${Object.keys(socialLinks).length} platforms`);

        // --- Build structured output ---
        const paragraphs = [];

        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`🏢  COMPANY OVERVIEW`);
        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`Company Name: ${companyName || 'Not detected'}`);
        paragraphs.push(`Website: ${baseUrl}`);
        paragraphs.push(`Domain: ${domain}`);

        paragraphs.push('');
        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`📞  CONTACT INFORMATION`);
        paragraphs.push(`══════════════════════════════════════`);
        if (phones.length > 0) {
          phones.forEach((p, i) => paragraphs.push(`Phone ${i + 1}: ${p}`));
        } else {
          paragraphs.push('Phone: No phone numbers found on site');
        }
        paragraphs.push('');
        if (emails.length > 0) {
          emails.forEach((e, i) => paragraphs.push(`Email ${i + 1}: ${e}`));
        } else {
          paragraphs.push('Email: No email addresses found on site');
        }

        paragraphs.push('');
        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`📍  ADDRESS / LOCATIONS`);
        paragraphs.push(`══════════════════════════════════════`);
        if (addresses.length > 0) {
          addresses.slice(0, 5).forEach((a, i) => paragraphs.push(`Address ${i + 1}: ${a}`));
        } else {
          paragraphs.push('Address: No structured addresses found');
        }

        paragraphs.push('');
        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`🔢  TAX & REGISTRATION IDs`);
        paragraphs.push(`══════════════════════════════════════`);
        if (gstins.length > 0) {
          gstins.forEach((g, i) => paragraphs.push(`GSTIN ${i + 1}: ${g}`));
        } else {
          paragraphs.push('GSTIN: No GST numbers found on site');
        }
        if (pans.length > 0) {
          pans.forEach((p, i) => paragraphs.push(`PAN ${i + 1}: ${p}`));
        }
        if (cins.length > 0) {
          cins.forEach((c, i) => paragraphs.push(`CIN ${i + 1}: ${c}`));
        }

        paragraphs.push('');
        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`🌐  SOCIAL MEDIA PRESENCE`);
        paragraphs.push(`══════════════════════════════════════`);
        if (Object.keys(socialLinks).length > 0) {
          for (const [platform, urls] of Object.entries(socialLinks)) {
            paragraphs.push(`${platform}: ${urls[0]}`);
          }
        } else {
          paragraphs.push('No social media links found');
        }

        paragraphs.push('');
        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`📊  EXTRACTION SUMMARY`);
        paragraphs.push(`══════════════════════════════════════`);
        paragraphs.push(`Total Phone Numbers: ${phones.length}`);
        paragraphs.push(`Total Email Addresses: ${emails.length}`);
        paragraphs.push(`Total GSTIN Numbers: ${gstins.length}`);
        paragraphs.push(`Total Social Profiles: ${Object.values(socialLinks).flat().length}`);
        paragraphs.push(`Pages Crawled: ${pagesToCrawl.length}`);
        paragraphs.push(`Total Text Analyzed: ${allText.length} characters`);

        const formattedData = {
          title: `Company Intel: ${companyName || domain}`,
          description: `Business intelligence report for ${baseUrl}`,
          keywords: '',
          stats: {
            loadTime: 'Playwright Multi-Page Crawl',
            pageSize: `${pagesToCrawl.length} pages`
          },
          ogTags: [],
          headings: [],
          links: allLinks.slice(0, 100).map(l => ({ text: l.text || '(link)', url: l.href })),
          images: [],
          paragraphs: paragraphs
        };

        // Save local JSON file
        const timestamp = Date.now();
        const filename = `scraped_intel_${domain.replace(/\./g, '_')}_${timestamp}.json`;
        fs.mkdirSync(scrapesDir, { recursive: true });

        const filePayload = {
          url: baseUrl,
          domain,
          timestamp,
          data: formattedData,
          rawIntel: {
            companyName,
            phones,
            emails,
            gstins,
            pans,
            cins,
            socialLinks,
            addresses
          }
        };

        const filePath = path.join(scrapesDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(filePayload, null, 2));
        console.log(`Saved Intel results to: ${filePath}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, filename, data: formattedData }));

      } catch (err) {
        console.error('Error during Intel scrape:', err);
        if (browser) {
          await browser.close().catch(() => {});
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || 'An error occurred during intel scrape.' }));
      }
    });
    return;
  }
  // Serve static files from 'public' folder
  let reqPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, 'public', safePath);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.ico': 'image/x-icon'
      };
      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      sendJson(res, 404, { success: false, error: 'API route or file not found.' });
    }
  });
});

server.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
});

server.on('error', (err) => {
  console.error('API server failed to start:', err);
  process.exit(1);
});
