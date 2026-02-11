// Check what tables already exist in the database
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  // Try the old tables from the PRD
  const oldTables = [
    'ops_mission_proposals', 'ops_missions', 'ops_mission_steps',
    'ops_agents', 'ops_events', 'ops_policy'
  ];

  console.log('Checking for existing tables from previous build...\n');

  for (const table of oldTables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`  ✗ ${table} — not found`);
    } else {
      console.log(`  ✓ ${table} — EXISTS (${data.length} rows visible)`);
    }
  }
}

main().catch(console.error);
