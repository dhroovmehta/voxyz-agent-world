// Contentron Integration Tests
// Tests for src/lib/content.js — content pipeline + watchlist Supabase queries.
// TDD: These tests are written BEFORE the implementation.

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';

const createMockSupabase = require('../mocks/supabase');
const mockSupabase = createMockSupabase();
global.__mockSupabase = mockSupabase;

jest.mock('../../src/lib/supabase', () => global.__mockSupabase);

const content = require('../../src/lib/content');

beforeEach(() => {
  mockSupabase.__reset();
});

// ============================================================
// HELPER: Seed draft data
// ============================================================

function seedDrafts(drafts) {
  mockSupabase.__setData('content_drafts', drafts);
}

function seedWatchlist(items) {
  mockSupabase.__setData('content_watchlist', items);
}

function seedResearch(items) {
  mockSupabase.__setData('content_research', items);
}

function seedPublished(items) {
  mockSupabase.__setData('content_published', items);
}

// ============================================================
// PILLAR NAMES
// ============================================================

describe('pillarName()', () => {
  test('returns correct names for pillars 1-3', () => {
    expect(content.pillarName(1)).toBe('Idea to Shipped');
    expect(content.pillarName(2)).toBe('The Double-Click');
    expect(content.pillarName(3)).toBe('Live from the Workshop');
  });

  test('returns "Unknown" for invalid pillar', () => {
    expect(content.pillarName(99)).toBe('Unknown');
    expect(content.pillarName(null)).toBe('Unknown');
  });
});

// ============================================================
// LIST QUEUED DRAFTS
// ============================================================

