import { createIcons, Activity, Bell, CheckCheck, Circle, CircleCheck, Clock3, Code2, Command, FileCode2, LoaderCircle, MessageSquareText, Monitor, RefreshCw, Send, Settings2, ShieldCheck, Terminal, Wifi, X } from 'lucide';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';
import './style.css';

const icons = { Activity, Bell, CheckCheck, Circle, CircleCheck, Clock3, Code2, Command, FileCode2, LoaderCircle, MessageSquareText, Monitor, RefreshCw, Send, Settings2, ShieldCheck, Terminal, Wifi, X };
const NativeNotify = registerPlugin('NativeNotify');
const UPDATE_REPOSITORY = 'Aigooz/codex-remote';
const saved = JSON.parse(localStorage.getItem('codex-remote') || '{}');
const state = { endpoint: saved.endpoint || '', token: saved.token || '', code: '', ws: null, connected: false, connectionState: saved.token ? 'saved' : 'idle', connectionMessage: saved.token ? '已保存配对信息，点击连接电脑' : '尚未连接电脑', connectionTimer: null, view: 'work', snapshot: null, events: [], error: '', notification: false, notifications: saved.notifications !== false, pairing: false, update: null, updateStatus: '', checkingUpdate: false };
const icon = (name, size = 18) => `<i data-lucide="${name}" width="${size}" height="${size}"></i>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = () => localStorage.setItem('codex-remote', JSON.stringify({ endpoint: state.endpoint, token: state.token, notifications: state.notifications }));
const connectionStatus = () => ({
  idle: { icon: 'wifi', title: '尚未连接', detail: state.connectionMessage },
  saved: { icon: 'shield-check', title: '等待连接', detail: state.connectionMessage },
  connecting: { icon: 'loader-circle', title: '正在连接', detail: state.connectionMessage },
  pairing: { icon: 'shield-check', title: '正在验证配对码', detail: state.connectionMessage },
  syncing: { icon: 'loader-circle', title: '连接成功，正在同步', detail: state.connectionMessage },
  connected: { icon: 'circle-check', title: '已连接电脑', detail: state.connectionMessage },
  error: { icon: 'x', title: '连接失败', detail: state.connectionMessage },
  disconnected: { icon: 'wifi', title: '连接已断开', detail: state.connectionMessage }
}[state.connectionState] || { icon: 'wifi', title: '连接状态未知', detail: state.connectionMessage });

function render() {
  const thread = state.snapshot?.thread;
  const active = thread?.status?.type === 'active';
  const turns = state.snapshot?.turns || [];
  const history = turns.flatMap(turn => turn.items.map(item => ({ ...item, turnId: turn.id }))).slice(-16).reverse();
  document.querySelector('#app').innerHTML = `<main class="phone-shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">${icon('command', 18)}</span><span>codex<span class="brand-light">remote</span></span></div><button class="icon-button" id="notifications" aria-label="通知" title="通知">${icon('bell', 18)}${state.notification ? '<span class="notification-dot visible"></span>' : ''}</button></header>
    ${state.update ? `<div class="update-release update-banner" role="status"><strong>发现新版本 ${esc(state.update.version)}</strong><button class="primary-small" id="install-update" type="button">${icon('refresh-cw', 15)} 下载并安装</button></div>` : ''}
    ${state.view === 'work' ? `<section class="workspace-head"><div class="eyebrow"><span class="pulse ${active ? 'active' : 'idle'}"></span>${state.connected ? active ? 'LIVE SESSION' : 'SESSION CONNECTED' : 'NOT CONNECTED'}</div><h1>${esc(thread?.name || 'Codex 工作台')}</h1><div class="machine-row"><span class="machine-icon">${icon('monitor', 15)}</span><span>电脑 Codex</span><span class="separator">/</span><span class="repo-name">${esc(thread?.cwd || '等待连接')}</span><span class="connection-pill">${icon('wifi', 12)} ${state.connected ? '实时' : '离线'}</span></div><div class="connection-inline ${state.connectionState}">${icon(connectionStatus().icon, 14)}<span><strong>${esc(connectionStatus().title)}</strong><small>${esc(state.connectionMessage)}</small></span></div></section>
    <section class="task-panel"><div class="task-meta"><span class="task-label">会话状态</span><span class="elapsed">${icon('clock-3', 13)} ${active ? '正在处理' : thread ? '等待输入' : '未连接'}</span></div><h2>${esc(thread?.preview || (state.connected ? '等待 Codex 活动' : '连接电脑上的 Codex'))}</h2><div class="progress-line"><div class="progress-track"><span class="indeterminate" style="width:${active ? '48%' : '0%'}"></span></div><strong>${active ? '运行中' : thread ? '就绪' : '—'}</strong></div><div class="task-foot"><span>${icon('code-2', 14)} ${esc(thread?.model || 'Codex')}</span><span>${thread ? new Date(thread.updatedAt * 1000).toLocaleString() : ''}</span></div></section>
    <div class="section-heading"><div><span class="section-kicker">LIVE ACTIVITY</span><h3>真实会话动态</h3></div><span class="live-tag">${active ? icon('loader-circle', 13) : icon('circle-check', 13)} ${active ? '处理中' : '已同步'}</span></div>
    <section class="timeline" aria-label="真实 Codex 会话动态">${state.error ? `<div class="error-panel">${esc(state.error)}</div>` : ''}${history.length ? history.map(item => `<article class="event"><div class="event-rail"><span class="event-icon ${item.type === 'commandExecution' ? 'teal' : 'blue'}">${icon(item.type === 'commandExecution' ? 'terminal' : 'message-square-text', 15)}</span><span class="rail-line"></span></div><div class="event-body"><div class="event-top"><strong>${esc(item.type === 'commandExecution' ? '终端命令' : item.type === 'agentMessage' ? 'Codex 回复' : item.type === 'userMessage' ? '用户消息' : item.type)}</strong><time>${esc(item.status || '')}</time></div><p>${esc(item.text || item.command || item.status || '')}</p></div></article>`).join('') : `<div class="empty-notice">${icon('activity', 22)}<span>${state.connected ? '暂无会话动态' : '连接后显示真实工作状态'}</span></div>`}</section>` : state.view === 'settings' ? `<section class="subpage settings-page"><div class="subpage-head"><div><span class="section-kicker">CONNECTION</span><h1>连接设置</h1></div></div><form id="connection-form" class="connection-form"><label>电脑地址<input name="endpoint" value="${esc(state.endpoint)}" placeholder="ws://192.168.1.20:4174/remote" required></label><label>配对码<input name="code" value="${esc(state.code)}" placeholder="电脑终端显示的配对码" maxlength="8"></label><button class="primary-small" type="submit" ${['connecting', 'pairing', 'syncing'].includes(state.connectionState) ? 'disabled' : ''}>${icon(state.connectionState === 'connected' ? 'refresh-cw' : 'wifi', 16)} ${state.connectionState === 'connected' ? '重新连接' : '连接电脑'}</button></form><div class="connection-status ${state.connectionState}" role="status" aria-live="polite">${icon(connectionStatus().icon, 17)}<span><strong>${esc(connectionStatus().title)}</strong><small>${esc(connectionStatus().detail)}</small></span></div><div class="settings-group"><div class="settings-title">通知</div><div class="setting-row"><span><strong>任务完成提醒</strong><small>收到 Codex 完成事件时提醒</small></span><button class="switch ${state.notifications ? 'on' : ''}" role="switch" aria-checked="${state.notifications}" id="notification-toggle" aria-label="任务完成提醒"><span></span></button></div></div><div class="settings-group"><div class="settings-title">应用更新</div><button class="primary-small" id="check-update" type="button" ${state.checkingUpdate ? 'disabled' : ''}>${icon('refresh-cw', 16)} ${state.checkingUpdate ? '检查中…' : '检查更新'}</button>${state.updateStatus ? `<p class="update-status">${esc(state.updateStatus)}</p>` : ''}${state.update ? `<div class="update-release"><strong>${esc(state.update.version)}</strong>${state.update.notes ? `<p>${esc(state.update.notes)}</p>` : ''}<button class="primary-small" id="install-update" type="button">下载并安装</button></div>` : ''}</div><div class="about-row"><span>连接安全</span><span>配对授权 · 本地存储</span></div></section>` : `<section class="subpage"><div class="subpage-head"><div><span class="section-kicker">CODEX THREAD</span><h1>当前对话</h1></div></div><div class="session-row selected"><span class="session-mark working">${icon('message-square-text', 16)}</span><span class="session-copy"><strong>${esc(thread?.name || '未连接')}</strong><small>${esc(thread?.id || '请先连接电脑端')}</small><small class="session-repo">${esc(thread?.cwd || '')}</small></span></div></section>`}
    ${state.view === 'work' ? `<section class="composer-wrap"><div class="composer-hint">${icon('shield-check', 13)} ${state.snapshot?.writeAvailable ? '消息通过配对连接发送到 Codex' : '当前会话受桌面写保护，手机发送不可用'}</div><form class="composer" id="task-form"><textarea id="task-input" rows="1" placeholder="告诉 Codex 接下来做什么…" aria-label="输入任务" ${!state.connected || !state.snapshot?.writeAvailable ? 'disabled' : ''}></textarea><div class="composer-tools"><span class="composer-shortcut">Enter 发送 · Shift+Enter 换行</span><button class="send-button" aria-label="发送任务" title="发送任务" type="submit" ${!state.connected || !state.snapshot?.writeAvailable ? 'disabled' : ''}>${icon('send', 17)}</button></div></form></section>` : ''}
    <nav class="bottom-nav"><button class="nav-item ${state.view === 'work' ? 'active' : ''}" data-view="work">${icon('activity', 19)}<span>工作台</span></button><button class="nav-item ${state.view === 'sessions' ? 'active' : ''}" data-view="sessions">${icon('message-square-text', 19)}<span>会话</span></button><button class="nav-item ${state.view === 'settings' ? 'active' : ''}" data-view="settings">${icon('settings-2', 19)}<span>设置</span></button></nav>
    ${state.notification ? `<div class="completion-banner show" role="status">${icon('check-check', 18)}<span><strong>Codex 任务完成</strong><small>收到真实完成事件</small></span><button id="dismiss" aria-label="关闭">${icon('x', 16)}</button></div>` : ''}
  </main>`;
  createIcons({ icons, attrs: { 'stroke-width': 1.8 } });
  bind();
}

function connect() {
  if (state.connectionTimer) clearTimeout(state.connectionTimer);
  state.ws?.close();
  state.connected = false;
  state.snapshot = null;
  state.error = '';
  state.connectionState = 'connecting';
  state.connectionMessage = `正在连接 ${state.endpoint}`;
  render();
  let opened = false;
  let ws;
  try {
    ws = new WebSocket(state.endpoint);
    state.ws = ws;
  } catch (error) {
    state.connectionState = 'error';
    state.connectionMessage = `无法创建连接：${error.message || '请检查电脑地址'}`;
    state.error = state.connectionMessage;
    render();
    return;
  }
  state.connectionTimer = setTimeout(() => {
    if (!opened && state.ws === ws) {
      state.connectionState = 'error';
      state.connectionMessage = '连接超时，请确认地址、Wi-Fi 和 Windows 防火墙设置';
      state.error = state.connectionMessage;
      ws.close();
      render();
    }
  }, 10000);
  ws.onopen = () => {
    opened = true;
    clearTimeout(state.connectionTimer);
    state.connectionState = state.token ? 'syncing' : 'pairing';
    state.connectionMessage = state.token ? '已连接服务，正在验证保存的配对授权' : '已连接服务，正在验证配对码';
    if (state.token) ws.send(JSON.stringify({ type: 'refresh', token: state.token }));
    else if (state.code) ws.send(JSON.stringify({ type: 'pair', code: state.code.trim().toUpperCase() }));
    else {
      state.connectionState = 'error';
      state.connectionMessage = '已连接电脑，但没有输入配对码';
    }
    render();
  };
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.type === 'paired') {
      state.token = data.token; state.code = ''; state.connectionState = 'syncing';
      state.connectionMessage = '配对成功，正在读取 Codex 会话';
      store(); ws.send(JSON.stringify({ type: 'refresh', token: state.token }));
    }
    if (data.type === 'snapshot') {
      state.snapshot = data.snapshot; state.connected = true; state.connectionState = 'connected';
      state.connectionMessage = data.snapshot?.thread?.name ? `已连接：${data.snapshot.thread.name}` : '已连接电脑，实时状态已同步';
      state.error = '';
    }
    if (data.type === 'complete' && state.notifications) {
      state.notification = true;
      if (Capacitor.isNativePlatform()) NativeNotify.show({ title: 'Codex 任务完成', body: threadLabel() });
      else if ('Notification' in window && Notification.permission === 'granted') new Notification('Codex 任务完成', { body: threadLabel() });
    }
    if (data.type === 'error') {
      state.error = data.message;
      state.connectionState = 'error';
      state.connectionMessage = data.message || '电脑端返回了连接错误';
    }
    if (data.type === 'sent') { state.error = ''; state.connectionMessage = '任务已发送到 Codex'; }
    if (['paired', 'snapshot', 'complete', 'error', 'sent'].includes(data.type)) render();
  };
  ws.onclose = () => {
    if (state.ws !== ws) return;
    state.connected = false;
    if (state.connectionState !== 'error') {
      state.connectionState = 'disconnected';
      state.connectionMessage = '连接已断开，请检查电脑端桥接窗口是否仍在运行';
    }
    render();
  };
  ws.onerror = () => {
    if (state.ws !== ws) return;
    state.connected = false;
    state.connectionState = 'error';
    state.connectionMessage = '无法连接电脑，请确认使用 ws:// 地址、同一 Wi-Fi 和防火墙权限';
    state.error = state.connectionMessage;
    render();
  };
}

function threadLabel() { return state.snapshot?.thread?.name || '当前 Codex 会话已完成'; }

async function checkForUpdate() {
  state.checkingUpdate = true; state.update = null; state.updateStatus = ''; render();
  try {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? '找不到公开仓库或尚未发布版本' : `GitHub 请求失败 (${response.status})`);
    const releases = await response.json();
    const installed = await NativeNotify.getAppVersion();
    const current = installed.versionName.split(/[.+-]/)[0].split('.').map(part => Number.parseInt(part, 10) || 0);
    const newerReleases = releases.map(release => {
      const version = release.tag_name.replace(/^v/i, '');
      const numbers = version.split(/[.+-]/)[0].split('.').map(part => Number.parseInt(part, 10));
      const asset = release.assets?.find(item => item.name.toLowerCase().endsWith('.apk'));
      if (!asset || !numbers.length || numbers.some(Number.isNaN)) return null;
      for (let index = 0; index < Math.max(numbers.length, current.length); index += 1) {
        if ((numbers[index] || 0) !== (current[index] || 0)) return (numbers[index] || 0) > (current[index] || 0) ? { version, url: asset.browser_download_url, sha256: asset.digest?.replace(/^sha256:/i, '') || '', size: asset.size || 0, notes: release.body || '', numbers } : null;
      }
      return null;
    }).filter(Boolean).sort((a, b) => {
      for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index += 1) {
        if ((a.numbers[index] || 0) !== (b.numbers[index] || 0)) return (b.numbers[index] || 0) - (a.numbers[index] || 0);
      }
      return 0;
    });
    state.update = newerReleases[0] || null;
    state.updateStatus = state.update ? `发现新版本 ${state.update.version}` : `已是最新版本（${installed.versionName}）`;
  } catch (error) { state.updateStatus = error.message || '检查更新失败'; }
  finally { state.checkingUpdate = false; render(); }
}

function bind() {
  document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => { state.view = el.dataset.view; render(); }));
  document.querySelector('#connection-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    state.endpoint = String(f.get('endpoint') || '').trim();
    state.code = String(f.get('code') || '').trim();
    if (!/^wss?:\/\/[^\s/]+(?::\d+)?\/[^\s]+$/i.test(state.endpoint)) {
      state.connectionState = 'error';
      state.connectionMessage = '地址格式不正确，应类似 ws://100.2.48.178:4174/remote';
      render();
      return;
    }
    if (!state.code && !state.token) {
      state.connectionState = 'error';
      state.connectionMessage = '请输入电脑终端显示的配对码';
      render();
      return;
    }
    if (state.code) state.token = '';
    store();
    connect();
    if (Capacitor.isNativePlatform()) NativeNotify.requestPermission().catch(() => {});
    else if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  });
  document.querySelector('#check-update')?.addEventListener('click', checkForUpdate);
  document.querySelector('#install-update')?.addEventListener('click', async () => { try { state.updateStatus = '正在下载并验证安装包…'; render(); const result = await NativeNotify.installUpdate({ url: state.update.url, sha256: state.update.sha256, size: state.update.size }); state.updateStatus = result.needsPermission ? '请允许此应用安装未知应用，然后返回并再次点击安装' : '安装包验证通过，Android 安装程序已打开'; } catch (error) { state.updateStatus = error.message || '更新安装失败'; } render(); });
  document.querySelector('#notification-toggle')?.addEventListener('click', async () => { state.notifications = !state.notifications; store(); if (state.notifications && Capacitor.isNativePlatform()) await NativeNotify.requestPermission(); else if (state.notifications && 'Notification' in window) await Notification.requestPermission(); render(); });
  document.querySelector('#task-form')?.addEventListener('submit', e => { e.preventDefault(); const text = document.querySelector('#task-input').value.trim(); if (!text || !state.ws || !state.token) return; state.ws.send(JSON.stringify({ type: 'send', token: state.token, text })); document.querySelector('#task-input').value = ''; });
  document.querySelector('#task-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); document.querySelector('#task-form').requestSubmit(); } });
  document.querySelector('#dismiss')?.addEventListener('click', () => { state.notification = false; render(); });
  document.querySelector('#notifications')?.addEventListener('click', () => { state.notification = false; state.view = 'work'; render(); });
}

render();
if (state.endpoint) connect();
if (Capacitor.isNativePlatform()) checkForUpdate();
