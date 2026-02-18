// Tests for Phase 1: Tier Restructure
// T2 = Claude Sonnet 4.5 (replaces Manus), T3 approval gate removed, T3→T2→T1 fallback

// Load models.js directly (not the mock) since we're testing its actual exports
const { selectTier, MODELS, COMPLEX_KEYWORDS, TIER3_KEYWORDS } = require('../src/lib/models');

describe('Tier Restructure', () => {

  describe('MODELS config', () => {
    test('tier2 is claude-sonnet-4.5, not manus', () => {
      expect(MODELS.tier2.name).toBe('claude-sonnet-4.5');
      expect(MODELS.tier2.model).toContain('claude-sonnet');
    });

    test('tier2 uses OpenRouter endpoint', () => {
      expect(MODELS.tier2.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    test('tier2 uses OPENROUTER_API_KEY (same key as tier1/tier3)', () => {
      expect(MODELS.tier2.apiKeyEnv).toBe('OPENROUTER_API_KEY');
    });

    test('tier2 has cost tracking values', () => {
      expect(MODELS.tier2.costPer1kInput).toBeGreaterThan(0);
      expect(MODELS.tier2.costPer1kOutput).toBeGreaterThan(0);
    });

    test('tier3 is still claude-opus', () => {
      expect(MODELS.tier3.name).toContain('claude-opus');
    });

    test('tier1 is still minimax', () => {
      expect(MODELS.tier1.name).toBe('minimax');
    });
  });

  describe('TIER3_KEYWORDS', () => {
    test('TIER3_KEYWORDS is exported and is an array', () => {
      expect(Array.isArray(TIER3_KEYWORDS)).toBe(true);
      expect(TIER3_KEYWORDS.length).toBeGreaterThan(0);
    });

    test('includes product requirements keywords', () => {
      expect(TIER3_KEYWORDS).toContain('product requirements');
    });

    test('includes design document keywords', () => {
      expect(TIER3_KEYWORDS).toContain('design document');
    });
  });

  describe('selectTier() — updated routing', () => {
    test('T3 keyword "product requirements" → tier3', () => {
      expect(selectTier(false, 'Create product requirements document')).toBe('tier3');
    });

    test('T3 keyword "design document" → tier3', () => {
      expect(selectTier(false, 'Write the design document for the new system')).toBe('tier3');
    });

    test('T3 keyword "executive report" → tier3', () => {
      expect(selectTier(false, 'Prepare the executive report for investors')).toBe('tier3');
    });

    test('T3 keyword "business case" → tier3', () => {
      expect(selectTier(false, 'Build the business case for expansion')).toBe('tier3');
    });

    test('T2 keyword "research" still → tier2 (regression)', () => {
      expect(selectTier(false, 'Research the competitive landscape')).toBe('tier2');
    });

    test('T2 keyword "strategy" still → tier2 (regression)', () => {
      expect(selectTier(false, 'Develop our go-to-market strategy')).toBe('tier2');
    });

    test('T2 keyword "analysis" still → tier2 (regression)', () => {
      expect(selectTier(false, 'Perform financial analysis on Q3 numbers')).toBe('tier2');
    });

    test('simple task → tier1 (regression)', () => {
      expect(selectTier(false, 'Summarize yesterdays meeting')).toBe('tier1');
    });

    test('empty description → tier1 (regression)', () => {
      expect(selectTier(false, '')).toBe('tier1');
    });

    test('isComplex=true → tier2 (regression)', () => {
      expect(selectTier(true, 'Simple task but marked complex')).toBe('tier2');
    });

    test('final step → tier2 (regression)', () => {
      expect(selectTier(false, 'Compile findings', { isFinalStep: true })).toBe('tier2');
    });

    test('T3 keyword takes precedence when isComplex is false', () => {
      expect(selectTier(false, 'Write the product specification')).toBe('tier3');
    });

    test('isComplex=true overrides T3 keywords to tier2', () => {
      // isComplex is checked first, returns tier2 before keyword check
      expect(selectTier(true, 'Write the product requirements')).toBe('tier2');
    });
  });
});
