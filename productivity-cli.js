#!/usr/bin/env node
/** 
 * Productivity Tracker CLI - runs locally on PC using SQLite
 * Usage: node productivity-cli.js <command> [args]
 */

const path = require('path');
const fs = require('fs');

// Initialize database
const dbPath = path.join(__dirname, 'productivity.db');
const db = new (require('better-sqlite3'))(dbPath);

// Make DB accessible globally for scripts
global.db = db;

// Welcome message
console.log('╔═════════════════════════════════════════════════════════╗');
console.log('║   📱 Productivity Tracker CLI - All-in-One System   ║');
console.log('║   Local SQLite Database - Runs on your PC           ║');
console.log('╚═════════════════════════════════════════════════════════╝');
console.log();

// Initialize schema if database doesn't exist
if (!fs.existsSync(dbPath)) {
  console.log('📦 Initializing new productivity database...');
  const fs = require('fs');
  // Read and execute the SQL schema
  // For now, create tables manually
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      goal_type TEXT DEFAULT 'personal',
      progress_percentage INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      workspace_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      goal_id INTEGER,
      workspace_id INTEGER,
      progress_percentage INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      project_id INTEGER,
      goal_id INTEGER,
      status TEXT DEFAULT 'backlog',
      priority TEXT DEFAULT 'medium',
      due_date DATE,
      estimated_duration INTEGER DEFAULT 0,
      actual_duration INTEGER DEFAULT 0,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
    );
  `);
  console.log('✅ Database schema initialized');
}
console.log();

// Command dispatch
const command = process.argv[2];
const args = process.argv.slice(3);

function handleHelp() {
  console.log('Available commands:');
  console.log();
  console.log('  init                                      Initialize/reset database');
  console.log('  user:add <username> [email]               Add a new user');
  console.log('  workspace:add <name> [description]        Create a workspace');
  console.log('  goal:add <title> [type] [workspace]       Create a goal');
  console.log('  project:add <title> [goal] [workspace]    Create a project');
  console.log('  task:add <title> [project] [due]          Create a task');
  console.log('  task:list                                 List all tasks');
  console.log('  task:today                                List today\'s tasks');
  console.log('  task:complete <id>                        Mark task as done');
  console.log('  habit:add <title> [frequency]             Add a habit');
  console.log('  habit:log <habit_id>                        Log habit completion');
  console.log('  calendar:add <title> <start> <end>        Add calendar event');
  console.log('  focus:start <task_id>                       Start a focus session');
  console.log('  focus:stop                                  Stop current focus session');
  console.log('  journal:add <mood> [content]              Add journal entry');
  console.log('  productivity:score                        Calculate productivity score');
  console.log('  search <query>                              Global search');
  console.log('  help                                        Show this help');
  console.log();
}

function handleInit() {
  // Core tables only - full schema in SQL file
  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      goal_type TEXT DEFAULT 'personal',
      progress_percentage INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      workspace_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      goal_id INTEGER,
      workspace_id INTEGER,
      progress_percentage INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      project_id INTEGER,
      goal_id INTEGER,
      status TEXT DEFAULT 'backlog',
      priority TEXT DEFAULT 'medium',
      due_date DATE,
      estimated_duration INTEGER DEFAULT 0,
      actual_duration INTEGER DEFAULT 0,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      frequency TEXT DEFAULT 'daily',
      streak_count INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      completion_rate REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS habit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL,
      date DATE NOT NULL,
      completed BOOLEAN DEFAULT FALSE,
      completion_time DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
      UNIQUE(habit_id, date)
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME,
      all_day BOOLEAN DEFAULT FALSE,
      status TEXT DEFAULT 'scheduled',
      color TEXT DEFAULT '#10b981',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS focus_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      started_at DATETIME NOT NULL,
      ended_at DATETIME,
      duration_minutes INTEGER,
      mode TEXT DEFAULT 'pomodoro',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date DATE DEFAULT (DATE('now')),
      mood TEXT,
      content TEXT,
      productivity_score INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      focus_minutes INTEGER DEFAULT 0,
      habits_completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Insert default workspace and user after table creation
  const workspaceStmt = db.prepare("INSERT INTO workspaces (name, slug, description, is_default) VALUES (?, ?, ?, ?)");
  workspaceStmt.run('Personal', 'personal', 'My personal productivity workspace', 1);

  const userStmt = db.prepare("INSERT INTO users (username, email) VALUES (?, ?)");
  userStmt.run('defaultuser', 'default@example.com');

  db.exec('PRAGMA foreign_keys = ON');

  console.log('✅ Database schema initialized with core tables and defaults');
}

function handleUserAdd(username, email) {
  try {
    const stmt = db.prepare('INSERT INTO users (username, email) VALUES (?, ?)');
    const info = stmt.run(username, email || null);
    console.log(`✅ User created: ${username} (ID: ${info.lastInsertRowid})`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleWorkspaceAdd(name, description) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const stmt = db.prepare('INSERT INTO workspaces (name, slug, description) VALUES (?, ?, ?)');
    const info = stmt.run(name, slug, description || '');
    console.log(`✅ Workspace created: ${name} (ID: ${info.lastInsertRowid})`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleGoalAdd(title, type, workspaceId) {
  try {
    const stmt = db.prepare('INSERT INTO goals (title, goal_type, workspace_id) VALUES (?, ?, ?)');
    const info = stmt.run(title, type || 'personal', workspaceId || null);
    console.log(`✅ Goal created: ${title} (ID: ${info.lastInsertRowid})`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleProjectAdd(title, goalId, workspaceId) {
  try {
    const stmt = db.prepare('INSERT INTO projects (title, goal_id, workspace_id) VALUES (?, ?, ?)');
    const info = stmt.run(title, goalId || null, workspaceId || null);
    console.log(`✅ Project created: ${title} (ID: ${info.lastInsertRowid})`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleTaskAdd(title, projectId, dueDate) {
  try {
    const stmt = db.prepare(`
      INSERT INTO tasks (title, project_id, due_date, status, priority)
      VALUES (?, ?, ?, 'backlog', 'medium')
    `);
    const info = stmt.run(title, projectId || null, dueDate || null);
    console.log(`✅ Task created: ${title} (ID: ${info.lastInsertRowid})`);
    console.log(`   Project: ${projectId ? 'linked' : 'none'}`);
    console.log(`   Due: ${dueDate || 'no due date'}`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleTaskList() {
  const rows = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.due_date,
           p.title as project_title, g.title as goal_title
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN goals g ON t.goal_id = g.id
    ORDER BY t.priority DESC, t.created_at DESC
  `).all();

  console.log(`\n📋 Tasks (${rows.length})`);
  console.log('─'.repeat(60));
  rows.forEach((row, i) => {
    const priorityIcon = row.priority === 'urgent' ? '🔴' : row.priority === 'high' ? '🟠' : row.priority === 'medium' ? '🟡' : '🟢';
    const statusIcon = row.status === 'done' ? '☑' : row.status === 'in_progress' ? '⟳' : row.status === 'backlog' ? '○' : '⚪';
    const due = row.due_row ? ` | Due: ${row.due_date}` : '';
    console.log(`[${i + 1}] ${statusIcon} ${priorityIcon} ${row.id}. ${row.title}${due} ${row.project_title ? `(@${row.project_title})` : ''}`);
  });
  console.log();
}

