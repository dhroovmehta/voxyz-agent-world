// Phase 2: "YOU ARE the Expert" Prompt Quality Tests
// Ensures all prompts frame agents as DOERS, not ADVISORS.

const { DOMAIN_INSTRUCTIONS, getDomainInstructions, buildTaskContext } = require('../src/lib/context');

// Mock supabase for buildTaskContext tests
const createMockSupabase = require('./mocks/supabase');
const mockSupabase = createMockSupabase();
global.__mockSupabase = mockSupabase;
jest.mock('../src/lib/supabase', () => global.__mockSupabase);

describe('Phase 2: "YOU ARE the Expert" Prompt Quality', () => {

  describe('DOMAIN_INSTRUCTIONS — expert framing', () => {
    const domains = Object.keys(DOMAIN_INSTRUCTIONS);

    test.each(domains)('%s instructions contain "YOU ARE" expert framing', (domain) => {
      expect(DOMAIN_INSTRUCTIONS[domain]).toMatch(/YOU ARE/i);
    });

    test.each(domains)('%s instructions contain anti-meta directive', (domain) => {
      // Should tell agents NOT to describe what someone else should do
      expect(DOMAIN_INSTRUCTIONS[domain]).toMatch(/not describing|not.*instructions|ACTUAL deliverable|DO.*IT/i);
    });

    test('research instructions still require data points (regression)', () => {
      expect(DOMAIN_INSTRUCTIONS.research).toContain('Specific data points');
    });

    test('strategy instructions still require quantified projections (regression)', () => {
      expect(DOMAIN_INSTRUCTIONS.strategy).toContain('quantified projections');
    });
  });

  describe('getDomainInstructions() — generic fallback', () => {
    test('generic fallback contains "YOU ARE" expert framing', () => {
      const generic = getDomainInstructions('Unknown Role XYZ');
      expect(generic).toMatch(/YOU ARE/i);
    });

    test('generic fallback contains "Deliver the WORK" directive', () => {
      const generic = getDomainInstructions('Unknown Role XYZ');
      expect(generic).toMatch(/deliver.*work|ACTUAL deliverable|DO.*IT/i);
    });

    test('generic fallback still requires evidence-backed output (regression)', () => {
      const generic = getDomainInstructions('Unknown Role XYZ');
      expect(generic).toMatch(/evidence|data|reasoning/i);
    });
  });

  describe('buildTaskContext() — universal DOER directive', () => {
    beforeEach(() => {
      mockSupabase.__reset();
    });

    test('quality standards include DOER directive', async () => {
      // Set up mock data so getOriginalMessage returns null (no proposal)
      mockSupabase.__setData('missions', []);

      const step = { id: 1, mission_id: 99, description: 'Research competitors' };
      const context = await buildTaskContext(step, 'Research Analyst');
      expect(context).toMatch(/DOER.*not.*ADVISOR|you are the one doing it|produce.*actual.*deliverable/i);
    });

    test('quality standards still require data-backed claims (regression)', async () => {
      mockSupabase.__setData('missions', []);

      const step = { id: 1, mission_id: 99, description: 'Analyze market' };
      const context = await buildTaskContext(step, 'Research Analyst');
      expect(context).toContain('Every claim must be backed');
    });
  });
});