describe('listQueuedDrafts()', () => {
  test('returns only queued drafts', async () => {
    seedDrafts([
      { id: 'aaa-1', title: 'Queued One', status: 'queued', score_overall: 4.0 },
      { id: 'bbb-2', title: 'Draft One', status: 'draft', score_overall: 3.0 },
      { id: 'ccc-3', title: 'Queued Two', status: 'queued', score_overall: 3.5 }
    ]);

    const result = await content.listQueuedDrafts();
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.every(d => d.status === 'queued')).toBe(true);
  });

  test('sorts by score_overall descending', async () => {
    seedDrafts([
      { id: 'aaa-1', title: 'Low Score', status: 'queued', score_overall: 2.0 },
      { id: 'bbb-2', title: 'High Score', status: 'queued', score_overall: 4.5 },
      { id: 'ccc-3', title: 'Mid Score', status: 'queued', score_overall: 3.5 }
    ]);

    const result = await content.listQueuedDrafts();
    expect(result.drafts[0].title).toBe('High Score');
    expect(result.drafts[1].title).toBe('Mid Score');
    expect(result.drafts[2].title).toBe('Low Score');
  });

  test('limits to 10 results and reports total count', async () => {
    const drafts = [];
    for (let i = 0; i < 15; i++) {
      drafts.push({
        id: `draft-${i}`,
        title: `Draft ${i}`,
        status: 'queued',
        score_overall: 5.0 - (i * 0.1)
      });
    }
    seedDrafts(drafts);

    const result = await content.listQueuedDrafts();
    expect(result.drafts.length).toBeLessThanOrEqual(10);
    expect(result.total).toBe(15);
  });

  test('returns empty list when no queued drafts', async () => {
    seedDrafts([
      { id: 'aaa-1', title: 'Published', status: 'published', score_overall: 4.0 }
    ]);

    const result = await content.listQueuedDrafts();
    expect(result.drafts).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ============================================================
// VIEW DRAFT
// ============================================================

describe('viewDraft()', () => {
  test('finds draft by full UUID', async () => {
    seedDrafts([
      { id: '3de8a1f2-abcd-4000-b000-000000000001', title: 'My Draft', status: 'queued' }
    ]);

    const result = await content.viewDraft('3de8a1f2-abcd-4000-b000-000000000001');
    expect(result).toBeTruthy();
    expect(result.title).toBe('My Draft');
  });

  test('finds draft by short ID (first 8 chars)', async () => {
    seedDrafts([
      { id: '3de8a1f2-abcd-4000-b000-000000000001', title: 'My Draft', status: 'queued' }
    ]);

    const result = await content.viewDraft('3de8a1f2');
    expect(result).toBeTruthy();
    expect(result.title).toBe('My Draft');
  });

  test('returns null for non-existent ID', async () => {
    seedDrafts([
      { id: 'aaa-1', title: 'Existing', status: 'queued' }
    ]);

    const result = await content.viewDraft('nonexistent');
    expect(result).toBeNull();
  });
});

// ============================================================
// APPROVE DRAFT
// ============================================================

describe('approveDraft()', () => {
  test('sets status to published and adds published_at', async () => {
    seedDrafts([
      { id: 'draft-approve-1', title: 'Approve Me', status: 'queued' }
    ]);

    const result = await content.approveDraft('draft-approve-1');
    expect(result.ok).toBe(true);

    const updated = mockSupabase.__getData('content_drafts');
    const draft = updated.find(d => d.id === 'draft-approve-1');
    expect(draft.status).toBe('published');
    expect(draft.published_at).toBeTruthy();
  });

  test('is idempotent — returns friendly message if already published', async () => {
    seedDrafts([
      { id: 'draft-pub-1', title: 'Already Published', status: 'published', published_at: '2026-02-20T00:00:00Z' }
    ]);

    const result = await content.approveDraft('draft-pub-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_published');
  });

  test('returns not_found for non-existent draft', async () => {
    seedDrafts([]);

    const result = await content.approveDraft('nonexistent');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_found');
  });
});

// ============================================================
// REJECT DRAFT
// ============================================================

describe('rejectDraft()', () => {
  test('sets status to discarded', async () => {
    seedDrafts([
      { id: 'draft-reject-1', title: 'Reject Me', status: 'queued' }
    ]);

    const result = await content.rejectDraft('draft-reject-1');
    expect(result.ok).toBe(true);

    const updated = mockSupabase.__getData('content_drafts');
    const draft = updated.find(d => d.id === 'draft-reject-1');
    expect(draft.status).toBe('discarded');
  });

  test('is idempotent — returns friendly message if already discarded', async () => {
    seedDrafts([
      { id: 'draft-disc-1', title: 'Already Discarded', status: 'discarded' }
    ]);

    const result = await content.rejectDraft('draft-disc-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_discarded');
  });
});

// ============================================================
// REVISE DRAFT
// ============================================================

describe('reviseDraft()', () => {
  test('sets status to revision and stores feedback', async () => {
    seedDrafts([
      { id: 'draft-revise-1', title: 'Revise Me', status: 'queued', editor_suggestions: [] }
    ]);

    const result = await content.reviseDraft('draft-revise-1', 'Make it punchier');
    expect(result.ok).toBe(true);

    const updated = mockSupabase.__getData('content_drafts');
    const draft = updated.find(d => d.id === 'draft-revise-1');
    expect(draft.status).toBe('revision');
    expect(draft.editor_suggestions).toContain('Make it punchier');
  });

  test('rejects revision of non-queued draft', async () => {
    seedDrafts([
      { id: 'draft-pub-1', title: 'Published', status: 'published' }
    ]);

    const result = await content.reviseDraft('draft-pub-1', 'some feedback');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_queued');
  });

  test('works without feedback text', async () => {
    seedDrafts([
      { id: 'draft-revise-2', title: 'Revise No Feedback', status: 'queued', editor_suggestions: [] }
    ]);

    const result = await content.reviseDraft('draft-revise-2');
    expect(result.ok).toBe(true);

    const updated = mockSupabase.__getData('content_drafts');
    const draft = updated.find(d => d.id === 'draft-revise-2');
    expect(draft.status).toBe('revision');
  });
});

// ============================================================
// DRAFT STATS
// ============================================================

describe('getDraftStats()', () => {
  test('returns counts grouped by status', async () => {
    seedDrafts([
      { id: '1', status: 'queued' },
      { id: '2', status: 'queued' },
      { id: '3', status: 'draft' },
      { id: '4', status: 'published', published_at: new Date().toISOString() },
      { id: '5', status: 'discarded' }
    ]);
    seedResearch([
      { id: 'r1', status: 'new' },
      { id: 'r2', status: 'new' },
      { id: 'r3', status: 'used' }
    ]);
    seedPublished([
      { id: 'p1', published_at: new Date().toISOString() }
    ]);

    const stats = await content.getDraftStats();
    expect(stats.byStatus.queued).toBe(2);
    expect(stats.byStatus.draft).toBe(1);
    expect(stats.byStatus.published).toBe(1);
    expect(stats.byStatus.discarded).toBe(1);
    expect(stats.newResearch).toBe(2);
    expect(stats.publishedLast7Days).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// WATCHLIST — LIST
// ============================================================

describe('listWatchlist()', () => {
  test('returns all active watchlist items', async () => {
    seedWatchlist([
      { id: 'w1', type: 'topic', value: 'multimodal AI', category: 'core', priority: 5, active: true },
      { id: 'w2', type: 'twitter_account', value: '@AnthropicAI', category: 'core', priority: 4, active: true },
      { id: 'w3', type: 'topic', value: 'old topic', category: 'supporting', priority: 1, active: false }
    ]);

    const items = await content.listWatchlist();
    // Should include all items (active + inactive for display)
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// WATCHLIST — ADD
// ============================================================

describe('addWatchlistItem()', () => {
  test('inserts a topic with correct defaults', async () => {
    const result = await content.addWatchlistItem('topic', 'multimodal AI');
    expect(result.ok).toBe(true);

    const items = mockSupabase.__getData('content_watchlist');
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('topic');
    expect(items[0].value).toBe('multimodal AI');
    expect(items[0].added_by).toBe('dhroov');
    expect(items[0].active).toBe(true);
  });

  test('inserts a twitter account', async () => {
    const result = await content.addWatchlistItem('account', '@AnthropicAI');
    expect(result.ok).toBe(true);

    const items = mockSupabase.__getData('content_watchlist');
    expect(items[0].type).toBe('twitter_account');
  });

  test('rejects invalid type', async () => {
    const result = await content.addWatchlistItem('invalid', 'something');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_type');
  });
});

// ============================================================
// WATCHLIST — REMOVE
// ============================================================

describe('removeWatchlistItem()', () => {
  test('removes by exact id', async () => {
    seedWatchlist([
      { id: 'w1', type: 'topic', value: 'AI agents', active: true },
      { id: 'w2', type: 'topic', value: 'LLMs', active: true }
    ]);

    const result = await content.removeWatchlistItem('w1');
    expect(result.ok).toBe(true);

    const items = mockSupabase.__getData('content_watchlist');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('w2');
  });

  test('removes by value match', async () => {
    seedWatchlist([
      { id: 'w1', type: 'topic', value: 'AI agents', active: true },
      { id: 'w2', type: 'topic', value: 'LLMs', active: true }
    ]);

    const result = await content.removeWatchlistItem('AI agents');
    expect(result.ok).toBe(true);

    const items = mockSupabase.__getData('content_watchlist');
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe('LLMs');
  });

  test('returns not_found for non-existent item', async () => {
    seedWatchlist([]);

    const result = await content.removeWatchlistItem('nonexistent');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_found');
  });
});
