// web.js — Lightweight web access for agents (Decision 6)
// WHY: Agents need live data — prices, news, competitor info — but we can't run
// a headless browser on a 1GB VPS. HTTP fetch + HTML-to-text covers 80% of use cases
// at zero extra cost. No Puppeteer, no Chrome, no RAM explosion.
//
// Two capabilities:
// 1. fetchPage(url) — GET a URL, strip HTML to plain text
// 2. searchWeb(query) — Search via DuckDuckGo HTML (no API key needed)

// ============================================================
// PAGE FETCHING (HTTP GET + HTML-to-text)
// ============================================================

/**
 * Fetch a web page and extract readable text content.
 * Strips HTML tags, scripts, styles, and returns clean text.
 * Truncates to maxChars to avoid blowing up LLM context.
 *
 * @param {string} url - The URL to fetch
 * @param {number} [maxChars=8000] - Max characters to return
 * @returns {{ content: string, title: string, url: string, error: string|null }}
 */
async function fetchPage(url, maxChars = 8000) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VoxYZBot/1.0; +https://voxyz.ai)',
        'Accept': 'text/html,application/xhtml+xml,application/json,text/plain'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (!response.ok) {
      return { content: null, title: null, url, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();

    // If JSON, return formatted
    if (contentType.includes('application/json')) {
      const truncated = raw.substring(0, maxChars);
      return { content: truncated, title: url, url, error: null };
    }

    // Extract title
    const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    // Strip HTML to plain text
    const text = htmlToText(raw);
    const truncated = text.substring(0, maxChars);

    return { content: truncated, title, url, error: null };
  } catch (err) {
    console.error(`[web] Failed to fetch ${url}: ${err.message}`);
    return { content: null, title: null, url, error: err.message };
  }
}

// ============================================================
// WEB SEARCH (DuckDuckGo HTML — no API key needed)
// ============================================================

/**
 * Search the web using DuckDuckGo's HTML endpoint.
 * Returns a list of results with titles, URLs, and snippets.
 * Free, no API key, no rate limit issues for our volume.
 *
 * @param {string} query - Search query
 * @param {number} [maxResults=5] - Max results to return
 * @returns {{ results: Array<{title, url, snippet}>, error: string|null }}
 */
async function searchWeb(query, maxResults = 5) {
  try {
    const encoded = encodeURIComponent(query);
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VoxYZBot/1.0; +https://voxyz.ai)',
        'Accept': 'text/html'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return { results: [], error: `Search failed: HTTP ${response.status}` };
    }

    const html = await response.text();
    const results = parseSearchResults(html, maxResults);

    console.log(`[web] Search "${query}": ${results.length} results`);
    return { results, error: null };
  } catch (err) {
    console.error(`[web] Search failed for "${query}": ${err.message}`);
    return { results: [], error: err.message };
  }
}

// ============================================================
// AGENT TOOL INTERFACE
// ============================================================

/**
 * Process a web access request from an agent's task output.
 * Agents can embed [WEB_SEARCH:query] or [WEB_FETCH:url] tags in their output
 * to trigger web access. The worker calls this to resolve them.
 *
 * @param {string} text - Agent output that may contain web tags
 * @returns {{ results: Array<{type, query, data}>, enrichedText: string }}
 */
async function resolveWebTags(text) {
  const results = [];

  // Find [WEB_SEARCH:query] tags
  const searchMatches = text.matchAll(/\[WEB_SEARCH:([^\]]+)\]/g);
  for (const match of searchMatches) {
    const query = match[1].trim();
    const searchResult = await searchWeb(query);
    results.push({ type: 'search', query, data: searchResult });
  }

  // Find [WEB_FETCH:url] tags
  const fetchMatches = text.matchAll(/\[WEB_FETCH:(https?:\/\/[^\]]+)\]/g);
  for (const match of fetchMatches) {
    const url = match[1].trim();
    const fetchResult = await fetchPage(url);
    results.push({ type: 'fetch', query: url, data: fetchResult });
  }

  return { results, hasWebTags: results.length > 0 };
}

/**
 * Format web results into a context string that can be injected into an agent's
 * follow-up prompt. Called by the worker when an agent needs live data.
 *
 * @param {Array} results - From resolveWebTags()
 * @returns {string} Formatted web context for LLM prompt
 */
function formatWebResults(results) {
  if (!results || results.length === 0) return '';

  const lines = ['# LIVE WEB DATA (fetched just now)', ''];

  for (const r of results) {
    if (r.type === 'search') {
      lines.push(`## Search: "${r.query}"`);
      if (r.data.error) {
        lines.push(`Error: ${r.data.error}`);
      } else {
        for (const sr of r.data.results) {
          lines.push(`- **${sr.title}** (${sr.url})`);
          if (sr.snippet) lines.push(`  ${sr.snippet}`);
        }
      }
      lines.push('');
    } else if (r.type === 'fetch') {
      lines.push(`## Page: ${r.query}`);
      if (r.data.error) {
        lines.push(`Error: ${r.data.error}`);
      } else {
        lines.push(`Title: ${r.data.title}`);
        lines.push(`Content (truncated):\n${r.data.content?.substring(0, 3000) || 'No content'}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================
// HTML PARSING HELPERS (no dependencies)
// ============================================================

/**
 * Convert HTML to plain text. No external dependencies.
 * Strips tags, decodes entities, collapses whitespace.
 */
function htmlToText(html) {
  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
  text = text.replace(/<br[^>]*\/?>/gi, '\n');
  text = text.replace(/<hr[^>]*\/?>/gi, '\n---\n');

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#x2F;/g, '/');
  text = text.replace(/&mdash;/g, '—');
  text = text.replace(/&ndash;/g, '–');

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * Parse DuckDuckGo HTML search results into structured data.
 */
function parseSearchResults(html, maxResults) {
  const results = [];

  // DuckDuckGo HTML results are in <a class="result__a"> tags
  // with snippets in <a class="result__snippet"> tags
  const resultBlocks = html.split(/class="result__body"/gi);

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    // Extract URL and title from result__a link
    const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let url = linkMatch[1];
    const title = htmlToText(linkMatch[2]).trim();

    // DuckDuckGo wraps URLs in a redirect — extract the real URL
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const snippet = snippetMatch ? htmlToText(snippetMatch[1]).trim() : '';

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

module.exports = {
  fetchPage,
  searchWeb,
  resolveWebTags,
  formatWebResults,
  htmlToText
};
