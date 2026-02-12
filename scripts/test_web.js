#!/usr/bin/env node
// Quick test to verify web search works on the VPS.
// Run: node scripts/test_web.js

const web = require('../src/lib/web');

(async () => {
  console.log('Testing web search...\n');

  const search = await web.searchWeb('current ethereum ETH price USD');
  if (search.results.length === 0) {
    console.error('FAIL: Search returned 0 results');
    console.error('Error:', search.error);
    process.exit(1);
  }

  console.log(`PASS: ${search.results.length} results`);
  for (const r of search.results.slice(0, 3)) {
    console.log(`  - ${r.title}`);
    console.log(`    ${(r.snippet || '').substring(0, 120)}`);
  }

  console.log('\nTesting web tag resolution...\n');
  const tagged = await web.resolveWebTags('[WEB_SEARCH:bitcoin price today]');
  console.log(`PASS: resolveWebTags found ${tagged.results.length} tag(s)`);
  console.log(`Search returned ${tagged.results[0]?.data?.results?.length || 0} results`);

  console.log('\nAll tests passed.');
})();
