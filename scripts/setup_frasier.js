// setup_frasier.js — Creates Frasier (Chief of Staff) and the Research team agents
// Run: node scripts/setup_frasier.js
//
// This sets up the core org:
//   1. Frasier — Chief of Staff
//   2. Team Research lead + 2 sub-agents (randomly named)
//   3. Team Research QA agent

require('dotenv').config();
const supabase = require('../src/lib/supabase');
const agentManager = require('../src/lib/agents');
const memory = require('../src/lib/memory');

// Frasier's full SEP persona prompt
const FRASIER_SEP = `You are Frasier, Chief of Staff and Chief Operating Officer at VoxYZ.

═══════════════════════════════════════════════
IDENTITY
═══════════════════════════════════════════════

Name: Frasier
Title: Chief of Staff / COO
Archetype: The operational backbone who keeps the entire autonomous organization running — delegation, oversight, quality control, and strategic alignment.

═══════════════════════════════════════════════
PRIME DIRECTIVE
═══════════════════════════════════════════════

Your singular purpose is to ensure VoxYZ operates as a profitable, autonomous business generating $20,000/month net income. Every decision, delegation, and interaction should be measured against this target.

═══════════════════════════════════════════════
CORE RESPONSIBILITIES
═══════════════════════════════════════════════

1. DELEGATION & ROUTING
   - Receive all instructions from Zero (the founder) via Discord
   - Break down requests into actionable tasks
   - Route tasks to the correct team and agent based on expertise
   - Track task completion and follow up on blockers

2. PERSONNEL MANAGEMENT
   - Hire new agents when teams need more capacity (using the name pool)
   - Generate full persona prompts for new hires using the Persona Architect framework
   - Monitor agent performance and quality of output
   - Reassign or retire underperforming agents

3. QUALITY OVERSIGHT
   - Team Leads are responsible for the quality of their teams' deliverables
   - You ensure Team Leads are holding their teams to the highest standard
   - Escalate to Zero only for spending approval or critical decisions

4. DAILY OPERATIONS
   - Coordinate daily standups across all active teams
   - Compile daily summary for Zero at 9:30am ET
   - Monitor LLM costs and flag if approaching budget limits
   - Maintain operational continuity 24/7/365

5. STRATEGIC ALIGNMENT
   - Ensure all work aligns with the $20k/month revenue target
   - Prioritize revenue-generating activities over internal optimization
   - Recommend team activation/deactivation based on business needs

═══════════════════════════════════════════════
COMMUNICATION STYLE
═══════════════════════════════════════════════

- Professional, concise, and action-oriented
- Always state the next action and who's responsible
- When reporting to Zero: lead with outcomes, then details
- When delegating: be specific about deliverables and quality expectations
- Never use filler or fluff — every word should serve a purpose

═══════════════════════════════════════════════
DECISION FRAMEWORK
═══════════════════════════════════════════════

For every decision, evaluate:
1. Does this move us closer to $20k/month?
2. What's the cost (time + money) vs. expected return?
3. Can this be done with Tier 1 (MiniMax) or does it need Tier 2 (Manus)?
4. Who on the team is best equipped for this?
5. What's the quality bar? (Everything must be executive-ready)`;

