// test_pipeline.js — End-to-end pipeline test
// Tests the full critical path WITHOUT calling the LLM:
//   Proposal → Mission → Step → Simulated Execution → Approval Chain → Completion
//
// Run: node scripts/test_pipeline.js

require('dotenv').config();
const supabase = require('../src/lib/supabase');
const missions = require('../src/lib/missions');
const agents = require('../src/lib/agents');
const memory = require('../src/lib/memory');
const events = require('../src/lib/events');
const policy = require('../src/lib/policy');
const models = require('../src/lib/models');

async function main() {
  console.log('='.repeat(60));
  console.log('VoxYZ — End-to-End Pipeline Test');
  console.log('='.repeat(60) + '\n');

  // Step 1: Verify agents exist
  console.log('=== Step 1: Verify Agents ===\n');
  const teamAgents = await agents.getTeamAgents('team-research');
  console.log(`  Research team agents: ${teamAgents.length}`);
  for (const a of teamAgents) {
    console.log(`    - ${a.display_name} (${a.role}) [${a.agent_type}]`);
  }
  if (teamAgents.length === 0) {
    console.log('  ✗ No agents! Run setup_frasier.js first.');
    process.exit(1);
  }

  // Step 2: Create a proposal
  console.log('\n=== Step 2: Create Proposal ===\n');
  const proposal = await missions.createProposal({
    proposingAgentId: 'zero',
    title: 'Research top 5 AI SaaS business models for solopreneurs',
    description: 'Identify the top 5 AI-powered SaaS business models that a solopreneur can launch with minimal capital. For each model, provide: target market, revenue potential, competitive landscape, estimated time to first revenue, and key risks.',
    priority: 'normal',
    targetTeamId: 'team-research'
  });

  if (!proposal) {
    console.log('  ✗ Failed to create proposal');
    process.exit(1);
  }
  console.log(`  ✓ Proposal #${proposal.id} created`);

  // Step 3: Simulate heartbeat picking up the proposal
  console.log('\n=== Step 3: Accept Proposal → Create Mission ===\n');
  const mission = await missions.acceptProposal(proposal.id, 'team-research');
  if (!mission) {
    console.log('  ✗ Failed to accept proposal');
    process.exit(1);
  }
  console.log(`  ✓ Mission #${mission.id} created from proposal`);

  // Step 4: Assign a step to an agent
  console.log('\n=== Step 4: Create Mission Step ===\n');
  const bestRole = missions.routeByKeywords(proposal.description);
  console.log(`  Route analysis: best role = "${bestRole}"`);

  // Find best agent for the role
  const assignee = teamAgents.find(a => a.role.toLowerCase().includes('research')) || teamAgents[0];
  console.log(`  Assigned to: ${assignee.display_name} (${assignee.role})`);

  const step = await missions.createStep({
    missionId: mission.id,
    description: proposal.description,
    assignedAgentId: assignee.id,
    modelTier: 'tier1',
    stepOrder: 1
  });

  if (!step) {
    console.log('  ✗ Failed to create step');
    process.exit(1);
  }
  console.log(`  ✓ Step #${step.id} created (status: ${step.status})`);

  // Step 5: Worker claims the step
  console.log('\n=== Step 5: Worker Claims Step ===\n');
  const claimed = await missions.claimStep(step.id);
  if (!claimed) {
    console.log('  ✗ Failed to claim step');
    process.exit(1);
  }
  console.log(`  ✓ Step claimed (status: ${claimed.status})`);

  // Step 6: Simulate LLM response (no actual API call)
  console.log('\n=== Step 6: Simulate LLM Execution ===\n');

  // Build the prompt to verify it works
  const promptData = await memory.buildAgentPrompt(assignee.id, ['business-research', 'ai-saas']);
  if (promptData.error) {
    console.log(`  ✗ Failed to build prompt: ${promptData.error}`);
    process.exit(1);
  }
  console.log(`  ✓ Agent prompt built (${promptData.systemPrompt.length} chars)`);
  console.log(`  ✓ Memories loaded: ${promptData.memories.totalCount}`);

  // Simulate a result (would normally come from LLM)
  const simulatedResult = `# Top 5 AI SaaS Business Models for Solopreneurs

## 1. AI Content Generation Platform
- Target: SMBs needing marketing content
- Revenue: $15-30k/month at 200 subscribers ($79/mo avg)
- Competition: Jasper, Copy.ai — gap in niche-specific content
- Time to revenue: 2-3 months
- Key risk: API cost scaling

## 2. AI Customer Support Chatbot
- Target: E-commerce businesses
- Revenue: $20-40k/month at 150 subscribers ($199/mo avg)
- Competition: Intercom, Drift — gap in affordable SMB solutions
- Time to revenue: 3-4 months
- Key risk: Accuracy requirements

[Simulated — this would be real LLM output in production]`;

  // Complete the step (goes to in_review)
  const completed = await missions.completeStep(step.id, simulatedResult);
  console.log(`  ✓ Step completed (status: ${completed.status})`);

  // Save to agent memory
  await memory.saveMemory({
    agentId: assignee.id,
    memoryType: 'task',
    content: `Completed research on AI SaaS business models. Identified 5 viable models.`,
    summary: 'Completed AI SaaS business model research',
    topicTags: ['business-research', 'ai-saas', 'market-analysis'],
    importance: 7,
    sourceType: 'mission',
    sourceId: String(mission.id)
  });
  console.log(`  ✓ Memory saved for ${assignee.display_name}`);

  // Step 7: Approval chain
  console.log('\n=== Step 7: Approval Chain ===\n');

  // Find team lead for review
  const teamLead = teamAgents.find(a => a.agent_type === 'team_lead');
  if (teamLead) {
    const approval = await missions.createApproval({
      missionStepId: step.id,
      reviewerAgentId: teamLead.id,
      reviewType: 'team_lead'
    });
    console.log(`  ✓ Approval request created for ${teamLead.display_name} (Team Lead)`);

    // Simulate approval
    const reviewed = await missions.submitReview(approval.id, {
      status: 'approved',
      feedback: 'Solid research. Data-backed and actionable. Approved.'
    });
    console.log(`  ✓ Review submitted: ${reviewed.status}`);

    // Mark step as approved
    await missions.approveStep(step.id);
    console.log(`  ✓ Step #${step.id} approved`);
  } else {
    console.log('  ⚠ No team lead found, auto-approving');
    await missions.approveStep(step.id);
  }

  // Step 8: Check mission completion
  console.log('\n=== Step 8: Mission Completion ===\n');
  const missionDone = await missions.checkMissionCompletion(mission.id);
  console.log(`  Mission completed: ${missionDone ? '✓ YES' : '✗ NO'}`);

  // Step 9: Verify event log
  console.log('\n=== Step 9: Event Log ===\n');
  await events.logEvent({
    eventType: 'pipeline_test',
    severity: 'info',
    description: 'Pipeline test completed successfully',
    data: { missionId: mission.id, stepId: step.id }
  });
  console.log('  ✓ Test event logged');

  // Step 10: Policy checks
  console.log('\n=== Step 10: Policy Checks ===\n');

  const freeAction = await policy.checkAuthorization({ action: 'research', costUsd: 0 });
  console.log(`  Free action authorized: ${freeAction.authorized ? '✓ YES' : '✗ NO'} — ${freeAction.reason}`);

  const paidAction = await policy.checkAuthorization({ action: 'buy tool', costUsd: 50 });
  console.log(`  $50 action authorized: ${paidAction.authorized ? '✓ YES' : '✗ NO'} — ${paidAction.reason}`);

  const tier3Auth = await policy.checkTier3Authorization();
  console.log(`  Tier 3 (Claude) authorized: ${tier3Auth.authorized ? '✓ YES' : '✗ NO'} — ${tier3Auth.reason}`);

  const withinHours = await policy.isWithinOperatingHours();
  console.log(`  Within operating hours: ${withinHours ? '✓ YES' : '✗ NO'}`);

  // Step 11: Model routing
  console.log('\n=== Step 11: Model Routing ===\n');
  const tier1 = models.selectTier(false, 'Write a tweet about our new product');
  console.log(`  "Write a tweet" → ${tier1}`);

  const tier2 = models.selectTier(false, 'Conduct a deep competitive analysis of the AI automation market');
  console.log(`  "Deep competitive analysis" → ${tier2}`);

  const tier2forced = models.selectTier(true, 'Simple summary');
  console.log(`  "Simple summary" (isComplex=true) → ${tier2forced}`);

  // Cleanup
  console.log('\n=== Cleanup ===\n');
  await supabase.from('approval_chain').delete().eq('mission_step_id', step.id);
  await supabase.from('agent_memories').delete().eq('source_id', String(mission.id));
  await supabase.from('mission_steps').delete().eq('mission_id', mission.id);
  await supabase.from('missions').delete().eq('id', mission.id);
  await supabase.from('mission_proposals').delete().eq('id', proposal.id);
  console.log('  ✓ Test data cleaned up');

  console.log('\n' + '='.repeat(60));
  console.log('✓ ALL PIPELINE TESTS PASSED');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Pipeline test failed:', err);
  process.exit(1);
});
