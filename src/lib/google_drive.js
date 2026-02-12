// google_drive.js — Publish deliverables as Google Docs in shared Drive folders
// WHY: Notion is great for pages, but Google Drive is better for docs, spreadsheets,
// and files that Zero might want to share externally or edit collaboratively.
// Each team gets a subfolder. Deliverables become Google Docs with full formatting.

const { google } = require('googleapis');
const supabase = require('./supabase');

// ============================================================
// AUTH
// ============================================================

let driveClient = null;

/**
 * Get an authenticated Google Drive client using the service account key.
 * The key is stored as a JSON string in the GOOGLE_SERVICE_ACCOUNT_KEY env var.
 */
function getDriveClient() {
  if (driveClient) return driveClient;

  try {
    let key;

    // Option 1: Read from a JSON file (most reliable — avoids dotenv escaping issues)
    const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
      || require('path').join(__dirname, '../../credentials/google-service-account.json');

    try {
      const fs = require('fs');
      if (fs.existsSync(keyFilePath)) {
        key = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
        console.log('[gdrive] Loaded service account from file');
      }
    } catch (fileErr) {
      // Fall through to env var
    }

    // Option 2: Fall back to env var
    if (!key) {
      const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      if (!keyJson) {
        console.error('[gdrive] Missing service account key. Place it at credentials/google-service-account.json');
        return null;
      }
      key = JSON.parse(keyJson);
      if (key.private_key) {
        key.private_key = key.private_key.replace(/\\n/g, '\n');
      }
    }

    // Use domain-wide delegation to impersonate the Workspace user
    // This makes files count against the Workspace user's storage, not the service account
    const impersonateEmail = process.env.GOOGLE_IMPERSONATE_EMAIL;

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets'
      ],
      clientOptions: impersonateEmail ? { subject: impersonateEmail } : {}
    });

    driveClient = google.drive({ version: 'v3', auth });
    console.log(`[gdrive] Authenticated${impersonateEmail ? ` as ${impersonateEmail}` : ''}`);
    return driveClient;
  } catch (err) {
    console.error('[gdrive] Failed to initialize Drive client:', err.message);
    return null;
  }
}

// ============================================================
// FOLDER MANAGEMENT
// ============================================================

let folderCache = null;

/**
 * Get or create the team folder structure.
 * Root: "VoxYZ Deliverables" (or env override)
 * Children: "Research Team", "Execution Team", "Advisory Team"
 */
async function getTeamFolders() {
  if (folderCache) return folderCache;

  const drive = getDriveClient();
  if (!drive) return null;

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  if (rootFolderId) {
    // Use the configured root folder
    const teamFolders = await findOrCreateTeamFolders(drive, rootFolderId);
    folderCache = { rootFolderId, teamFolders };
    return folderCache;
  }

  // No root folder configured — find or create one
  const rootName = process.env.GOOGLE_DRIVE_ROOT_NAME || 'VoxYZ Deliverables';
  const rootId = await findOrCreateFolder(drive, rootName, null);
  if (!rootId) return null;

  const teamFolders = await findOrCreateTeamFolders(drive, rootId);
  folderCache = { rootFolderId: rootId, teamFolders };
  return folderCache;
}

/**
 * Find or create the three team subfolders under the root.
 */
async function findOrCreateTeamFolders(drive, parentId) {
  const teamMap = {
    'team-research': 'Research Team',
    'team-execution': 'Execution Team',
    'team-advisory': 'Advisory Team'
  };

  const result = {};
  for (const [teamId, folderName] of Object.entries(teamMap)) {
    const folderId = await findOrCreateFolder(drive, folderName, parentId);
    if (folderId) {
      result[teamId] = folderId;
      console.log(`[gdrive] ${folderName} folder: ${folderId}`);
    }
  }

  return result;
}

/**
 * Find a folder by name (under a parent), or create it if missing.
 */
async function findOrCreateFolder(drive, name, parentId) {
  try {
    // Search for existing folder
    let query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }

    const list = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (list.data.files && list.data.files.length > 0) {
      return list.data.files[0].id;
    }

    // Create folder
    const folder = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : []
      },
      fields: 'id'
    });

    console.log(`[gdrive] Created folder "${name}": ${folder.data.id}`);
    return folder.data.id;
  } catch (err) {
    console.error(`[gdrive] Error with folder "${name}":`, err.message);
    return null;
  }
}

// ============================================================
// PUBLISH DELIVERABLE
// ============================================================

/**
 * Publish a deliverable as a Google Doc under the team's folder.
 *
 * @param {Object} params
 * @param {string} params.title - Document title
 * @param {string} params.content - The deliverable content (plain text / markdown)
 * @param {string} params.teamId - Which team folder
 * @param {string} params.agentName - Who created it
 * @param {number} params.missionId - For reference
 * @param {number} params.stepId - For reference
 * @returns {Object|null} { id, url } or null on failure
 */