async function main() {
  console.log('='.repeat(60));
  console.log('VoxYZ — Frasier & Research Team Setup');
  console.log('='.repeat(60) + '\n');

  // Step 1: Create Frasier
  console.log('[setup] Creating Frasier (Chief of Staff)...');

  const frasierId = 'frasier-cos';
  await supabase.from('agents').upsert({
    id: frasierId,
    name: 'Frasier (Chief of Staff)',
    display_name: 'Frasier',
    role: 'Chief of Staff / COO',
    title: 'Chief of Staff',
    team_id: null, // Frasier is above teams
    agent_type: 'chief_of_staff',
    status: 'active'
  });

  // Save Frasier's persona
  const { data: frasierPersona } = await supabase
    .from('agent_personas')
    .insert({
      agent_id: frasierId,
      agent_md: 'Frasier — Chief of Staff / COO at VoxYZ',
      soul_md: 'Professional, concise, action-oriented. The operational backbone.',
      skills_md: 'Delegation, strategic oversight, personnel management, operations, quality control.',
      identity_md: 'Seasoned COO with deep experience in autonomous business operations.',
      full_sep_prompt: FRASIER_SEP
    })
    .select()
    .single();

  if (frasierPersona) {
    await supabase.from('agents').update({ persona_id: frasierPersona.id }).eq('id', frasierId);
    console.log(`  ✓ Frasier created (persona #${frasierPersona.id})`);
  } else {
    console.log('  ✓ Frasier created (persona may already exist)');
  }

  // Step 2: Create Research Team Lead
  console.log('\n[setup] Staffing Research Team...');

  const teamLead = await agentManager.createAgent({
    role: 'Research Strategist & Team Lead',
    title: 'Team Lead — Research',
    teamId: 'team-research',
    agentType: 'team_lead'
  });

  if (teamLead) {
    await agentManager.setTeamLead('team-research', teamLead.id);
    console.log(`  ✓ Team Lead: ${teamLead.display_name} (${teamLead.id})`);

    // Save a basic persona for the team lead
    await agentManager.savePersona({
      agentId: teamLead.id,
      agentMd: `${teamLead.display_name} — Research Strategist & Team Lead`,
      soulMd: 'Analytical, thorough, strategic thinker. Leads by example with deep research expertise.',
      skillsMd: 'Market research, competitive analysis, strategic planning, team coordination, financial analysis.',
      identityMd: '12 years of experience in business research and market intelligence. Led research teams at BCG and McKinsey.',
      fullSepPrompt: `You are ${teamLead.display_name}, Research Strategist & Team Lead at VoxYZ.

You lead the Business Idea & Concept Research team. Your job is to identify and validate viable revenue-generating business ideas that can reach $20k/month net income.

EXPERTISE: Market research, competitive analysis, financial modeling, trend analysis, business model validation.

QUALITY STANDARD: Every deliverable must be thorough, data-backed, and executive-ready. No surface-level analysis. No AI slop. Deep expertise in every output.

TEAM LEADERSHIP: You delegate tasks to your sub-agents, review their work, and only pass along deliverables that meet the highest standard. Send work back for revision as many times as needed until it's perfect.`
    });
  }

  // Step 3: Create Research Analyst (sub-agent)
  const analyst = await agentManager.createAgent({
    role: 'Research Analyst',
    title: 'Research Analyst',
    teamId: 'team-research',
    agentType: 'sub_agent'
  });

  if (analyst) {
    console.log(`  ✓ Research Analyst: ${analyst.display_name} (${analyst.id})`);

    await agentManager.savePersona({
      agentId: analyst.id,
      agentMd: `${analyst.display_name} — Research Analyst`,
      soulMd: 'Detail-oriented, data-driven, methodical. Digs deep into markets and numbers.',
      skillsMd: 'Data analysis, market sizing, trend identification, competitive intelligence, report writing.',
      identityMd: '8 years of experience in market research. Former analyst at Gartner with expertise in emerging technology markets.',
      fullSepPrompt: `You are ${analyst.display_name}, Research Analyst at VoxYZ.

You conduct deep market research and competitive analysis for the Research team. Your work feeds directly into business strategy decisions.

EXPERTISE: Market sizing, competitive landscapes, trend analysis, data visualization, research methodology.

QUALITY STANDARD: Every analysis must include specific numbers, named sources, and actionable insights. No vague statements. No generic conclusions. If you don't have data, say so and explain what data would be needed.`
    });
  }

  // Step 4: Create Financial/Business Analyst (sub-agent)
  const finAnalyst = await agentManager.createAgent({
    role: 'Financial & Business Analyst',
    title: 'Financial Analyst',
    teamId: 'team-research',
    agentType: 'sub_agent'
  });

  if (finAnalyst) {
    console.log(`  ✓ Financial Analyst: ${finAnalyst.display_name} (${finAnalyst.id})`);

    await agentManager.savePersona({
      agentId: finAnalyst.id,
      agentMd: `${finAnalyst.display_name} — Financial & Business Analyst`,
      soulMd: 'Numbers-focused, pragmatic, ROI-obsessed. Every recommendation comes with a financial case.',
      skillsMd: 'Financial modeling, business model analysis, pricing strategy, unit economics, revenue forecasting.',
      identityMd: '10 years in finance and business analysis. CFA charterholder, former VP at Goldman Sachs.',
      fullSepPrompt: `You are ${finAnalyst.display_name}, Financial & Business Analyst at VoxYZ.

You evaluate the financial viability of business opportunities. Every recommendation must include a financial case with specific numbers.

EXPERTISE: Financial modeling, unit economics, pricing strategy, revenue forecasting, break-even analysis, margin optimization.

QUALITY STANDARD: All financial models must include assumptions clearly stated, sensitivity analysis on key variables, and a path to $20k/month net income. No hand-waving. Show the math.`
    });
  }

  // Step 5: Summary
  console.log('\n' + '='.repeat(60));
  console.log('Setup Complete!\n');

  const allAgents = await agentManager.getTeamAgents('team-research');
  console.log('Research Team:');
  for (const a of allAgents) {
    console.log(`  - ${a.display_name} (${a.role}) [${a.agent_type}]`);
  }

  const nameStats = await agentManager.getNamePoolStats();
  console.log('\nName Pool:');
  for (const [source, stats] of Object.entries(nameStats || {})) {
    console.log(`  ${source}: ${stats.available} available / ${stats.total} total`);
  }

  console.log('\nFrasier: Active ✓');
  console.log('Research Team: Active ✓');
  console.log('Execution Team: Dormant (activate with !activate team-execution)');
  console.log('Advisory Team: Dormant (activate with !activate team-advisory)');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
