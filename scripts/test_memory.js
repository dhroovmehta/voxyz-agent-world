// test_memory.js — Simulates multi-day memory to verify persistence
// This is the test that validates the #1 requirement: memory never resets.
//
// What it does:
//   1. Creates a test agent
//   2. Simulates 3 "days" of activity (memories, lessons, decisions, conversations)
//   3. Retrieves memories and verifies Day 3 agent recalls Day 1
//   4. Tests the full buildAgentPrompt() function
//   5. Cleans up test data

require('dotenv').config();
const supabase = require('../src/lib/supabase');
const memory = require('../src/lib/memory');

const TEST_AGENT_ID = 'test-memory-agent';

async function setup() {
  console.log('[test] Setting up test agent...');

  // Create test agent
  await supabase.from('agents').upsert({
    id: TEST_AGENT_ID,
    name: 'Memory Test Agent',
    display_name: 'Rei',
    role: 'Memory System Tester',
    title: 'QA Specialist',
    agent_type: 'sub_agent',
    status: 'active'
  });

  // Create a basic persona
  const { data: persona } = await supabase
    .from('agent_personas')
    .insert({
      agent_id: TEST_AGENT_ID,
      agent_md: 'Rei — Memory System Tester',
      soul_md: 'Meticulous, detail-oriented, never forgets.',
      skills_md: 'Testing, QA, memory verification.',
      identity_md: '5 years of QA experience.',
      full_sep_prompt: 'You are Rei, a QA Specialist at NERV. You are meticulous and detail-oriented. You test memory systems to ensure they never fail.'
    })
    .select()
    .single();

  if (persona) {
    await supabase.from('agents').update({ persona_id: persona.id }).eq('id', TEST_AGENT_ID);
  }

  console.log('[test] Test agent created.\n');
}

async function simulateDay1() {
  console.log('=== DAY 1: Agent starts working ===\n');

  // Agent works on a research task
  await memory.saveMemory({
    agentId: TEST_AGENT_ID,
    memoryType: 'task',
    content: 'Researched top 5 faceless business models. Found that print-on-demand, digital courses, and AI automation services are trending.',
    summary: 'Researched faceless business models',
    topicTags: ['business-research', 'faceless-business', 'market-analysis'],
    importance: 7,
    sourceType: 'mission'
  });

  // Agent has a conversation with team lead
  await memory.saveConversation({
    conversationId: 'conv-day1-001',
    conversationType: 'work_review',
    senderAgentId: TEST_AGENT_ID,
    recipientAgentId: 'team-lead-test',
    content: 'I recommend focusing on AI automation services. The market is growing at 40% CAGR.',
    context: 'Business research review'
  });

  // Agent learns a lesson
  await memory.saveLesson({
    agentId: TEST_AGENT_ID,
    lesson: 'Print-on-demand margins are thin (15-20%). AI services have 60-80% margins. Always compare margin structures.',
    context: 'Learned during faceless business research',
    category: 'strategy',
    importance: 8
  });

  // Agent makes a decision
  await memory.logDecision({
    agentId: TEST_AGENT_ID,
    decision: 'Recommended AI automation services over print-on-demand',
    reasoning: '3x higher margins, growing market, lower competition in our niche',
    alternativesConsidered: 'Print-on-demand, digital courses, dropshipping'
  });

  console.log('  Day 1: 1 task memory, 1 conversation, 1 lesson, 1 decision saved.\n');
}

async function simulateDay2() {
  console.log('=== DAY 2: Agent continues working ===\n');

  await memory.saveMemory({
    agentId: TEST_AGENT_ID,
    memoryType: 'task',
    content: 'Built competitive analysis for AI automation market. Key players: Zapier, Make, n8n. Gap found: no one targets non-technical solopreneurs specifically.',
    summary: 'Competitive analysis — AI automation market',
    topicTags: ['competitive-analysis', 'ai-automation', 'market-gap'],
    importance: 8,
    sourceType: 'mission'
  });

  await memory.saveMemory({
    agentId: TEST_AGENT_ID,
    memoryType: 'observation',
    content: 'Zero seems most interested in opportunities with recurring revenue. Should prioritize subscription-based models in future recommendations.',
    summary: 'Zero prefers recurring revenue models',
    topicTags: ['founder-preferences', 'revenue-model'],
    importance: 9,
    sourceType: 'conversation'
  });

  await memory.saveLesson({
    agentId: TEST_AGENT_ID,
    lesson: 'When presenting options to Zero, always lead with the recurring revenue angle. He values predictability.',
    context: 'Observed from Day 1 feedback session',
    category: 'communication',
    importance: 9
  });

  console.log('  Day 2: 2 memories, 1 lesson saved.\n');
}