async function publishDeliverable({ title, content, teamId, agentName, missionId, stepId }) {
  const drive = getDriveClient();
  if (!drive) return null;

  const folders = await getTeamFolders();
  if (!folders) return null;

  const parentFolderId = folders.teamFolders[teamId] || folders.rootFolderId;

  // Add metadata header to the content
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fullContent = `Agent: ${agentName} | Mission #${missionId} | Step #${stepId} | ${dateStr}\n${'─'.repeat(60)}\n\n${content}`;

  try {
    // Create a Google Doc (with Workspace impersonation, storage counts against the user)
    const file = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        parents: [parentFolderId]
      },
      media: {
        mimeType: 'text/plain',
        body: fullContent
      },
      fields: 'id, webViewLink'
    });

    const docId = file.data.id;
    const docUrl = file.data.webViewLink;

    // Make the doc viewable by anyone with the link
    await drive.permissions.create({
      fileId: docId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    console.log(`[gdrive] Published: "${title}" → ${docUrl}`);

    // Log to google_drive_sync table if it exists
    await supabase
      .from('google_drive_sync')
      .insert({
        mission_step_id: stepId,
        team_id: teamId,
        drive_file_id: docId,
        file_title: title,
        file_url: docUrl,
        sync_type: 'deliverable',
        status: 'synced'
      })
      .then(({ error }) => {
        if (error) console.log(`[gdrive] Sync log skipped (table may not exist): ${error.message}`);
      });

    return { id: docId, url: docUrl };
  } catch (err) {
    console.error(`[gdrive] Failed to publish "${title}":`, err.message);
    return null;
  }
}

// ============================================================
// DAILY BACKUP (Decision 23 — automated DB backup to Drive)
// ============================================================

/**
 * Export key database tables as JSON files to a "Backups" folder in Google Drive.
 * Runs daily at 3am ET via heartbeat. Zero cost — just Drive storage.
 *
 * Tables backed up:
 *   - agents, agent_personas, teams, ops_policy (full — small tables)
 *   - agent_memories, lessons_learned (last 7 days)
 *   - missions, mission_steps (last 7 days)
 *   - model_usage (last 7 days — for cost audit trail)
 */
async function backupDatabase() {
  const drive = getDriveClient();
  if (!drive) {
    console.error('[gdrive] Backup skipped — no Drive client');
    return { success: false, error: 'No Drive client' };
  }

  const folders = await getTeamFolders();
  if (!folders) {
    console.error('[gdrive] Backup skipped — no folder structure');
    return { success: false, error: 'No folder structure' };
  }

  // Find or create a "Backups" folder under the root
  const backupFolderId = await findOrCreateFolder(drive, 'Backups', folders.rootFolderId);
  if (!backupFolderId) {
    return { success: false, error: 'Could not create Backups folder' };
  }

  const dateStr = new Date().toISOString().split('T')[0]; // e.g. 2026-02-11
  const dayFolderId = await findOrCreateFolder(drive, `backup-${dateStr}`, backupFolderId);
  if (!dayFolderId) {
    return { success: false, error: 'Could not create day folder' };
  }

  // 7-day lookback for large tables
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const sinceIso = since.toISOString();

  // Define what to back up
  const backupTasks = [
    { name: 'agents', query: supabase.from('agents').select('*') },
    { name: 'agent_personas', query: supabase.from('agent_personas').select('*') },
    { name: 'teams', query: supabase.from('teams').select('*') },
    { name: 'ops_policy', query: supabase.from('ops_policy').select('*') },
    { name: 'agent_memories_7d', query: supabase.from('agent_memories').select('*').gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(1000) },
    { name: 'lessons_learned', query: supabase.from('lessons_learned').select('*') },
    { name: 'missions_7d', query: supabase.from('missions').select('*').gte('created_at', sinceIso) },
    { name: 'mission_steps_7d', query: supabase.from('mission_steps').select('*').gte('created_at', sinceIso) },
    { name: 'model_usage_7d', query: supabase.from('model_usage').select('*').gte('created_at', sinceIso).limit(2000) }
  ];

  let uploadedCount = 0;
  const errors = [];

  for (const task of backupTasks) {
    try {
      const { data, error } = await task.query;
      if (error) {
        errors.push(`${task.name}: ${error.message}`);
        continue;
      }

      const jsonContent = JSON.stringify(data || [], null, 2);

      await drive.files.create({
        requestBody: {
          name: `${task.name}.json`,
          mimeType: 'application/json',
          parents: [dayFolderId]
        },
        media: {
          mimeType: 'application/json',
          body: jsonContent
        },
        fields: 'id'
      });

      uploadedCount++;
      console.log(`[gdrive] Backed up ${task.name}: ${(data || []).length} rows`);
    } catch (err) {
      errors.push(`${task.name}: ${err.message}`);
    }
  }

  const result = {
    success: errors.length === 0,
    date: dateStr,
    tablesBackedUp: uploadedCount,
    totalTables: backupTasks.length,
    errors
  };

  console.log(`[gdrive] Backup complete: ${uploadedCount}/${backupTasks.length} tables to backup-${dateStr}`);
  return result;
}

/**
 * Clear the folder cache (call when folder structure changes).
 */
function clearCache() {
  folderCache = null;
}

module.exports = {
  publishDeliverable,
  getTeamFolders,
  backupDatabase,
  clearCache
};
