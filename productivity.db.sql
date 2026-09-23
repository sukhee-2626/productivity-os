-- Productivity Tracker SQL Schema for SQLite
-- Runs locally on your PC with better-sqlite3

-- ============================================================
-- CORE ENTITIES
-- ============================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  preferences_json TEXT DEFAULT '{}'
);

-- User sessions table
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Workspace members
CREATE TABLE IF NOT EXISTS workspace_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(workspace_id, user_id)
);

-- ============================================================
-- GOAL SYSTEM (Goal → Milestone → Project → Task)
-- ============================================================

-- Goals table
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  goal_type TEXT DEFAULT 'personal' CHECK (goal_type IN ('vision', 'yearly', 'quarterly', 'monthly')),
  target_date DATE,
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  workspace_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Milestones table
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  position INTEGER DEFAULT 0,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  goal_id INTEGER,
  workspace_id INTEGER,
  deadline DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
  color TEXT DEFAULT '#3b82f6',
  icon TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- ============================================================
-- TASKS (The central entity)
-- ============================================================

-- Tasks table - the "one source of truth"
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  project_id INTEGER,
  goal_id INTEGER,
  milestone_id INTEGER,
  workspace_id INTEGER,

  -- Task properties
  status TEXT DEFAULT 'backlog' CHECK (status IN ('backlog', 'todo', 'in_progress', 'blocked', 'review', 'done', 'archived')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  energy_level INTEGER DEFAULT 3 CHECK (energy_level BETWEEN 1 AND 5), -- 1=Low, 5=High

  -- Scheduling
  due_date DATE,
  due_time TIME,
  start_date DATE,
  start_time TIME,

  -- Estimation & Tracking
  estimated_duration INTEGER DEFAULT 0, -- in minutes
  actual_duration INTEGER DEFAULT 0, -- in minutes
  completion_percentage INTEGER DEFAULT 0 CHECK (completion_percentage BETWEEN 0 AND 100),

  -- Context
  context_json TEXT DEFAULT '{}', -- @Computer, @College, @Home, etc.
  labels_json TEXT DEFAULT '[]', -- JSON array of label names

  -- Relations
  parent_task_id INTEGER,
  order_index INTEGER DEFAULT 0,

  -- AI & Automation
  ai_summary TEXT,
  ai_last_analyzed DATETIME,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Task dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  depends_on_task_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id, depends_on_task_id)
);

-- Task checklists
CREATE TABLE IF NOT EXISTS task_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  is_complete BOOLEAN DEFAULT FALSE,
  order_index INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Task comments
CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Task attachments
CREATE TABLE IF NOT EXISTS task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  file_path TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- ============================================================
-- CALENDAR & TIME BLOCKING
-- ============================================================

-- Calendar events (coexist with tasks)
CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  all_day BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  color TEXT DEFAULT '#10b981',
  workspace_id INTEGER,
  recurrence_rule TEXT, -- iCal RRULE format
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Time blocks (linked to tasks)
CREATE TABLE IF NOT EXISTS time_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  calendar_event_id INTEGER,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  is_focus_block BOOLEAN DEFAULT TRUE,
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'shifted', 'cancelled')),
  actual_start DATETIME,
  actual_end DATETIME,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL
);

-- ============================================================
-- FOCUS SESSIONS & TIME TRACKING
-- ============================================================

-- Focus sessions
CREATE TABLE IF NOT EXISTS focus_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_minutes INTEGER,
  focus_quality INTEGER DEFAULT 5 CHECK (focus_quality BETWEEN 1 AND 10),
  distractions INTEGER DEFAULT 0,
  mode TEXT DEFAULT 'pomodoro' CHECK (mode IN ('pomodoro', 'deep_work', 'custom', 'countdown')),
  pomodoros_completed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Time entries (track actual work time)
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_minutes INTEGER,
  is_interrupted BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================================
-- HABITS
-- ============================================================

-- Habits table
CREATE TABLE IF NOT EXISTS habits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly', 'custom')),
  target_count INTEGER DEFAULT 1,
  unit TEXT DEFAULT 'times',
  color TEXT DEFAULT '#f59e0b',
  icon TEXT,
  goal_id INTEGER,
  workspace_id INTEGER,
  streak_count INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  completion_rate REAL DEFAULT 0 CHECK (completion_rate BETWEEN 0 AND 1),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Habit logs (daily tracking)
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

-- ============================================================
-- NOTES & SECOND BRAIN
-- ============================================================

-- Notes table
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  content TEXT NOT NULL,
  tags_json TEXT DEFAULT '[]',
  category TEXT,
  workspace_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Note-tag junction
CREATE TABLE IF NOT EXISTS note_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  tag_name TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  UNIQUE(note_id, tag_name)
);

-- Journal entries
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date DATE DEFAULT (DATE('now')),
  mood TEXT,
  content TEXT,
  productivity_score INTEGER DEFAULT 0 CHECK (productivity_score BETWEEN 0 AND 100),
  tasks_completed INTEGER DEFAULT 0,
  focus_minutes INTEGER DEFAULT 0,
  habits_completed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ==========================================================--
