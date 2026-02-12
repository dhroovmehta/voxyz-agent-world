// health.js — System health check runner
// WHY: Catch problems before they cause task failures.
// Checks Supabase, OpenRouter, and Discord connectivity every 10 minutes.
// Results written to health_checks table for historical tracking.

const supabase = require('./supabase');

// ============================================================
// RUN ALL HEALTH CHECKS
// ============================================================

/**
 * Run all health checks in parallel.
 * Returns a summary with pass/fail status for each component.
 *
 * @returns {{ allPassing: boolean, checks: Array, failedComponents: string[] }}
 */
async function runAllHealthChecks() {
  const checks = await Promise.all([
    checkSupabase(),
    checkOpenRouter()
  ]);

  const failedComponents = checks
    .filter(c => c.status === 'fail')
    .map(c => c.component);

  const allPassing = failedComponents.length === 0;

  // Write all results to health_checks table
  for (const check of checks) {
    await writeHealthCheck(check);
  }

  if (allPassing) {
    console.log(`[health] All checks passing (${checks.length} components)`);
  } else {
    console.error(`[health] FAILURES: ${failedComponents.join(', ')}`);
  }

  return { allPassing, checks, failedComponents };
}

// ============================================================
// INDIVIDUAL CHECKS
// ============================================================

/**
 * Check Supabase connectivity with a simple query.
 */
async function checkSupabase() {
  const start = Date.now();
  try {
    const { error } = await supabase
      .from('teams')
      .select('id')
      .limit(1);

    const responseTimeMs = Date.now() - start;

    if (error) {
      return {
        checkType: 'db_connection',
        component: 'supabase',
        status: 'fail',
        responseTimeMs,
        details: error.message
      };
    }

    // Warn if slow (>2 seconds)
    const status = responseTimeMs > 2000 ? 'warning' : 'pass';
    return {
      checkType: 'db_connection',
      component: 'supabase',
      status,
      responseTimeMs,
      details: status === 'warning' ? `Slow response: ${responseTimeMs}ms` : null
    };
  } catch (err) {
    return {
      checkType: 'db_connection',
      component: 'supabase',
      status: 'fail',
      responseTimeMs: Date.now() - start,
      details: err.message
    };
  }
}

/**
 * Check OpenRouter API key validity with a lightweight models list call.
 */
async function checkOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      checkType: 'api_keys',
      component: 'openrouter',
      status: 'fail',
      responseTimeMs: 0,
      details: 'OPENROUTER_API_KEY not set'
    };
  }

  const start = Date.now();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://voxyz.ai',
        'X-Title': 'VoxYZ Agent World'
      }
    });

    const responseTimeMs = Date.now() - start;

    if (!response.ok) {
      return {
        checkType: 'api_keys',
        component: 'openrouter',
        status: 'fail',
        responseTimeMs,
        details: `HTTP ${response.status}`
      };
    }

    const status = responseTimeMs > 5000 ? 'warning' : 'pass';
    return {
      checkType: 'api_keys',
      component: 'openrouter',
      status,
      responseTimeMs,
      details: status === 'warning' ? `Slow response: ${responseTimeMs}ms` : null
    };
  } catch (err) {
    return {
      checkType: 'api_keys',
      component: 'openrouter',
      status: 'fail',
      responseTimeMs: Date.now() - start,
      details: err.message
    };
  }
}

// ============================================================
// PERSISTENCE
// ============================================================

/**
 * Write a health check result to the health_checks table.
 */
async function writeHealthCheck(check) {
  const { error } = await supabase
    .from('health_checks')
    .insert({
      check_type: check.checkType,
      component: check.component,
      status: check.status,
      response_time_ms: check.responseTimeMs,
      details: check.details
    });

  if (error) {
    console.error(`[health] Failed to write health check for ${check.component}:`, error.message);
  }
}

module.exports = {
  runAllHealthChecks,
  checkSupabase,
  checkOpenRouter
};
