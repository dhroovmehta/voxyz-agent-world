// notion.js — Publish deliverables and summaries to Notion
// WHY: Discord is for alerts only. Notion is where deliverables live.
// Each team has a page in the VoxYZ HQ workspace.
// Deliverables are created as child pages under the team's page.

const supabase = require('./supabase');

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ============================================================
// CORE API
// ============================================================

async function notionRequest(method, path, body = null) {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error('[notion] Missing NOTION_API_KEY');
    return null;
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${NOTION_API_URL}${path}`, options);

  if (!response.ok) {
    const error = await response.text();
    console.error(`[notion] API ${response.status}: ${error}`);
    return null;
  }

  return response.json();
}

// ============================================================
// PAGE DISCOVERY
// ============================================================

/**
 * Find the HQ page and team sub-pages.
 * Uses direct page ID (from env) to avoid search API issues.
 * Falls back to search if no ID configured.
 */
let pageCache = null;

async function getTeamPages() {
  if (pageCache) return pageCache;

  // Use direct page ID if configured (most reliable)
  const hqPageId = process.env.NOTION_HQ_PAGE_ID || '304c642f7e708027958adc5e3c989068';

  // Get child pages of the HQ page
  const children = await notionRequest('GET', `/blocks/${hqPageId}/children?page_size=100`);

  if (!children || !children.results) {
    console.error(`[notion] Could not access HQ page. Check NOTION_HQ_PAGE_ID and integration access.`);
    return null;
  }

  // Find team pages by title among children
  const teamPages = {};
  const teamKeywords = {
    'team-research': 'research',
    'team-execution': 'execution',
    'team-advisory': 'advisory'
  };

  for (const block of children.results) {
    if (block.type === 'child_page') {
      const title = (block.child_page?.title || '').toLowerCase();
      for (const [teamId, keyword] of Object.entries(teamKeywords)) {
        if (title.includes(keyword)) {
          teamPages[teamId] = block.id;
          console.log(`[notion] Found ${block.child_page.title}: ${block.id}`);
        }
      }
    }
  }

  pageCache = {
    hqPageId,
    teamPages
  };

  return pageCache;
}

// ============================================================
// PUBLISH DELIVERABLE
// ============================================================

/**
 * Publish a completed deliverable as a new Notion page under the team's page.
 *
 * @param {Object} params
 * @param {string} params.title - Page title
 * @param {string} params.content - The deliverable content (markdown-ish)
 * @param {string} params.teamId - Which team page to publish under
 * @param {string} params.agentName - Who created it
 * @param {number} params.missionId - For reference
 * @param {number} params.stepId - For reference
 * @returns {Object|null} The created page, or null on failure
 */
async function publishDeliverable({ title, content, teamId, agentName, missionId, stepId }) {
  const pages = await getTeamPages();
  if (!pages) return null;

  const parentPageId = pages.teamPages[teamId] || pages.hqPageId;

  // Convert content to Notion blocks (paragraphs)
  const blocks = contentToBlocks(content);

  const page = await notionRequest('POST', '/pages', {
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ text: { content: title } }]
      }
    },
    children: [
      // Metadata header
      {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { emoji: '📋' },
          rich_text: [{
            text: {
              content: `Agent: ${agentName} | Mission #${missionId} | Step #${stepId} | ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            }
          }]
        }
      },
      { object: 'block', type: 'divider', divider: {} },
      ...blocks
    ]
  });

  if (page) {
    console.log(`[notion] Published: "${title}" → ${page.url}`);

    // Log to notion_sync table
    await supabase
      .from('notion_sync')
      .insert({
        mission_step_id: stepId,
        team_id: teamId,
        notion_page_id: page.id,
        page_title: title,
        sync_type: 'deliverable',
        status: 'synced'
      });

    return page;
  }

  return null;
}

/**
 * Publish a daily summary to Notion.
 */
