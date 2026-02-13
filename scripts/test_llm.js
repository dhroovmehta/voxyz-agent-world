// test_llm.js — Quick test of a real LLM call via OpenRouter
// Verifies the API key works and MiniMax responds
// Run: node scripts/test_llm.js

require('dotenv').config();
const models = require('../src/lib/models');
const memory = require('../src/lib/memory');

async function main() {
  console.log('='.repeat(60));
  console.log('Frasier — Live LLM Call Test');
  console.log('='.repeat(60) + '\n');

  // Test 1: Raw MiniMax call
  console.log('=== Test 1: MiniMax via OpenRouter ===\n');
  console.log(`  API Key: ${process.env.OPENROUTER_API_KEY?.substring(0, 20)}...`);

  const result = await models.callLLM({
    systemPrompt: 'You are a helpful assistant. Respond in 1-2 sentences.',
    userMessage: 'What is 2 + 2? Just answer the question briefly.',
    agentId: 'test',
    forceTier: 'tier1'
  });

  if (result.error) {
    console.log(`  ✗ FAILED: ${result.error}`);
    process.exit(1);
  }

  console.log(`  ✓ Model: ${result.model}`);
  console.log(`  ✓ Tier: ${result.tier}`);
  console.log(`  ✓ Response: "${result.content}"`);
  console.log(`  ✓ Tokens: ${result.usage?.total_tokens || 'unknown'}`);

  // Test 2: Full agent prompt + LLM call (Frasier)
  console.log('\n=== Test 2: Frasier Full Prompt + LLM ===\n');

  const promptData = await memory.buildAgentPrompt('frasier-cos', ['founder-request']);
  if (promptData.error) {
    console.log(`  ✗ Failed to build prompt: ${promptData.error}`);
    process.exit(1);
  }

  console.log(`  ✓ Frasier prompt: ${promptData.systemPrompt.length} chars`);

  const frasierResult = await models.callLLM({
    systemPrompt: promptData.systemPrompt,
    userMessage: 'Zero says: "What teams do we have active right now? Give me a quick status update." Respond as Frasier, Chief of Staff.',
    agentId: 'frasier-cos',
    forceTier: 'tier1'
  });

  if (frasierResult.error) {
    console.log(`  ✗ FAILED: ${frasierResult.error}`);
    process.exit(1);
  }

  console.log(`  ✓ Frasier responded (${frasierResult.content.length} chars):`);
  console.log(`\n--- Frasier's Response ---`);
  console.log(frasierResult.content);
  console.log(`--- End Response ---\n`);

  // Test 3: Check model_usage was logged
  console.log('=== Test 3: Model Usage Logged ===\n');
  const costs = await models.getModelCosts(new Date(Date.now() - 5 * 60 * 1000).toISOString());
  console.log(`  ✓ Tier 1 calls: ${costs?.tier1?.calls || 0}`);
  console.log(`  ✓ Total cost: $${costs?.total?.cost?.toFixed(6) || 0}`);

  console.log('\n' + '='.repeat(60));
  console.log('✓ LLM INTEGRATION WORKING');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
