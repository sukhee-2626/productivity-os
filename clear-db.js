// ponytail: script to clear database and seed initial admin credentials.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'productivity.db');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'productivity.db.sql'), 'utf8');
db.exec(schema);

// Hash password with Node crypto stdlib
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
const passwordHash = `${salt}:${hash}`;

db.prepare(`
  INSERT INTO users (id, username, email, password_hash)
  VALUES (1, 'admin', 'admin@productivityos.local', ?)
`).run(passwordHash);

// Create clean default workspaces
db.prepare("INSERT INTO workspaces (id, name, slug, description, is_default) VALUES (1, 'Personal', 'personal', 'Personal Workspace', 1)").run();
db.prepare("INSERT INTO workspaces (id, name, slug, description, is_default) VALUES (2, 'College', 'college', 'College Workspace', 0)").run();
db.prepare("INSERT INTO workspaces (id, name, slug, description, is_default) VALUES (3, 'Work', 'work', 'Work Workspace', 0)").run();

db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (1, 1, 'owner')").run();
db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (2, 1, 'owner')").run();
db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (3, 1, 'owner')").run();

console.log('Every workspace cleared. All data reset to new user state (0 tasks, 0 goals, 0 habits).');
db.close();
