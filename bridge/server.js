import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 4174);
const THREAD_ID = process.env.CODEX_THREAD_ID || '01a1890a-314b-7f60-ad3a-c61dbab0fabe';
const pairingCode = crypto.randomBytes(4).toString('hex').toUpperCase();
const pairingExpiresAt = Date.now() + 10 * 60 * 1000;
const clients = new Set();
let token = '';
let nextId = 0;
let rpcBuffer = '';
const pending = new Map();
let thread = null;
let turns = [];
let writeAvailable = false;
let refreshing = false;

function resolveCodexCommand() {
  const configured = process.env.CODEX_BIN?.trim();
  const candidates = configured ? [configured] : [];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const appServerRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    try {
      const versions = fs.readdirSync(appServerRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
      for (const version of versions) candidates.push(path.join(appServerRoot, version.name, 'codex.exe'));
    } catch { /* The desktop Codex installation may not be present. */ }
    if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, '.codex', 'plugins', '.plugin-appserver', 'codex.exe'));
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'codex.cmd'));
  }
  candidates.push(process.platform === 'win32' ? 'codex.exe' : 'codex');
  const executable = candidates.find(candidate => !path.isAbsolute(candidate) || fs.existsSync(candidate));
  if (!executable) {
    throw new Error('找不到 Codex CLI。请设置 CODEX_BIN 为 codex.exe 的完整路径后重试。');
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${executable}" app-server --stdio`] };
  }
  return { command: executable, args: ['app-server', '--stdio'] };
}

const codexCommand = resolveCodexCommand();
console.log(`Using Codex CLI: ${codexCommand.command}${codexCommand.args.length ? ` ${codexCommand.args.join(' ')}` : ''}`);
const codex = spawn(codexCommand.command, codexCommand.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
codex.stdout.setEncoding('utf8');
codex.stderr.on('data', data => console.error('[codex]', data.toString().trim()));
codex.stdout.on('data', data => {
  rpcBuffer += data;
  while (true) {
    const end = rpcBuffer.indexOf('\n');
    if (end < 0) break;
    const line = rpcBuffer.slice(0, end); rpcBuffer = rpcBuffer.slice(end + 1);
    try {
      const message = JSON.parse(line);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (message.method) onCodexEvent(message.method, message.params || {});
    } catch { /* Ignore non-JSON app-server diagnostics on stdout. */ }
  }
});
codex.on('exit', code => { broadcast({ type: 'error', message: `Codex app-server exited (${code})` }); process.exitCode = 1; });

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    codex.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(data);
}

function onCodexEvent(method, params) {
  if (method === 'agentMessageDelta' || method === 'item/agentMessage/delta' || method === 'turn/started' || method === 'turn/completed' || method === 'thread/status/changed') {
    if (params.threadId === THREAD_ID) {
      if (method === 'turn/completed') broadcast({ type: 'complete', turn: params.turn });
      else broadcast({ type: 'event', method, params });
      refresh().catch(error => broadcast({ type: 'error', message: error.message }));
    }
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
  const read = await rpc('thread/read', { threadId: THREAD_ID, includeTurns: true });
  thread = read.thread;
  turns = thread.turns || [];
  broadcast({ type: 'snapshot', snapshot: snapshot() });
  } finally { refreshing = false; }
}

function snapshot() {
  return {
    thread: thread && { id: thread.id, name: thread.name, cwd: thread.cwd, model: thread.model, status: thread.status, updatedAt: thread.updatedAt, preview: thread.preview, canAcceptDirectInput: thread.canAcceptDirectInput },
    writeAvailable,
    turns: turns.slice(-12).map(turn => ({ id: turn.id, status: turn.status, items: (turn.items || []).map(item => ({ type: item.type, text: item.text || item.content?.map?.(part => part.text || '').join('') || '', command: item.command, status: item.status })).filter(item => item.text || item.command || /command|plan|message/i.test(item.type || '')) }))
  };
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ paired: Boolean(token), threadId: THREAD_ID })); return; }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/remote') return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  clients.add(ws);
  ws.on('message', async raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'pair') {
        if (Date.now() > pairingExpiresAt || message.code !== pairingCode) throw new Error('配对码不正确或已过期');
        token = crypto.randomBytes(32).toString('hex');
        ws.send(JSON.stringify({ type: 'paired', token }));
        return;
      }
      const suppliedToken = Buffer.from(String(message.token || ''));
      const expectedToken = Buffer.from(token);
      if (!token || suppliedToken.length !== expectedToken.length || !crypto.timingSafeEqual(suppliedToken, expectedToken)) throw new Error('设备未授权，请重新配对');
      if (message.type === 'refresh') { await refresh(); return; }
      if (message.type === 'send') {
        const text = String(message.text || '').trim();
        if (!text || text.length > 12000) throw new Error('任务内容为空或超出长度限制');
        if (!writeAvailable) throw new Error('当前桌面会话由 Codex 桌面端占用，官方并发写保护拒绝了手机端接管。请先在桌面端结束当前任务，再重新连接。');
        await rpc('turn/start', { threadId: THREAD_ID, input: [{ type: 'text', text }] });
        ws.send(JSON.stringify({ type: 'sent' }));
      }
    } catch (error) { ws.send(JSON.stringify({ type: 'error', message: error.message })); }
  });
  ws.on('close', () => clients.delete(ws));
  if (token) ws.send(JSON.stringify({ type: 'snapshot', snapshot: snapshot() }));
});

await rpc('initialize', { clientInfo: { name: 'codex-mobile-bridge', version: '0.1.0' }, capabilities: { experimentalApi: true } });
codex.stdin.write('{"jsonrpc":"2.0","method":"initialized","params":{}}\n');
try { await refresh(); } catch (error) { console.error('Initial thread read failed:', error.message); }
try {
  await rpc('thread/resume', { threadId: THREAD_ID, excludeTurns: true });
  writeAvailable = true;
} catch (error) {
  writeAvailable = false;
  console.error('Mobile write unavailable:', error.message);
}
setInterval(() => refresh().catch(error => broadcast({ type: 'error', message: error.message })), 5000);
server.listen(PORT, '0.0.0.0', () => {
  const addresses = Object.values(os.networkInterfaces()).flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'))
    .map(item => item.address);
  console.log(`Codex Remote pairing code: ${pairingCode}`);
  if (addresses.length) addresses.forEach(address => console.log(`Phone endpoint: ws://${address}:${PORT}/remote`));
  else console.log(`Phone endpoint: ws://127.0.0.1:${PORT}/remote (仅本机可用)`);
  console.log(`Target thread: ${THREAD_ID}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); wss.close(); codex.kill(); });
