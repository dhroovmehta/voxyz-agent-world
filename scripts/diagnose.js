// diagnose.js — Quick health check for the VPS environment
// Run: node scripts/diagnose.js

require('dotenv').config();

const checks = {
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY?.startsWith('eyJ'),
  DISCORD_BOT_TOKEN: !!process.env.DISCORD_BOT_TOKEN,
  DISCORD_ZERO_ID: !!process.env.DISCORD_ZERO_ID,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY?.startsWith('sk-or-'),
  MANUS_API_KEY: !!process.env.MANUS_API_KEY && process.env.MANUS_API_KEY.length > 10,
  NOTION_API_KEY: process.env.NOTION_API_KEY?.startsWith('ntn_'),
};

console.log('\n=== Frasier Environment Check ===\n');
let allGood = true;
for (const [key, ok] of Object.entries(checks)) {
  const status = ok ? 'OK' : 'MISSING/INVALID';
  const val = process.env[key] ? `${process.env[key].substring(0, 8)}...` : '(empty)';
  console.log(`  ${ok ? '✅' : '❌'} ${key}: ${status} [${val}]`);
  if (!ok) allGood = false;
}

console.log('\n=== Notion API Test ===\n');

async function testNotion() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.log('  ❌ No NOTION_API_KEY set');
    return;
  }

  const hqPageId = process.env.NOTION_HQ_PAGE_ID || '304c642f7e708027958adc5e3c989068';
  console.log(`  Testing page ID: ${hqPageId}`);

  try {
    const res = await fetch(`https://api.notion.com/v1/blocks/${hqPageId}/children?page_size=100`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`  ❌ Notion API ${res.status}: ${err}`);
      return;
    }

    const data = await res.json();
    console.log(`  ✅ Notion connected! Found ${data.results.length} child blocks`);
    for (const block of data.results) {
      if (block.type === 'child_page') {
        console.log(`     📄 ${block.child_page.title} (${block.id})`);
      }
    }
  } catch (err) {
    console.log(`  ❌ Notion request failed: ${err.message}`);
  }
}

async function testOpenRouter() {
  console.log('\n=== OpenRouter API Test ===\n');
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log('  ❌ No OPENROUTER_API_KEY set');
    return;
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'minimax/minimax-01',
        messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
        max_tokens: 10
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`  ❌ OpenRouter API ${res.status}: ${err}`);
      return;
    }

    const data = await res.json();
    console.log(`  ✅ OpenRouter connected! Response: "${data.choices?.[0]?.message?.content}"`);
  } catch (err) {
    console.log(`  ❌ OpenRouter request failed: ${err.message}`);
  }
}

(async () => {
  await testNotion();
  await testOpenRouter();
  console.log('\n' + (allGood ? '✅ All env vars look good!' : '⚠️  Fix the issues above before running PM2.') + '\n');
})();