function handleTaskToday() {
  const rows = db.prepare(`
    SELECT t.*, p.title as project_title
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.status IN ('todo', 'in_progress')
      AND (t.due_date IS NULL OR t.due_date = DATE('now'))
    ORDER BY t.priority DESC, t.created_at DESC
  `).all();

  if (rows.length === 0) {
    console.log('🎯 No tasks for today!');
    return;
  }

  console.log(`\n⚡ Today's Tasks (${rows.length})`);
  console.log('─'.repeat(60));
  rows.forEach((row, i) => {
    const priorityIcon = row.priority === 'urgent' ? '🔴' : row.priority === 'high' ? '🟠' : row.priority === 'medium' ? '🟡' : '🟢';
    console.log(`${i + 1}. ${priorityIcon} ${row.title}`);
    if (row.estimated_duration) {
      const hrs = Math.floor(row.estimated_duration / 60);
      const mins = row.estimated_duration % 60;
      console.log(`   Est: ${hrs}h${mins > 0 ? `:${mins}` : ''}`);
    }
  });
  console.log();
}

function handleTaskComplete(id) {
  try {
    const now = new Date();
    db.prepare('UPDATE tasks SET status = \'done\', completed_at = ? WHERE id = ?').run(now.toISOString(), id);
    console.log(`✅ Task #${id} marked as done!`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleHabitAdd(title, frequency) {
  try {
    const stmt = db.prepare('INSERT INTO habits (title, frequency) VALUES (?, ?)');
    const info = stmt.run(title, frequency || 'daily');
    console.log(`✅ Habit created: ${title} (ID: ${info.lastInsertRowid}, Frequency: ${frequency || 'daily'})`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleHabitLog(habitId) {
  try {
    const todayDate = new Date().toISOString().split('T')[0];
    // Check if already logged today
    const existing = db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?').get(habitId, todayDate);
    if (existing) {
      console.log('⚠️ Habit already logged for today');
      return;
    }
    db.prepare('INSERT INTO habit_logs (habit_id, date, completed) VALUES (?, ?, 1)').run(habitId, todayDate);
    console.log('✅ Habit logged for today!');
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleCalendarAdd(title, start, end) {
  try {
    const stmt = db.prepare('INSERT INTO calendar_events (title, start_time, end_time) VALUES (?, ?, ?)');
    const info = stmt.run(title, start || new Date().toISOString(), end || new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString());
    console.log(`✅ Calendar event created: ${title} (ID: ${info.lastInsertRowid})`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleFocusStart(taskId) {
  try {
    const startedAt = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO focus_sessions (task_id, started_at) VALUES (?, ?)');
    const info = stmt.run(taskId, startedAt);
    console.log(`▶️ Focus session started for task #${taskId} (Session ID: ${info.lastInsertRowid})`);
    console.log(`   Started at: ${new Date(startedAt).toLocaleTimeString()}`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleFocusStop() {
  try {
    // Get the most recent unfinished focus session
    const session = db.prepare(`
      SELECT fs.*, t.title as task_title
      FROM focus_sessions fs
      LEFT JOIN tasks t ON fs.task_id = t.id
      WHERE fs.ended_at IS NULL
      ORDER BY fs.started_at DESC
      LIMIT 1
    `).get();

    if (!session) {
      console.log('⚠️ No active focus session found');
      return;
    }

    const endedAt = new Date().toISOString();
    const durationMinutes = Math.round((new Date(endedAt) - new Date(session.started_at)) / 60000);

    db.prepare('UPDATE focus_sessions SET ended_at = ?, duration_minutes = ? WHERE id = ?')
      .run(endedAt, durationMinutes, session.id);

    console.log(`⏹️ Focus session ended`);
    console.log(`   Duration: ${durationMinutes} minutes`);
    console.log(`   Task: ${session.task_title}`);
    console.log(`   Completed at: ${new Date(endedAt).toLocaleTimeString()}`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleJournalAdd(mood, content) {
  try {
    const userId = 1; // Default user (created in init)
    const todayDate = new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
      INSERT INTO journal_entries (user_id, date, mood, content, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const info = stmt.run(userId, todayDate, mood || null, content || null);
    console.log(`✅ Journal entry added (ID: ${info.lastInsertRowid})`);
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleProductivityScore() {
  try {
    const todayDate = new Date().toISOString().split('T')[0];

    // Tasks created or due today
    const tasks = db.prepare(`
      SELECT * FROM tasks
      WHERE date(created_at) = ? OR date(due_date) = ?
    `).all(todayDate, todayDate);

    const completed = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    const completionRate = total > 0 ? Math.round(100 * completed / total) : 100;

    // Focus minutes today
    const focusData = db.prepare(`
      SELECT SUM(duration_minutes) as total_minutes
      FROM focus_sessions
      WHERE substr(started_at, 1, 10) = ?
    `).get(todayDate);

    const focusMinutes = focusData.total_minutes || 0;

    // Simple score without habits for now
    const taskScore = completionRate;
    const focusScore = focusMinutes > 0 ? Math.min(100, Math.round(10 * focusMinutes / 60)) : 0;

    const overallScore = Math.round(0.6 * taskScore + 0.4 * focusScore);

    console.log(`\n📊 Productivity Score: ${overallScore}/100`);
    console.log(`─`.repeat(40));
    console.log(`Task Completion: ${completionRate}% (${completed}/${total})`);
    console.log(`Focus Time: ${focusMinutes} min (${focusScore}/100)`);
    console.log();
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

function handleSearch(query) {
  try {
    const searchLike = `%${query}%`;
    const tasks = db.prepare(`
      SELECT id, title, description FROM tasks WHERE title LIKE ? OR description LIKE ?
    `).all(searchLike, searchLike);

    const goals = db.prepare(`
      SELECT id, title FROM goals WHERE title LIKE ?
    `).all(searchLike);

    const projects = db.prepare(`
      SELECT id, title FROM projects WHERE title LIKE ?
    `).all(searchLike);

    const habits = db.prepare(`
      SELECT id, title FROM habits WHERE title LIKE ?
    `).all(searchLike);

    console.log(`\n🔍 Search results for: "${query}"`);
    console.log('─'.repeat(60));

    if (tasks.length > 0) {
      console.log(`\n📋 Tasks (${tasks.length}):`);
      tasks.forEach(t => console.log(`  • ${t.id}. ${t.title}`));
    }

    if (goals.length > 0) {
      console.log(`\n🎯 Goals (${goals.length}):`);
      goals.forEach(g => console.log(`  • ${g.id}. ${g.title}`));
    }

    if (projects.length > 0) {
      console.log(`\n📁 Projects (${projects.length}):`);
      projects.forEach(p => console.log(`  • ${p.id}. ${p.title}`));
    }

    if (habits.length > 0) {
      console.log(`\n🔁 Habits (${habits.length}):`);
      habits.forEach(h => console.log(`  • ${h.id}. ${h.title}`));
    }

    if (tasks.length === 0 && goals.length === 0 && projects.length === 0 && habits.length === 0) {
      console.log('  No results found.');
    }
    console.log();
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

// Route to handlers
switch (command) {
  case 'init':
    handleInit();
    break;
  case 'user:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js user:add <username> [email]'); process.exit(1); }
    handleUserAdd(args[0], args[1]);
    break;
  case 'workspace:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js workspace:add <name> [description]'); process.exit(1); }
    handleWorkspaceAdd(args[0], args[1] || '');
    break;
  case 'goal:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js goal:add <title> [type] [workspace]'); process.exit(1); }
    handleGoalAdd(args[0], args[1], args[2]);
    break;
  case 'project:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js project:add <title> [goal_id] [workspace_id]'); process.exit(1); }
    handleProjectAdd(args[0], args[1], args[2]);
    break;
  case 'task:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js task:add <title> [project_id] [due_date]'); process.exit(1); }
    handleTaskAdd(args[0], args[1], args[2]);
    break;
  case 'task:list':
    handleTaskList();
    break;
  case 'task:today':
    handleTaskToday();
    break;
  case 'task:complete':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js task:complete <id>'); process.exit(1); }
    handleTaskComplete(args[0]);
    break;
  case 'habit:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js habit:add <title> [frequency]'); process.exit(1); }
    handleHabitAdd(args[0], args[1]);
    break;
  case 'habit:log':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js habit:log <habit_id>'); process.exit(1); }
    handleHabitLog(args[0]);
    break;
  case 'calendar:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js calendar:add <title> <start> [end]'); process.exit(1); }
    handleCalendarAdd(args[0], args[1], args[2] || undefined);
    break;
  case 'focus:start':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js focus:start <task_id>'); process.exit(1); }
    handleFocusStart(args[0]);
    break;
  case 'focus:stop':
    handleFocusStop();
    break;
  case 'journal:add':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js journal:add <mood> [content]'); process.exit(1); }
    handleJournalAdd(args[0], args[1] || '');
    break;
  case 'productivity:score':
    handleProductivityScore();
    break;
  case 'search':
    if (!args[0]) { console.log('❌ Usage: node productivity-cli.js search <query>'); process.exit(1); }
    handleSearch(args[0]);
    break;
  case 'help':
  default:
    handleHelp();
    break;
}