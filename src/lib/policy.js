// policy.js — Rule engine backed by the policy table
// WHY: Every agent action checks policy before executing.
// Free actions auto-execute. Any money requires founder approval.
// Policies are versioned and auditable in PostgreSQL.

const supabase = require('./supabase');

// Cache policies in memory for 5 minutes to avoid hitting DB on every check
let policyCache = null;
let policyCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================
// POLICY RETRIEVAL
// ============================================================

/**
 * Get all active policies, cached for 5 minutes.
 */
async function getPolicies() {
  const now = Date.now();
  if (policyCache && (now - policyCacheTime) < CACHE_TTL_MS) {
    return policyCache;
  }

  const { data, error } = await supabase
    .from('policy')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('[policy] Failed to fetch policies:', error.message);
    return policyCache || []; // Return stale cache if available
  }

  policyCache = data || [];
  policyCacheTime = now;
  return policyCache;
}

/**
 * Get a specific policy by type.
 */
async function getPolicy(policyType) {
  const policies = await getPolicies();
  return policies.find(p => p.policy_type === policyType) || null;
}

// ============================================================
// AUTHORIZATION CHECKS
// ============================================================

/**
 * Check if an action is authorized under current policy.
 * Returns { authorized, reason, requiresApproval, approver }
 *
 * @param {Object} params
 * @param {string} params.action - What the agent wants to do
 * @param {number} [params.costUsd] - Estimated cost of the action (0 = free)
 * @param {string} [params.agentId] - Who wants to do it
 * @param {string} [params.agentType] - chief_of_staff | team_lead | sub_agent
 * @returns {Object} Authorization result
 */
async function checkAuthorization({ action, costUsd = 0, agentId = null, agentType = 'sub_agent' }) {
  const spendingPolicy = await getPolicy('spending_limit');

  // Rule: Any spending requires Zero approval
  if (costUsd > 0) {
    const threshold = spendingPolicy?.rules?.threshold_usd || 0.01;
    if (costUsd >= threshold) {
      return {
        authorized: false,
        reason: `Action costs $${costUsd.toFixed(2)}. All spending requires founder approval.`,
        requiresApproval: true,
        approver: 'zero'
      };
    }
  }

  // Free actions are auto-approved
  return {
    authorized: true,
    reason: 'Free action — auto-approved',
    requiresApproval: false,
    approver: null
  };
}

/**
 * Check if a Tier 3 (Claude) model call is authorized.
 * Always requires explicit founder approval.
 */
async function checkTier3Authorization() {
  const routingPolicy = await getPolicy('model_routing');
  const requiresApproval = routingPolicy?.rules?.tier3?.requires_approval !== false;

  return {
    authorized: !requiresApproval,
    reason: requiresApproval
      ? 'Tier 3 (Claude Opus 4.5) requires explicit founder approval via Frasier DM.'
      : 'Tier 3 auto-approved by policy',
    requiresApproval,
    approver: 'zero'
  };
}

// ============================================================
// SCHEDULE CHECKS
// ============================================================

/**
 * Check if now is within Zero's operating hours.
 * Used to decide notification urgency.
 */
async function isWithinOperatingHours() {
  const policy = await getPolicy('operating_hours');
  if (!policy) return true; // No policy = always available

  const rules = policy.rules;
  const tz = rules.timezone || 'America/New_York';

  // Get current time in the configured timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  const currentMinutes = hour * 60 + minute;

  const [startH, startM] = rules.start.split(':').map(Number);
  const [endH, endM] = rules.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Get the daily summary schedule.
 */
async function getDailySummarySchedule() {
  const policy = await getPolicy('daily_summary');
  if (!policy) {
    return { time: '09:30', timezone: 'America/New_York' };
  }
  return policy.rules;
}

/**
 * Get the cost alert threshold.
 */
async function getCostAlertThreshold() {
  const policy = await getPolicy('cost_alert');
  if (!policy) {
    return { dailyThresholdUsd: 10 };
  }
  return {
    dailyThresholdUsd: policy.rules.daily_threshold_usd || 10
  };
}

// ============================================================
// POLICY MANAGEMENT
// ============================================================

/**
 * Update a policy's rules. Creates a new version.
 */
async function updatePolicy(policyType, newRules) {
  const existing = await getPolicy(policyType);
  if (!existing) {
    console.error(`[policy] Policy type "${policyType}" not found`);
    return null;
  }

  const { data, error } = await supabase
    .from('policy')
    .update({
      rules: newRules,
      version: existing.version + 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', existing.id)
    .select()
    .single();

  if (error) {
    console.error(`[policy] Failed to update policy:`, error.message);
    return null;
  }

  // Invalidate cache
  policyCache = null;
  console.log(`[policy] Updated ${policyType} to version ${data.version}`);
  return data;
}

/**
 * Clear the policy cache. Called when policies are updated externally.
 */
function clearCache() {
  policyCache = null;
  policyCacheTime = 0;
}

module.exports = {
  getPolicies,
  getPolicy,
  checkAuthorization,
  checkTier3Authorization,
  isWithinOperatingHours,
  getDailySummarySchedule,
  getCostAlertThreshold,
  updatePolicy,
  clearCache
};
