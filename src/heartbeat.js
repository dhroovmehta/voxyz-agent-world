// heartbeat.js — Orchestration engine (PM2 process #2)
// WHY: This is the "brain" that keeps the system running.
// Polls every 30 seconds for state changes and triggers actions:
//   - Picks up new proposals → creates missions → assigns steps to agents
//   - Schedules daily standups (9:00am ET)
//   - Routes steps through the approval chain (QA → Team Lead)
//   - Checks mission completion
//   - Monitors for errors and triggers alerts
//
// No WebSockets. No pub/sub. Just polling. It's simpler and it works.

require('dotenv').config();
const missions = require('./lib/missions');
const agents = require('./lib/agents');
const conversations = require('./lib/conversations');
const memory = require('./lib/memory');
const models = require('./lib/models');
const events = require('./lib/events');
const policy = require('./lib/policy');

const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
let running = true;
let lastStandupDate = null; // Track if standup ran today

// ============================================================
// MAIN LOOP
// ============================================================

async function main() {
  console.log('[heartbeat] Starting orchestration engine...');
  await events.logEvent({
    eventType: 'heartbeat_started',
    severity: 'info',
    description: 'Heartbeat orchestration engine started'
  });

  while (running) {
    try {
      await tick();
    } catch (err) {
      console.error('[heartbeat] Unexpected error in tick:', err.message);
      await events.logEvent({
        eventType: 'heartbeat_error',
        severity: 'error',
        description: `Heartbeat tick error: ${err.message}`
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * One tick of the heartbeat. Runs all checks in sequence.
 */
async function tick() {
  // 1. Process new proposals → missions
  await processProposals();

  // 2. Route steps through approval chain
  await processApprovals();

  // 3. Check for completed missions
  await checkMissions();

  // 4. Schedule daily standup (time-based trigger)
  await checkDailyStandup();
}

// ============================================================
// PROPOSAL PROCESSING
// ============================================================

/**
 * Pick up pending proposals, create missions, break into steps, assign to agents.
 */
async function processProposals() {
  const proposals = await missions.getPendingProposals();
  if (proposals.length === 0) return;

  console.log(`[heartbeat] Processing ${proposals.length} pending proposal(s)...`);

  for (const proposal of proposals) {
    try {
      // Determine target team
      const teamId = proposal.assigned_team_id || 'team-research'; // Default to research team

      // Check team is active
      const team = await agents.getTeam(teamId);
      if (!team || team.status !== 'active') {
        console.log(`[heartbeat] Team ${teamId} not active. Proposal #${proposal.id} deferred.`);
        continue;
      }

      // Accept proposal and create mission
      const mission = await missions.acceptProposal(proposal.id, teamId);
      if (!mission) continue;

      // Get team agents for assignment
      const teamAgents = await agents.getTeamAgents(teamId);
      if (teamAgents.length === 0) {
        console.log(`[heartbeat] No agents on team ${teamId}. Mission #${mission.id} created but no steps assigned.`);
        continue;
      }

      // Route task to best-fit agent
      const bestRole = missions.routeByKeywords(proposal.description || proposal.title);
      const assignee = findBestAgent(teamAgents, bestRole) || teamAgents[0];

      // Determine model tier
      const isComplex = proposal.priority === 'urgent';
      const modelTier = isComplex ? 'tier2' : 'tier1';

      // Create the step
      await missions.createStep({
        missionId: mission.id,
        description: proposal.description || proposal.title,
        assignedAgentId: assignee.id,
        modelTier,
        stepOrder: 1
      });

      await events.logEvent({
        eventType: 'mission_created',
        agentId: assignee.id,
        teamId,
        severity: 'info',
        description: `Mission #${mission.id}: "${proposal.title}" assigned to ${assignee.display_name}`,
        data: { missionId: mission.id, proposalId: proposal.id }
      });

      console.log(`[heartbeat] Mission #${mission.id} created, assigned to ${assignee.display_name} (${modelTier})`);

    } catch (err) {
      console.error(`[heartbeat] Error processing proposal #${proposal.id}:`, err.message);
    }
  }
}

/**
 * Find the best agent for a role category on a team.
 * Prefers: team_lead for strategy, sub_agents for execution.
 */
function findBestAgent(teamAgents, roleCategory) {
  // Simple matching: look for agents whose role contains relevant keywords
  const roleKeywords = {
    research: ['research', 'analyst', 'intelligence'],
    strategy: ['strategy', 'lead', 'strategist'],
    content: ['content', 'writer', 'creator', 'copywriter'],
    engineering: ['engineer', 'developer', 'architect'],
    qa: ['qa', 'quality', 'tester'],
    marketing: ['marketing', 'growth', 'seo'],
    knowledge: ['knowledge', 'documentation', 'curator']
  };

  const keywords = roleKeywords[roleCategory] || [];
  for (const agent of teamAgents) {
    const agentRole = (agent.role || '').toLowerCase();
    if (keywords.some(kw => agentRole.includes(kw))) {
      return agent;
    }
  }

  // Fallback: return team lead if available, else first agent
  return teamAgents.find(a => a.agent_type === 'team_lead') || null;
}

// ============================================================
// APPROVAL CHAIN PROCESSING
// ============================================================

/**
 * Find steps in review that need approvals created,
 * and route them through the QA → Team Lead chain.
 */
async function processApprovals() {
  const stepsNeedingReview = await missions.getStepsNeedingReview();
  if (stepsNeedingReview.length === 0) return;

  for (const step of stepsNeedingReview) {
    try {
      // Get the team for this step's mission
      const { data: missionData } = await require('./lib/supabase')
        .from('missions')
        .select('team_id')
        .eq('id', step.mission_id)
        .single();

      if (!missionData) continue;

      const teamAgents = await agents.getTeamAgents(missionData.team_id);

      // Find QA agent on the team
      const qaAgent = teamAgents.find(a => a.agent_type === 'qa' || a.role?.toLowerCase().includes('qa'));

      // Find team lead
      const teamLead = teamAgents.find(a => a.agent_type === 'team_lead');

      if (qaAgent) {
        // Route to QA first
        await missions.createApproval({
          missionStepId: step.id,
          reviewerAgentId: qaAgent.id,
          reviewType: 'qa'
        });
        console.log(`[heartbeat] Step #${step.id} sent to QA (${qaAgent.display_name})`);
      } else if (teamLead) {
        // No QA? Go straight to team lead
        await missions.createApproval({
          missionStepId: step.id,
          reviewerAgentId: teamLead.id,
          reviewType: 'team_lead'
        });
        console.log(`[heartbeat] Step #${step.id} sent to Team Lead (${teamLead.display_name})`);
      } else {
        // No reviewers available — auto-approve
        await missions.approveStep(step.id);
        console.log(`[heartbeat] Step #${step.id} auto-approved (no reviewers on team)`);
      }
    } catch (err) {
      console.error(`[heartbeat] Error processing approval for step #${step.id}:`, err.message);
    }
  }
}

// ============================================================
// MISSION COMPLETION CHECK
// ============================================================

async function checkMissions() {
  const activeMissions = await missions.getActiveMissions();

  for (const mission of activeMissions) {
    const completed = await missions.checkMissionCompletion(mission.id);
    if (completed) {
      await events.logEvent({
        eventType: 'mission_completed',
        teamId: mission.team_id,
        severity: 'info',
        description: `Mission #${mission.id}: "${mission.title}" completed`,
        data: { missionId: mission.id }
      });
    }
  }
}

// ============================================================
// DAILY STANDUP (time-based trigger)
// ============================================================

async function checkDailyStandup() {
  const schedule = await policy.getDailySummarySchedule();
  const tz = schedule.timezone || 'America/New_York';
  const [targetH, targetM] = (schedule.time || '09:00').split(':').map(Number);

  // Get current time in target timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = formatter.formatToParts(now);
  const currentDate = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);

  // Check if it's standup time (within 5-minute window) and hasn't run today
  if (hour === targetH && minute >= targetM && minute < targetM + 5 && lastStandupDate !== currentDate) {
    lastStandupDate = currentDate;
    console.log(`[heartbeat] Triggering daily standup for ${currentDate}...`);
    await runDailyStandup();
  }
}

/**
 * Run the daily standup for all active agents.
 * Each agent gets a standup prompt, responds via LLM.
 */
async function runDailyStandup() {
  const activeAgents = await agents.getAllActiveAgents();
  if (activeAgents.length === 0) {
    console.log('[heartbeat] No active agents for standup');
    return;
  }

  const standupConv = conversations.startConversation({
    type: 'standup',
    initiatorAgentId: 'system',
    context: `Daily standup — ${new Date().toLocaleDateString('en-US')}`
  });

  for (const agent of activeAgents) {
    try {
      // Build agent prompt with memory
      const promptData = await memory.buildAgentPrompt(agent.id, ['standup', 'daily-update']);
      if (promptData.error) continue;

      const standupPrompt = conversations.buildStandupPrompt(agent.display_name);

      // Call LLM for standup response
      const result = await models.callLLM({
        systemPrompt: promptData.systemPrompt,
        userMessage: standupPrompt,
        agentId: agent.id,
        forceTier: 'tier1' // Standups always use cheapest model
      });

      if (result.content) {
        // Save standup turn
        await conversations.addTurn({
          conversationId: standupConv.conversationId,
          conversationType: 'standup',
          senderAgentId: agent.id,
          teamId: agent.team_id,
          content: result.content,
          context: 'Daily standup'
        });

        // Save to memory
        await memory.saveMemory({
          agentId: agent.id,
          memoryType: 'conversation',
          content: `Daily standup: ${result.content}`,
          summary: `Standup update`,
          topicTags: ['standup', 'daily-update'],
          importance: 4,
          sourceType: 'standup'
        });

        console.log(`[heartbeat] ${agent.display_name} standup: ${result.content.substring(0, 80)}...`);
      }
    } catch (err) {
      console.error(`[heartbeat] Standup error for ${agent.display_name}:`, err.message);
    }
  }

  await events.logEvent({
    eventType: 'daily_standup',
    severity: 'info',
    description: `Daily standup completed with ${activeAgents.length} agents`
  });
}

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[heartbeat] Shutting down...');
  running = false;
});

process.on('SIGTERM', () => {
  console.log('[heartbeat] Shutting down...');
  running = false;
});

main().catch(err => {
  console.error('[heartbeat] Fatal error:', err);
  process.exit(1);
});