async function simulateDay3() {
  console.log('=== DAY 3: Agent should remember everything ===\n');

  await memory.saveMemory({
    agentId: TEST_AGENT_ID,
    memoryType: 'task',
    content: 'Created pricing strategy for AI automation SaaS. Three tiers: $29/mo basic, $79/mo pro, $199/mo enterprise. Based on competitive analysis from Day 2.',
    summary: 'Created SaaS pricing strategy',
    topicTags: ['pricing', 'ai-automation', 'saas'],
    importance: 7,
    sourceType: 'mission'
  });

  console.log('  Day 3: 1 memory saved.\n');
}

async function verifyMemoryPersistence() {
  console.log('=== VERIFICATION: Does Day 3 agent recall Day 1? ===\n');

  // Test 1: Retrieve all memories
  const allRecent = await memory.getRecentMemories(TEST_AGENT_ID, 20);
  console.log(`  Total memories: ${allRecent.length}`);

  // Test 2: Check topic retrieval finds Day 1 content
  const businessMemories = await memory.getTopicMemories(TEST_AGENT_ID, ['business-research'], 10);
  console.log(`  Memories tagged "business-research": ${businessMemories.length}`);
  if (businessMemories.length > 0) {
    console.log(`    ✓ Found Day 1 research: "${businessMemories[0].summary}"`);
  } else {
    console.log('    ✗ FAILED: Could not find Day 1 research via topic tags');
  }

  // Test 3: Check lessons persist
  const lessons = await memory.getLessons(TEST_AGENT_ID, 10);
  console.log(`  Lessons learned: ${lessons.length}`);
  for (const l of lessons) {
    console.log(`    ✓ Lesson (importance ${l.importance}): "${l.lesson.substring(0, 80)}..."`);
  }

  // Test 4: Full prompt build
  console.log('\n  Building full agent prompt (identity + memory)...');
  const prompt = await memory.buildAgentPrompt(TEST_AGENT_ID, ['ai-automation', 'pricing']);

  if (prompt.error) {
    console.log(`    ✗ FAILED: ${prompt.error}`);
  } else {
    console.log(`    ✓ System prompt built (${prompt.systemPrompt.length} chars)`);
    console.log(`    ✓ Memories included: ${prompt.memories.totalCount}`);
    console.log(`      - Recent: ${prompt.memories.recent.length}`);
    console.log(`      - Topic-matched: ${prompt.memories.topicMatched.length}`);
    console.log(`      - Lessons: ${prompt.memories.lessons.length}`);

    // Verify Day 1 content appears in the prompt
    const hasDay1 = prompt.systemPrompt.includes('faceless business');
    const hasDay2 = prompt.systemPrompt.includes('competitive analysis') || prompt.systemPrompt.includes('recurring revenue');
    const hasDay3 = prompt.systemPrompt.includes('pricing');
    const hasLesson = prompt.systemPrompt.includes('margin');

    console.log(`\n    Day 1 recall: ${hasDay1 ? '✓ YES' : '✗ NO'}`);
    console.log(`    Day 2 recall: ${hasDay2 ? '✓ YES' : '✗ NO'}`);
    console.log(`    Day 3 recall: ${hasDay3 ? '✓ YES' : '✗ NO'}`);
    console.log(`    Lessons recall: ${hasLesson ? '✓ YES' : '✗ NO'}`);
  }

  // Test 5: Memory stats
  const stats = await memory.getMemoryStats(TEST_AGENT_ID);
  console.log(`\n  Memory Stats: ${stats.memories} memories, ${stats.lessons} lessons, ${stats.decisions} decisions`);
}

async function cleanup() {
  console.log('\n[test] Cleaning up test data...');
  await supabase.from('agent_memories').delete().eq('agent_id', TEST_AGENT_ID);
  await supabase.from('lessons_learned').delete().eq('agent_id', TEST_AGENT_ID);
  await supabase.from('decisions_log').delete().eq('agent_id', TEST_AGENT_ID);
  await supabase.from('conversation_history').delete().eq('sender_agent_id', TEST_AGENT_ID);
  await supabase.from('agent_personas').delete().eq('agent_id', TEST_AGENT_ID);
  await supabase.from('agents').delete().eq('id', TEST_AGENT_ID);
  console.log('[test] Cleaned up.\n');
}

async function main() {
  console.log('='.repeat(60));
  console.log('Frasier — Memory System Persistence Test');
  console.log('Simulates 3 days of agent activity, verifies recall.');
  console.log('='.repeat(60) + '\n');

  await setup();
  await simulateDay1();
  await simulateDay2();
  await simulateDay3();
  await verifyMemoryPersistence();
  await cleanup();

  console.log('='.repeat(60));
  console.log('Memory persistence test complete.');
  console.log('='.repeat(60));
}

main().catch(console.error);