async function publishDailySummary({ title, content, teamId }) {
  const pages = await getTeamPages();
  if (!pages) return null;

  const parentPageId = pages.teamPages[teamId] || pages.hqPageId;
  const blocks = contentToBlocks(content);

  const page = await notionRequest('POST', '/pages', {
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ text: { content: title } }]
      }
    },
    children: [
      {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { emoji: '📊' },
          rich_text: [{
            text: { content: `Daily Summary — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` }
          }]
        }
      },
      { object: 'block', type: 'divider', divider: {} },
      ...blocks
    ]
  });

  if (page) {
    console.log(`[notion] Daily summary published: "${title}" → ${page.url}`);
  }

  return page;
}

// ============================================================
// CONTENT CONVERSION
// ============================================================

/**
 * Convert text content to Notion block objects.
 * Handles headings (##), bullet points (-), and paragraphs.
 * Notion API limit: 100 blocks per request, 2000 chars per block.
 */
function contentToBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Heading 1
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ text: { content: trimmed.substring(2).trim() } }]
        }
      });
    }
    // Heading 2
    else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ text: { content: trimmed.substring(3).trim() } }]
        }
      });
    }
    // Heading 3
    else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ text: { content: trimmed.substring(4).trim() } }]
        }
      });
    }
    // Bullet point
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ text: { content: truncate(trimmed.substring(2).trim(), 1900) } }]
        }
      });
    }
    // Numbered list
    else if (/^\d+\.\s/.test(trimmed)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ text: { content: truncate(trimmed.replace(/^\d+\.\s/, ''), 1900) } }]
        }
      });
    }
    // Regular paragraph
    else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: truncate(trimmed, 1900) } }]
        }
      });
    }

    // Notion limit: 100 blocks per request
    if (blocks.length >= 95) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: '[Content truncated — full version in Google Drive]' } }]
        }
      });
      break;
    }
  }

  return blocks;
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

// ============================================================
// TASK BOARDS (Decision 24 — each team gets a structured board)
// ============================================================

// Cache for task board database IDs
let taskBoardCache = {};

/**
 * Get or create a task board (Notion database) for a team.
 * Each team gets one board with columns: To Do, In Progress, In Review, Done.
 * Tasks are assignable to agents AND Zero.
 *
 * @param {string} teamId - e.g. 'team-research'
 * @returns {string|null} Database ID or null on failure
 */
async function getOrCreateTaskBoard(teamId) {
  if (taskBoardCache[teamId]) return taskBoardCache[teamId];

  const pages = await getTeamPages();
  if (!pages) return null;

  const parentPageId = pages.teamPages[teamId] || pages.hqPageId;

  // Search for existing task board under the team page
  const children = await notionRequest('GET', `/blocks/${parentPageId}/children?page_size=100`);
  if (children && children.results) {
    for (const block of children.results) {
      if (block.type === 'child_database') {
        const title = (block.child_database?.title || '').toLowerCase();
        if (title.includes('task') || title.includes('board')) {
          taskBoardCache[teamId] = block.id;
          console.log(`[notion] Found task board for ${teamId}: ${block.id}`);
          return block.id;
        }
      }
    }
  }

  // Create a new task board database
  const teamNames = {
    'team-research': 'Research',
    'team-execution': 'Execution',
    'team-advisory': 'Advisory'
  };
  const teamName = teamNames[teamId] || teamId;

  const db = await notionRequest('POST', '/databases', {
    parent: { page_id: parentPageId },
    title: [{ text: { content: `${teamName} Task Board` } }],
    properties: {
      'Task': {
        title: {}
      },
      'Status': {
        select: {
          options: [
            { name: 'To Do', color: 'gray' },
            { name: 'In Progress', color: 'blue' },
            { name: 'In Review', color: 'yellow' },
            { name: 'Done', color: 'green' }
          ]
        }
      },
      'Assignee': {
        rich_text: {}
      },
      'Priority': {
        select: {
          options: [
            { name: 'Low', color: 'gray' },
            { name: 'Normal', color: 'blue' },
            { name: 'Urgent', color: 'red' }
          ]
        }
      },
      'Mission ID': {
        number: {}
      },
      'Due Date': {
        date: {}
      }
    }
  });

  if (db) {
    taskBoardCache[teamId] = db.id;
    console.log(`[notion] Created task board for ${teamId}: ${db.id}`);
    return db.id;
  }

  return null;
}

