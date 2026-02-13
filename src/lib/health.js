// health.js — System health check runner
// WHY: Catch problems before they cause task failures.
// Checks Supabase, OpenRouter, and Discord connectivity every 10 minutes.
// Results written to health_checks table for historical tracking.

const os = require('os');
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
    checkOpenRouter(),
    checkRAM(),
    checkBandwidth()
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
        'HTTP-Referer': 'https://frasier.ai',
        'X-Title': 'Frasier'
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

/**
 * Check RAM usage. Alert at 80% — consider VPS upgrade ($8 → $12/month for 2GB).
 * WHY: 1GB VPS means we need to watch memory closely. PM2 can restart on OOM
 * but that loses in-flight work.
 */
function checkRAM() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const usedPercent = (usedMem / totalMem) * 100;
  const usedMB = Math.round(usedMem / 1024 / 1024);
  const totalMB = Math.round(totalMem / 1024 / 1024);

  // Also check this process's memory
  const processMemMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  let status = 'pass';
  let details = null;

  if (usedPercent >= 90) {
    status = 'fail';
    details = `CRITICAL: ${usedPercent.toFixed(1)}% RAM used (${usedMB}MB / ${totalMB}MB). Process heap: ${processMemMB}MB. Consider VPS upgrade.`;
  } else if (usedPercent >= 80) {
    status = 'warning';
    details = `High RAM: ${usedPercent.toFixed(1)}% used (${usedMB}MB / ${totalMB}MB). Process heap: ${processMemMB}MB.`;
  }

  return {
    checkType: 'resource',
    component: 'ram',
    status,
    responseTimeMs: 0,
    details,
    metadata: { usedPercent: usedPercent.toFixed(1), usedMB, totalMB, processHeapMB: processMemMB }
  };
}

/**
 * Check Supabase bandwidth usage. Alert at 50% of 2GB monthly limit.
 * WHY: Supabase free tier has 2GB bandwidth. If we hit it, the API stops working.
 * Approximation: count model_usage rows this month as a proxy for API activity.
 */
async function checkBandwidth() {
  const start = Date.now();
  try {
    // Count API calls this month as a rough bandwidth proxy
    // Each Supabase REST call is ~2-5KB. model_usage is our heaviest table.
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { count, error } = await supabase
      .from('model_usage')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStart.toISOString());

    const responseTimeMs = Date.now() - start;

    if (error) {
      return {
        checkType: 'resource',
        component: 'bandwidth',
        status: 'fail',
        responseTimeMs,
        details: error.message
      };
    }

    // Rough estimate: ~3KB per API call average (request + response)
    // model_usage calls represent ~40% of total API activity
    const estimatedTotalCalls = Math.round((count || 0) * 2.5);
    const estimatedBandwidthMB = Math.round(estimatedTotalCalls * 3 / 1024);
    const bandwidthLimitMB = 2048; // 2GB free tier
    const usedPercent = (estimatedBandwidthMB / bandwidthLimitMB) * 100;

    let status = 'pass';
    let details = null;

    if (usedPercent >= 75) {
      status = 'fail';
      details = `CRITICAL: ~${estimatedBandwidthMB}MB / ${bandwidthLimitMB}MB bandwidth used (~${usedPercent.toFixed(0)}%). Consider Supabase Pro.`;
    } else if (usedPercent >= 50) {
      status = 'warning';
      details = `High bandwidth: ~${estimatedBandwidthMB}MB / ${bandwidthLimitMB}MB (~${usedPercent.toFixed(0)}%).`;
    }

    return {
      checkType: 'resource',
      component: 'bandwidth',
      status,
      responseTimeMs,
      details,
      metadata: { estimatedBandwidthMB, usedPercent: usedPercent.toFixed(1), apiCallsThisMonth: estimatedTotalCalls }
    };
  } catch (err) {
    return {
      checkType: 'resource',
      component: 'bandwidth',
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
  checkOpenRouter,
  checkRAM,
  checkBandwidth
};
