// ponytail: basic SQLite seeder. Upgrade when multi-tenant migrations needed.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'productivity.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'productivity.db.sql'), 'utf8');
db.exec(schema);

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const insertAll = db.transaction(() => {
    db.prepare("INSERT INTO users (id, username, email) VALUES (1, 'sukhee', 'sukhee@productivityos.local')").run();
    db.prepare("INSERT INTO workspaces (id, name, slug, description, is_default) VALUES (1, 'Personal', 'personal', 'Daily personal management', 1)").run();
    db.prepare("INSERT INTO workspaces (id, name, slug, description, is_default) VALUES (2, 'College', 'college', 'Academic coursework', 0)").run();
    db.prepare("INSERT INTO workspaces (id, name, slug, description, is_default) VALUES (3, 'Work', 'work', 'Professional projects', 0)").run();
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (1, 1, 'owner')").run();

    // Goals
    db.prepare("INSERT INTO goals (id, title, description, goal_type, target_date, progress_percentage, status, workspace_id) VALUES (1, 'Become a Software Engineer', 'Master core CS and ship products', 'yearly', '2025-12-31', 65, 'active', 1)").run();
    db.prepare("INSERT INTO goals (id, title, description, goal_type, target_date, progress_percentage, status, workspace_id) VALUES (2, 'Peak Physical Health', 'Daily strength and cardio', 'yearly', '2025-12-31', 80, 'active', 1)").run();

    // Milestones
    db.prepare("INSERT INTO milestones (id, goal_id, title, progress_percentage, status) VALUES (1, 1, 'DSA Arrays & Trees', 80, 'active')").run();
    db.prepare("INSERT INTO milestones (id, goal_id, title, progress_percentage, status) VALUES (2, 1, 'Full Stack Capstone', 50, 'active')").run();

    // Projects
    db.prepare("INSERT INTO projects (id, title, description, goal_id, workspace_id, deadline, status, progress_percentage, color) VALUES (1, 'DSA Mastery Project', 'Solve 150 LeetCode problems', 1, 2, '2025-10-15', 'active', 70, '#3b82f6')").run();
    db.prepare("INSERT INTO projects (id, title, description, goal_id, workspace_id, deadline, status, progress_percentage, color) VALUES (2, 'AI Productivity App', 'Build local SQLite productivity system', 1, 3, '2025-10-01', 'active', 85, '#8b5cf6')").run();

    // Tasks (Unified data model)
    const taskStmt = db.prepare(`
      INSERT INTO tasks (id, title, description, project_id, goal_id, milestone_id, workspace_id, status, priority, energy_level, due_date, estimated_duration, actual_duration, labels_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const today = new Date().toISOString().split('T')[0];
    taskStmt.run(1, 'Complete Java Assignment', 'Implement inheritance and polymorphic payment service', 1, 1, 2, 2, 'todo', 'urgent', 4, today, 90, 0, '["Academic","Java"]');
    taskStmt.run(2, 'Practice 5 DSA Tree Problems', 'Binary Tree Invert, LCA, Diameter, Max Path Sum', 1, 1, 1, 2, 'in_progress', 'high', 5, today, 120, 45, '["DSA","Coding"]');
    taskStmt.run(3, 'Project Schema Review', 'Finalize SQLite tables, indexes, and views', 2, 1, 2, 3, 'done', 'high', 3, today, 45, 45, '["Database","SQL"]');
    taskStmt.run(4, 'Read OS Virtual Memory Notes', 'Paging, TLB hits, and page replacement algorithms', 1, 1, 1, 2, 'todo', 'medium', 2, today, 40, 0, '["Reading"]');
    taskStmt.run(5, 'Organize GitHub Repositories', 'Archive stale repos, update readmes', 2, 1, 2, 1, 'backlog', 'low', 1, null, 30, 0, '["Admin"]');
    taskStmt.run(6, 'Build Focus Timer UI Component', 'Clean Pomodoro state machine with ambient audio hooks', 2, 1, 2, 3, 'review', 'medium', 3, today, 60, 55, '["Frontend"]');

    // Habits & Logs
    db.prepare("INSERT INTO habits (id, title, frequency, target_count, unit, color, streak_count, best_streak, status) VALUES (1, 'Morning Exercise', 'daily', 1, 'session', '#10b981', 7, 14, 'active')").run();
    db.prepare("INSERT INTO habits (id, title, frequency, target_count, unit, color, streak_count, best_streak, status) VALUES (2, 'DSA 2 Hours', 'daily', 2, 'hours', '#3b82f6', 5, 21, 'active')").run();
    db.prepare("INSERT INTO habits (id, title, frequency, target_count, unit, color, streak_count, best_streak, status) VALUES (3, 'Hydration 3L', 'daily', 3, 'liters', '#06b6d4', 12, 18, 'active')").run();
    db.prepare("INSERT INTO habits (id, title, frequency, target_count, unit, color, streak_count, best_streak, status) VALUES (4, 'Read 20 Pages', 'daily', 20, 'pages', '#f59e0b', 4, 9, 'active')").run();

    const logStmt = db.prepare("INSERT OR REPLACE INTO habit_logs (habit_id, date, completed) VALUES (?, ?, ?)");
    logStmt.run(1, today, 1);
    logStmt.run(3, today, 1);

    // Calendar Events
    const calStmt = db.prepare("INSERT INTO calendar_events (title, description, start_time, end_time, color) VALUES (?, ?, ?, ?, ?)");
    calStmt.run('Morning Routine & Meditation', 'Wake up, hydration, stretch', `${today} 06:30:00`, `${today} 07:15:00`, '#10b981');
    calStmt.run('College Lectures', 'Operating Systems & Networks', `${today} 09:30:00`, `${today} 13:00:00`, '#3b82f6');
    calStmt.run('Deep Work: Project Development', 'FlowOS integration', `${today} 15:00:00`, `${today} 17:00:00`, '#8b5cf6');

    // Focus Sessions
    const focusStmt = db.prepare("INSERT INTO focus_sessions (task_id, started_at, ended_at, duration_minutes, focus_quality, mode) VALUES (?, ?, ?, ?, ?, ?)");
    focusStmt.run(3, `${today} 08:00:00`, `${today} 08:45:00`, 45, 9, 'deep_work');
    focusStmt.run(2, `${today} 14:00:00`, `${today} 14:45:00`, 45, 8, 'pomodoro');

    // Time entries
    db.prepare("INSERT INTO time_entries (task_id, user_id, started_at, ended_at, duration_minutes) VALUES (3, 1, ?, ?, 45)").run(`${today} 08:00:00`, `${today} 08:45:00`);

    // Journal Entry
    db.prepare("INSERT INTO journal_entries (user_id, date, mood, content, productivity_score, tasks_completed, focus_minutes, habits_completed) VALUES (1, ?, '😊 High Energy', 'Great progress on database schema and DSA practice.', 84, 1, 90, 2)").run(today);

    // Notes
    db.prepare("INSERT INTO notes (title, content, tags_json, category, workspace_id) VALUES ('Java Polymorphism Cheatsheet', 'Dynamic method dispatch uses vtable lookup at runtime. Interfaces permit multiple inheritance of type.', '[\"Java\",\"OOP\",\"Cheatsheet\"]', 'Study', 2)").run();
    db.prepare("INSERT INTO notes (title, content, tags_json, category, workspace_id) VALUES ('Productivity OS Architecture', 'One task = single source of truth across Kanban, Calendar, Focus, Analytics.', '[\"Architecture\",\"Productivity\"]', 'Design', 1)").run();
  });

  insertAll();
  console.log('Seeded database successfully.');
} else {
  console.log('Database already populated.');
}

db.close();
