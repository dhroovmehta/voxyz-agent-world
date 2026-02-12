// social.js — Social media posting via Buffer (Decision 15)
// WHY: Agents create social content (tweets, LinkedIn posts, etc.) but can't post directly.
// Buffer's free tier gives us 3 social channels + 10 scheduled posts per channel.
// When Faye (or any agent) creates social content, it gets queued to Buffer.
// For paid platforms without API access → tasks routed to Zero via Notion task board.
//
// Requires: BUFFER_ACCESS_TOKEN in .env

const supabase = require('./supabase');

const BUFFER_API = 'https://api.bufferapp.com/1';

// ============================================================
// CORE API
// ============================================================

/**
 * Make an authenticated Buffer API request.
 */
async function bufferRequest(method, path, body = null) {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    console.error('[social] Missing BUFFER_ACCESS_TOKEN');
    return null;
  }

  const url = `${BUFFER_API}${path}.json?access_token=${token}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  };

  if (body && method !== 'GET') {
    options.body = new URLSearchParams(body).toString();
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      console.error(`[social] Buffer API ${response.status}: ${error.substring(0, 200)}`);
      return null;
    }

    return response.json();
  } catch (err) {
    console.error(`[social] Request failed: ${err.message}`);
    return null;
  }
}

// ============================================================
// PROFILE MANAGEMENT
// ============================================================

let profileCache = null;

/**
 * Get all connected Buffer profiles (social accounts).
 * Cached to avoid repeated API calls.
 *
 * @returns {Array|null} Array of profile objects with id, service, formatted_username
 */
async function getProfiles() {
  if (profileCache) return profileCache;

  const result = await bufferRequest('GET', '/profiles');
  if (!result) return null;

  profileCache = result.map(p => ({
    id: p.id,
    service: p.service,
    username: p.formatted_username,
    default: p.default
  }));

  console.log(`[social] Buffer profiles: ${profileCache.map(p => `${p.service}:${p.username}`).join(', ')}`);
  return profileCache;
}

// ============================================================
// POST SCHEDULING
// ============================================================

/**
 * Schedule a social media post via Buffer.
 * Buffer handles timing — posts go into the queue and are published
 * according to the schedule set in Buffer's dashboard.
 *
 * @param {Object} params
 * @param {string} params.text - Post content
 * @param {string} [params.service] - Target service: 'twitter', 'linkedin', 'facebook' (default: all)
 * @param {boolean} [params.now] - Post immediately instead of queuing (default: false)
 * @param {string} [params.agentId] - Which agent created the content
 * @param {number} [params.missionStepId] - Originating mission step
 * @returns {{ success: boolean, updates: Array, error: string|null }}
 */
async function schedulePost({ text, service = null, now = false, agentId = null, missionStepId = null }) {
  const profiles = await getProfiles();
  if (!profiles || profiles.length === 0) {
    return { success: false, updates: [], error: 'No Buffer profiles connected' };
  }

  // Filter to target service, or use all profiles
  const targetProfiles = service
    ? profiles.filter(p => p.service === service)
    : profiles;

  if (targetProfiles.length === 0) {
    return { success: false, updates: [], error: `No Buffer profile for service: ${service}` };
  }

  const updates = [];
  const errors = [];

  for (const profile of targetProfiles) {
    const body = {
      text,
      profile_ids: profile.id,
      shorten: 'true'
    };

    if (now) {
      body.now = 'true';
    }

    const result = await bufferRequest('POST', '/updates/create', body);

    if (result && result.success) {
      updates.push({
        service: profile.service,
        username: profile.username,
        updateId: result.updates?.[0]?.id
      });
      console.log(`[social] Queued to ${profile.service}:${profile.username}: "${text.substring(0, 60)}..."`);
    } else {
      errors.push(`${profile.service}: ${result?.message || 'Unknown error'}`);
    }
  }

  // Log to database for tracking
  if (updates.length > 0) {
    await supabase.from('events').insert({
      event_type: 'social_post_queued',
      agent_id: agentId,
      severity: 'info',
      description: `Social post queued to ${updates.map(u => u.service).join(', ')}: "${text.substring(0, 100)}"`,
      data: { updates, missionStepId, services: updates.map(u => u.service) }
    });
  }

  return {
    success: updates.length > 0,
    updates,
    error: errors.length > 0 ? errors.join('; ') : null
  };
}

/**
 * Get pending posts in the Buffer queue.
 * Useful for the daily summary — "3 posts scheduled for today".
 *
 * @param {string} [service] - Filter by service
 * @returns {Array} Array of pending updates
 */
async function getPendingPosts(service = null) {
  const profiles = await getProfiles();
  if (!profiles) return [];

  const targetProfiles = service
    ? profiles.filter(p => p.service === service)
    : profiles;

  const allPending = [];

  for (const profile of targetProfiles) {
    const result = await bufferRequest('GET', `/profiles/${profile.id}/updates/pending`);
    if (result && result.updates) {
      for (const update of result.updates) {
        allPending.push({
          service: profile.service,
          text: update.text,
          scheduledAt: update.scheduled_at,
          id: update.id
        });
      }
    }
  }

  return allPending;
}

/**
 * Process social media tags in agent output.
 * Agents can embed [SOCIAL_POST:content here] in their work output.
 * The worker detects this and queues the post to Buffer.
 *
 * @param {string} text - Agent output that may contain social tags
 * @param {string} agentId - Which agent created it
 * @returns {{ posted: boolean, results: Array }}
 */
async function resolveSocialTags(text, agentId) {
  const results = [];
  const matches = text.matchAll(/\[SOCIAL_POST:([^\]]+)\]/g);

  for (const match of matches) {
    const postText = match[1].trim();
    const result = await schedulePost({
      text: postText,
      agentId
    });
    results.push(result);
  }

  return { posted: results.length > 0, results };
}

/**
 * Clear the profile cache.
 */
function clearCache() {
  profileCache = null;
}

module.exports = {
  schedulePost,
  getPendingPosts,
  getProfiles,
  resolveSocialTags,
  clearCache
};
