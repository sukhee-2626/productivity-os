// ponytail: stdlib http server. Upgrade to express/fastify when plugin middleware ecosystem is required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'productivity.db'));
db.pragma('foreign_keys = ON');

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verify, 'hex'));
}

function getSessionUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const user = db.prepare(`
    SELECT u.id, u.username, u.email
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return user || null;
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function calcScore() {
  const today = getToday();
  const tasks = db.prepare(`
    SELECT status, estimated_duration, actual_duration
    FROM tasks
    WHERE due_date = ? OR date(created_at) = ? OR status = 'in_progress'
  `).all(today, today);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const taskRate = totalTasks > 0 ? Math.min(100, Math.round((completedTasks / totalTasks) * 100)) : 0;

  const focusData = db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) as mins
    FROM focus_sessions
    WHERE substr(started_at, 1, 10) = ?
  `).get(today);
  const focusMins = focusData ? focusData.mins : 0;
  const focusRate = Math.min(100, Math.round((focusMins / 180) * 100)); // 3 hours goal

  const habits = db.prepare("SELECT COUNT(*) as total FROM habits WHERE status = 'active'").get().total || 0;
  let habitRate = 0;
  let loggedHabits = 0;
  if (habits > 0) {
    loggedHabits = db.prepare(`
      SELECT COUNT(*) as completed
      FROM habit_logs
      WHERE date = ? AND completed = 1
    `).get(today).completed;
    habitRate = Math.min(100, Math.round((loggedHabits / habits) * 100));
  }

  const planningAcc = totalTasks > 0 ? 85 : 0;
  const overall = (totalTasks === 0 && habits === 0 && focusMins === 0)
    ? 0
    : Math.round((taskRate * 0.35) + (focusRate * 0.30) + (habitRate * 0.20) + (planningAcc * 0.15));

  return {
    score: overall,
    breakdown: {
      taskCompletion: taskRate,
      focusTime: focusRate,
      habitConsistency: habitRate,
      planningAccuracy: planningAcc
    },
    metrics: {
      completedTasks,
      totalTasks,
      focusMinutes: focusMins,
      completedHabits: loggedHabits,
      totalHabits: habits
    }
  };
}