/**
 * Create a task on a team's task board.
 *
 * @param {Object} params
 * @param {string} params.teamId - Which team's board
 * @param {string} params.title - Task title
 * @param {string} [params.assignee] - Agent name or 'Zero' for founder tasks
 * @param {string} [params.status] - 'To Do' | 'In Progress' | 'In Review' | 'Done'
 * @param {string} [params.priority] - 'Low' | 'Normal' | 'Urgent'
 * @param {number} [params.missionId] - Related mission ID
 * @param {string} [params.description] - Task details (added as page content)
 * @returns {Object|null} Created page or null
 */
async function createTask({ teamId, title, assignee = null, status = 'To Do', priority = 'Normal', missionId = null, description = null }) {
  const boardId = await getOrCreateTaskBoard(teamId);
  if (!boardId) return null;

  const properties = {
    'Task': {
      title: [{ text: { content: title } }]
    },
    'Status': {
      select: { name: status }
    },
    'Priority': {
      select: { name: priority }
    }
  };

  if (assignee) {
    properties['Assignee'] = {
      rich_text: [{ text: { content: assignee } }]
    };
  }

  if (missionId) {
    properties['Mission ID'] = {
      number: missionId
    };
  }

  const body = {
    parent: { database_id: boardId },
    properties
  };

  // Add description as page content if provided
  if (description) {
    body.children = contentToBlocks(description).slice(0, 20);
  }

  const page = await notionRequest('POST', '/pages', body);

  if (page) {
    console.log(`[notion] Task created: "${title}" on ${teamId} board (${status})`);
  }

  return page;
}

/**
 * Update a task's status on the board.
 *
 * @param {string} pageId - Notion page ID of the task
 * @param {string} status - 'To Do' | 'In Progress' | 'In Review' | 'Done'
 * @returns {Object|null} Updated page or null
 */
async function updateTaskStatus(pageId, status) {
  const result = await notionRequest('PATCH', `/pages/${pageId}`, {
    properties: {
      'Status': {
        select: { name: status }
      }
    }
  });

  if (result) {
    console.log(`[notion] Task ${pageId} → ${status}`);
  }

  return result;
}

/**
 * Get all tasks from a team's board, optionally filtered by status.
 *
 * @param {string} teamId
 * @param {string} [status] - Filter by status (e.g. 'To Do')
 * @returns {Array} Array of task objects
 */
async function getTeamTasks(teamId, status = null) {
  const boardId = await getOrCreateTaskBoard(teamId);
  if (!boardId) return [];

  const body = {
    page_size: 100,
    sorts: [{ property: 'Status', direction: 'ascending' }]
  };

  if (status) {
    body.filter = {
      property: 'Status',
      select: { equals: status }
    };
  }

  const result = await notionRequest('POST', `/databases/${boardId}/query`, body);
  if (!result || !result.results) return [];

  return result.results.map(page => ({
    id: page.id,
    title: page.properties?.Task?.title?.[0]?.text?.content || 'Untitled',
    status: page.properties?.Status?.select?.name || 'To Do',
    assignee: page.properties?.Assignee?.rich_text?.[0]?.text?.content || null,
    priority: page.properties?.Priority?.select?.name || 'Normal',
    missionId: page.properties?.['Mission ID']?.number || null,
    url: page.url
  }));
}

/**
 * Clear the page cache (call when workspace structure changes).
 */
function clearCache() {
  pageCache = null;
  taskBoardCache = {};
}

module.exports = {
  publishDeliverable,
  publishDailySummary,
  getTeamPages,
  // Task boards (Decision 24)
  getOrCreateTaskBoard,
  createTask,
  updateTaskStatus,
  getTeamTasks,
  clearCache
};
