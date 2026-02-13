// github.js — Auto-push agent state to GitHub (Decision 12)
// WHY: Source code lives in GitHub already, but agent state (personas, configs,
// skills, policy rules) should also be version-controlled for audit and recovery.
// Deliverables do NOT go here — those go to Notion and Google Drive only.
//
// Uses GitHub REST API (Contents endpoint) — no extra dependencies needed.
// Requires: GITHUB_TOKEN and GITHUB_REPO in .env

const supabase = require('./supabase');

const GITHUB_API = 'https://api.github.com';

// ============================================================
// CORE API
// ============================================================

/**
 * Make an authenticated GitHub API request.
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g. /repos/owner/repo/contents/file.json)
 * @param {Object} [body] - Request body
 * @returns {Object|null} Response data or null on failure
 */
async function githubRequest(method, path, body = null) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('[github] Missing GITHUB_TOKEN');
    return null;
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Frasier/1.0'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${GITHUB_API}${path}`, options);

    if (!response.ok) {
      const error = await response.text();
      console.error(`[github] API ${response.status}: ${error.substring(0, 200)}`);
      return null;
    }

    return response.json();
  } catch (err) {
    console.error(`[github] Request failed: ${err.message}`);
    return null;
  }
}

// ============================================================
// FILE OPERATIONS
// ============================================================

/**
 * Get the SHA of an existing file (needed for updates).
 * Returns null if file doesn't exist (which means we create it).
 */
async function getFileSha(repo, path) {
  const result = await githubRequest('GET', `/repos/${repo}/contents/${path}`);
  return result?.sha || null;
}

/**
 * Create or update a file in the repository.
 * GitHub Contents API requires base64-encoded content.
 *
 * @param {string} repo - Repository in "owner/repo" format
 * @param {string} filePath - Path within the repo (e.g. "state/agents.json")
 * @param {string} content - File content (will be base64-encoded)
 * @param {string} message - Commit message
 * @returns {Object|null} Commit data or null on failure
 */
async function pushFile(repo, filePath, content, message) {
  const encoded = Buffer.from(content).toString('base64');

  // Check if file exists (need SHA for update)
  const sha = await getFileSha(repo, filePath);

  const body = {
    message,
    content: encoded,
    branch: 'main'
  };

  if (sha) {
    body.sha = sha; // Update existing file
  }

  const result = await githubRequest('PUT', `/repos/${repo}/contents/${filePath}`, body);

  if (result) {
    console.log(`[github] ${sha ? 'Updated' : 'Created'} ${filePath}`);
  }

  return result;
}

// ============================================================
// DAILY STATE PUSH (Decision 12)
// ============================================================

/**
 * Push current agent state to GitHub.
 * Called daily by heartbeat. Commits:
 *   - state/agents.json — all agent configs
 *   - state/personas.json — all agent personas
 *   - state/teams.json — team structure
 *   - state/policy.json — ops policy rules
 *   - state/skills.json — agent skills registry
 *
 * @returns {{ success: boolean, filesUpdated: number, errors: string[] }}
 */
async function pushDailyState() {
  const repo = process.env.GITHUB_REPO;
  if (!repo) {
    console.error('[github] Missing GITHUB_REPO (format: owner/repo)');
    return { success: false, filesUpdated: 0, errors: ['GITHUB_REPO not set'] };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { success: false, filesUpdated: 0, errors: ['GITHUB_TOKEN not set'] };
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const errors = [];
  let filesUpdated = 0;

  // Gather all state data in parallel
  const [agentsResult, personasResult, teamsResult, policyResult, skillsResult] = await Promise.all([
    supabase.from('agents').select('*').eq('status', 'active'),
    supabase.from('agent_personas').select('*'),
    supabase.from('teams').select('*'),
    supabase.from('ops_policy').select('*'),
    supabase.from('agent_skills').select('*')
  ]);

  const statePushes = [
    {
      path: 'state/agents.json',
      data: agentsResult.data,
      error: agentsResult.error
    },
    {
      path: 'state/personas.json',
      data: personasResult.data,
      error: personasResult.error
    },
    {
      path: 'state/teams.json',
      data: teamsResult.data,
      error: teamsResult.error
    },
    {
      path: 'state/policy.json',
      data: policyResult.data,
      error: policyResult.error
    },
    {
      path: 'state/skills.json',
      data: skillsResult.data,
      error: skillsResult.error
    }
  ];

  for (const push of statePushes) {
    if (push.error) {
      errors.push(`${push.path}: ${push.error.message}`);
      continue;
    }

    try {
      const content = JSON.stringify(push.data || [], null, 2);
      const result = await pushFile(
        repo,
        push.path,
        content,
        `[auto] Daily state sync — ${dateStr}`
      );

      if (result) {
        filesUpdated++;
      } else {
        errors.push(`${push.path}: Push failed`);
      }
    } catch (err) {
      errors.push(`${push.path}: ${err.message}`);
    }
  }

  const success = errors.length === 0;
  console.log(`[github] State push: ${filesUpdated}/${statePushes.length} files to ${repo} (${dateStr})`);

  return { success, filesUpdated, totalFiles: statePushes.length, errors };
}

module.exports = {
  pushFile,
  pushDailyState
};
