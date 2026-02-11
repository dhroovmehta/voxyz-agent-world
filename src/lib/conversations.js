// conversations.js — Agent-to-agent conversation engine
// WHY: Agents need to communicate to coordinate work — handoffs, reviews,
// standups, and work discussions. Work-related conversations only at launch.
//
// How it works:
//   1. Heartbeat or worker triggers a conversation (e.g., daily standup, handoff)
//   2. A conversation_id groups all turns together
//   3. Turn-based: Agent A speaks → stored → Agent B reads + responds → stored
//   4. Each turn is saved as both a conversation_history row AND an agent_memory

const supabase = require('./supabase');
const { v4: uuidv4 } = require('uuid');

// Conversation types at launch (work-related only)
const CONVERSATION_TYPES = {
  standup: 'standup',         // Daily standup: what did I do, what's next, blockers
  handoff: 'handoff',         // Passing work between agents
  work_review: 'work_review', // Reviewing a deliverable
  delegation: 'delegation',   // Team lead assigning work
  report: 'report',           // Reporting to Frasier or team lead
  brainstorm: 'brainstorm'    // Working through a problem together
};

// ============================================================
// CONVERSATION LIFECYCLE
// ============================================================

/**
 * Start a new conversation between agents.
 * Returns a conversation ID that groups all turns.
 *
 * @param {Object} params
 * @param {string} params.type - One of CONVERSATION_TYPES
 * @param {string} params.initiatorAgentId - Who starts the conversation
 * @param {string} [params.recipientAgentId] - Who they're talking to (null for broadcast)
 * @param {string} [params.teamId] - Team context
 * @param {string} [params.context] - What the conversation is about
 * @param {number} [params.missionStepId] - If related to a specific task
 * @returns {Object} { conversationId, type, initiator, recipient }
 */
function startConversation({
  type,
  initiatorAgentId,
  recipientAgentId = null,
  teamId = null,
  context = null,
  missionStepId = null
}) {
  const conversationId = `conv-${type}-${Date.now()}-${uuidv4().substring(0, 8)}`;

  console.log(`[conversations] Started ${type} conversation: ${conversationId}`);
  console.log(`[conversations]   ${initiatorAgentId} → ${recipientAgentId || 'broadcast'}`);

  return {
    conversationId,
    type,
    initiator: initiatorAgentId,
    recipient: recipientAgentId,
    teamId,
    context,
    missionStepId
  };
}

/**
 * Add a turn to a conversation (one agent speaks).
 * Saved to both conversation_history and agent_memories.
 */
async function addTurn({
  conversationId,
  conversationType,
  senderAgentId,
  recipientAgentId = null,
  teamId = null,
  content,
  context = null,
  missionStepId = null,
  metadata = {}
}) {
  // Save to conversation_history
  const { data: turn, error } = await supabase
    .from('conversation_history')
    .insert({
      conversation_id: conversationId,
      conversation_type: conversationType,
      sender_agent_id: senderAgentId,
      recipient_agent_id: recipientAgentId,
      team_id: teamId,
      content,
      context,
      mission_step_id: missionStepId,
      metadata
    })
    .select()
    .single();

  if (error) {
    console.error(`[conversations] Failed to save turn:`, error.message);
    return null;
  }

  return turn;
}

/**
 * Get all turns in a conversation (ordered chronologically).
 */
async function getConversationTurns(conversationId) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`[conversations] Failed to get turns:`, error.message);
    return [];
  }
  return data || [];
}

/**
 * Build conversation context for an agent's next turn.
 * Returns formatted previous turns so the agent knows what's been said.
 */
async function buildConversationContext(conversationId) {
  const turns = await getConversationTurns(conversationId);
  if (turns.length === 0) return '';

  const lines = ['## Conversation So Far'];
  for (const turn of turns) {
    const time = new Date(turn.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });
    lines.push(`[${time}] ${turn.sender_agent_id}: ${turn.content}`);
  }

  return lines.join('\n');
}

// ============================================================
// CONVERSATION GENERATORS (called by heartbeat)
// ============================================================

/**
 * Generate a daily standup prompt for an agent.
 * Returns the user message to send to the agent's LLM call.
 */
function buildStandupPrompt(agentDisplayName) {
  return `It's time for the daily standup. Briefly share:
1. What you accomplished since the last standup
2. What you're working on next
3. Any blockers or concerns

Be concise and specific. Reference actual tasks and outcomes from your memory.`;
}

/**
 * Generate a handoff prompt when one agent passes work to another.
 */
function buildHandoffPrompt(fromAgentName, taskDescription, priorWork) {
  return `${fromAgentName} is handing off the following task to you:

**Task:** ${taskDescription}

**Work completed so far:**
${priorWork}

Review what's been done, then continue the work. If you have questions or concerns about the handoff, state them clearly.`;
}

/**
 * Generate a work review prompt for QA or Team Lead.
 */
function buildReviewPrompt(authorAgentName, deliverable, taskDescription) {
  return `Review this deliverable from ${authorAgentName}:

**Task:** ${taskDescription}

**Deliverable:**
${deliverable}

Evaluate for:
1. Completeness — Does it fully address the task?
2. Accuracy — Are facts, data, and claims correct?
3. Quality — Is it well-written, clear, and professional?
4. Depth — Does it show deep domain expertise?

If it meets all criteria, approve it. If not, provide specific, actionable feedback for revision. Be thorough — this must be executive-ready and client-facing.`;
}

/**
 * Generate a delegation prompt for a team lead assigning work.
 */
function buildDelegationPrompt(teamLeadName, taskDescription, agentRole) {
  return `${teamLeadName} is assigning you the following task:

**Task:** ${taskDescription}

You are being assigned this because of your expertise as ${agentRole}. Break down your approach, then execute. If you need clarification, ask your team lead.`;
}

// ============================================================
// CONVERSATION RETRIEVAL
// ============================================================

/**
 * Get recent conversations for an agent.
 */
async function getAgentConversations(agentId, limit = 10) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .or(`sender_agent_id.eq.${agentId},recipient_agent_id.eq.${agentId}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[conversations] Failed to get conversations for ${agentId}:`, error.message);
    return [];
  }
  return data || [];
}

/**
 * Get recent conversations for a team.
 */
async function getTeamConversations(teamId, limit = 20) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[conversations] Failed to get team conversations:`, error.message);
    return [];
  }
  return data || [];
}

module.exports = {
  CONVERSATION_TYPES,
  startConversation,
  addTurn,
  getConversationTurns,
  buildConversationContext,
  buildStandupPrompt,
  buildHandoffPrompt,
  buildReviewPrompt,
  buildDelegationPrompt,
  getAgentConversations,
  getTeamConversations
};