-- AUTOMATIONS
-- ============================================================

-- Automations
CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('task_completed', 'habit_completed', 'deadline_approaching', 'overdue', 'daily_review', 'weekly_review', 'custom')),
  trigger_condition_json TEXT DEFAULT '{}',
  action_type TEXT NOT NULL CHECK (action_type IN ('move_to_today', 'update_project_progress', 'notify', 'reschedule', 'set_priority', 'complete_task', 'custom')),
  action_target_json TEXT DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT TRUE,
  workspace_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- ==========================================================--
-- ACTIVITY LOG (for audit & insights)
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action_type TEXT NOT NULL, -- 'task_created', 'task_completed', 'habit_logged', etc.
  entity_type TEXT NOT NULL, -- 'task', 'habit', 'project', etc.
  entity_id INTEGER,
  details_json TEXT DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Whiteboard / Mind Map Canvas
CREATE TABLE IF NOT EXISTS whiteboard_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'task',
  label TEXT NOT NULL,
  x REAL DEFAULT 100,
  y REAL DEFAULT 100,
  color TEXT DEFAULT '#3b82f6',
  data_json TEXT DEFAULT '{}'
);

-- ==========================================================--
-- PRODUCTIVITY SCORE COMPONENTS
-- ============================================================

-- Daily productivity snapshots
CREATE TABLE IF NOT EXISTS daily_productivity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date DATE DEFAULT (DATE('now')),
  productivity_score INTEGER DEFAULT 0 CHECK (productivity_score BETWEEN 0 AND 100),
  tasks_planned INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  focus_minutes INTEGER DEFAULT 0,
  deep_work_minutes INTEGER DEFAULT 0,
  habit_completions INTEGER DEFAULT 0,
  habit_target INTEGER DEFAULT 0,
  calendar_events_completed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, date)
);

-- Productivity score component weights (configurable per user)
CREATE TABLE IF NOT EXISTS score_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_completion_weight REAL DEFAULT 0.25,
  focus_time_weight REAL DEFAULT 0.20,
  planning_accuracy_weight REAL DEFAULT 0.15,
  habit_consistency_weight REAL DEFAULT 0.20,
  goal_progress_weight REAL DEFAULT 0.10,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id)
);

-- ==========================================================--
-- INDEXES FOR PERFORMANCE
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS tasks_status_priority ON tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task_id ON focus_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_habits_goal_id ON habits(goal_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(workspace_id);

-- ==========================================================--
-- VIEWS FOR COMMON QUERIES
-- ============================================================

-- Today's tasks view
CREATE VIEW IF NOT EXISTS view_today_tasks AS
SELECT t.*, p.title as project_title, g.title as goal_title
FROM tasks t
LEFT JOIN projects p ON t.project_id = p.id
LEFT JOIN goals g ON t.goal_id = g.id
WHERE t.status IN ('todo', 'in_progress')
  AND (t.due_date IS NULL OR t.due_date = DATE('now'))
ORDER BY t.priority DESC, t.energy_level DESC, t.order_index;

-- Weekly view
CREATE VIEW IF NOT EXISTS view_week_tasks AS
SELECT t.*, p.title as project_title
FROM tasks t
LEFT JOIN projects p ON t.project_id = p.id
WHERE t.due_date BETWEEN DATE('now') AND DATE('now', '+6 days')
  OR (t.status IN ('todo') AND t.created_at BETWEEN DATE('now') AND DATE('now', '+6 days'))
ORDER BY t.due_date ASC, t.priority DESC;

-- Habit completion streak calculation view
CREATE VIEW IF NOT EXISTS view_habit_streaks AS
SELECT h.id, h.title,
  (SELECT COUNT(*) FROM habit_logs hl
   WHERE hl.habit_id = h.id AND hl.completed = 1
     AND hl.date >= DATE('now', '-6 days')) as recent_completions,
  h.streak_count, h.best_streak
FROM habits h
WHERE h.status = 'active';

-- Project progress view
CREATE VIEW IF NOT EXISTS view_project_progress AS
SELECT p.id, p.title,
  COUNT(t.id) as total_tasks,
  SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed_tasks,
  CASE WHEN COUNT(t.id) > 0 THEN ROUND(100.0 * SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) / COUNT(t.id), 2) ELSE 0 END as progress_percentage
FROM projects p
LEFT JOIN tasks t ON p.id = t.project_id
GROUP BY p.id;

-- ==========================================================--
-- SAMPLE DATA INSERTION (commented out)
-- ============================================================

-- Uncomment and modify to insert sample data:
--
-- INSERT INTO users (username, email, password_hash) VALUES ('testuser', 'test@example.com', '$2b$12$dummy');
-- INSERT INTO workspaces (name, slug, description, is_default) VALUES ('Personal', 'personal', 'Personal productivity', TRUE);
-- ... etc

-- ============================================================
-- SCHEMA VALIDATION QUERY
-- ============================================================
--
-- SELECT count(*) as table_count FROM sqlite_master WHERE type='table';
-- SELECT * FROM sqlite_master ORDER BY type, name;