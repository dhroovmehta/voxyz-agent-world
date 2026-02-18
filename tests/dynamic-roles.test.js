// Phase 3: Dynamic Role Determination Tests
// Tests for LLM-based determineDynamicProjectRoles() that replaces hardcoded keyword matching.

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
process.env.OPENROUTER_API_KEY = 'test-key';

const createMockSupabase = require('./mocks/supabase');
const mockSupabase = createMockSupabase();
global.__mockSupabase = mockSupabase;

jest.mock('../src/lib/supabase', () => global.__mockSupabase);

// Mock models.js — we control what the LLM "returns"
const mockCallLLM = jest.fn();
jest.mock('../src/lib/models', () => ({
  callLLM: mockCallLLM,
  selectTier: jest.fn().mockReturnValue('tier1'),
  MODELS: {
    tier1: { name: 'minimax', tier: 'tier1', maxTokens: 4096 },
    tier2: { name: 'claude-sonnet-4.5', tier: 'tier2', maxTokens: 8192 },
    tier3: { name: 'claude-opus-4.5', tier: 'tier3', maxTokens: 4096 }
  },
  COMPLEX_KEYWORDS: [],
  TIER3_KEYWORDS: []
}));

const agents = require('../src/lib/agents');

describe('determineDynamicProjectRoles()', () => {

  beforeEach(() => {
    mockCallLLM.mockReset();
    mockSupabase.__reset();
  });

  test('returns array of { title, category, reason } from LLM response', async () => {
    mockCallLLM.mockResolvedValue({
      content: JSON.stringify([
        { title: 'Real Estate Market Analyst', category: 'research', reason: 'Market research on real estate AI tools' },
        { title: 'AI Product Architect', category: 'engineering', reason: 'Design the AI agent architecture' }
      ]),
      error: null
    });

    const roles = await agents.determineDynamicProjectRoles('Build a Real Estate AI Agent for Lead Generation');
    expect(roles).toHaveLength(2);
    expect(roles[0].title).toBe('Real Estate Market Analyst');
    expect(roles[0].category).toBe('research');
    expect(roles[0].reason).toBeTruthy();
    expect(roles[1].title).toBe('AI Product Architect');
    expect(roles[1].category).toBe('engineering');
  });

  test('categories are validated against allowed list', async () => {
    mockCallLLM.mockResolvedValue({
      content: JSON.stringify([
        { title: 'Fake Role', category: 'invalid_category', reason: 'test' }
      ]),
      error: null
    });

    const roles = await agents.determineDynamicProjectRoles('Some project');
    // Invalid categories should be defaulted to 'research'
    expect(roles[0].category).toBe('research');
  });

  test('falls back to keyword matching when LLM fails', async () => {
    mockCallLLM.mockResolvedValue({ content: null, error: 'API error' });

    const roles = await agents.determineDynamicProjectRoles('Research competitive landscape and build marketing strategy');
    expect(roles.length).toBeGreaterThan(0);
    // Should still get roles via keyword fallback
    const categories = roles.map(r => r.category);
    expect(categories).toContain('research');
  });

  test('falls back gracefully on invalid JSON from LLM', async () => {
    mockCallLLM.mockResolvedValue({
      content: 'Here are the roles you need: Research Analyst and Strategy Lead',
      error: null
    });

    const roles = await agents.determineDynamicProjectRoles('Build a new product');
    expect(roles.length).toBeGreaterThan(0);
    // Should fallback to keyword matching
    expect(roles[0]).toHaveProperty('title');
    expect(roles[0]).toHaveProperty('category');
  });

  test('each role has a free-form title (not from predefined list)', async () => {
    mockCallLLM.mockResolvedValue({
      content: JSON.stringify([
        { title: 'Healthcare Compliance Specialist', category: 'qa', reason: 'Ensure HIPAA compliance' },
        { title: 'Telehealth UX Researcher', category: 'research', reason: 'User research for telehealth platform' }
      ]),
      error: null
    });

    const roles = await agents.determineDynamicProjectRoles('Build a HIPAA-compliant telehealth platform');
    expect(roles[0].title).toBe('Healthcare Compliance Specialist');
    expect(roles[1].title).toBe('Telehealth UX Researcher');
  });

  test('handles LLM response wrapped in markdown code block', async () => {
    mockCallLLM.mockResolvedValue({
      content: '```json\n[{"title":"Data Scientist","category":"research","reason":"ML models"}]\n```',
      error: null
    });

    const roles = await agents.determineDynamicProjectRoles('Build ML pipeline');
    expect(roles).toHaveLength(1);
    expect(roles[0].title).toBe('Data Scientist');
  });

  test('uses tier1 (cheap) for the LLM call', async () => {
    mockCallLLM.mockResolvedValue({
      content: JSON.stringify([{ title: 'Analyst', category: 'research', reason: 'test' }]),
      error: null
    });

    await agents.determineDynamicProjectRoles('Any project');
    expect(mockCallLLM).toHaveBeenCalledWith(expect.objectContaining({
      forceTier: 'tier1'
    }));
  });

  test('old determineProjectRoles() still works as backward compat', () => {
    // Keyword-based version should still be exported
    const roles = agents.determineProjectRoles('Research the market and build an API');
    expect(roles).toContain('research');
    expect(roles).toContain('engineering');
  });
});
