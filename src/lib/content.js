// content.js — Content pipeline & watchlist queries for Contentron integration
// WHY: Contentron has no Discord bot. Frasier provides the !content and !watchlist
// commands that write to shared Supabase tables. Contentron reads them on its next
// 2-hour tick. Zero direct communication — just shared database state.

const supabase = require('./supabase');

// ============================================================
// CONSTANTS
// ============================================================

const PILLAR_NAMES = {
  1: 'Idea to Shipped',
  2: 'The Double-Click',
  3: 'Live from the Workshop'
};

// Maps user-friendly type names to database type values
const WATCHLIST_TYPE_MAP = {
  'topic': 'topic',
  'account': 'twitter_account',
  'rss': 'rss_feed'
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Return a human-readable pillar name.
 */
function pillarName(pillar) {
  return PILLAR_NAMES[pillar] || 'Unknown';
}

/**
 * Resolve a short or full UUID to a single content_drafts row.
 * WHY: Typing full UUIDs in Discord is painful. Allow first 8 chars.
 * If multiple drafts match a short prefix, returns null (ambiguous).
 */
async function resolveDraft(idInput) {
  if (!idInput) return null;
  const id = idInput.trim();

  // Full UUID (36 chars with dashes) — exact match
  if (id.length === 36) {
    const { data, error } = await supabase
      .from('content_drafts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[content] Error resolving draft by full ID:', error.message);
      return null;
    }
    return data;
  }

  // Short ID — fetch all and filter by prefix in JS
  // WHY: Supabase PostgREST .like() on UUID columns is unreliable.
  // For a small table (< 1000 drafts), this is fine.
  const { data: all, error } = await supabase
    .from('content_drafts')
    .select('*');

  if (error) {
    console.error('[content] Error fetching drafts for short ID resolve:', error.message);
    return null;
  }

  const matches = (all || []).filter(function(d) {
    return d.id && d.id.startsWith(id);
  });

  if (matches.length === 1) return matches[0];
  // Ambiguous or not found
  return null;
}

// ============================================================
// CONTENT DRAFTS — QUERIES
// ============================================================

/**
 * List queued drafts, sorted by score descending. Returns top 10 + total count.
 */
async function listQueuedDrafts() {
  // Get total count of queued drafts
  const { data: allQueued, error: countErr } = await supabase
    .from('content_drafts')
    .select('*')
    .eq('status', 'queued');

  if (countErr) {
    console.error('[content] Error counting queued drafts:', countErr.message);
    return { drafts: [], total: 0 };
  }

  const all = allQueued || [];
  const total = all.length;

  // Sort by score descending and take top 10
  all.sort(function(a, b) {
    return (b.score_overall || 0) - (a.score_overall || 0);
  });
  var drafts = all.slice(0, 10);

  return { drafts: drafts, total: total };
}

/**
 * View a single draft by full or short UUID.
 */
async function viewDraft(shortId) {
  return resolveDraft(shortId);
}

/**
 * Get pipeline statistics: counts by status, published last 7 days, new research items.
 */
async function getDraftStats() {
  // All drafts grouped by status
  const { data: allDrafts, error: draftErr } = await supabase
    .from('content_drafts')
    .select('*');

  if (draftErr) {
    console.error('[content] Error fetching draft stats:', draftErr.message);
  }

  var byStatus = {};
  (allDrafts || []).forEach(function(d) {
    var s = d.status || 'unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
  });

  // Published in last 7 days
  var sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  var sevenDaysAgoISO = sevenDaysAgo.toISOString();

  const { data: recentPublished, error: pubErr } = await supabase
    .from('content_published')
    .select('*')
    .gte('published_at', sevenDaysAgoISO);

  if (pubErr) {
    console.error('[content] Error fetching published stats:', pubErr.message);
  }

  // New research items
  const { data: newResearch, error: resErr } = await supabase
    .from('content_research')
    .select('*')
    .eq('status', 'new');

  if (resErr) {
    console.error('[content] Error fetching research stats:', resErr.message);
  }

  return {
    byStatus: byStatus,
    publishedLast7Days: (recentPublished || []).length,
    newResearch: (newResearch || []).length
  };
}

// ============================================================
// CONTENT DRAFTS — MUTATIONS
// ============================================================

/**
 * Approve a draft for publishing.
 * Idempotent: returns { ok: false, reason: 'already_published' } if already done.
 */
