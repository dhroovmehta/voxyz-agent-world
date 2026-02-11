// events.js — Central event logger
// WHY: Every significant action creates an event row. Events are the audit trail.
// Used by heartbeat for trigger detection, by monitoring for alerts,
// and by Frasier for daily summaries.

const supabase = require('./supabase');

/**
 * Log an event.
 *
 * @param {Object} params
 * @param {string} params.eventType - mission_created | task_completed | agent_hired | error | etc.
 * @param {string} [params.agentId]
 * @param {string} [params.teamId]
 * @param {string} [params.severity] - debug | info | warning | error | critical
 * @param {string} [params.description]
 * @param {Object} [params.data] - Flexible JSON payload
 */
async function logEvent({
  eventType,
  agentId = null,
  teamId = null,
  severity = 'info',
  description = null,
  data = {}
}) {
  const { error } = await supabase
    .from('events')
    .insert({
      event_type: eventType,
      agent_id: agentId,
      team_id: teamId,
      severity,
      description,
      data
    });

  if (error) {
    console.error(`[events] Failed to log event ${eventType}:`, error.message);
  }
}

/**
 * Get recent events, optionally filtered by type or severity.
 */
async function getRecentEvents({ eventType = null, severity = null, limit = 50 } = {}) {
  let query = supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (eventType) query = query.eq('event_type', eventType);
  if (severity) query = query.eq('severity', severity);

  const { data, error } = await query;
  if (error) {
    console.error('[events] Failed to get events:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Get unprocessed events (for heartbeat triggers).
 */
async function getUnprocessedEvents(eventType = null) {
  let query = supabase
    .from('events')
    .select('*')
    .eq('processed', false)
    .order('created_at', { ascending: true });

  if (eventType) query = query.eq('event_type', eventType);

  const { data, error } = await query;
  if (error) {
    console.error('[events] Failed to get unprocessed events:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Mark events as processed.
 */
async function markProcessed(eventIds) {
  if (!eventIds.length) return;

  const { error } = await supabase
    .from('events')
    .update({ processed: true })
    .in('id', eventIds);

  if (error) {
    console.error('[events] Failed to mark events as processed:', error.message);
  }
}

/**
 * Get error events since a given timestamp (for monitoring).
 */
async function getErrorsSince(since) {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .in('severity', ['error', 'critical'])
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[events] Failed to get errors:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Get event counts by type since a timestamp (for daily summary).
 */
async function getEventSummary(since) {
  const { data, error } = await supabase
    .from('events')
    .select('event_type, severity')
    .gte('created_at', since);

  if (error) {
    console.error('[events] Failed to get event summary:', error.message);
    return {};
  }

  const summary = {};
  for (const row of (data || [])) {
    if (!summary[row.event_type]) {
      summary[row.event_type] = { total: 0, errors: 0 };
    }
    summary[row.event_type].total++;
    if (row.severity === 'error' || row.severity === 'critical') {
      summary[row.event_type].errors++;
    }
  }
  return summary;
}

module.exports = {
  logEvent,
  getRecentEvents,
  getUnprocessedEvents,
  markProcessed,
  getErrorsSince,
  getEventSummary
};
