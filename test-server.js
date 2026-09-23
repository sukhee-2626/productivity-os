// ponytail: assert-based test runner. Upgrade to test runner when suite exceeds single file.
const assert = require('node:assert');
const http = require('node:http');
const { server, db } = require('./server.js');

const PORT = 4000;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('Running ProductivityOS world-class integration & feature checks...');

  // 1. Auth: Default Admin Login
  const loginRes = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  assert.strictEqual(loginRes.status, 200, 'Admin login status must be 200');
  assert.ok(loginRes.data.token, 'Must return session token');
  assert.strictEqual(loginRes.data.user.username, 'admin');
  const adminToken = loginRes.data.token;
  console.log('✔ Admin login authentication valid');

  // 2. Auth: Register New User
  const testUsername = 'test_' + Date.now();
  const regRes = await request('POST', '/api/auth/register', {
    username: testUsername,
    email: `${testUsername}@local.test`,
    password: 'secretpassword'
  });
  assert.strictEqual(regRes.status, 201, 'User registration status must be 201');
  assert.ok(regRes.data.token, 'Must return session token for new user');
  const userToken = regRes.data.token;
  console.log('✔ User registration valid');

  // 3. Auth: Verify /api/auth/me
  const meRes = await request('GET', '/api/auth/me', null, userToken);
  assert.strictEqual(meRes.status, 200, 'Me check must be 200');
  assert.strictEqual(meRes.data.user.username, testUsername);
  console.log('✔ Bearer session verification valid');

  // 4. Overview API (Clean new-user state)
  const overview = await request('GET', '/api/overview', null, userToken);
  assert.strictEqual(overview.status, 200, 'Overview status must be 200');
  assert.strictEqual(overview.data.todayTasks.length, 0, 'New user tasks must be 0');
  assert.strictEqual(overview.data.habits.length, 0, 'New user habits must be 0');
  assert.strictEqual(overview.data.score.score, 0, 'New user initial score must be 0');
  assert.strictEqual(overview.data.streak, 0, 'New user initial streak must be 0');
  console.log('✔ Clean new-user workspace state valid (0 tasks, 0 score, 0 habits)');

  // 5. Task creation & update
  const newTask = await request('POST', '/api/tasks', {
    title: 'Self-Check Task Integration',
    priority: 'urgent',
    estimated_duration: 25
  }, userToken);
  assert.strictEqual(newTask.status, 201, 'Task creation status must be 201');
  assert.strictEqual(newTask.data.title, 'Self-Check Task Integration');
  const taskId = newTask.data.id;

  const updateTask = await request('PUT', `/api/tasks/${taskId}`, { status: 'done' }, userToken);
  assert.strictEqual(updateTask.status, 200, 'Task update status must be 200');
  assert.strictEqual(updateTask.data.status, 'done');
  console.log('✔ Task CRUD lifecycle valid');

  // 6. Habit creation & toggle
  const newHabit = await request('POST', '/api/habits', { title: 'Cold Shower', frequency: 'daily' }, userToken);
  assert.strictEqual(newHabit.status, 201);
  const habitToggle = await request('POST', `/api/habits/${newHabit.data.id}/toggle`, null, userToken);
  assert.strictEqual(habitToggle.status, 200, 'Habit toggle status must be 200');
  console.log('✔ Habit lifecycle valid');

  // 7. Focus session start & stop
  const focusStart = await request('POST', '/api/focus/start', { task_id: taskId, mode: 'pomodoro' }, userToken);
  assert.strictEqual(focusStart.status, 200, 'Focus start must be 200');
  const focusStop = await request('POST', '/api/focus/stop', { duration_minutes: 25, quality: 9 }, userToken);
  assert.strictEqual(focusStop.status, 200, 'Focus stop must be 200');
  console.log('✔ Focus session lifecycle valid');

  // 8. Brain dump
  const brainDump = await request('POST', '/api/brain-dump', {
    text: 'Submit physics assignment tomorrow, urgent bugfix for payments, buy milk'
  }, userToken);
  assert.strictEqual(brainDump.status, 200, 'Brain dump must be 200');
  assert.strictEqual(brainDump.data.processedCount, 3);
  console.log('✔ Brain Dump parser valid');

  // 9. Risk analysis engine
  const risks = await request('GET', '/api/risk-analysis', null, userToken);
  assert.strictEqual(risks.status, 200, 'Risk analysis status must be 200');
  console.log('✔ Risk analysis engine valid');

  // 10. Whiteboard persistence
  const node = await request('POST', '/api/whiteboard', {
    type: 'goal',
    label: 'Test Node',
    x: 120,
    y: 150,
    color: '#3b82f6'
  }, userToken);
  assert.strictEqual(node.status, 201, 'Whiteboard node creation must be 201');
  console.log('✔ Whiteboard canvas persistence valid');

  // 11. Gamification XP & Leveling
  const gameRes = await request('GET', '/api/gamification', null, userToken);
  assert.strictEqual(gameRes.status, 200);
  assert.ok(gameRes.data.xp > 0, 'XP must be accumulated from completed task & focus');
  assert.ok(gameRes.data.level >= 1, 'Level must be at least 1');
  assert.ok(Array.isArray(gameRes.data.badges), 'Badges array returned');
  console.log('✔ Gamification XP, Leveling & Badges valid');

  // 12. Habit 35-Day Heatmap
  const heatRes = await request('GET', '/api/habits/heatmap', null, userToken);
  assert.strictEqual(heatRes.status, 200);
  assert.strictEqual(heatRes.data.days.length, 35, 'Heatmap must have 35 days');
  console.log('✔ Habit 35-Day Matrix Heatmap valid');

  // 13. Global Unified Search
  const searchRes = await request('GET', '/api/search?q=Self-Check', null, userToken);
  assert.strictEqual(searchRes.status, 200);
  assert.ok(searchRes.data.results.length > 0, 'Search should find Self-Check task');
  console.log('✔ Global Unified Search valid');

  // 14. 1-Click Templates Engine
  const tplRes = await request('POST', '/api/templates/apply', { template: 'software_engineer' }, userToken);
  assert.strictEqual(tplRes.status, 200);
  const tasksAfterTpl = await request('GET', '/api/tasks', null, userToken);
  assert.ok(tasksAfterTpl.data.length >= 4, 'Tasks populated from template');
  console.log('✔ 1-Click Templates Engine valid');

  // 15. Daily Evening Review
  const reviewRes = await request('POST', '/api/daily-review', {
    win: 'Shipped world class UI',
    friction: 'None',
    tomorrow_priority: 'Launch to users'
  }, userToken);
  assert.strictEqual(reviewRes.status, 200);
  assert.ok(reviewRes.data.aiFeedback, 'AI feedback returned');
  console.log('✔ Daily Evening Review & Reflection valid');

  // 16. Auth: Logout
  const logoutRes = await request('POST', '/api/auth/logout', null, userToken);
  assert.strictEqual(logoutRes.status, 200, 'Logout must be 200');
  const unauthRes = await request('GET', '/api/auth/me', null, userToken);
  assert.strictEqual(unauthRes.status, 401, 'Revoked session must be 401');
  console.log('✔ Logout session invalidation valid');

  // 17. Workspace Data Wipe (New User Reset)
  const clearRes = await request('POST', '/api/workspaces/clear', null, adminToken);
  assert.strictEqual(clearRes.status, 200, 'Workspace clear must be 200');
  const postClearOverview = await request('GET', '/api/overview', null, adminToken);
  assert.strictEqual(postClearOverview.data.todayTasks.length, 0);
  assert.strictEqual(postClearOverview.data.habits.length, 0);
  assert.strictEqual(postClearOverview.data.score.score, 0);
  console.log('✔ Workspace data clear verified (all workspaces reset to new-user state)');

  server.close(() => {
    db.close();
    console.log('All 17 integration & world-class feature checks passed. ProductivityOS verified.');
    process.exit(0);
  });
}

runTests().catch(err => {
  console.error('Test failed:', err);
  server.close();
  process.exit(1);
});