async function approveDraft(shortId) {
  var draft = await resolveDraft(shortId);
  if (!draft) return { ok: false, reason: 'not_found' };
  if (draft.status === 'published') return { ok: false, reason: 'already_published' };

  const { error } = await supabase
    .from('content_drafts')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', draft.id);

  if (error) {
    console.error('[content] Error approving draft:', error.message);
    return { ok: false, reason: 'db_error', message: error.message };
  }

  return { ok: true, draft: draft };
}

/**
 * Reject a draft permanently.
 * Idempotent: returns { ok: false, reason: 'already_discarded' } if already done.
 */
async function rejectDraft(shortId) {
  var draft = await resolveDraft(shortId);
  if (!draft) return { ok: false, reason: 'not_found' };
  if (draft.status === 'discarded') return { ok: false, reason: 'already_discarded' };

  const { error } = await supabase
    .from('content_drafts')
    .update({ status: 'discarded' })
    .eq('id', draft.id);

  if (error) {
    console.error('[content] Error rejecting draft:', error.message);
    return { ok: false, reason: 'db_error', message: error.message };
  }

  return { ok: true, draft: draft };
}

/**
 * Send a draft back for revision with optional feedback.
 * Only works on queued drafts — Contentron's Writer will pick it up.
 */
async function reviseDraft(shortId, feedback) {
  var draft = await resolveDraft(shortId);
  if (!draft) return { ok: false, reason: 'not_found' };
  if (draft.status !== 'queued') return { ok: false, reason: 'not_queued' };

  var updatePayload = { status: 'revision' };
  if (feedback) {
    // Append feedback to existing suggestions
    var existing = Array.isArray(draft.editor_suggestions) ? draft.editor_suggestions : [];
    updatePayload.editor_suggestions = existing.concat([feedback]);
  }

  const { error } = await supabase
    .from('content_drafts')
    .update(updatePayload)
    .eq('id', draft.id);

  if (error) {
    console.error('[content] Error sending draft for revision:', error.message);
    return { ok: false, reason: 'db_error', message: error.message };
  }

  return { ok: true, draft: draft };
}

// ============================================================
// WATCHLIST — QUERIES
// ============================================================

/**
 * List all watchlist items, ordered by category then priority descending.
 */
async function listWatchlist() {
  const { data, error } = await supabase
    .from('content_watchlist')
    .select('*')
    .order('category', { ascending: true })
    .order('priority', { ascending: false });

  if (error) {
    console.error('[content] Error listing watchlist:', error.message);
    return [];
  }

  return data || [];
}

// ============================================================
// WATCHLIST — MUTATIONS
// ============================================================

/**
 * Add an item to the watchlist.
 * @param {string} type - 'topic', 'account', or 'rss'
 * @param {string} value - The topic string, account handle, or feed URL
 */
async function addWatchlistItem(type, value) {
  var dbType = WATCHLIST_TYPE_MAP[type];
  if (!dbType) {
    return { ok: false, reason: 'invalid_type' };
  }

  // Default category based on type
  var category = type === 'account' ? 'core' : 'supporting';

  var row = {
    type: dbType,
    value: value,
    category: category,
    priority: 3,
    active: true,
    added_by: 'dhroov'
  };

  const result = await supabase
    .from('content_watchlist')
    .insert(row)
    .select()
    .single();

  if (result.error) {
    console.error('[content] Error adding watchlist item:', result.error.message);
    return { ok: false, reason: 'db_error', message: result.error.message };
  }

  return { ok: true, item: result.data };
}

/**
 * Remove an item from the watchlist by ID or by value.
 * Tries ID match first, then value match.
 */
async function removeWatchlistItem(idOrValue) {
  if (!idOrValue) return { ok: false, reason: 'not_found' };

  // Try by ID first
  var allItems = await listWatchlist();
  var match = allItems.find(function(item) {
    return item.id === idOrValue;
  });

  // If no ID match, try by value
  if (!match) {
    match = allItems.find(function(item) {
      return item.value === idOrValue;
    });
  }

  if (!match) {
    return { ok: false, reason: 'not_found' };
  }

  const { error } = await supabase
    .from('content_watchlist')
    .delete()
    .eq('id', match.id);

  if (error) {
    console.error('[content] Error removing watchlist item:', error.message);
    return { ok: false, reason: 'db_error', message: error.message };
  }

  return { ok: true, item: match };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  pillarName: pillarName,
  listQueuedDrafts: listQueuedDrafts,
  viewDraft: viewDraft,
  approveDraft: approveDraft,
  rejectDraft: rejectDraft,
  reviseDraft: reviseDraft,
  getDraftStats: getDraftStats,
  listWatchlist: listWatchlist,
  addWatchlistItem: addWatchlistItem,
  removeWatchlistItem: removeWatchlistItem
};
