// setup_database.js — Tests Supabase connection and verifies table access
// Run: node scripts/setup_database.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function testConnection() {
  console.log('[setup] Testing Supabase connection...');
  console.log(`[setup] URL: ${process.env.SUPABASE_URL}`);
  console.log(`[setup] Key format: ${process.env.SUPABASE_SERVICE_KEY?.substring(0, 20)}...`);

  try {
    // Test basic connectivity by querying a table
    const { data, error } = await supabase
      .from('name_pool')
      .select('count')
      .limit(1);

    if (error) {
      // Table might not exist yet — that's expected if schema hasn't been run
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.log('[setup] Connection OK but tables not created yet.');
        console.log('[setup] Run the SQL in sql/001_initial_schema.sql via Supabase Dashboard:');
        console.log('[setup]   1. Go to https://supabase.com/dashboard');
        console.log('[setup]   2. Select your project');
        console.log('[setup]   3. Go to SQL Editor');
        console.log('[setup]   4. Paste the contents of sql/001_initial_schema.sql');
        console.log('[setup]   5. Click "Run"');
        console.log('[setup]   6. Run this script again to verify');
        return false;
      }
      console.error('[setup] Connection error:', error.message);
      return false;
    }

    console.log('[setup] Connection successful!');
    return true;
  } catch (err) {
    console.error('[setup] Failed to connect:', err.message);
    return false;
  }
}

async function verifyTables() {
  console.log('\n[setup] Verifying all tables...');

  const tables = [
    'teams', 'agents', 'agent_personas', 'name_pool',
    'mission_proposals', 'missions', 'mission_steps', 'approval_chain',
    'agent_memories', 'conversation_history', 'lessons_learned', 'decisions_log',
    'events', 'policy', 'model_usage', 'health_checks', 'agent_skills',
    'notion_sync', 'gdrive_sync', 'github_sync', 'social_accounts', 'backups'
  ];

  let allGood = true;

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error) {
      console.log(`  ✗ ${table} — ERROR: ${error.message}`);
      allGood = false;
    } else {
      console.log(`  ✓ ${table}`);
    }
  }

  return allGood;
}

async function verifySeedData() {
  console.log('\n[setup] Verifying seed data...');

  // Check name pool
  const { data: names, error: nameErr } = await supabase
    .from('name_pool')
    .select('source, name')
    .order('source');

  if (nameErr) {
    console.log('  ✗ name_pool seed data — ERROR:', nameErr.message);
    return false;
  }

  const bebop = names.filter(n => n.source === 'cowboy_bebop').length;
  const eva = names.filter(n => n.source === 'evangelion').length;
  const gundam = names.filter(n => n.source === 'gundam_wing').length;
  console.log(`  ✓ name_pool: ${names.length} total (Bebop: ${bebop}, Evangelion: ${eva}, Gundam Wing: ${gundam})`);

  // Check policies
  const { data: policies, error: policyErr } = await supabase
    .from('policy')
    .select('name');

  if (policyErr) {
    console.log('  ✗ policy seed data — ERROR:', policyErr.message);
    return false;
  }
  console.log(`  ✓ policy: ${policies.length} rules loaded`);

  // Check teams
  const { data: teams, error: teamErr } = await supabase
    .from('teams')
    .select('id, name, status');

  if (teamErr) {
    console.log('  ✗ teams seed data — ERROR:', teamErr.message);
    return false;
  }

  for (const team of teams) {
    console.log(`  ✓ team: ${team.id} — ${team.name} [${team.status}]`);
  }

  return true;
}

async function testMemoryWriteRead() {
  console.log('\n[setup] Testing memory write/read cycle...');

  // Write a test memory
  const testMemory = {
    agent_id: 'test-agent',
    memory_type: 'observation',
    content: 'Memory system test — this entry verifies write/read works.',
    summary: 'System test',
    topic_tags: ['system-test', 'setup'],
    importance: 1,
    source_type: 'mission'
  };

  // We need a test agent first
  const { data: testAgent, error: agentErr } = await supabase
    .from('agents')
    .upsert({
      id: 'test-agent',
      name: 'Test Agent',
      display_name: 'Test',
      role: 'System Test',
      agent_type: 'sub_agent',
      status: 'retired'
    })
    .select()
    .single();

  if (agentErr) {
    console.log('  ✗ Could not create test agent:', agentErr.message);
    return false;
  }

  const { data: written, error: writeErr } = await supabase
    .from('agent_memories')
    .insert(testMemory)
    .select()
    .single();

  if (writeErr) {
    console.log('  ✗ Memory WRITE failed:', writeErr.message);
    return false;
  }
  console.log(`  ✓ Memory WRITE: id=${written.id}`);

  // Read it back
  const { data: read, error: readErr } = await supabase
    .from('agent_memories')
    .select('*')
    .eq('id', written.id)
    .single();

  if (readErr) {
    console.log('  ✗ Memory READ failed:', readErr.message);
    return false;
  }
  console.log(`  ✓ Memory READ: "${read.summary}" (tags: ${read.topic_tags.join(', ')})`);

  // Test topic tag retrieval
  const { data: tagged, error: tagErr } = await supabase
    .from('agent_memories')
    .select('*')
    .contains('topic_tags', ['system-test']);

  if (tagErr) {
    console.log('  ✗ Memory TAG RETRIEVAL failed:', tagErr.message);
    return false;
  }
  console.log(`  ✓ Memory TAG RETRIEVAL: found ${tagged.length} entries with tag "system-test"`);

  // Clean up test data
  await supabase.from('agent_memories').delete().eq('agent_id', 'test-agent');
  await supabase.from('agents').delete().eq('id', 'test-agent');
  console.log('  ✓ Test data cleaned up');

  return true;
}

async function main() {
  console.log('='.repeat(60));
  console.log('VoxYZ Agent World — Database Setup Verification');
  console.log('='.repeat(60));

  const connected = await testConnection();
  if (!connected) {
    console.log('\n[setup] ⚠ Run the schema SQL first, then re-run this script.');
    process.exit(1);
  }

  const tablesOk = await verifyTables();
  if (!tablesOk) {
    console.log('\n[setup] ⚠ Some tables missing. Run the full schema SQL.');
    process.exit(1);
  }

  const seedOk = await verifySeedData();
  const memoryOk = await testMemoryWriteRead();

  console.log('\n' + '='.repeat(60));
  if (tablesOk && seedOk && memoryOk) {
    console.log('✓ ALL CHECKS PASSED — Database is ready for VoxYZ Agent World');
  } else {
    console.log('⚠ SOME CHECKS FAILED — Review errors above');
  }
  console.log('='.repeat(60));
}

main().catch(console.error);
