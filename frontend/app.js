/* ========================================================================== 
   Web Spy Application Logic
   ========================================================================== */

const configuredApiBaseUrl = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : ''))
    .trim()
    .replace(/\/+$/, '');

function apiUrl(path) {
    if (!configuredApiBaseUrl) {
        throw new Error('The API URL is not configured. Set VITE_API_URL in the Vercel project settings.');
    }
    return `${configuredApiBaseUrl}${path}`;
}

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements - Form & Controls
    const scrapeForm = document.getElementById('scrapeForm');
    const urlInput = document.getElementById('urlInput');
    const scrapeBtn = document.getElementById('scrapeBtn');
    const scrapeModeSelect = document.getElementById('scrapeModeSelect');
    const searchQueryGroup = document.getElementById('searchQueryGroup');
    const searchQueryInput = document.getElementById('searchQueryInput');
    const extractSchemaGroup = document.getElementById('extractSchemaGroup');
    const extractSchemaInput = document.getElementById('extractSchemaInput');
    const gstInputGroup = document.getElementById('gstInputGroup');
    const gstInput = document.getElementById('gstInput');

    // DOM Elements - Page States
    const welcomeState = document.getElementById('welcomeState');
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const resultsPanel = document.getElementById('resultsPanel');
    const errorMessage = document.getElementById('errorMessage');
    const retryBtn = document.getElementById('retryBtn');
    const switchProxyBtn = document.getElementById('switchProxyBtn');

    // DOM Elements - Header Info
    const scrapedTitle = document.getElementById('scrapedTitle');
    const scrapedUrl = document.getElementById('scrapedUrl');
    const scrapedUrlText = document.getElementById('scrapedUrlText');

    // DOM Elements - Metrics
    const metricTime = document.getElementById('metricTime');
    const metricSize = document.getElementById('metricSize');
    const metricLinks = document.getElementById('metricLinks');
    const metricImages = document.getElementById('metricImages');

    // DOM Elements - Tabs & Tab counts
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const countLinksTab = document.getElementById('countLinksTab');
    const countImagesTab = document.getElementById('countImagesTab');
    const countParasTab = document.getElementById('countParasTab');

    // DOM Elements - Dynamic Tab Panels
    const metaTitle = document.getElementById('metaTitle');
    const metaDesc = document.getElementById('metaDesc');
    const metaKeywords = document.getElementById('metaKeywords');
    const ogContainer = document.getElementById('ogContainer');
    const headingsOutline = document.getElementById('headingsOutline');
    const linksTableBody = document.getElementById('linksTableBody');
    const linkSearch = document.getElementById('linkSearch');
    const imagesGallery = document.getElementById('imagesGallery');
    const imageSearch = document.getElementById('imageSearch');
    const paragraphsContent = document.getElementById('paragraphsContent');
    const rawJsonCode = document.getElementById('rawJsonCode');

    // DOM Elements - Copy & Export Buttons
    const copyParasBtn = document.getElementById('copyParasBtn');
    const copyJsonBtn = document.getElementById('copyJsonBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportTxtBtn = document.getElementById('exportTxtBtn');

    // DOM Elements - History Drawer
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const modeChoices = document.querySelectorAll('.mode-choice');
    const modeHelper = document.getElementById('modeHelper');
    const scrapeBtnText = document.getElementById('scrapeBtnText');

    // State variables
    let currentScrapedData = null;
    let activeScrapedId = null;

    // Initialize application
    renderHistoryList();

    // Scrape Mode toggle visibility handler
    scrapeModeSelect.addEventListener('change', () => {
        const mode = scrapeModeSelect.value;

        // Hide all conditional groups first
        searchQueryGroup.classList.add('hidden');
        extractSchemaGroup.classList.add('hidden');
        gstInputGroup.classList.add('hidden');
        urlInput.parentElement.classList.remove('hidden');
        urlInput.required = true;

        if (mode === 'intel') {
            // Company Intel Mode: just needs a URL.
        } else if (mode === 'gst') {
            gstInputGroup.classList.remove('hidden');
            urlInput.parentElement.classList.add('hidden');
            urlInput.required = false;
        } else if (mode === 'ai-search') {
            searchQueryGroup.classList.remove('hidden');
            extractSchemaGroup.classList.remove('hidden');
        }

        // Sync quick switcher buttons
        modeChoices.forEach(c => {
            if (c.dataset.modeChoice === mode) {
                c.classList.add('active');
            } else {
                c.classList.remove('active');
            }
        });

        // Set helper text and button label
        if (mode === 'intel') {
            if (modeHelper) modeHelper.textContent = 'Analyze company details, contact info, and tax/social signals.';
            if (scrapeBtnText) scrapeBtnText.textContent = 'Run intel scan';
        } else if (mode === 'gst') {
            if (modeHelper) modeHelper.textContent = 'Query public registries for verified taxpayer registration records.';
            if (scrapeBtnText) scrapeBtnText.textContent = 'Verify GSTIN';
        } else if (mode === 'ai-search') {
            if (modeHelper) modeHelper.textContent = 'Use Llama 3.1 to extract structured schemas from content.';
            if (scrapeBtnText) scrapeBtnText.textContent = 'Run AI Extraction';
        }
    });

    // Wire up quick switcher click listener
    modeChoices.forEach(choice => {
        choice.addEventListener('click', () => {
            const targetMode = choice.dataset.modeChoice;
            scrapeModeSelect.value = targetMode;
            scrapeModeSelect.dispatchEvent(new Event('change'));
        });
    });

    // Scrape submission event
    scrapeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const mode = scrapeModeSelect.value;

        if (mode === 'gst') {
            const gstin = gstInput.value.trim().toUpperCase();
            if (!gstin) {
                showToast('Please enter a GST number', 'error');
                return;
            }
            if (gstin.length !== 15) {
                showToast('GSTIN must be 15 characters long', 'error');
                return;
            }
            
            // Construct target URL using a public lookup service
            const targetUrl = `https://www.mastersindia.co/gst-number-search-and-verification/?gstin=${gstin}`;
            urlInput.value = targetUrl; // update url field in UI for reference
            
            await performGstScrape(gstin);
        } else if (mode === 'intel') {
            const url = urlInput.value.trim();
            if (!url) {
                showToast('Please enter a website URL', 'error');
                return;
            }
            await performIntelScrape(url);
        } else if (mode === 'ai-search') {
            const url = urlInput.value.trim();
            if (!url) return;
            const query = searchQueryInput.value.trim();
            const schema = extractSchemaInput.value.trim();
            await performAiScrape(url, query, schema);
        }
    });

    // Retry event
    retryBtn.addEventListener('click', () => {
        scrapeForm.requestSubmit();
    });

    // Retry through the backend service
    switchProxyBtn.addEventListener('click', () => {
        showToast('Retrying scan...');
        scrapeForm.requestSubmit();
    });

    // Perform Scrape Operation
    async function performScrape(url) {
        showState('loading');
        const startTime = performance.now();

        try {
            // Clean and validate URL
            let targetUrl = url;
            if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = 'https://' + targetUrl;
            }
            urlInput.value = targetUrl; // update in UI

            const response = await fetch(apiUrl('/api/scrape'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: targetUrl })
            });
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.error || `API responded with server error (${response.status})`);
            }

            const result = await response.json();
            const html = result.html;

            if (!html) {
                throw new Error('Target website returned empty content.');
            }

            // Parse HTML
            const parsedData = parseHtmlContent(html, targetUrl);
            parsedData.stats = result.stats || {
                loadTime: `${((performance.now() - startTime) / 1000).toFixed(2)}s`,
                pageSize: formatBytes(new Blob([html]).size)
            };

            // Save to local storage
            const recordId = saveScrapeToLocalStorage(targetUrl, parsedData);
            activeScrapedId = recordId;
            currentScrapedData = parsedData;

            // Update UI Views
            renderScrapedResults(parsedData, targetUrl);
            renderHistoryList();
            showState('results');
            showToast('Scraped page successfully');

            // Auto-save copy to local server directory
            saveScrapeToBackend(targetUrl, parsedData);

        } catch (err) {
            console.error(err);
            errorMessage.textContent = err.message || 'An unknown error occurred while retrieving page content.';
            showState('error');
            showToast('Scrape operation failed', 'error');
        }
    }

    // Parse HTML string using DOMParser
    function parseHtmlContent(htmlString, baseUrl) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        // 1. Meta / Overview Details
        const title = doc.title || doc.querySelector('title')?.textContent?.trim() || 'Untitled Page';

        const descEl = doc.querySelector('meta[name="description"]') ||
            doc.querySelector('meta[property="og:description"]') ||
            doc.querySelector('meta[name="twitter:description"]');
        const description = descEl?.getAttribute('content')?.trim() || 'No description found.';

        const keywordsEl = doc.querySelector('meta[name="keywords"]');
        const keywords = keywordsEl?.getAttribute('content')?.trim() || 'No keywords specified.';

        // OpenGraph Data
        const ogTags = [];
        doc.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach(meta => {
            const property = meta.getAttribute('property') || meta.getAttribute('name');
            const content = meta.getAttribute('content');
            if (property && content) {
                ogTags.push({ property, content: content.trim() });
            }
        });

        // 2. Headings hierarchy (H1 - H6)
        const headings = [];
        doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
            const level = parseInt(h.tagName.substring(1));
            const text = h.textContent?.trim() || '';
            if (text) {
                headings.push({ level, text, tag: h.tagName });
            }
        });

        // 3. Extracted Links
        const links = [];
        const uniqueLinks = new Set();
        doc.querySelectorAll('a').forEach(a => {
            const text = a.textContent?.trim().replace(/\s+/g, ' ') || '';
            let href = a.getAttribute('href')?.trim() || '';

            if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                const absoluteUrl = resolveAbsoluteUrl(baseUrl, href);
                const linkKey = `${text}||${absoluteUrl}`;

                if (!uniqueLinks.has(linkKey)) {
                    uniqueLinks.add(linkKey);
                    links.push({ text: text || '(Empty Anchor Link)', url: absoluteUrl });
                }
            }
        });

        // 4. Extracted Images
        const images = [];
        const uniqueImages = new Set();
        doc.querySelectorAll('img').forEach(img => {
            const alt = img.getAttribute('alt')?.trim() || '';
            const src = img.getAttribute('src')?.trim() || '';

            if (src && !src.startsWith('data:')) {
                const absoluteUrl = resolveAbsoluteUrl(baseUrl, src);
                if (!uniqueImages.has(absoluteUrl)) {
                    uniqueImages.add(absoluteUrl);
                    images.push({ alt: alt || '(No alternative description text)', url: absoluteUrl });
                }
            }
        });

        // 5. Extracted Paragraph Text
        const paragraphs = [];
        doc.querySelectorAll('p').forEach(p => {
            const text = p.textContent?.trim().replace(/\s+/g, ' ') || '';
            if (text && text.length > 5) {
                paragraphs.push(text);
            }
        });

        return {
            title,
            description,
            keywords,
            ogTags,
            headings,
            links,
            images,
            paragraphs
        };
    }

    // Resolve Relative URLs
    function resolveAbsoluteUrl(base, relative) {
        try {
            return new URL(relative, base).href;
        } catch (e) {
            // Fallback relative parser
            if (relative.startsWith('//')) return 'https:' + relative;
            if (relative.startsWith('/')) {
                const baseOrigin = new URL(base).origin;
                return baseOrigin + relative;
            }
            return relative;
        }
    }

    // Render scraped results to the DOM tabs
    function renderScrapedResults(data, url) {
        // Header & Info
        scrapedTitle.textContent = data.title;
        scrapedUrl.href = url;
        scrapedUrlText.textContent = url;

        // Metrics
        metricTime.textContent = data.stats.loadTime;
        metricSize.textContent = data.stats.pageSize;
        metricLinks.textContent = data.links.length;
        metricImages.textContent = data.images.length;

        // Tab Header Counts
        if (countLinksTab) countLinksTab.textContent = data.links.length;
        if (countImagesTab) countImagesTab.textContent = data.images.length;
        if (countParasTab) countParasTab.textContent = data.paragraphs.length;

        // 1. Overview Panel
        metaTitle.textContent = data.title;
        metaDesc.textContent = data.description;
        metaKeywords.textContent = data.keywords;

        // OG Tags
        ogContainer.innerHTML = '';
        if (data.ogTags.length > 0) {
            data.ogTags.forEach(tag => {
                const ogCard = document.createElement('div');
                ogCard.className = 'og-card';
                ogCard.innerHTML = `
          <span class="og-property">${escapeHtml(tag.property)}</span>
          <span class="og-value">${escapeHtml(tag.content)}</span>
        `;
                ogContainer.appendChild(ogCard);
            });
        } else {
            ogContainer.innerHTML = '<p class="text-muted">No Open Graph properties detected.</p>';
        }

        // 2. Headings Panel
        headingsOutline.innerHTML = '';
        if (data.headings.length > 0) {
            data.headings.forEach(h => {
                const headingEl = document.createElement('div');
                headingEl.className = `heading-item level-${h.level}`;
                headingEl.innerHTML = `
          <span class="h-badge h${h.level}">${h.tag}</span>
          <span class="heading-text">${escapeHtml(h.text)}</span>
        `;
                headingsOutline.appendChild(headingEl);
            });
        } else {
            headingsOutline.innerHTML = '<p class="text-muted">No headings (H1-H6) found in the page layout.</p>';
        }

        // 3. Links Panel
        renderLinksTable(data.links);

        // 4. Images Panel
        renderImagesGallery(data.images);

        // 5. Paragraphs / Details Render
        const isGst = data.title && data.title.startsWith('GSTIN Lookup:');
        const isIntel = data.title && data.title.startsWith('Company Intel:');

        if (isGst && data.paragraphs.length > 0) {
            const gstData = {};
            data.paragraphs.forEach(p => {
                if (p.startsWith('Note:')) return;
                const idx = p.indexOf(':');
                if (idx !== -1) {
                    const key = p.substring(0, idx).trim();
                    const val = p.substring(idx + 1).trim();
                    gstData[key] = val;
                }
            });

            const keys = Object.keys(gstData);
            if (keys.length > 0) {
                const tableContainer = document.createElement('div');
                tableContainer.className = 'table-container';
                tableContainer.style.overflowX = 'auto';
                tableContainer.style.marginTop = '15px';

                const table = document.createElement('table');
                table.className = 'data-table';
                
                const thead = document.createElement('thead');
                const headerRow = document.createElement('tr');
                keys.forEach(k => {
                    const th = document.createElement('th');
                    th.textContent = k;
                    th.style.whiteSpace = 'nowrap';
                    headerRow.appendChild(th);
                });
                thead.appendChild(headerRow);
                table.appendChild(thead);

                const tbody = document.createElement('tbody');
                const valueRow = document.createElement('tr');
                keys.forEach(k => {
                    const td = document.createElement('td');
                    const val = gstData[k];
                    if (k === 'Status' && val.toLowerCase() === 'active') {
                        td.innerHTML = `<span class="table-badge success">Active</span>`;
                    } else if (k === 'GSTIN') {
                        td.innerHTML = `<span class="table-badge primary">${escapeHtml(val)}</span>`;
                    } else if (val === 'N/A' || !val) {
                        td.innerHTML = `<span class="table-badge secondary">N/A</span>`;
                    } else {
                        td.textContent = val;
                    }
                    td.style.whiteSpace = 'nowrap';
                    valueRow.appendChild(td);
                });
                tbody.appendChild(valueRow);
                table.appendChild(tbody);

                tableContainer.appendChild(table);

                const tabOverview = document.getElementById('tab-overview');
                const oldGstTable = tabOverview.querySelector('.gst-table-container');
                const oldGstNote = tabOverview.querySelector('.gst-note-container');
                if (oldGstTable) oldGstTable.remove();
                if (oldGstNote) oldGstNote.remove();

                tableContainer.classList.add('gst-table-container');
                tabOverview.prepend(tableContainer);

                const note = data.paragraphs.find(p => p.startsWith('Note:'));
                if (note) {
                    const noteEl = document.createElement('p');
                    noteEl.className = 'text-muted gst-note-container';
                    noteEl.style.marginTop = '15px';
                    noteEl.style.fontSize = '0.85rem';
                    noteEl.textContent = note;
                    tabOverview.appendChild(noteEl);
                }
            }
        } else if (isIntel && data.paragraphs.length > 0) {
            const intelData = {
                'Company Name': '',
                'Website': '',
                'Domain': '',
                'Phone Numbers': [],
                'Emails': [],
                'Addresses': [],
                'GSTINs': [],
                'PANs': [],
                'CINs': [],
                'Social Profiles': []
            };

            const socialPlatforms = ['facebook', 'twitter', 'linkedin', 'instagram', 'youtube', 'github', 'pinterest', 'medium', 'crunchbase', 'social'];

            data.paragraphs.forEach(p => {
                if (!p || p.includes('═══') || p.includes('OVERVIEW') || p.includes('CONTACT') || p.includes('ADDRESS') || p.includes('TAX &') || p.includes('SOCIAL') || p.includes('SUMMARY')) {
                    return;
                }
                const idx = p.indexOf(':');
                if (idx !== -1) {
                    const key = p.substring(0, idx).trim().toLowerCase();
                    const val = p.substring(idx + 1).trim();

                    if (key === 'company name') {
                        intelData['Company Name'] = val;
                    } else if (key === 'website') {
                        intelData['Website'] = val;
                    } else if (key === 'domain') {
                        intelData['Domain'] = val;
                    } else if (key.startsWith('phone')) {
                        if (val !== 'No phone numbers found on site') {
                            intelData['Phone Numbers'].push(val);
                        }
                    } else if (key.startsWith('email')) {
                        if (val !== 'No email addresses found on site') {
                            intelData['Emails'].push(val);
                        }
                    } else if (key.startsWith('address')) {
                        if (val !== 'No structured addresses found') {
                            intelData['Addresses'].push(val);
                        }
                    } else if (key.startsWith('gstin')) {
                        if (val !== 'No GST numbers found on site') {
                            intelData['GSTINs'].push(val);
                        }
                    } else if (key.startsWith('pan')) {
                        intelData['PANs'].push(val);
                    } else if (key.startsWith('cin')) {
                        intelData['CINs'].push(val);
                    } else if (socialPlatforms.some(plat => key.includes(plat))) {
                        if (val !== 'No social media links found') {
                            const platName = p.substring(0, idx).trim();
                            intelData['Social Profiles'].push(`${platName}: ${val}`);
                        }
                    }
                }
            });

            const tableData = {
                'Company Name': intelData['Company Name'] || 'N/A',
                'Website': intelData['Website'] || 'N/A',
                'Domain': intelData['Domain'] || 'N/A',
                'Phone Numbers': intelData['Phone Numbers'].join(', ') || 'None found',
                'Emails': intelData['Emails'].join(', ') || 'None found',
                'Addresses': intelData['Addresses'].join('; ') || 'None found',
                'GSTINs': intelData['GSTINs'].join(', ') || 'None found',
                'PANs': intelData['PANs'].join(', ') || 'None found',
                'CINs': intelData['CINs'].join(', ') || 'None found',
                'Social Profiles': intelData['Social Profiles'].join(', ') || 'None found'
            };

            const fieldIcons = {
                'Company Name': '🏢',
                'Website': '🌐',
                'Domain': '🏷️',
                'Phone Numbers': '📞',
                'Emails': '✉️',
                'Addresses': '📍',
                'GSTINs': '🔢',
                'PANs': '💳',
                'CINs': '📄',
                'Social Profiles': '🔗'
            };

            const rowThemes = {
                'Company Name': { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.02)', text: '#1d4ed8' },
                'Website': { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.02)', text: '#1d4ed8' },
                'Domain': { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.02)', text: '#1d4ed8' },
                'Phone Numbers': { border: '#4f46e5', bg: 'rgba(79, 70, 229, 0.02)', text: '#4338ca' },
                'Emails': { border: '#4f46e5', bg: 'rgba(79, 70, 229, 0.02)', text: '#4338ca' },
                'Addresses': { border: '#4f46e5', bg: 'rgba(79, 70, 229, 0.02)', text: '#4338ca' },
                'GSTINs': { border: '#0d9488', bg: 'rgba(13, 148, 136, 0.02)', text: '#0f766e' },
                'PANs': { border: '#0d9488', bg: 'rgba(13, 148, 136, 0.02)', text: '#0f766e' },
                'CINs': { border: '#0d9488', bg: 'rgba(13, 148, 136, 0.02)', text: '#0f766e' },
                'Social Profiles': { border: '#db2777', bg: 'rgba(219, 39, 119, 0.02)', text: '#be185d' }
            };

            const tableContainer = document.createElement('div');
            tableContainer.className = 'table-container';
            tableContainer.style.marginTop = '15px';
            tableContainer.style.border = '1px solid var(--border-color)';
            tableContainer.style.borderRadius = 'var(--radius-lg)';
            tableContainer.style.boxShadow = 'var(--shadow-md)';
            tableContainer.style.overflow = 'hidden';
            tableContainer.style.backgroundColor = '#ffffff';

            const table = document.createElement('table');
            table.className = 'data-table';
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';

            const tbody = document.createElement('tbody');

            Object.entries(tableData).forEach(([k, val]) => {
                const row = document.createElement('tr');
                const theme = rowThemes[k] || { border: 'var(--border-color)', bg: 'transparent', text: 'var(--text-secondary)' };
                
                // Header (Key) Column
                const th = document.createElement('th');
                th.style.width = '240px';
                th.style.padding = '14px 20px';
                th.style.textAlign = 'left';
                th.style.borderBottom = '1px solid var(--border-color)';
                th.style.background = theme.bg;
                th.style.borderLeft = `4px solid ${theme.border}`;
                th.style.borderRight = '1px solid var(--border-color)';
                th.style.verticalAlign = 'middle';
                
                const flexDiv = document.createElement('div');
                flexDiv.style.display = 'flex';
                flexDiv.style.alignItems = 'center';
                flexDiv.style.gap = '8px';
                flexDiv.style.color = theme.text;
                flexDiv.style.fontWeight = '700';
                flexDiv.style.fontSize = '0.85rem';
                flexDiv.style.letterSpacing = '0.5px';
                flexDiv.style.textTransform = 'uppercase';
                
                const iconSpan = document.createElement('span');
                iconSpan.style.fontSize = '1.1rem';
                iconSpan.textContent = fieldIcons[k] || '•';
                
                const labelSpan = document.createElement('span');
                labelSpan.textContent = k;
                
                flexDiv.appendChild(iconSpan);
                flexDiv.appendChild(labelSpan);
                th.appendChild(flexDiv);

                // Value Column
                const td = document.createElement('td');
                td.style.padding = '14px 20px';
                td.style.borderBottom = '1px solid var(--border-color)';
                td.style.fontSize = '0.9rem';
                td.style.color = 'var(--text-primary)';
                td.style.lineHeight = '1.6';
                td.style.verticalAlign = 'middle';
                
                if (val === 'None found' || val === 'N/A' || val === 'Not detected') {
                    td.innerHTML = `<span class="table-badge secondary" style="background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; padding: 4px 10px; border-radius: var(--radius-sm); font-weight: 600; font-size: 0.75rem; display: inline-block;">${val}</span>`;
                } else if (k === 'Company Name') {
                    td.innerHTML = `<strong style="color: var(--text-primary); font-weight: 700; font-size: 0.95rem;">${escapeHtml(val)}</strong>`;
                } else if (k === 'Website') {
                    td.innerHTML = `<a href="${escapeHtml(val)}" target="_blank" style="color: #2563eb; text-decoration: none; font-weight: 600; border-bottom: 1px dashed rgba(37, 99, 235, 0.4); padding-bottom: 2px; transition: all 0.2s;" onmouseover="this.style.color='#1d4ed8'; this.style.borderBottomColor='#1d4ed8';" onmouseout="this.style.color='#2563eb'; this.style.borderBottomColor='rgba(37, 99, 235, 0.4)';">${escapeHtml(val)}</a>`;
                } else if (k === 'Domain') {
                    td.innerHTML = `<code style="font-family: var(--font-mono); color: #0d9488; background: #f0fdf4; padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid #bbf7d0; font-weight: 600; font-size: 0.8rem;">${escapeHtml(val)}</code>`;
                } else if (k === 'Phone Numbers' || k === 'Emails') {
                    const items = val.split(', ').map(item => `<span class="table-badge info" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 4px 10px; border-radius: var(--radius-sm); font-weight: 600; font-size: 0.75rem; display: inline-block; margin-right: 6px; margin-bottom: 4px; box-shadow: var(--shadow-sm);">${escapeHtml(item)}</span>`).join('');
                    td.innerHTML = items;
                } else if (k === 'GSTINs' || k === 'PANs' || k === 'CINs') {
                    const items = val.split(', ').map(item => `<span class="table-badge primary" style="background: #e6fffa; color: #0d9488; border: 1px solid #b2f5ea; padding: 4px 10px; border-radius: var(--radius-sm); font-weight: 600; font-size: 0.75rem; display: inline-block; margin-right: 6px; margin-bottom: 4px; box-shadow: var(--shadow-sm);">${escapeHtml(item)}</span>`).join('');
                    td.innerHTML = items;
                } else if (k === 'Social Profiles') {
                    const items = val.split(', ').map(item => {
                        const idx = item.indexOf(':');
                        const label = idx !== -1 ? item.substring(0, idx) : 'Link';
                        const url = idx !== -1 ? item.substring(idx + 1).trim() : item;
                        return `<a href="${escapeHtml(url)}" target="_blank" class="table-badge success" style="background: #fdf2f8; color: #db2777; border: 1px solid #fbcfe8; padding: 4px 10px; border-radius: var(--radius-sm); font-weight: 600; font-size: 0.75rem; display: inline-block; margin-right: 6px; margin-bottom: 4px; text-decoration: none; box-shadow: var(--shadow-sm); transition: all 0.2s;" onmouseover="this.style.background='#fce7f3'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='#fdf2f8'; this.style.transform='none';">${escapeHtml(label)}</a>`;
                    }).join('');
                    td.innerHTML = items;
                } else if (k === 'Addresses') {
                    const items = val.split('; ').map(item => `<div style="margin-bottom: 6px; color: var(--text-secondary); display: flex; align-items: flex-start; gap: 6px;"><span style="color: #ef4444; margin-top: 1px;">📍</span><span>${escapeHtml(item)}</span></div>`).join('');
                    td.innerHTML = items || 'N/A';
                } else {
                    td.textContent = val;
                }

                row.appendChild(th);
                row.appendChild(td);
                tbody.appendChild(row);
            });

            table.appendChild(tbody);
            tableContainer.appendChild(table);

            const tabOverview = document.getElementById('tab-overview');
            const oldIntelTable = tabOverview.querySelector('.intel-table-container');
            const oldIntelSummary = tabOverview.querySelector('.intel-summary-container');
            if (oldIntelTable) oldIntelTable.remove();
            if (oldIntelSummary) oldIntelSummary.remove();

            tableContainer.classList.add('intel-table-container');
            tabOverview.prepend(tableContainer);

            const summaryWrapper = document.createElement('div');
            summaryWrapper.classList.add('intel-summary-container');
            summaryWrapper.style.marginTop = '24px';

            const summaryTitle = document.createElement('h4');
            summaryTitle.textContent = 'Extraction Stats & Metadata';
            summaryTitle.style.marginBottom = '12px';
            summaryWrapper.appendChild(summaryTitle);

            const summaryList = document.createElement('div');
            summaryList.style.display = 'grid';
            summaryList.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
            summaryList.style.gap = '10px';

            data.paragraphs.forEach(p => {
                if (p.includes('Total') || p.includes('Pages Crawled') || p.includes('Total Text Analyzed')) {
                    const item = document.createElement('div');
                    item.className = 'paragraph-item';
                    item.style.padding = '8px 12px';
                    item.textContent = p;
                    summaryList.appendChild(item);
                }
            });

            summaryWrapper.appendChild(summaryList);
            tabOverview.appendChild(summaryWrapper);
        } else {
            if (paragraphsContent) {
                paragraphsContent.innerHTML = '';
                if (data.paragraphs.length > 0) {
                    data.paragraphs.forEach(p => {
                        const pEl = document.createElement('div');
                        pEl.className = 'paragraph-item';
                        pEl.textContent = p;
                        paragraphsContent.appendChild(pEl);
                    });
                } else {
                    paragraphsContent.innerHTML = '<p class="text-muted">No paragraphs of text body content found.</p>';
                }
            }
        }

        // 6. JSON Panel
        const cleanOutput = {
            source: url,
            title: data.title,
            description: data.description,
            keywords: data.keywords,
            stats: data.stats,
            ogProperties: data.ogTags,
            headings: data.headings,
            links: data.links,
            images: data.images,
            textParagraphs: data.paragraphs
        };
        rawJsonCode.textContent = JSON.stringify(cleanOutput, null, 2);
        
        // Render visual analytics
        renderJsonAnalytics(cleanOutput);
    }

    // Render Links Helper
    function renderLinksTable(links, filterText = '') {
        linksTableBody.innerHTML = '';
        const query = filterText.toLowerCase().trim();

        const filtered = links.filter(link =>
            link.text.toLowerCase().includes(query) ||
            link.url.toLowerCase().includes(query)
        );

        if (filtered.length > 0) {
            filtered.forEach(link => {
                const row = document.createElement('tr');
                row.innerHTML = `
          <td><span class="link-anchor">${escapeHtml(link.text)}</span></td>
          <td><a href="${escapeHtml(link.url)}" target="_blank" class="link-url">${escapeHtml(link.url)}</a></td>
        `;
                linksTableBody.appendChild(row);
            });
        } else {
            linksTableBody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">No links found matching your search.</td></tr>`;
        }
    }

    // Render Images Helper
    function renderImagesGallery(images, filterText = '') {
        imagesGallery.innerHTML = '';
        const query = filterText.toLowerCase().trim();

        const filtered = images.filter(img =>
            img.alt.toLowerCase().includes(query) ||
            img.url.toLowerCase().includes(query)
        );

        if (filtered.length > 0) {
            filtered.forEach(img => {
                const card = document.createElement('div');
                card.className = 'image-card';

                // Preview loader logic
                card.innerHTML = `
          <div class="image-preview-box">
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'40\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%236b7280\' stroke-width=\'1.5\'><rect x=\'3\' y=\'3\' width=\'18\' height=\'18\' rx=\'2\' ry=\'2\'></rect><line x1=\'21\' y1=\'15\' x2=\'16\' y2=\'10\'></line><line x1=\'5\' y1=\'21\' x2=\'14\' y2=\'12\'></line><circle cx=\'8.5\' cy=\'8.5\' r=\'1.5\'></circle></svg>'; this.style.opacity=0.5;">
          </div>
          <div class="image-details">
            <span class="image-alt" title="${escapeHtml(img.alt)}">${escapeHtml(img.alt)}</span>
            <a href="${escapeHtml(img.url)}" target="_blank" class="image-url" title="${escapeHtml(img.url)}">${escapeHtml(img.url)}</a>
          </div>
        `;
                imagesGallery.appendChild(card);
            });
        } else {
            imagesGallery.innerHTML = '<p class="text-muted" style="grid-column: 1/-1;">No images found matching your search.</p>';
        }
    }

    // Search Filter Events
    linkSearch.addEventListener('input', (e) => {
        if (currentScrapedData) renderLinksTable(currentScrapedData.links, e.target.value);
    });

    imageSearch.addEventListener('input', (e) => {
        if (currentScrapedData) renderImagesGallery(currentScrapedData.images, e.target.value);
    });

    // Tab Navigation Handling
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPanel = document.getElementById(`tab-${btn.dataset.tab}`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    // Switch between page view states
    function showState(state) {
        welcomeState.classList.add('hidden');
        loadingState.classList.add('hidden');
        errorState.classList.add('hidden');
        resultsPanel.classList.add('hidden');

        if (state === 'welcome') welcomeState.classList.remove('hidden');
        else if (state === 'loading') loadingState.classList.remove('hidden');
        else if (state === 'error') errorState.classList.remove('hidden');
        else if (state === 'results') resultsPanel.classList.remove('hidden');
    }

    // Local Storage Save/History Functions
    function saveScrapeToLocalStorage(url, data) {
        const scrapeId = `webspy_${Date.now()}`;
        const timestamp = new Date().toLocaleString();

        // Save full data payload
        const fullRecord = {
            id: scrapeId,
            url: url,
            title: data.title,
            timestamp: timestamp,
            data: data
        };

        localStorage.setItem(scrapeId, JSON.stringify(fullRecord));

        // Update index of history records
        let index = getHistoryIndex();
        index.unshift({
            id: scrapeId,
            url: url,
            title: data.title,
            timestamp: timestamp
        });

        // Keep history clean (e.g. limit to last 25 scrapes)
        if (index.length > 25) {
            const removed = index.pop();
            localStorage.removeItem(removed.id);
        }

        localStorage.setItem('webspy_history_index', JSON.stringify(index));
        return scrapeId;
    }

    function getHistoryIndex() {
        const indexStr = localStorage.getItem('webspy_history_index');
        return indexStr ? JSON.parse(indexStr) : [];
    }

    function renderHistoryList() {
        historyList.innerHTML = '';
        const index = getHistoryIndex();

        if (index.length === 0) {
            historyList.innerHTML = `
        <div class="empty-history">
          <p>No saved scrapes yet.</p>
        </div>
      `;
            return;
        }

        index.forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            if (item.id === activeScrapedId) {
                historyItem.classList.add('active');
            }

            historyItem.innerHTML = `
        <div class="history-details">
          <span class="history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
          <span class="history-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</span>
          <span class="history-date">${item.timestamp}</span>
        </div>
        <button class="btn-delete-history" title="Delete scrape" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      `;

            // Item click resolves content
            historyItem.addEventListener('click', (e) => {
                // Prevent trigger if they click the delete trash bin
                if (e.target.closest('.btn-delete-history')) return;

                loadScrapeFromHistory(item.id);
            });

            // Delete individual item action
            const deleteBtn = historyItem.querySelector('.btn-delete-history');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteScrape(item.id);
            });

            historyList.appendChild(historyItem);
        });
    }

    function loadScrapeFromHistory(id) {
        const rawData = localStorage.getItem(id);
        if (!rawData) {
            showToast('Scraped details could not be found.', 'error');
            return;
        }

        const record = JSON.parse(rawData);
        activeScrapedId = id;
        currentScrapedData = record.data;
        urlInput.value = record.url;

        // Reset Search Fields
        linkSearch.value = '';
        imageSearch.value = '';

        renderScrapedResults(record.data, record.url);
        renderHistoryList();
        showState('results');
        showToast('Loaded details from local storage');
    }

    function deleteScrape(id) {
        localStorage.removeItem(id);

        let index = getHistoryIndex();
        index = index.filter(item => item.id !== id);
        localStorage.setItem('webspy_history_index', JSON.stringify(index));

        if (activeScrapedId === id) {
            activeScrapedId = null;
            currentScrapedData = null;
            urlInput.value = '';
            showState('welcome');
        }

        renderHistoryList();
        showToast('Scraped entry deleted');
    }

    // Clear all history
    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all saved scrapings from history?')) {
            const index = getHistoryIndex();
            index.forEach(item => localStorage.removeItem(item.id));
            localStorage.removeItem('webspy_history_index');

            activeScrapedId = null;
            currentScrapedData = null;
            urlInput.value = '';

            renderHistoryList();
            showState('welcome');
            showToast('All history cleared');
        }
    });

    // Copy Paragraphs Utility
    if (copyParasBtn) {
        copyParasBtn.addEventListener('click', () => {
            if (!currentScrapedData || currentScrapedData.paragraphs.length === 0) return;
            const fullText = currentScrapedData.paragraphs.join('\n\n');
            navigator.clipboard.writeText(fullText)
                .then(() => showToast('Extracted text copied to clipboard!'))
                .catch(() => showToast('Failed to copy text', 'error'));
        });
    }

    // Copy Raw JSON Utility
    copyJsonBtn.addEventListener('click', () => {
        if (!rawJsonCode.textContent) return;
        navigator.clipboard.writeText(rawJsonCode.textContent)
            .then(() => showToast('JSON content copied to clipboard!'))
            .catch(() => showToast('Failed to copy JSON', 'error'));
    });

    // Export Actions: Download Files
    exportJsonBtn.addEventListener('click', () => {
        if (!currentScrapedData) return;
        const cleanOutput = {
            source: urlInput.value || '',
            title: currentScrapedData.title,
            description: currentScrapedData.description,
            keywords: currentScrapedData.keywords,
            stats: currentScrapedData.stats,
            headings: currentScrapedData.headings,
            links: currentScrapedData.links,
            images: currentScrapedData.images,
            textParagraphs: currentScrapedData.paragraphs
        };
        downloadFile(
            JSON.stringify(cleanOutput, null, 2),
            'application/json',
            `scraped_${getDomainName(urlInput.value)}.json`
        );
        showToast('Downloaded JSON export');
    });


    // Render Images Helper
    function renderImagesGallery(images, filterText = '') {
        imagesGallery.innerHTML = '';
        const query = filterText.toLowerCase().trim();

        const filtered = images.filter(img =>
            img.alt.toLowerCase().includes(query) ||
            img.url.toLowerCase().includes(query)
        );

        if (filtered.length > 0) {
            filtered.forEach(img => {
                const card = document.createElement('div');
                card.className = 'image-card';

                // Preview loader logic
                card.innerHTML = `
          <div class="image-preview-box">
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%236b7280\\' stroke-width=\\'1.5\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><line x1=\\'21\\' y1=\\'15\\' x2=\\'16\\' y2=\\'10\\'></line><line x1=\\'5\\' y1=\\'21\\' x2=\\'14\\' y2=\\'12\\'></line><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle></svg>'; this.style.opacity=0.5;">
          </div>
          <div class="image-details">
            <span class="image-alt" title="${escapeHtml(img.alt)}">${escapeHtml(img.alt)}</span>
            <a href="${escapeHtml(img.url)}" target="_blank" class="image-url" title="${escapeHtml(img.url)}">${escapeHtml(img.url)}</a>
          </div>
        `;
                imagesGallery.appendChild(card);
            });
        } else {
            imagesGallery.innerHTML = '<p class="text-muted" style="grid-column: 1/-1;">No images found matching your search.</p>';
        }
    }

    // Search Filter Events
    linkSearch.addEventListener('input', (e) => {
        if (currentScrapedData) renderLinksTable(currentScrapedData.links, e.target.value);
    });

    imageSearch.addEventListener('input', (e) => {
        if (currentScrapedData) renderImagesGallery(currentScrapedData.images, e.target.value);
    });

    // Tab Navigation Handling
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPanel = document.getElementById(`tab-${btn.dataset.tab}`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    // Switch between page view states
    function showState(state) {
        welcomeState.classList.add('hidden');
        loadingState.classList.add('hidden');
        errorState.classList.add('hidden');
        resultsPanel.classList.add('hidden');

        if (state === 'welcome') welcomeState.classList.remove('hidden');
        else if (state === 'loading') loadingState.classList.remove('hidden');
        else if (state === 'error') errorState.classList.remove('hidden');
        else if (state === 'results') resultsPanel.classList.remove('hidden');
    }

    exportCsvBtn.addEventListener('click', () => {
        if (!currentScrapedData) return;

        // We will build a multi-sheet-style single CSV containing Links and Images
        let csvContent = `TYPE,LABEL/ALT,URL\n`;

        currentScrapedData.links.forEach(l => {
            const cleanLabel = l.text.replace(/"/g, '""');
            const cleanUrl = l.url.replace(/"/g, '""');
            csvContent += `"LINK","${cleanLabel}","${cleanUrl}"
`;
        });

        currentScrapedData.images.forEach(i => {
            const cleanAlt = i.alt.replace(/"/g, '""');
            const cleanUrl = i.url.replace(/"/g, '""');
            csvContent += `"IMAGE","${cleanAlt}","${cleanUrl}"
`;
        });

        downloadFile(
            csvContent,
            'text/csv;charset=utf-8;',
            `scraped_assets_${getDomainName(urlInput.value)}.csv`
        );
        showToast('Downloaded CSV export');
    });

    exportTxtBtn.addEventListener('click', () => {
        if (!currentScrapedData) return;

        let txtContent = `SCRAPED WEB PAGE CONTENT
`;
        txtContent += `=====================================
`;
        txtContent += `URL: ${urlInput.value}
`;
        txtContent += `Title: ${currentScrapedData.title}
`;
        txtContent += `Description: ${currentScrapedData.description}
`;
        txtContent += `Keywords: ${currentScrapedData.keywords}
`;
        txtContent += `Date Scraped: ${new Date().toLocaleString()}
`;
        txtContent += `=====================================

`;

        if (currentScrapedData.headings.length > 0) {
            txtContent += `OUTLINE HEADINGS
`;
            txtContent += `-------------------------------------
`;
            currentScrapedData.headings.forEach(h => {
                const indent = ' '.repeat((h.level - 1) * 2);
                txtContent += `${indent}- [${h.tag}] ${h.text}
`;
            });
            txtContent += `
`;
        }

        if (currentScrapedData.paragraphs.length > 0) {
            txtContent += `BODY PARAGRAPHS TEXT
`;
            txtContent += `-------------------------------------
`;
            currentScrapedData.paragraphs.forEach(p => {
                txtContent += `${p}

`;
            });
        }

        downloadFile(
            txtContent,
            'text/plain',
            `scraped_text_${getDomainName(urlInput.value)}.txt`
        );
        showToast('Downloaded Text export');
    });

    // Download Trigger Helper
    function downloadFile(content, mimeType, filename) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        if (navigator.msSaveBlob) { // IE 10+
            navigator.msSaveBlob(blob, filename);
        } else {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    }

    // Toast Alerts System
    function showToast(message, type = 'success') {
        // Remove existing toasts
        const activeToasts = document.querySelectorAll('.toast');
        activeToasts.forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = type === 'success' ?
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` :
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

        toast.innerHTML = `
      ${icon}
      <span>${escapeHtml(message)}</span>
    `;

        document.body.appendChild(toast);

        // Auto-remove toast
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // Utility: Formatting Bytes to Human-Readable Size
    function formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // Utility: Escape HTML string to avoid XSS issues
    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Utility: Extract domain name for output filenames
    function getDomainName(url) {
        try {
            const hostname = new URL(url).hostname;
            return hostname.replace('www.', '').split('.')[0] || 'page';
        } catch (e) {
            return 'page';
        }
    }

    // Auto-save scraped payload to the configured backend storage
    async function saveScrapeToBackend(url, data) {
        const domain = getDomainName(url);
        const payload = {
            url: url,
            domain: domain,
            title: data.title,
            description: data.description,
            keywords: data.keywords,
            stats: data.stats,
            ogProperties: data.ogTags,
            headings: data.headings,
            links: data.links,
            images: data.images,
            textParagraphs: data.paragraphs
        };

        try {
            const response = await fetch(apiUrl('/api/save'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.success) {
                showToast(`Saved report as: ${result.filename}`);
            } else {
                console.error('Server failed to save scrape:', result.error);
                showToast('Failed to save a server-side copy', 'error');
            }
        } catch (err) {
            console.error('Network error saving scrape to server:', err);
            showToast('Network error saving to the backend', 'error');
        }
    }

    // Perform AI Scrape Operation using local server Playwright + Ollama
    async function performAiScrape(url, query, schema) {
        showState('loading');
        
        const loadingTitle = document.querySelector('#loadingState h3');
        const loadingText = document.querySelector('#loadingState p');
        const origTitle = loadingTitle ? loadingTitle.textContent : 'Fetching Page Content';
        const origText = loadingText ? loadingText.textContent : '';
        
        if (loadingTitle) loadingTitle.textContent = 'Launching AI Browser Engine';
        if (loadingText) loadingText.textContent = `Interacting with website and extracting information using Llama 3.1. This may take 15 to 45 seconds...`;

        try {
            let targetUrl = url;
            if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = 'https://' + targetUrl;
            }
            urlInput.value = targetUrl;

            const response = await fetch(apiUrl('/api/scrape-ai'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: targetUrl,
                    query: query,
                    schema: schema
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Server error' }));
                throw new Error(errData.error || `Server responded with error (${response.status})`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'AI scraping failed');
            }

            const recordId = saveScrapeToLocalStorage(targetUrl, result.data);
            activeScrapedId = recordId;
            currentScrapedData = result.data;

            renderScrapedResults(result.data, targetUrl);
            renderHistoryList();
            showState('results');
            showToast(`Successfully extracted data using Llama 3.1!`);

        } catch (err) {
            console.error(err);
            if (errorMessage) errorMessage.textContent = err.message || 'An error occurred during AI extraction.';
            showState('error');
            showToast('AI Scrape failed', 'error');
        } finally {
            if (loadingTitle) loadingTitle.textContent = origTitle;
            if (loadingText) loadingText.textContent = origText;
        }
    }

    // Perform Headless GST Scrape on backend (No LLM/AI)
    async function performGstScrape(gstin) {
        showState('loading');
        
        const loadingTitle = document.querySelector('#loadingState h3');
        const loadingText = document.querySelector('#loadingState p');
        const origTitle = loadingTitle ? loadingTitle.textContent : 'Fetching Page Content';
        const origText = loadingText ? loadingText.textContent : '';
        
        if (loadingTitle) loadingTitle.textContent = 'Opening GST Verification';
        if (loadingText) loadingText.textContent = `Running headless browser to fetch business details for: ${gstin}. This may take 8 to 15 seconds...`;

        try {
            const response = await fetch(apiUrl('/api/scrape-gst'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gstin: gstin })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Server error' }));
                throw new Error(errData.error || `Server responded with error (${response.status})`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'GST lookup failed');
            }

            const recordId = saveScrapeToLocalStorage(urlInput.value || gstin, result.data);
            activeScrapedId = recordId;
            currentScrapedData = result.data;

            renderScrapedResults(result.data, urlInput.value || gstin);
            renderHistoryList();
            showState('results');
            showToast(`Successfully retrieved details for GSTIN: ${gstin}`);

        } catch (err) {
            console.error(err);
            if (errorMessage) errorMessage.textContent = err.message || 'An error occurred during GST lookup.';
            showState('error');
            showToast('GST Lookup failed', 'error');
        } finally {
            if (loadingTitle) loadingTitle.textContent = origTitle;
            if (loadingText) loadingText.textContent = origText;
        }
    }

    async function performIntelScrape(url) {
        showState('loading');

        const loadingTitle = document.querySelector('#loadingState h3');
        const loadingText = document.querySelector('#loadingState p');
        const origTitle = loadingTitle ? loadingTitle.textContent : 'Fetching Page Content';
        const origText = loadingText ? loadingText.textContent : '';

        if (loadingTitle) loadingTitle.textContent = 'Running Company Intelligence Scan';
        if (loadingText) loadingText.textContent = `Crawling ${url} and its contact/about pages to extract phone numbers, emails, GST numbers, social profiles, and business details. This may take 15-30 seconds...`;

        try {
            const response = await fetch(apiUrl('/api/scrape-intel'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Server error' }));
                throw new Error(errData.error || `Server responded with error (${response.status})`);
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Intel extraction failed');
            }

            const recordId = saveScrapeToLocalStorage(url, result.data);
            activeScrapedId = recordId;
            currentScrapedData = result.data;

            renderScrapedResults(result.data, url);
            renderHistoryList();
            showState('results');
            showToast(`Company intelligence report ready for ${url}`);

        } catch (err) {
            console.error(err);
            if (errorMessage) errorMessage.textContent = err.message || 'An error occurred during intel scan.';
            showState('error');
            showToast('Intel scan failed', 'error');
        } finally {
            if (loadingTitle) loadingTitle.textContent = origTitle;
            if (loadingText) loadingText.textContent = origText;
        }
    }

    // SVG Donut Chart Creator
    function drawDonutChart(canvasId, dataPoints) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        canvas.innerHTML = '';

        const total = dataPoints.reduce((sum, dp) => sum + dp.value, 0);
        if (total === 0) {
            canvas.innerHTML = '<p class="text-muted" style="font-size:0.8rem;text-align:center;">No data available</p>';
            return;
        }

        const size = 160;
        const center = size / 2;
        const radius = 58;
        const circumference = 2 * Math.PI * radius;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

        // Draw background circle
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', center);
        bgCircle.setAttribute('cy', center);
        bgCircle.setAttribute('r', radius);
        bgCircle.setAttribute('fill', 'transparent');
        bgCircle.setAttribute('stroke', 'rgba(255, 255, 255, 0.04)');
        bgCircle.setAttribute('stroke-width', '14');
        svg.appendChild(bgCircle);

        let accumulatedPercent = 0;
        dataPoints.forEach(dp => {
            if (dp.value === 0) return;
            const percent = dp.value / total;
            const strokeLength = circumference * percent;
            const strokeOffset = circumference - (circumference * accumulatedPercent);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', center);
            circle.setAttribute('cy', center);
            circle.setAttribute('r', radius);
            circle.setAttribute('fill', 'transparent');
            circle.setAttribute('stroke', dp.color);
            circle.setAttribute('stroke-width', '14');
            circle.setAttribute('stroke-dasharray', `${strokeLength} ${circumference}`);
            circle.setAttribute('stroke-dashoffset', strokeOffset);
            circle.setAttribute('transform', `rotate(-90 ${center} ${center})`);
            circle.style.transition = 'all 0.3s ease';
            circle.style.cursor = 'pointer';

            circle.addEventListener('mouseenter', () => {
                circle.setAttribute('stroke-width', '18');
                circle.setAttribute('stroke', '#ffffff');
            });
            circle.addEventListener('mouseleave', () => {
                circle.setAttribute('stroke-width', '14');
                circle.setAttribute('stroke', dp.color);
            });

            svg.appendChild(circle);
            accumulatedPercent += percent;
        });

        // Center Text
        const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        textGroup.style.textAnchor = 'middle';
        textGroup.style.dominantBaseline = 'central';

        const textVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textVal.setAttribute('x', center);
        textVal.setAttribute('y', center - 6);
        textVal.setAttribute('fill', '#f3f4f6');
        textVal.style.fontSize = '20px';
        textVal.style.fontWeight = '800';
        textVal.style.fontFamily = 'Inter, sans-serif';
        textVal.textContent = total;
        textGroup.appendChild(textVal);

        const textLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textLabel.setAttribute('x', center);
        textLabel.setAttribute('y', center + 14);
        textLabel.setAttribute('fill', '#6b7280');
        textLabel.style.fontSize = '9px';
        textLabel.style.fontWeight = '700';
        textLabel.style.fontFamily = 'Inter, sans-serif';
        textLabel.style.letterSpacing = '0.5px';
        textLabel.textContent = 'ENTITIES';
        textGroup.appendChild(textLabel);

        svg.appendChild(textGroup);
        canvas.appendChild(svg);
    }

    // Render visual analytics for JSON tab
    function renderJsonAnalytics(data) {
        const chartCanvas = document.getElementById('analyticsChart');
        const chartLegend = document.getElementById('analyticsLegend');
        const panelTitle = document.querySelector('#jsonAnalyticsPanel h4');
        
        if (!chartCanvas || !chartLegend) return;
        
        chartCanvas.innerHTML = '';
        chartLegend.innerHTML = '';

        const isGst = data.title && data.title.startsWith('GSTIN Lookup:');
        const isIntel = data.title && data.title.startsWith('Company Intel:');

        if (isGst) {
            if (panelTitle) panelTitle.textContent = 'Taxpayer Credential Card';
            
            // Extract fields
            const gstData = {};
            data.textParagraphs.forEach(p => {
                if (p.startsWith('Note:')) return;
                const idx = p.indexOf(':');
                if (idx !== -1) {
                    const key = p.substring(0, idx).trim();
                    const val = p.substring(idx + 1).trim();
                    gstData[key] = val;
                }
            });

            const card = document.createElement('div');
            card.className = 'taxpayer-card';
            card.innerHTML = `
                <div class="taxpayer-card-header">
                    <div class="card-chip"></div>
                    <span class="card-logo">GSTIN TAXPAYER</span>
                </div>
                <div class="taxpayer-card-body">
                    <div class="card-field">
                        <span class="card-field-label">Legal Name</span>
                        <span class="card-field-val" style="color: #a78bfa; font-weight: 800; font-size: 0.95rem;">${escapeHtml(gstData['Legal Name'] || gstData['Legal Name of Business'] || 'N/A')}</span>
                    </div>
                    ${(gstData['Trade Name / Business Name'] || gstData['Trade Name']) && (gstData['Trade Name / Business Name'] !== 'N/A' && gstData['Trade Name'] !== 'N/A') ? `
                    <div class="card-field">
                        <span class="card-field-label">Trade Name</span>
                        <span class="card-field-val" style="color: #60a5fa; font-weight: 800; font-size: 0.9rem;">${escapeHtml(gstData['Trade Name / Business Name'] || gstData['Trade Name'])}</span>
                    </div>
                    ` : ''}
                    <div class="card-field">
                        <span class="card-field-label">GSTIN</span>
                        <span class="card-field-val code">${escapeHtml(gstData['GSTIN'] || 'N/A')}</span>
                    </div>
                    <div class="card-row">
                        <div class="card-field">
                            <span class="card-field-label">Reg Date</span>
                            <span class="card-field-val">${escapeHtml(gstData['Registration Date'] || 'N/A')}</span>
                        </div>
                        <div class="card-field">
                            <span class="card-field-label">Status</span>
                            <span class="card-field-val status-active">${escapeHtml(gstData['Status'] || 'Active').toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            `;
            
            chartCanvas.style.width = '100%';
            chartCanvas.style.height = 'auto';
            chartCanvas.appendChild(card);
            chartLegend.style.display = 'none';
            return;
        }

        chartLegend.style.display = 'flex';
        chartCanvas.style.width = '160px';
        chartCanvas.style.height = '160px';

        if (isIntel) {
            if (panelTitle) panelTitle.textContent = 'Extracted Intelligence Data';
            
            // Extract counts
            const phones = data.textParagraphs.filter(p => p.startsWith('Phone ')).length;
            const emails = data.textParagraphs.filter(p => p.startsWith('Email ')).length;
            const gstins = data.textParagraphs.filter(p => p.startsWith('GSTIN ')).length;
            const socials = data.links.length;
            const pans = data.textParagraphs.filter(p => p.startsWith('PAN ') || p.startsWith('CIN ')).length;

            const dataPoints = [
                { name: 'Phones', value: phones, color: '#3b82f6' },
                { name: 'Emails', value: emails, color: '#06b6d4' },
                { name: 'GSTINs', value: gstins, color: '#8b5cf6' },
                { name: 'PANs/CINs', value: pans, color: '#ec4899' },
                { name: 'Socials', value: socials, color: '#10b981' }
            ];

            drawDonutChart('analyticsChart', dataPoints);

            dataPoints.forEach(dp => {
                const item = document.createElement('div');
                item.className = 'legend-item';
                item.innerHTML = `
                    <div class="legend-label-wrapper">
                        <span class="legend-color-dot" style="background-color: ${dp.color};"></span>
                        <span class="legend-name">${dp.name}</span>
                    </div>
                    <span class="legend-val">${dp.value}</span>
                `;
                chartLegend.appendChild(item);
            });
            return;
        }

        // Standard Scrape
        if (panelTitle) panelTitle.textContent = 'Web Content Distribution';

        const dataPoints = [
            { name: 'Links', value: data.links.length, color: '#10b981' },
            { name: 'Images', value: data.images.length, color: '#ec4899' },
            { name: 'Paragraphs', value: data.textParagraphs.length, color: '#8b5cf6' },
            { name: 'Headings', value: data.headings.length, color: '#ef4444' }
        ];

        drawDonutChart('analyticsChart', dataPoints);

        dataPoints.forEach(dp => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <div class="legend-label-wrapper">
                    <span class="legend-color-dot" style="background-color: ${dp.color};"></span>
                    <span class="legend-name">${dp.name}</span>
                </div>
                <span class="legend-val">${dp.value}</span>
            `;
            chartLegend.appendChild(item);
        });
    }

    // Chatbot functionality
    const chatbotWidget = document.getElementById('chatbotWidget');
    const chatbotTrigger = document.getElementById('chatbotTrigger');
    const closeChatBtn = document.getElementById('closeChatBtn');
    const chatbotInputForm = document.getElementById('chatbotInputForm');
    const chatbotInput = document.getElementById('chatbotInput');
    const chatbotMessages = document.getElementById('chatbotMessages');

    let chatHistory = [];

    if (chatbotTrigger && closeChatBtn && chatbotWidget) {
        chatbotTrigger.addEventListener('click', () => {
            chatbotWidget.classList.remove('closed');
            chatbotInput.focus();
            scrollToBottom();
        });

        closeChatBtn.addEventListener('click', () => {
            chatbotWidget.classList.add('closed');
        });

        chatbotInputForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const messageText = chatbotInput.value.trim();
            if (!messageText) return;

            chatbotInput.value = '';
            
            appendMessage('user', messageText);
            chatHistory.push({ role: 'user', content: messageText });

            const typingIndicator = appendTypingIndicator();
            scrollToBottom();

            try {
                let contextPayload = null;
                if (currentScrapedData) {
                    contextPayload = {
                        source: urlInput.value || '',
                        title: currentScrapedData.title || '',
                        description: currentScrapedData.description || '',
                        textParagraphs: currentScrapedData.paragraphs || [],
                        links: currentScrapedData.links || []
                    };
                }

                const response = await fetch(apiUrl('/api/chat'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: chatHistory,
                        context: contextPayload
                    })
                });

                typingIndicator.remove();

                if (!response.ok) {
                    throw new Error(`Chat API error (${response.status})`);
                }

                const result = await response.json();
                if (result.success && result.response) {
                    appendMessage('assistant', result.response);
                    chatHistory.push({ role: 'assistant', content: result.response });
                } else {
                    throw new Error(result.error || 'Invalid chat response');
                }

            } catch (err) {
                console.error(err);
                typingIndicator.remove();
                appendMessage('assistant', `⚠️ Sorry, I encountered an error communicating with the AI service: ${err.message}. Please verify that the backend can reach its configured Ollama server.`);
            } finally {
                scrollToBottom();
            }
        });
    }

    function appendMessage(role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${role}`;
        
        let htmlText = escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
            
        msgDiv.innerHTML = htmlText;
        chatbotMessages.appendChild(msgDiv);
    }

    function appendTypingIndicator() {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message assistant';
        msgDiv.innerHTML = `
            <div class="typing-indicator">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        `;
        chatbotMessages.appendChild(msgDiv);
        return msgDiv;
    }

    function scrollToBottom() {
        chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    }
});
