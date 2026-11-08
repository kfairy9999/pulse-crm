import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const deal = {
  id: 'deal-1',
  title: 'CRM verification — temporary deal',
  contact_name: 'CRM verification — temporary',
  company: 'Verification Co',
  stage: 'New Lead',
  value: 1,
  value_cents: 100,
  position: 0,
  expected_close_date: null,
  notes: 'Temporary acceptance-test deal, not a real lead',
};
const stages = Object.fromEntries(['New Lead', 'Contacted', 'Booked', 'Proposal', 'Won', 'Lost'].map((stage) => [stage, stage === 'New Lead' ? [deal] : []]));

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function chromeBinary() {
  const candidates = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome'].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
      if (version) return { path: candidate, version };
    } catch { /* A path can exist and still not be a launchable browser. */ }
  }
  return null;
}

test('production bundle renders the first deal from an HTTP opportunity payload', async (t) => {
  const chrome = chromeBinary();
  if (!chrome) {
    assert.equal(process.env.CI, undefined, 'CI must provide a launchable Chrome. The first-deal render was not checked.');
    t.skip('Chrome is not installed');
    return;
  }
  console.log(`Chrome ${chrome.version} at ${chrome.path}`);
  const root = path.resolve('dist');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/auth/session') return response.end(JSON.stringify({ authenticated: true, user: { id: 'owner', email: 'owner@example.test' }, setupRequired: false, passwordProtocol: 'browser-pbkdf2-sha256-v1' }));
    if (url.pathname === '/api/metadata') return response.end(JSON.stringify({ sampleDataSeeded: false }));
    if (url.pathname === '/api/contacts') return response.end(JSON.stringify({ contacts: [{ id: 'contact-1', name: 'CRM verification — temporary', company: 'Verification Co', email: null, tags: [] }], total: 1, tags: [] }));
    if (url.pathname === '/api/opportunities') return response.end(JSON.stringify({ stages, total: 1 }));
    if (url.pathname === '/api/dashboard') return response.end(JSON.stringify({ metrics: {}, tasks: [], upcoming: [], activity: [], monthly: [], recentContacts: [] }));
    const file = url.pathname === '/' || url.pathname === '/signin' ? '/index.html' : url.pathname;
    try {
      const body = await readFile(path.join(root, file));
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      response.setHeader('Content-Type', type);
      response.end(body);
    } catch {
      response.writeHead(404).end('missing');
    }
  });
  const port = await listen(server);
  t.after(() => server.close());
  const userData = path.join('/tmp', `pulse-browser-${process.pid}-${Date.now()}`);
  let chromeError = '';
  let chromeExit = null;
  const browser = spawn(chrome.path, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${userData}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr?.on('data', (chunk) => { chromeError = `${chromeError}${chunk}`.slice(-800); });
  browser.once('exit', (code, signal) => { chromeExit = { code, signal }; });
  t.after(() => browser.kill('SIGTERM'));
  let version;
  for (let attempt = 0; attempt < 150 && !version && !chromeExit; attempt += 1) {
    try {
      const active = await readFile(path.join(userData, 'DevToolsActivePort'), 'utf8');
      const debugPort = Number(active.split('\n')[0]);
      if (debugPort) version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json());
    } catch { /* Chrome is still starting. */ }
    if (!version) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(version, `Chrome DevTools did not start from ${chrome.path} (${chrome.version}). exit=${JSON.stringify(chromeExit)} stderr=${chromeError}`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map();
  const events = [];
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
    } else if (message.method) events.push(message);
  });
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/#/pipeline` }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const exceptions = events.filter((event) => event.method === 'Runtime.exceptionThrown').map((event) => event.params.exceptionDetails.exception?.description?.split('\n')[0]);
  const text = await send('Runtime.evaluate', { expression: 'document.body?.innerText || ""', returnByValue: true }, sessionId);
  assert.deepEqual(exceptions, []);
  assert.match(text.result.value, /CRM verification — temporary deal/);
  assert.match(text.result.value, /New Lead/);
  assert.match(text.result.value, /\$1/);
  ws.close();
});
