// Phase 5: Expert-Based Reviews Tests
// Tests that domain experts are preferred over generic QA/Team Lead for reviews.

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
process.env.OPENROUTER_API_KEY = 'test-key';

const createMockSupabase = require('./mocks/supabase');
const mockSupabase = createMockSupabase();
global.__mockSupabase = mockSupabase;

jest.mock('../src/lib/supabase', () => global.__mockSupabase);

// Mock models
jest.mock('../src/lib/models', () => require('./mocks/models'));

const agents = require('../src/lib/agents');
const missions = require('../src/lib/missions');

describe('Phase 5: Expert-Based Reviews', () => {

  describe('findDomainExpert()', () => {
    beforeEach(() => {
      mockSupabase.__reset();
    });

    test('findBestAgentAcrossTeams finds domain expert by role keyword', async () => {
      // Set up agents across different teams
      mockSupabase.__setData('agents', [
        { id: 'agent-1', display_name: 'Rex', role: 'QA Engineer', agent_type: 'qa', team_id: 'team-research', status: 'active' },
        { id: 'agent-2', display_name: 'Mira', role: 'Real Estate Market Analyst', agent_type: 'sub_agent', team_id: 'team-research', status: 'active' },
        { id: 'agent-3', display_name: 'Kai', role: 'Full-Stack Engineer', agent_type: 'sub_agent', team_id: 'team-execution', status: 'active' }
      ]);

      // Research category should find Mira (contains "analyst" which matches research keywords)
      const expert = await agents.findBestAgentAcrossTeams('research');
      expect(expert).not.toBeNull();
      expect(expert.id).toBe('agent-2');
    });

    test('domain expert can be found on any team (not just same team)', async () => {
      mockSupabase.__setData('agents', [
        { id: 'agent-1', display_name: 'Leo', role: 'Strategy Lead', agent_type: 'sub_agent', team_id: 'team-execution', status: 'active' }
      ]);

      // Strategy agent is on team-execution but should still be found for strategy tasks
      const expert = await agents.findBestAgentAcrossTeams('strategy');
      expect(expert).not.toBeNull();
      expect(expert.id).toBe('agent-1');
    });

    test('returns null when no agent matches the domain', async () => {
      mockSupabase.__setData('agents', [
        { id: 'agent-1', display_name: 'Rex', role: 'QA Engineer', agent_type: 'qa', team_id: 'team-research', status: 'active' }
      ]);

      // Marketing category — no marketing agents exist
      const expert = await agents.findBestAgentAcrossTeams('marketing');
      expect(expert).toBeNull();
    });
  });

  describe('routeByKeywords()', () => {
    test('routes research tasks to research category', () => {
      const role = missions.routeByKeywords('Conduct market research on AI SaaS competitors');
      expect(role).toBe('research');
    });

    test('routes engineering tasks to engineering category', () => {
      const role = missions.routeByKeywords('Build an API endpoint for user authentication');
      expect(role).toBe('engineering');
    });

    test('routes strategy tasks to strategy category', () => {
      const role = missions.routeByKeywords('Develop the pricing model and revenue strategy');
      expect(role).toBe('strategy');
    });

    test('defaults to research for unmatched tasks', () => {
      const role = missions.routeByKeywords('Do something vague');
      expect(role).toBe('research');
    });
  });
});