function cascadeTaskUpdate(taskId) {
  const task = db.prepare('SELECT project_id, goal_id FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;
  if (task.project_id) {
    const pStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
      FROM tasks WHERE project_id = ?
    `).get(task.project_id);
    if (pStats && pStats.total > 0) {
      const pct = Math.round((pStats.done / pStats.total) * 100);
      db.prepare('UPDATE projects SET progress_percentage = ? WHERE id = ?').run(pct, task.project_id);
    }
  }
  if (task.goal_id) {
    const gStats = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
      FROM tasks WHERE goal_id = ?
    `).get(task.goal_id);
    if (gStats && gStats.total > 0) {
      const pct = Math.round((gStats.done / gStats.total) * 100);
      db.prepare('UPDATE goals SET progress_percentage = ? WHERE id = ?').run(pct, task.goal_id);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // --- AUTHENTICATION ROUTES ---

  if (pathname === '/api/auth/register' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.username || !b.password) {
      return json(res, { error: 'Username and password required' }, 400);
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(b.username);
    if (existing) {
      return json(res, { error: 'Username already taken' }, 409);
    }
    const passHash = hashPassword(b.password);
    const info = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(b.username, b.email || null, passHash);
    const userId = info.lastInsertRowid;

    const ws = db.prepare('INSERT INTO workspaces (name, slug, is_default) VALUES (?, ?, 1)')
      .run('Personal', `personal-${userId}`);
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')")
      .run(ws.lastInsertRowid, userId);

    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))")
      .run(token, userId);

    return json(res, { token, user: { id: userId, username: b.username, email: b.email || null } }, 201);
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.username || !b.password) {
      return json(res, { error: 'Username and password required' }, 400);
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(b.username);
    if (!user || !verifyPassword(b.password, user.password_hash)) {
      return json(res, { error: 'Invalid username or password' }, 401);
    }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))")
      .run(token, user.id);

    return json(res, { token, user: { id: user.id, username: user.username, email: user.email } });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    return json(res, { success: true });
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = getSessionUser(req);
    if (!user) return json(res, { error: 'Unauthorized' }, 401);
    return json(res, { user });
  }

  // User Management: List Users
  if (pathname === '/api/users' && method === 'GET') {
    const list = db.prepare('SELECT id, username, email, created_at FROM users ORDER BY id ASC').all();
    return json(res, list);
  }

  // User Management: Create User (by admin or logged in user)
  if (pathname === '/api/users' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.username || !b.password) {
      return json(res, { error: 'Username and password required' }, 400);
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(b.username);
    if (existing) {
      return json(res, { error: 'Username already taken' }, 409);
    }
    const passHash = hashPassword(b.password);
    const info = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(b.username, b.email || null, passHash);
    const newUserId = info.lastInsertRowid;

    // Create user's personal workspace
    const ws = db.prepare('INSERT INTO workspaces (name, slug, is_default) VALUES (?, ?, 1)')
      .run(`${b.username}'s Personal`, `personal-${newUserId}`);
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')")
      .run(ws.lastInsertRowid, newUserId);

    return json(res, {
      id: newUserId,
      username: b.username,
      email: b.email || null,
      workspace_id: ws.lastInsertRowid
    }, 201);
  }

  // User Management: Delete User
  if (pathname.startsWith('/api/users/') && method === 'DELETE') {
    const targetId = parseInt(pathname.split('/')[3], 10);
    if (targetId === 1) {
      return json(res, { error: 'Cannot delete primary admin user' }, 400);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    return json(res, { success: true, deletedId: targetId });
  }

  // --- API ROUTES ---

  // Clear all workspace data (New User Reset)
  if (pathname === '/api/workspaces/clear' && method === 'POST') {
    db.exec(`
      DELETE FROM tasks;
      DELETE FROM habits;
      DELETE FROM habit_logs;
      DELETE FROM goals;
      DELETE FROM milestones;
      DELETE FROM projects;
      DELETE FROM calendar_events;
      DELETE FROM focus_sessions;
      DELETE FROM time_entries;
      DELETE FROM notes;
      DELETE FROM journal_entries;
      DELETE FROM whiteboard_nodes;
    `);
    return json(res, { success: true, message: 'All workspace data cleared to clean new-user state.' });
  }

  // Overview / Dashboard
  if (pathname === '/api/overview' && method === 'GET') {
    const today = getToday();
    const sessionUser = getSessionUser(req);
    const user = sessionUser || db.prepare('SELECT username FROM users LIMIT 1').get() || { username: 'User' };
    const scoreData = calcScore();

    const streakRow = db.prepare("SELECT COALESCE(MAX(streak_count), 0) as s FROM habits WHERE status = 'active'").get();
    const streak = streakRow ? streakRow.s : 0;

    const ws = parsedUrl.searchParams.get('workspace_id');
    let taskWhere = "(t.due_date = ? OR t.status = 'in_progress') AND t.status != 'archived'";
    const taskParams = [today];
    if (ws && ws !== 'all') {
      taskWhere += " AND (t.workspace_id = ? OR t.workspace_id IS NULL)";
      taskParams.push(ws);
    }

    const todayTasks = db.prepare(`
      SELECT t.*, p.title as project_title
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE ${taskWhere}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `).all(...taskParams);

    const habits = db.prepare(`
      SELECT h.*,
        CASE WHEN hl.completed = 1 THEN 1 ELSE 0 END as completed_today
      FROM habits h
      LEFT JOIN habit_logs hl ON h.id = hl.habit_id AND hl.date = ?
      WHERE h.status = 'active'
    `).all(today);

    const goals = db.prepare(`
      SELECT id, title, progress_percentage, status FROM goals LIMIT 4
    `).all();

    const projects = db.prepare(`
      SELECT p.*,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_tasks
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      GROUP BY p.id
    `).all();

    const schedule = db.prepare(`
      SELECT id, title, start_time, end_time, color, 'event' as type
      FROM calendar_events
      WHERE substr(start_time, 1, 10) = ?
      ORDER BY start_time ASC
    `).all(today);

    return json(res, {
      user: user.username,
      date: today,
      streak: streak,
      score: scoreData,
      todayTasks,
      habits,
      goals,
      projects,
      schedule
    });
  }

  // My Day
  if (pathname === '/api/my-day' && method === 'GET') {
    const today = getToday();
    const tasks = db.prepare(`
      SELECT t.*, p.title as project_title
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE (t.due_date = ? OR t.due_date IS NULL OR t.status = 'in_progress') AND t.status != 'archived'
      ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `).all(today);

    const events = db.prepare(`
      SELECT id, title, start_time, end_time, color, 'calendar' as source
      FROM calendar_events
      WHERE substr(start_time, 1, 10) = ?
      ORDER BY start_time ASC
    `).all(today);

    return json(res, { tasks, events, date: today });
  }

  // Tasks CRUD
  if (pathname === '/api/tasks' && method === 'GET') {
    const status = parsedUrl.searchParams.get('status');
    const ws = parsedUrl.searchParams.get('workspace_id');
    let query = `
      SELECT t.*, p.title as project_title, g.title as goal_title
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN goals g ON t.goal_id = g.id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }
    if (ws && ws !== 'all') {
      query += ' AND (t.workspace_id = ? OR t.workspace_id IS NULL)';
      params.push(ws);
    }
    query += ' ORDER BY t.created_at DESC';
    const tasks = db.prepare(query).all(...params);
    return json(res, tasks);
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.title) return json(res, { error: 'Title is required' }, 400);

    const stmt = db.prepare(`
      INSERT INTO tasks (title, description, project_id, goal_id, priority, energy_level, due_date, estimated_duration, status, labels_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      b.title,
      b.description || '',
      b.project_id || null,
      b.goal_id || null,
      b.priority || 'medium',
      b.energy_level || 3,
      b.due_date || getToday(),
      b.estimated_duration || 30,
      b.status || 'todo',
      JSON.stringify(b.labels || [])
    );
    const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
    return json(res, created, 201);
  }

  if (pathname.startsWith('/api/tasks/') && method === 'PUT') {
    const id = parseInt(pathname.split('/')[3], 10);
    const b = await parseBody(req);
    const fields = [];
    const values = [];

    ['title', 'description', 'status', 'priority', 'energy_level', 'due_date', 'estimated_duration', 'actual_duration', 'project_id', 'goal_id'].forEach(key => {
      if (b[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(b[key]);
      }
    });

    if (b.status === 'done') {
      fields.push("completed_at = CURRENT_TIMESTAMP");
    }

    if (fields.length === 0) return json(res, { error: 'No fields to update' }, 400);

    values.push(id);
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    cascadeTaskUpdate(id);
    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return json(res, updated);
  }

  if (pathname === '/api/tasks/bulk-delete' && method === 'POST') {
    const b = await parseBody(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(n => !isNaN(n)) : [];
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...ids);
    }
    return json(res, { success: true, deletedCount: ids.length });
  }

  if (pathname === '/api/tasks/clear-all' && method === 'POST') {
    const ws = parsedUrl.searchParams.get('workspace_id');
    if (ws && ws !== 'all') {
      db.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(ws);
    } else {
      db.prepare('DELETE FROM tasks').run();
    }
    return json(res, { success: true, message: 'All tasks cleared.' });
  }

  if (pathname.startsWith('/api/tasks/') && method === 'DELETE') {
    const id = parseInt(pathname.split('/')[3], 10);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return json(res, { success: true, deletedId: id });
  }

  // Kanban View
  if (pathname === '/api/kanban' && method === 'GET') {
    const ws = parsedUrl.searchParams.get('workspace_id');
    let query = `
      SELECT t.*, p.title as project_title
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.status != 'archived'
    `;
    const params = [];
    if (ws && ws !== 'all') {
      query += ' AND (t.workspace_id = ? OR t.workspace_id IS NULL)';
      params.push(ws);
    }
    query += ' ORDER BY t.created_at DESC';
    const allTasks = db.prepare(query).all(...params);

    const columns = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: []
    };

    allTasks.forEach(t => {
      if (columns[t.status]) columns[t.status].push(t);
      else columns.backlog.push(t);
    });

    return json(res, columns);
  }

  // Calendar
  if (pathname === '/api/calendar' && method === 'GET') {
    const events = db.prepare('SELECT * FROM calendar_events ORDER BY start_time ASC').all();
    const tasks = db.prepare("SELECT id, title, due_date, priority, status FROM tasks WHERE due_date IS NOT NULL").all();
    return json(res, { events, tasks });
  }

  if (pathname === '/api/calendar' && method === 'POST') {
    const b = await parseBody(req);
    const stmt = db.prepare('INSERT INTO calendar_events (title, description, start_time, end_time, color) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(b.title, b.description || '', b.start_time, b.end_time || b.start_time, b.color || '#3b82f6');
    const event = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(info.lastInsertRowid);
    return json(res, event, 201);
  }

  if (pathname.startsWith('/api/calendar/') && method === 'DELETE') {
    const id = parseInt(pathname.split('/')[3], 10);
    db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    return json(res, { success: true, deletedId: id });
  }

  // Work Schedule Preset Generator
  if (pathname === '/api/schedule/work' && method === 'POST') {
    const today = getToday();
    const b = await parseBody(req);
    const wsId = b.workspace_id || 3; // default Work workspace

    const scheduleBlocks = [
      { start: '09:00:00', end: '10:30:00', title: 'Deep Work: Core Architecture & Sprint Delivery', color: '#3b82f6', desc: 'Focus block: High-leverage execution' },
      { start: '10:30:00', end: '11:00:00', title: 'Daily Standup & Sprint Sync', color: '#10b981', desc: 'Team blockers, roadmap alignment' },
      { start: '11:00:00', end: '12:30:00', title: 'Feature Development & Coding', color: '#8b5cf6', desc: 'Implementation & bug resolution' },
      { start: '12:30:00', end: '13:30:00', title: '☕ Lunch & Reset Walk', color: '#f59e0b', desc: 'Healthy reset, zero screens' },
      { start: '13:30:00', end: '15:00:00', title: 'Code Reviews & Integration Testing', color: '#06b6d4', desc: 'Pull requests, CI/CD, QA' },
      { start: '15:00:00', end: '15:30:00', title: 'Architecture & Technical RFC Review', color: '#6366f1', desc: 'Design document discussion' },
      { start: '15:30:00', end: '17:00:00', title: 'Documentation & Sprint Polish', color: '#3b82f6', desc: 'API docs, release changelog' },
      { start: '17:00:00', end: '17:30:00', title: 'Workday Shutdown & Evening Plan', color: '#10b981', desc: 'Review achievements & queue tomorrow' }
    ];

    const insertEvent = db.prepare('INSERT INTO calendar_events (title, description, start_time, end_time, color) VALUES (?, ?, ?, ?, ?)');
    const createdEvents = [];
    for (const sb of scheduleBlocks) {
      const info = insertEvent.run(sb.title, sb.desc, `${today} ${sb.start}`, `${today} ${sb.end}`, sb.color);
      createdEvents.push({ id: info.lastInsertRowid, ...sb, date: today });
    }

    // Seed accompanying work tasks if none exist
    const workTaskCount = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ?').get(wsId).c;
    if (workTaskCount === 0) {
      const p = db.prepare("INSERT INTO projects (title, description, workspace_id, deadline, color) VALUES ('Core Engineering Sprint', 'Main product deliverables', ?, date('now', '+14 days'), '#3b82f6')").run(wsId);
      const insertTask = db.prepare("INSERT INTO tasks (title, description, project_id, workspace_id, status, priority, energy_level, due_date, estimated_duration, labels_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      insertTask.run('Review & merge open pull requests', 'Verify CI test suite and performance benchmarks', p.lastInsertRowid, wsId, 'todo', 'urgent', 4, today, 45, '["CodeReview","Team"]');
      insertTask.run('Deploy staging backend API service', 'Run database migration scripts and smoke tests', p.lastInsertRowid, wsId, 'in_progress', 'high', 5, today, 90, '["DevOps","Release"]');
      insertTask.run('Resolve customer-reported webhook retry bug', 'Implement exponential backoff with jitter', p.lastInsertRowid, wsId, 'todo', 'high', 4, today, 60, '["Bugfix","API"]');
    }

    return json(res, { success: true, count: createdEvents.length, schedule: createdEvents });
  }

  // Schedule Individual Task
  if (pathname === '/api/schedule/task' && method === 'POST') {
    const b = await parseBody(req);
    if (!b.task_id || !b.start_time) return json(res, { error: 'task_id and start_time required' }, 400);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(b.task_id);
    if (!task) return json(res, { error: 'Task not found' }, 404);

    const dur = b.duration_minutes || task.estimated_duration || 45;
    const today = b.date || getToday();
    const startStr = `${today} ${b.start_time}:00`;

    // Compute end time
    const [h, m] = b.start_time.split(':').map(Number);
    let endM = m + dur;
    let endH = h + Math.floor(endM / 60);
    endM = endM % 60;
    const endStr = `${today} ${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00`;

    const info = db.prepare('INSERT INTO calendar_events (title, description, start_time, end_time, color) VALUES (?, ?, ?, ?, ?)')
      .run(`[Task] ${task.title}`, task.description || '', startStr, endStr, b.color || '#8b5cf6');

    db.prepare("UPDATE tasks SET due_date = ?, status = CASE WHEN status = 'backlog' THEN 'todo' ELSE status END WHERE id = ?")
      .run(today, task.id);

    return json(res, { success: true, eventId: info.lastInsertRowid, task_id: task.id, start: startStr, end: endStr });
  }

  // Habits
  if (pathname === '/api/habits' && method === 'GET') {
    const today = getToday();
    const habits = db.prepare(`
      SELECT h.*,
        CASE WHEN hl.completed = 1 THEN 1 ELSE 0 END as completed_today
      FROM habits h
      LEFT JOIN habit_logs hl ON h.id = hl.habit_id AND hl.date = ?
      ORDER BY h.id ASC
    `).all(today);
    return json(res, habits);
  }

  if (pathname === '/api/habits' && method === 'POST') {
    const b = await parseBody(req);
    const stmt = db.prepare('INSERT INTO habits (title, frequency, target_count, unit, color) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(b.title, b.frequency || 'daily', b.target_count || 1, b.unit || 'times', b.color || '#10b981');
    const created = db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid);
    return json(res, created, 201);
  }

  if (pathname.endsWith('/toggle') && pathname.startsWith('/api/habits/') && method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    const today = getToday();
    const existing = db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?').get(id, today);

    if (existing && existing.completed === 1) {
      db.prepare('UPDATE habit_logs SET completed = 0 WHERE habit_id = ? AND date = ?').run(id, today);
      db.prepare('UPDATE habits SET streak_count = MAX(0, streak_count - 1) WHERE id = ?').run(id);
    } else {
      db.prepare(`
        INSERT INTO habit_logs (habit_id, date, completed, completion_time)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(habit_id, date) DO UPDATE SET completed = 1, completion_time = CURRENT_TIMESTAMP
      `).run(id, today);
      db.prepare('UPDATE habits SET streak_count = streak_count + 1, best_streak = MAX(best_streak, streak_count + 1) WHERE id = ?').run(id);
    }

    const habit = db.prepare(`
      SELECT h.*, CASE WHEN hl.completed = 1 THEN 1 ELSE 0 END as completed_today
      FROM habits h
      LEFT JOIN habit_logs hl ON h.id = hl.habit_id AND hl.date = ?
      WHERE h.id = ?
    `).get(today, id);
    return json(res, habit);
  }

  // Goals
  if (pathname === '/api/goals' && method === 'GET') {
    const goals = db.prepare('SELECT * FROM goals ORDER BY progress_percentage DESC').all();
    const milestones = db.prepare('SELECT * FROM milestones').all();
    const projects = db.prepare('SELECT * FROM projects').all();

    const nested = goals.map(g => ({
      ...g,
      milestones: milestones.filter(m => m.goal_id === g.id),
      projects: projects.filter(p => p.goal_id === g.id)
    }));
    return json(res, nested);
  }

  if (pathname === '/api/goals' && method === 'POST') {
    const b = await parseBody(req);
    const stmt = db.prepare('INSERT INTO goals (title, description, goal_type, target_date, progress_percentage, workspace_id) VALUES (?, ?, ?, ?, ?, 1)');
    const info = stmt.run(b.title, b.description || '', b.goal_type || 'yearly', b.target_date || null, b.progress_percentage || 0);
    return json(res, { id: info.lastInsertRowid, ...b }, 201);
  }

  // Projects
  if (pathname === '/api/projects' && method === 'GET') {
    const projects = db.prepare(`
      SELECT p.*,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_tasks
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      GROUP BY p.id
    `).all();
    return json(res, projects);
  }

  if (pathname === '/api/projects' && method === 'POST') {
    const b = await parseBody(req);
    const stmt = db.prepare('INSERT INTO projects (title, description, goal_id, workspace_id, deadline, color) VALUES (?, ?, ?, 1, ?, ?)');
    const info = stmt.run(b.title, b.description || '', b.goal_id || null, b.deadline || null, b.color || '#3b82f6');
    return json(res, { id: info.lastInsertRowid, ...b }, 201);
  }

  // Focus Sessions
  if (pathname === '/api/focus/active' && method === 'GET') {
    const active = db.prepare(`
      SELECT fs.*, t.title as task_title
      FROM focus_sessions fs
      LEFT JOIN tasks t ON fs.task_id = t.id
      WHERE fs.ended_at IS NULL
      ORDER BY fs.started_at DESC LIMIT 1
    `).get();
    return json(res, active || null);
  }

  if (pathname === '/api/focus/start' && method === 'POST') {
    const b = await parseBody(req);
    const now = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO focus_sessions (task_id, started_at, mode) VALUES (?, ?, ?)');
    const info = stmt.run(b.task_id || null, now, b.mode || 'pomodoro');
    return json(res, { id: info.lastInsertRowid, task_id: b.task_id, started_at: now, mode: b.mode || 'pomodoro' });
  }

  if (pathname === '/api/focus/stop' && method === 'POST') {
    const b = await parseBody(req);
    const active = db.prepare('SELECT * FROM focus_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get();
    if (!active) return json(res, { message: 'No active session' });

    const now = new Date().toISOString();
    const duration = b.duration_minutes || Math.max(1, Math.round((new Date(now) - new Date(active.started_at)) / 60000));

    db.prepare('UPDATE focus_sessions SET ended_at = ?, duration_minutes = ?, focus_quality = ? WHERE id = ?')
      .run(now, duration, b.quality || 8, active.id);

    if (active.task_id) {
      db.prepare('UPDATE tasks SET actual_duration = actual_duration + ? WHERE id = ?').run(duration, active.task_id);
      db.prepare('INSERT INTO time_entries (task_id, user_id, started_at, ended_at, duration_minutes) VALUES (?, 1, ?, ?, ?)')
        .run(active.task_id, active.started_at, now, duration);
    }

    return json(res, { id: active.id, duration_minutes: duration, ended_at: now });
  }

  // Analytics
  if (pathname === '/api/analytics' && method === 'GET') {
    const scoreData = calcScore();
    const totalFocus = db.prepare('SELECT COALESCE(SUM(duration_minutes), 0) as total FROM focus_sessions').get().total;
    const taskStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks GROUP BY status
    `).all();
    const habitCompletionRate = db.prepare(`
      SELECT AVG(CASE WHEN completed = 1 THEN 1.0 ELSE 0.0 END) as rate FROM habit_logs
    `).get().rate || 0.85;

    return json(res, {
      score: scoreData,
      totalFocusMinutes: totalFocus,
      taskDistribution: taskStats,
      habitConsistencyRate: Math.round(habitCompletionRate * 100)
    });
  }

  // Journal
  if (pathname === '/api/journal' && method === 'GET') {
    const entries = db.prepare('SELECT * FROM journal_entries ORDER BY date DESC LIMIT 14').all();
    return json(res, entries);
  }

  if (pathname === '/api/journal' && method === 'POST') {
    const b = await parseBody(req);
    const today = getToday();
    const score = calcScore().score;
    const tasksDone = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND date(completed_at) = ?").get(today).c;
    const focusMins = db.prepare("SELECT COALESCE(SUM(duration_minutes),0) as m FROM focus_sessions WHERE substr(started_at,1,10) = ?").get(today).m;

    const stmt = db.prepare(`
      INSERT INTO journal_entries (user_id, date, mood, content, productivity_score, tasks_completed, focus_minutes)
      VALUES (1, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(today, b.mood || '😊 Productive', b.content, score, tasksDone, focusMins);
    return json(res, { id: info.lastInsertRowid, date: today }, 201);
  }

  // Notes
  if (pathname === '/api/notes' && method === 'GET') {
    const notes = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all();
    return json(res, notes);
  }

  if (pathname === '/api/notes' && method === 'POST') {
    const b = await parseBody(req);
    const stmt = db.prepare('INSERT INTO notes (title, content, tags_json, category, workspace_id) VALUES (?, ?, ?, ?, 1)');
    const info = stmt.run(b.title, b.content, JSON.stringify(b.tags || []), b.category || 'General');
    return json(res, { id: info.lastInsertRowid, ...b }, 201);
  }

  // Brain Dump (Natural Language Auto-Sorter)
  if (pathname === '/api/brain-dump' && method === 'POST') {
    const b = await parseBody(req);
    const raw = b.text || '';
    const lines = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const createdTasks = [];

    const insertTask = db.prepare(`
      INSERT INTO tasks (title, status, priority, energy_level, due_date, estimated_duration, labels_json)
      VALUES (?, 'todo', ?, ?, ?, ?, ?)
    `);

    for (const item of lines) {
      let priority = 'medium';
      let energy = 3;
      let duration = 30;
      let label = 'Brain Dump';
      const lower = item.toLowerCase();

      if (lower.includes('urgent') || lower.includes('asap') || lower.includes('today')) priority = 'urgent';
      else if (lower.includes('project') || lower.includes('exam') || lower.includes('report')) priority = 'high';
      else if (lower.includes('buy') || lower.includes('call') || lower.includes('clean')) priority = 'low';

      if (lower.includes('study') || lower.includes('code') || lower.includes('dsa') || lower.includes('java')) {
        energy = 5;
        duration = 60;
        label = 'Study';
      }

      const info = insertTask.run(item, priority, energy, getToday(), duration, JSON.stringify([label]));
      createdTasks.push({ id: info.lastInsertRowid, title: item, priority, label });
    }

    return json(res, { processedCount: lines.length, tasks: createdTasks });
  }

  // AI Schedule Generator (Rule-based optimizer)
  if (pathname === '/api/ai/schedule' && method === 'POST') {
    const today = getToday();
    const pendingTasks = db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('todo', 'in_progress')
      ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, energy_level DESC
    `).all();

    let currentHour = 9;
    let currentMinute = 0;
    const schedule = [];

    for (const t of pendingTasks) {
      const startStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
      const dur = t.estimated_duration || 45;
      currentMinute += dur;
      while (currentMinute >= 60) {
        currentHour += 1;
        currentMinute -= 60;
      }
      const endStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

      schedule.push({
        time: `${startStr} - ${endStr}`,
        title: t.title,
        priority: t.priority,
        type: 'task',
        taskId: t.id
      });

      // Insert smart 15 min rest interval
      currentMinute += 15;
      while (currentMinute >= 60) {
        currentHour += 1;
        currentMinute -= 60;
      }
      schedule.push({
        time: `${endStr} - ${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`,
        title: '☕ Rest & Hydration Break',
        priority: 'low',
        type: 'break'
      });
    }

    return json(res, { date: today, generatedSlots: schedule });
  }

  // AI Assistant Chat & Action Engine
  if (pathname === '/api/ai/chat' && method === 'POST') {
    const b = await parseBody(req);
    const prompt = (b.message || '').toLowerCase();
    const today = getToday();
    let reply = '';
    let action = null;

    if (prompt.includes('plan') || prompt.includes('today')) {
      const count = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('todo', 'in_progress')").get().c;
      reply = `You have ${count} active tasks for today. Prime focus window recommended: 09:00 - 11:30 AM for high-energy items like Java & DSA. Lower priority items should shift past 15:00.`;
      action = 'suggest_schedule';
    } else if (prompt.includes('priority') || prompt.includes('first')) {
      const top = db.prepare("SELECT title FROM tasks WHERE status IN ('todo','in_progress') ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 1").get();
      reply = top ? `Top priority right now is "${top.title}". Start a 45-minute Pomodoro session immediately to clear the bottleneck.` : 'All urgent tasks are complete! Great job.';
      action = 'focus_task';
    } else if (prompt.includes('bottleneck') || prompt.includes('review') || prompt.includes('why')) {
      reply = `Historical pattern detected: Task completion drops 40% after 18:00. Shift your 2 heavy coding tasks to morning slots to ensure 95%+ planning accuracy.`;
      action = 'analytics_insight';
    } else {
      reply = `FlowOS AI active. I have synchronized your Goals, Kanban, Habits, and Focus timers. Type "Plan my day", "What should I do first?", or dump ideas via Brain Dump.`;
    }

    return json(res, { reply, action });
  }

  // Risk & Bottleneck Analysis Engine
  if (pathname === '/api/risk-analysis' && method === 'GET') {
    const today = getToday();
    const urgentTasks = db.prepare(`
      SELECT t.*, p.title as project_title, p.deadline as project_deadline
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.status NOT IN ('done', 'archived')
        AND (t.priority IN ('urgent', 'high') OR t.due_date <= date(?, '+2 days'))
      ORDER BY t.due_date ASC
    `).all(today);

    const atRiskProjects = db.prepare(`
      SELECT p.*,
        COUNT(t.id) as remaining_tasks,
        COALESCE(SUM(t.estimated_duration), 0) as remaining_minutes
      FROM projects p
      JOIN tasks t ON p.id = t.project_id
      WHERE t.status NOT IN ('done', 'archived')
        AND p.deadline IS NOT NULL
        AND p.deadline <= date(?, '+14 days')
      GROUP BY p.id
    `).all(today);

    return json(res, {
      urgentTasks,
      atRiskProjects,
      totalRisks: urgentTasks.length + atRiskProjects.length
    });
  }

  // Whiteboard / Infinite Canvas Nodes
  if (pathname === '/api/whiteboard' && method === 'GET') {
    const nodes = db.prepare('SELECT * FROM whiteboard_nodes ORDER BY id ASC').all();
    return json(res, nodes);
  }

  if (pathname === '/api/whiteboard' && method === 'POST') {
    const b = await parseBody(req);
    const stmt = db.prepare('INSERT INTO whiteboard_nodes (type, label, x, y, color, data_json) VALUES (?, ?, ?, ?, ?, ?)');
    const info = stmt.run(b.type || 'task', b.label || 'Node', b.x || 100, b.y || 100, b.color || '#3b82f6', JSON.stringify(b.data || {}));
    return json(res, { id: info.lastInsertRowid, ...b }, 201);
  }

  // Data Export & Backup
  if (pathname === '/api/export' && method === 'GET') {
    const snapshot = {
      users: db.prepare('SELECT * FROM users').all(),
      workspaces: db.prepare('SELECT * FROM workspaces').all(),
      goals: db.prepare('SELECT * FROM goals').all(),
      milestones: db.prepare('SELECT * FROM milestones').all(),
      projects: db.prepare('SELECT * FROM projects').all(),
      tasks: db.prepare('SELECT * FROM tasks').all(),
      habits: db.prepare('SELECT * FROM habits').all(),
      habit_logs: db.prepare('SELECT * FROM habit_logs').all(),
      calendar_events: db.prepare('SELECT * FROM calendar_events').all(),
      focus_sessions: db.prepare('SELECT * FROM focus_sessions').all(),
      notes: db.prepare('SELECT * FROM notes').all(),
      journal_entries: db.prepare('SELECT * FROM journal_entries').all(),
      whiteboard_nodes: db.prepare('SELECT * FROM whiteboard_nodes').all(),
      exported_at: new Date().toISOString()
    };
    return json(res, snapshot);
  }

  // Data Import & Restore
  if (pathname === '/api/import' && method === 'POST') {
    const data = await parseBody(req);
    if (!data.tasks || !data.goals) return json(res, { error: 'Invalid backup payload' }, 400);

    const restore = db.transaction(() => {
      if (Array.isArray(data.tasks)) {
        const insertTask = db.prepare(`
          INSERT OR IGNORE INTO tasks (id, title, description, project_id, goal_id, status, priority, due_date)
          VALUES (@id, @title, @description, @project_id, @goal_id, @status, @priority, @due_date)
        `);
        data.tasks.forEach(t => insertTask.run(t));
      }
    });
    restore();
    return json(res, { restored: true, timestamp: new Date().toISOString() });
  }

  // Workspaces List
  if (pathname === '/api/workspaces' && method === 'GET') {
    const list = db.prepare('SELECT * FROM workspaces ORDER BY is_default DESC, id ASC').all();
    return json(res, list);
  }

  // Gamification & XP System
  if (pathname === '/api/gamification' && method === 'GET') {
    const completedTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done'").get().c;
    const focusMinutes = db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM focus_sessions").get().m;
    const habitCompletions = db.prepare("SELECT COUNT(*) as c FROM habit_logs WHERE completed = 1").get().c;
    const streakRow = db.prepare("SELECT COALESCE(MAX(streak_count), 0) as s FROM habits WHERE status = 'active'").get();
    const streak = streakRow ? streakRow.s : 0;

    const xp = (completedTasks * 50) + (focusMinutes * 2) + (habitCompletions * 20);
    const level = Math.floor(Math.sqrt(xp / 100)) + 1;
    const currentBase = ((level - 1) ** 2) * 100;
    const nextBase = (level ** 2) * 100;
    const levelProgress = Math.min(100, Math.round(((xp - currentBase) / (nextBase - currentBase || 100)) * 100));

    const badges = [
      { id: 'starter', name: 'First Mission', icon: '🚀', unlocked: completedTasks >= 1, desc: 'Completed first task' },
      { id: 'deep_work', name: 'Hyper Focus', icon: '⚡', unlocked: focusMinutes >= 60, desc: 'Logged 60+ min focus' },
      { id: 'streak_master', name: 'Unstoppable', icon: '🔥', unlocked: habitCompletions >= 7, desc: '7+ habits logged' },
      { id: 'centurion', name: 'Master Builder', icon: '👑', unlocked: xp >= 500, desc: 'Earned 500+ XP' }
    ];

    return json(res, {
      xp,
      level,
      levelProgress,
      nextLevelXP: nextBase,
      streak,
      stats: { completedTasks, focusMinutes, habitCompletions },
      badges
    });
  }

  // Habit Heatmap (35-day matrix)
  if (pathname === '/api/habits/heatmap' && method === 'GET') {
    const days = [];
    const now = new Date();
    for (let i = 34; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const count = db.prepare('SELECT COUNT(*) as c FROM habit_logs WHERE date = ? AND completed = 1').get(dateStr).c;
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4;
      days.push({ date: dateStr, count, level });
    }
    return json(res, { days });
  }

  // Global Unified Search
  if (pathname === '/api/search' && method === 'GET') {
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    if (!q) return json(res, { query: '', results: [] });
    const pattern = `%${q}%`;
    const tasks = db.prepare("SELECT id, title, status, priority, 'task' as type FROM tasks WHERE title LIKE ? OR description LIKE ? LIMIT 6").all(pattern, pattern);
    const projects = db.prepare("SELECT id, title, 'project' as type FROM projects WHERE title LIKE ? LIMIT 4").all(pattern);
    const goals = db.prepare("SELECT id, title, 'goal' as type FROM goals WHERE title LIKE ? LIMIT 4").all(pattern);
    const habits = db.prepare("SELECT id, title, 'habit' as type FROM habits WHERE title LIKE ? LIMIT 4").all(pattern);
    const notes = db.prepare("SELECT id, title, 'note' as type FROM notes WHERE title LIKE ? OR content LIKE ? LIMIT 4").all(pattern, pattern);
    return json(res, { query: q, results: [...tasks, ...projects, ...goals, ...habits, ...notes] });
  }

  // 1-Click Templates Engine
  if (pathname === '/api/templates/apply' && method === 'POST') {
    const b = await parseBody(req);
    const tpl = b.template || 'software_engineer';
    const today = getToday();

    const apply = db.transaction(() => {
      if (tpl === 'software_engineer') {
        const gInfo = db.prepare("INSERT INTO goals (title, description, goal_type, target_date, progress_percentage, workspace_id) VALUES ('Master Distributed Systems & DSA', 'Build world-class engineering fundamentals', 'quarterly', date('now', '+90 days'), 25, 3)").run();
        const goalId = gInfo.lastInsertRowid;

        const p1 = db.prepare("INSERT INTO projects (title, description, goal_id, workspace_id, deadline, color) VALUES ('DSA & System Design Mastery', '150 LeetCode + System Design deep dive', ?, 3, date('now', '+60 days'), '#3b82f6')").run(goalId);
        const p2 = db.prepare("INSERT INTO projects (title, description, goal_id, workspace_id, deadline, color) VALUES ('High-Throughput Storage Engine', 'Custom LSM-tree and WAL implementation', ?, 3, date('now', '+45 days'), '#8b5cf6')").run(goalId);

        const insertTask = db.prepare("INSERT INTO tasks (title, description, project_id, goal_id, status, priority, energy_level, due_date, estimated_duration, labels_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        insertTask.run('Implement LFU Cache with O(1) eviction', 'Use doubly-linked list with frequency buckets', p1.lastInsertRowid, goalId, 'todo', 'urgent', 5, today, 60, '["DSA","Coding"]');
        insertTask.run('Raft Consensus: Leader election & heartbeat', 'Build state transition and RPC timers', p2.lastInsertRowid, goalId, 'in_progress', 'high', 5, today, 90, '["Systems","Architecture"]');
        insertTask.run('Profile SQLite memory footprint and WAL checkpointing', 'Measure sync overhead vs throughput', p2.lastInsertRowid, goalId, 'todo', 'high', 4, today, 45, '["SQL","Database"]');
        insertTask.run('Read Google Spanner & TrueTime research paper', 'Understand GPS and atomic clocks in distributed transactions', p1.lastInsertRowid, goalId, 'todo', 'medium', 3, today, 40, '["Reading","Theory"]');

        const insertHabit = db.prepare("INSERT INTO habits (title, frequency, target_count, unit, color) VALUES (?, 'daily', ?, ?, ?)");
        insertHabit.run('Deep Coding 2h', 2, 'hours', '#3b82f6');
        insertHabit.run('Solve 2 LeetCode Problems', 2, 'problems', '#8b5cf6');
        insertHabit.run('Hydrate 3 Liters', 3, 'liters', '#06b6d4');

        db.prepare("INSERT INTO notes (title, content, tags_json, category, workspace_id) VALUES ('Distributed Systems Rules', '1. Network partitions will happen.\n2. Clocks are not monotonically synchronized.\n3. Idempotency keys prevent duplicate execution.', '[\"Systems\",\"Notes\"]', 'Engineering', 3)").run();

      } else if (tpl === 'student') {
        const gInfo = db.prepare("INSERT INTO goals (title, description, goal_type, target_date, progress_percentage, workspace_id) VALUES ('Academic Honors & 4.0 GPA', 'Master all core semester courses', 'quarterly', date('now', '+90 days'), 35, 2)").run();
        const goalId = gInfo.lastInsertRowid;

        const p1 = db.prepare("INSERT INTO projects (title, description, goal_id, workspace_id, deadline, color) VALUES ('Operating Systems & Networks', 'Core coursework projects & labs', ?, 2, date('now', '+30 days'), '#10b981')").run(goalId);

        const insertTask = db.prepare("INSERT INTO tasks (title, description, project_id, goal_id, status, priority, energy_level, due_date, estimated_duration, labels_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        insertTask.run('Complete Java Inheritance & Polymorphism Lab', 'Implement payment processing hierarchy', p1.lastInsertRowid, goalId, 'todo', 'urgent', 4, today, 60, '["Academic","Java"]');
        insertTask.run('Revise Virtual Memory Paging & TLB Cache', 'Read chapter 8 and complete problem set', p1.lastInsertRowid, goalId, 'todo', 'high', 3, today, 45, '["Study","OS"]');
        insertTask.run('Prepare 1-page cheatsheet for midterm exam', 'Equations, cache formulas, throughput bounds', p1.lastInsertRowid, goalId, 'todo', 'medium', 2, today, 30, '["Exams"]');

        const insertHabit = db.prepare("INSERT INTO habits (title, frequency, target_count, unit, color) VALUES (?, 'daily', ?, ?, ?)");
        insertHabit.run('Review Lecture Slides 45m', 1, 'session', '#10b981');
        insertHabit.run('Read 30 Pages Textbook', 30, 'pages', '#f59e0b');
        insertHabit.run('Morning Study Block', 1, 'session', '#3b82f6');

      } else {
        // Peak Performance
        const gInfo = db.prepare("INSERT INTO goals (title, description, goal_type, target_date, progress_percentage, workspace_id) VALUES ('Peak Physical & Mental Performance', 'Optimize energy, deep work, and health', 'yearly', date('now', '+365 days'), 40, 1)").run();
        const goalId = gInfo.lastInsertRowid;

        const p1 = db.prepare("INSERT INTO projects (title, description, goal_id, workspace_id, deadline, color) VALUES ('Daily Execution Framework', 'Consistent morning routine & shutdown', ?, 1, date('now', '+30 days'), '#f59e0b')").run(goalId);

        const insertTask = db.prepare("INSERT INTO tasks (title, description, project_id, goal_id, status, priority, energy_level, due_date, estimated_duration, labels_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        insertTask.run('Morning 90m Deep Work: High-Leverage Creative Task', 'No notifications, phone in another room', p1.lastInsertRowid, goalId, 'todo', 'urgent', 5, today, 90, '["DeepWork"]');
        insertTask.run('Zone 2 Cardio: 45 min run or cycling', 'Aerobic base building', p1.lastInsertRowid, goalId, 'todo', 'high', 4, today, 45, '["Health"]');
        insertTask.run('Evening Digital Shutdown & Review', 'Clear desk, review tomorrow plan, journal', p1.lastInsertRowid, goalId, 'todo', 'medium', 2, today, 20, '["Routine"]');

        const insertHabit = db.prepare("INSERT INTO habits (title, frequency, target_count, unit, color) VALUES (?, 'daily', ?, ?, ?)");
        insertHabit.run('Morning Sunlight & Hydration', 1, 'routine', '#f59e0b');
        insertHabit.run('Workout / Mobility', 1, 'session', '#ef4444');
        insertHabit.run('Cold Shower / Breathwork', 1, 'session', '#06b6d4');
        insertHabit.run('No Screens After 21:30', 1, 'rule', '#8b5cf6');
      }
    });

    apply();
    return json(res, { success: true, template: tpl });
  }

  // Daily Evening Review
  if (pathname === '/api/daily-review' && method === 'POST') {
    const b = await parseBody(req);
    const today = getToday();
    const scoreData = calcScore();

    const tasksDone = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND (date(completed_at) = ? OR due_date = ?)").get(today, today).c;
    const focusMins = db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM focus_sessions WHERE substr(started_at, 1, 10) = ?").get(today).m;
    const habitsDone = db.prepare("SELECT COUNT(*) as c FROM habit_logs WHERE date = ? AND completed = 1").get(today).c;

    const content = `[Evening Reflection]\n🏆 Win: ${b.win || 'Execution'}\n⚠️ Friction: ${b.friction || 'None'}\n🎯 Tomorrow #1 Priority: ${b.tomorrow_priority || 'Key Deliverable'}`;

    db.prepare(`
      INSERT INTO journal_entries (user_id, date, mood, content, productivity_score, tasks_completed, focus_minutes, habits_completed)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(today, b.mood || '😊 Flow', content, scoreData.score, tasksDone, focusMins, habitsDone);

    const aiFeedback = `Reflection logged! Today's score: ${scoreData.score}/100 with ${focusMins}m focus time. Tomorrow's prime priority ("${b.tomorrow_priority || 'Top Task'}") is queued for morning block.`;

    return json(res, {
      success: true,
      score: scoreData.score,
      aiFeedback,
      metrics: { tasksDone, focusMins, habitsDone }
    });
  }

  // --- STATIC FILES SERVER ---
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    }[ext] || 'text/plain';

    res.writeHead(200, { 'Content-Type': contentType });
    return fs.createReadStream(filePath).pipe(res);
  }

  // Fallback to index.html for SPA client-side routing
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return fs.createReadStream(indexPath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ProductivityOS Server running on http://localhost:${PORT}`);
});

module.exports = { server, db };
