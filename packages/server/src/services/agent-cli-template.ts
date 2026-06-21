export interface AgentCliTemplateInput {
  apiUrl: string
  roomId: string
  token: string
}

export function renderAgentCliWrapper(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/.freechat/freechat.cjs" "$@"
`
}

export function renderAgentCliCjs(input: AgentCliTemplateInput): string {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const API_URL = ${JSON.stringify(input.apiUrl)};
const ROOM_ID = ${JSON.stringify(input.roomId)};
const TOKEN = ${JSON.stringify(input.token)};

function usage() {
  console.log([
    'FreeChat Agent CLI',
    '',
    'Principle:',
    '  - Before writing files/pages, run ./freechat tab files and follow the Tab/file directory map.',
    '  - Project-visible files must go through ./freechat file ...',
    '  - Files are not visible in the File Tab unless added to tab config.',
    '  - User-visible UI pages must go through ./freechat tab ...',
    '  - Before creating tasks/plans/subtasks, run ./freechat task list and reuse existing unfinished tasks when they match.',
    '',
    'Common workflows:',
    '  ./freechat chat send "我开始处理这个任务"',
    '  ./freechat tab files',
    '  ./freechat file write docs/progress.md "进度内容" --show',
    '  ./freechat file write-local ui/dashboard.html res/dashboard.html --show',
    '  ./freechat tab create-local "数据看板" res/dashboard.html',
    '  ./freechat tab update-local <tabId> res/dashboard.html',
    '',
    'Commands:',
    '  ./freechat tool list',
    '  ./freechat tool schema <toolName>',
    '  ./freechat tool call <toolName> \'<jsonArgs>\'',
    '  ./freechat chat recent [limit]  (default 30)',
    '  ./freechat chat send <content>',
    '  ./freechat task list [status]',
    '  ./freechat task create <title> [description] [--assignee <agentNameOrId>]',
    '  ./freechat task update <taskId> <field> <value> [field value...]',
    '  ./freechat task delete <taskId>',
    '  ./freechat task progress <taskId> <note>',
    '  ./freechat task retry <taskId> [--reason <text>]',
    '  ./freechat task subtask list <taskId>',
    '  ./freechat task subtask add <taskId> <title> [description] [--assignee <agentNameOrId>]',
    '  ./freechat task subtask update <subtaskId> <field> <value> [field value...]',
    '  ./freechat task subtask retry <subtaskId> [--reason <text>]',
    '  ./freechat task subtask delete <subtaskId>',
    '  ./freechat task plan create-json <localJsonPath>',
    '  ./freechat file list',
    '  ./freechat file glob <pattern>',
    '  ./freechat file read <path> [--limit <chars>] [--offset <chars>]',
    '  ./freechat file info <path>',
    '  ./freechat file download <path> [localPath]',
    '  ./freechat file upload <localPath> [projectPath] [--show]',
    '  ./freechat file write <path> <content> [--show|--hide]',
    '  ./freechat file write-local <path> <localPath> [--show|--hide]',
    '  ./freechat file mkdir <path> [--show|--hide]',
    '  ./freechat file delete <path>',
    '  ./freechat file show <path> [tabKey]',
    '  ./freechat file hide <path> [tabKey]',
    '  ./freechat workspace ls [path]',
    '  ./freechat workspace glob <pattern>',
    '  ./freechat workspace grep <query> [--glob <pattern>]',
    '  ./freechat workspace cat <path>',
    '  ./freechat tab files',
    '  ./freechat tab-config list [tabKey]',
    '  ./freechat tab-config add-file <path> [tabKey]',
    '  ./freechat tab-config remove-file <path> [tabKey]',
    '  ./freechat tab list',
    '  ./freechat tab create <title> <htmlContent>',
    '  ./freechat tab create-file <title> <projectFilePath>',
    '  ./freechat tab create-local <title> <localPath>',
    '  ./freechat tab update <tabId> <htmlContent>',
    '  ./freechat tab update-file <tabId> <projectFilePath>',
    '  ./freechat tab update-local <tabId> <localPath>',
    '  ./freechat tab delete <tabId>',
    '  ./freechat tab reorder <tabId> [tabId...]',
    '  ./freechat members list',
    '  ./freechat members add <userId> [role]',
    '  ./freechat profiles list',
    '  ./freechat profiles update-json <memberId> <localJsonPath>',
    '  ./freechat users get <userId>',
    '  ./freechat users search <query>',
    '  ./freechat agent room-list',
    '  ./freechat agent list-available',
    '  ./freechat agent add <agentNameOrId>',
    '  ./freechat agent remove <agentNameOrId>',
    '  ./freechat agent detail [agentId]',
    '  ./freechat agent restart <agentNameOrId> [--clear-session true] [--force true]',
    '  ./freechat agent create-request <name> --description <desc> --specialties <a,b>',
    '  ./freechat agent create-json <localJsonPath>',
    '  ./freechat room info',
    '  ./freechat room handoff --agent <agentNameOrId> [--reason <reason>]',
    '  ./freechat room update [--name <name>] [--description <desc>]',
    '  ./freechat room invite [--max-uses <n>] [--expires-in-days <n>]',
    '  ./freechat interaction confirm <title> [description]',
    '  ./freechat interaction choice <title> <opt1|opt2|...> [description]',
    '  ./freechat interaction multi_choice <title> <opt1|opt2|...> [description]',
    '  ./freechat interaction create-json <localJsonPath>',
    '  ./freechat interaction list [status]',
    '  ./freechat interaction respond <interactionId> <value|value1,value2> [inputKey=inputText...]',
    '  ./freechat interaction consume <interactionId>',
    '  ./freechat interaction cancel <interactionId>',
    '  ./freechat interaction show <interactionId>',
    '  ./freechat conversation list',
    '  ./freechat conversation read <project|dm> <id>',
    '  ./freechat conversation prefs <project|dm> <id> [pinned=true] [muted=true] [hidden=true]',
    '  ./freechat friends list',
    '  ./freechat friends requests',
    '  ./freechat friends request <userId> [message]',
    '  ./freechat friends accept <requestId>',
    '  ./freechat friends reject <requestId>',
    '  ./freechat dm open <userId>',
    '  ./freechat dm messages <conversationId> [limit]',
    '  ./freechat dm send <conversationId> <content>',
    '  ./freechat selftest smoke',
    '  ./freechat raw <action> \'<jsonArgs>\'',
    '',
    'Compatibility aliases:',
    '  tab create-from-file/update-from-file, tab create-from-local/update-from-local',
    '  tab create/create-file/create-local support --default to make the page the room default page',
    '  tab set-default <tabId|title>',
    '  file write <path> <content> true  (same as --show)',
  ].join('\\n'));
}

function die(message) {
  console.error(message);
  console.error('Run ./freechat help for usage.');
  process.exit(2);
}

function readLocalFile(localPath) {
  if (!localPath) die('localPath is required');
  const resolved = path.resolve(process.cwd(), localPath);
  if (!fs.existsSync(resolved)) die('Local file not found: ' + localPath);
  return fs.readFileSync(resolved, 'utf8');
}

function stripFlags(items) {
  const flags = new Set(items.filter((x) => String(x).startsWith('--')));
  return { args: items.filter((x) => !String(x).startsWith('--')), flags };
}

function parseShowFlag(items) {
  const { args, flags } = stripFlags(items);
  const tail = args[args.length - 1];
  const legacyShow = tail === 'true' || tail === '1';
  const legacyHide = tail === 'false' || tail === '0';
  const cleanedArgs = (legacyShow || legacyHide) ? args.slice(0, -1) : args;
  return { args: cleanedArgs, show: flags.has('--show') || flags.has('--add-to-tab') || legacyShow, hide: flags.has('--hide') || legacyHide };
}

function pairsToObject(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 2) {
    if (!items[i]) continue;
    out[items[i]] = items[i + 1];
  }
  return out;
}

function parseNamedOptions(items) {
  const args = [];
  const options = {};
  for (let i = 0; i < items.length; i++) {
    const item = String(items[i]);
    if (item.startsWith('--')) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = items[i + 1];
      if (next !== undefined && !String(next).startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      args.push(items[i]);
    }
  }
  return { args, options };
}

async function call(action, args = {}) {
  const res = await fetch(API_URL + '/api/agent-tools/' + ROOM_ID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ action, args })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, raw: text }; }
  if (!res.ok || data.success === false) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(data.data ?? data, null, 2));
}

async function callValue(action, args = {}) {
  const res = await fetch(API_URL + '/api/agent-tools/' + ROOM_ID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ action, args })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, raw: text }; }
  if (!res.ok || data.success === false) throw new Error(JSON.stringify(data));
  return data.data ?? data;
}

function safeWorkspacePath(input = '.') {
  const resolved = path.resolve(process.cwd(), input);
  const root = process.cwd();
  if (resolved !== root && !resolved.startsWith(root + path.sep)) die('Path escapes current workspace: ' + input);
  return resolved;
}

function globToRegExp(pattern) {
  let out = '';
  const text = String(pattern || '*');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '*' && text[i + 1] === '*') { out += '.*'; i++; continue; }
    if (ch === '*') { out += '[^/]*'; continue; }
    if (ch === '?') { out += '[^/]'; continue; }
    if ('\\\\.+^$(){}|[]'.includes(ch)) out += '\\\\' + ch; else out += ch;
  }
  return new RegExp('^' + out + '$', 'i');
}

function walkLocal(dir, prefix = '', out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walkLocal(full, rel, out); else out.push({ path: rel, size: st.size });
  }
  return out;
}

async function downloadProjectFile(projectPath, localPath) {
  if (!projectPath) die('path is required');
  const target = safeWorkspacePath(localPath || path.join('.freechat', 'files', projectPath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const key = String(projectPath).startsWith('file:') ? 'ref' : 'path';
  const url = API_URL + '/api/agent-files/' + ROOM_ID + '/download?' + key + '=' + encodeURIComponent(projectPath);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!res.ok) die(await res.text());
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buf);
  console.log(JSON.stringify({ path: projectPath, localPath: target, size: buf.length }, null, 2));
}

async function uploadProjectFile(localPath, projectPath, addToTab) {
  if (!localPath) die('localPath is required');
  const full = safeWorkspacePath(localPath);
  if (!fs.existsSync(full)) die('Local file not found: ' + localPath);
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(full)]), path.basename(full));
  if (projectPath) form.append('path', projectPath);
  if (addToTab) form.append('addToTab', 'true');
  const res = await fetch(API_URL + '/api/agent-files/' + ROOM_ID + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: form });
  const text = await res.text();
  if (!res.ok) die(text);
  console.log(text);
}

async function selftestSmoke() {
  const marker = '__selftest__/smoke-' + Date.now() + '.txt';
  const checks = [];
  async function check(name, fn) {
    try { await fn(); checks.push({ name, ok: true }); }
    catch (err) { checks.push({ name, ok: false, error: String(err.message || err) }); }
  }
  await check('room.info', () => callValue('room.info'));
  await check('chat.list', () => callValue('chat.list', { limit: 5 }));
  await check('members.list', () => callValue('members.list'));
  await check('task.list', () => callValue('task.list'));
  await check('file.write', () => callValue('file.write', { path: marker, content: 'FreeChat selftest smoke' }));
  await check('file.read', async () => {
    const result = await callValue('file.read', { path: marker });
    if (!String(result.content || '').includes('selftest')) throw new Error('unexpected file content');
  });
  await check('file.delete', () => callValue('file.delete', { path: marker }));
  await check('tab.list', () => callValue('tab.list'));
  await check('interaction.list', () => callValue('interaction.list', { status: 'pending' }));
  console.log(JSON.stringify({ checks, ok: checks.every((x) => x.ok) }, null, 2));
  if (!checks.every((x) => x.ok)) process.exit(1);
}

const [domain, cmd, ...rest] = process.argv.slice(2);
if (!domain || ['-h', '--help', 'help'].includes(domain)) {
  usage();
  process.exit(0);
}

if (domain === 'tool' && cmd === 'list') {
  call('tool.list');
} else if (domain === 'tool' && cmd === 'schema') {
  if (!rest[0]) die('toolName is required');
  call('tool.schema', { name: rest[0] });
} else if (domain === 'tool' && cmd === 'call') {
  if (!rest[0]) die('toolName is required');
  call(rest[0], rest[1] ? JSON.parse(rest[1]) : {});
} else if (domain === 'chat' && ['recent', 'list'].includes(cmd)) {
  call('chat.list', { limit: rest[0] || 20 });
} else if (domain === 'chat' && cmd === 'send') {
  const content = rest.join(' ').trim();
  if (!content) die('content is required');
  call('chat.send', { content });
} else if (domain === 'task' && cmd === 'list') {
  call('task.list', { status: rest[0] });
} else if (domain === 'task' && cmd === 'create') {
  const parsed = parseNamedOptions(rest);
  if (!parsed.args[0]) die('title is required');
  call('task.create', { title: parsed.args[0], description: parsed.args.slice(1).join(' ') || undefined, assignee: parsed.options.assignee, assigneeId: parsed.options.assigneeId, assigneeName: parsed.options.assigneeName, priority: parsed.options.priority });
} else if (domain === 'task' && cmd === 'update') {
  if (!rest[0]) die('taskId is required');
  call('task.update', { taskId: rest[0], updates: pairsToObject(rest.slice(1)) });
} else if (domain === 'task' && cmd === 'delete') {
  if (!rest[0]) die('taskId is required');
  call('task.delete', { taskId: rest[0] });
} else if (domain === 'task' && cmd === 'progress') {
  if (!rest[0]) die('taskId is required');
  const note = rest.slice(1).join(' ').trim();
  if (!note) die('note is required');
  call('task.progress', { taskId: rest[0], note });
} else if (domain === 'task' && cmd === 'retry') {
  const parsed = parseNamedOptions(rest);
  if (!parsed.args[0]) die('taskId is required');
  call('task.retry', { taskId: parsed.args[0], reason: parsed.options.reason });
} else if (domain === 'task' && cmd === 'subtask' && rest[0] === 'list') {
  if (!rest[1]) die('taskId is required');
  call('task.subtask_list', { taskId: rest[1] });
} else if (domain === 'task' && cmd === 'subtask' && rest[0] === 'add') {
  const parsed = parseNamedOptions(rest.slice(1));
  if (!parsed.args[0] || !parsed.args[1]) die('taskId and title are required');
  call('task.subtask_add', { taskId: parsed.args[0], title: parsed.args[1], description: parsed.args.slice(2).join(' ') || undefined, assignee: parsed.options.assignee, assigneeId: parsed.options.assigneeId, assigneeName: parsed.options.assigneeName });
} else if (domain === 'task' && cmd === 'subtask' && rest[0] === 'update') {
  if (!rest[1]) die('subtaskId is required');
  call('task.subtask_update', { itemId: rest[1], updates: pairsToObject(rest.slice(2)) });
} else if (domain === 'task' && cmd === 'subtask' && rest[0] === 'retry') {
  const parsed = parseNamedOptions(rest.slice(1));
  if (!parsed.args[0]) die('subtaskId is required');
  call('task.subtask_retry', { itemId: parsed.args[0], reason: parsed.options.reason });
} else if (domain === 'task' && cmd === 'subtask' && rest[0] === 'delete') {
  if (!rest[1]) die('subtaskId is required');
  call('task.subtask_delete', { itemId: rest[1] });
} else if (domain === 'task' && cmd === 'plan' && rest[0] === 'create-json') {
  if (!rest[1]) die('localJsonPath is required');
  call('task.plan.create', JSON.parse(readLocalFile(rest[1])));
} else if (domain === 'file' && cmd === 'list') {
  call('file.list');
} else if (domain === 'file' && cmd === 'glob') {
  if (!rest[0]) die('pattern is required');
  call('file.glob', { pattern: rest[0] });
} else if (domain === 'file' && cmd === 'read') {
  const parsed = parseNamedOptions(rest);
  if (!parsed.args[0]) die('path is required');
  call('file.read', { path: parsed.args[0], limit: parsed.options.limit, offset: parsed.options.offset, force: parsed.options.force === true });
} else if (domain === 'file' && cmd === 'info') {
  if (!rest[0]) die('path is required');
  call('file.info', { path: rest[0] });
} else if (domain === 'file' && cmd === 'download') {
  downloadProjectFile(rest[0], rest[1]);
} else if (domain === 'file' && cmd === 'upload') {
  const parsed = parseNamedOptions(rest);
  uploadProjectFile(parsed.args[0], parsed.args[1], parsed.options.show === true || parsed.options.addToTab === true);
} else if (domain === 'file' && cmd === 'promote') {
  const parsed = parseNamedOptions(rest);
  if (!parsed.args[0] || !parsed.args[1]) die('ref and targetPath are required');
  call('file.promote', { ref: parsed.args[0], targetPath: parsed.args[1], show: parsed.options.show === true || parsed.options.addToTab === true });
} else if (domain === 'file' && cmd === 'write') {
  const parsed = parseShowFlag(rest);
  if (!parsed.args[0]) die('path is required');
  const content = parsed.args.slice(1).join(' ');
  call('file.write', { path: parsed.args[0], content, addToTab: parsed.show && !parsed.hide });
} else if (domain === 'file' && cmd === 'write-local') {
  const parsed = parseShowFlag(rest);
  if (!parsed.args[0]) die('path is required');
  const content = readLocalFile(parsed.args[1]);
  call('file.write', { path: parsed.args[0], content, addToTab: parsed.show && !parsed.hide });
} else if (domain === 'file' && cmd === 'mkdir') {
  const parsed = parseShowFlag(rest);
  if (!parsed.args[0]) die('path is required');
  call('file.mkdir', { path: parsed.args[0], addToTab: parsed.show && !parsed.hide });
} else if (domain === 'file' && cmd === 'delete') {
  if (!rest[0]) die('path is required');
  call('file.delete', { path: rest[0] });
} else if (domain === 'file' && cmd === 'show') {
  if (!rest[0]) die('path is required');
  call('tab-config.add-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'file' && cmd === 'hide') {
  if (!rest[0]) die('path is required');
  call('tab-config.remove-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'workspace' && cmd === 'ls') {
  const dir = safeWorkspacePath(rest[0] || '.');
  console.log(JSON.stringify(fs.readdirSync(dir, { withFileTypes: true }).map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })), null, 2));
} else if (domain === 'workspace' && cmd === 'glob') {
  if (!rest[0]) die('pattern is required');
  const re = globToRegExp(rest[0]);
  console.log(JSON.stringify(walkLocal(process.cwd()).filter(f => re.test(f.path)), null, 2));
} else if (domain === 'workspace' && cmd === 'grep') {
  const parsed = parseNamedOptions(rest);
  const query = parsed.args.join(' ').trim();
  if (!query) die('query is required');
  const fileRe = parsed.options.glob ? globToRegExp(parsed.options.glob) : null;
  const matches = [];
  for (const f of walkLocal(process.cwd()).filter(x => !fileRe || fileRe.test(x.path))) {
    if (f.size > 2_000_000) continue;
    const full = safeWorkspacePath(f.path);
    const text = fs.readFileSync(full, 'utf8');
    text.split('\\n').forEach((line, i) => { if (line.includes(query) && matches.length < 200) matches.push({ path: f.path, line: i + 1, text: line.replace(/\\r$/, '') }); });
  }
  console.log(JSON.stringify({ query, matches, truncated: matches.length >= 200 }, null, 2));
} else if (domain === 'workspace' && cmd === 'cat') {
  if (!rest[0]) die('path is required');
  process.stdout.write(fs.readFileSync(safeWorkspacePath(rest[0]), 'utf8'));
} else if (domain === 'tab-config' && cmd === 'list') {
  call('tab-config.list', { tabKey: rest[0] || 'files' });
} else if (domain === 'tab-config' && cmd === 'add-file') {
  if (!rest[0]) die('path is required');
  call('tab-config.add-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab-config' && cmd === 'remove-file') {
  if (!rest[0]) die('path is required');
  call('tab-config.remove-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab' && cmd === 'files') {
  call('tab.files');
} else if (domain === 'tab' && cmd === 'list') {
  call('tab.list');
} else if (domain === 'tab' && cmd === 'create') {
  const parsed = parseNamedOptions(rest);
  if (!parsed.args[0]) die('title is required');
  call('tab.create', { title: parsed.args[0], content: parsed.args.slice(1).join(' '), makeDefault: parsed.options.default === true });
} else if (domain === 'tab' && ['create-file', 'create-from-file'].includes(cmd)) {
  const parsed = parseNamedOptions(rest);
  if (!parsed.args[0] || !parsed.args[1]) die('title and projectFilePath are required');
  call('tab.create-from-file', { title: parsed.args[0], path: parsed.args[1], makeDefault: parsed.options.default === true });
} else if (domain === 'tab' && ['create-local', 'create-from-local'].includes(cmd)) {
  const parsed = parseNamedOptions(rest);
  if (!parsed.args[0] || !parsed.args[1]) die('title and localPath are required');
  call('tab.create', { title: parsed.args[0], content: readLocalFile(parsed.args[1]), makeDefault: parsed.options.default === true });
} else if (domain === 'tab' && cmd === 'update') {
  if (!rest[0]) die('tabId is required');
  call('tab.update', { tabId: rest[0], content: rest.slice(1).join(' ') });
} else if (domain === 'tab' && ['update-file', 'update-from-file'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('tabId and projectFilePath are required');
  call('tab.update', { tabId: rest[0], path: rest[1] });
} else if (domain === 'tab' && ['update-local', 'update-from-local'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('tabId and localPath are required');
  call('tab.update', { tabId: rest[0], content: readLocalFile(rest[1]) });
} else if (domain === 'tab' && cmd === 'delete') {
  if (!rest[0]) die('tabId is required');
  call('tab.delete', { tabId: rest[0] });
} else if (domain === 'tab' && cmd === 'set-default') {
  if (!rest[0]) die('tabId or title is required');
  call('tab.set-default', { tabId: rest[0], title: rest[0] });
} else if (domain === 'tab' && cmd === 'reorder') {
  if (rest.length === 0) die('at least one tabId is required');
  call('tab.reorder', { tabIds: rest });
} else if (domain === 'members' && cmd === 'list') {
  call('members.list');
} else if (domain === 'members' && cmd === 'add') {
  if (!rest[0]) die('userId is required');
  call('members.add', { userId: rest[0], role: rest[1] || 'editor' });
} else if (domain === 'profiles' && cmd === 'list') {
  call('profiles.list');
} else if (domain === 'profiles' && cmd === 'update-json') {
  if (!rest[0] || !rest[1]) die('memberId and localJsonPath are required');
  call('profiles.update', { memberId: rest[0], ...JSON.parse(readLocalFile(rest[1])) });
} else if (domain === 'users' && cmd === 'get') {
  if (!rest[0]) die('userId is required');
  call('users.get', { userId: rest[0] });
} else if (domain === 'users' && cmd === 'search') {
  const query = rest.join(' ').trim();
  if (!query) die('query is required');
  call('users.search', { query });
} else if (domain === 'agent' && cmd === 'room-list') {
  call('agent.room-list');
} else if (domain === 'agent' && cmd === 'list-available') {
  call('agent.list_available');
} else if (domain === 'agent' && cmd === 'add') {
  if (!rest[0]) die('agentNameOrId is required');
  const opts = parseNamedOptions(rest.slice(1)).options;
  call('agent.add', { agent: rest[0], roomRole: opts.roomRole || opts.role, autoEnabled: opts.autoEnabled === 'true', priority: opts.priority });
} else if (domain === 'agent' && cmd === 'remove') {
  if (!rest[0]) die('agentNameOrId is required');
  call('agent.remove', { agent: rest[0] });
} else if (domain === 'agent' && cmd === 'detail') {
  call('agent.detail', { agent: rest[0] });
} else if (domain === 'agent' && cmd === 'restart') {
  if (!rest[0]) die('agentNameOrId is required');
  const opts = parseNamedOptions(rest.slice(1)).options;
  call('agent.restart', { agent: rest[0], clearSession: opts.clearSession !== 'false', force: opts.force === 'true', mode: opts.force === 'true' ? 'force' : 'soft' });
} else if (domain === 'agent' && (cmd === 'create-request' || cmd === 'create')) {
  if (!rest[0]) die('agent name is required');
  const opts = parseNamedOptions(rest.slice(1)).options;
  const specialties = opts.specialties ? String(opts.specialties).split(',').map(s => s.trim()).filter(Boolean) : [];
  call('agent.create_request', { name: rest[0], description: opts.description || opts.desc, specialties, roleType: opts.roleType || opts.role || 'specialist', roomRole: opts.roomRole || 'specialist', autoEnabled: opts.autoEnabled === 'true', priority: opts.priority });
} else if (domain === 'agent' && cmd === 'create-json') {
  if (!rest[0]) die('localJsonPath is required');
  call('agent.create_request', JSON.parse(readLocalFile(rest[0])));
} else if (domain === 'room' && cmd === 'info') {
  call('room.info');
} else if (domain === 'room' && cmd === 'handoff') {
  const opts = parseNamedOptions(rest).options;
  call('room.handoff', { agent: opts.agent || rest[0], reason: opts.reason || rest.slice(1).join(' ') });
} else if (domain === 'room' && cmd === 'update') {
  const opts = parseNamedOptions(rest).options;
  call('room.update', { name: opts.name, description: opts.description || opts.desc });
} else if (domain === 'room' && cmd === 'invite') {
  const opts = parseNamedOptions(rest).options;
  call('room.create-invite', { maxUses: opts.maxUses, expiresInDays: opts.expiresInDays });
} else if (domain === 'interaction' && ['confirm', 'choice', 'multi_choice'].includes(cmd)) {
  if (!rest[0]) die('title is required');
  const options = cmd === 'confirm' ? [{value:'confirm',label:'确认',style:'primary'},{value:'cancel',label:'取消',style:'secondary'}] : (rest[1]||'').split('|').filter(Boolean).map((v,i)=>({value:'opt'+(i+1),label:v}));
  const desc = cmd === 'confirm' ? rest.slice(1).join(' ') : rest.slice(2).join(' ');
  call('interaction.create', { type: cmd, title: rest[0], description: desc || undefined, options });
} else if (domain === 'interaction' && cmd === 'list') {
  call('interaction.list', { status: rest[0] || 'pending' });
} else if (domain === 'interaction' && cmd === 'respond') {
  if (!rest[0]) die('interactionId is required');
  if (!rest[1]) die('value is required');
  const rawValue = rest[1];
  const value = rawValue.includes(',') ? rawValue.split(',').map(s => s.trim()).filter(Boolean) : rawValue;
  const inputs = {};
  for (const part of rest.slice(2)) {
    const idx = part.indexOf('=');
    if (idx > 0) inputs[part.slice(0, idx)] = part.slice(idx + 1);
  }
  call('interaction.respond', { id: rest[0], value, inputs });
} else if (domain === 'interaction' && cmd === 'consume') {
  if (!rest[0]) die('interactionId is required');
  call('interaction.consume', { id: rest[0] });
} else if (domain === 'interaction' && cmd === 'cancel') {
  if (!rest[0]) die('interactionId is required');
  call('interaction.cancel', { id: rest[0] });
} else if (domain === 'interaction' && cmd === 'create-json') {
  if (!rest[0]) die('localJsonPath is required');
  call('interaction.create', JSON.parse(readLocalFile(rest[0])));
} else if (domain === 'interaction' && cmd === 'show') {
  if (!rest[0]) die('interactionId is required');
  call('interaction.get', { id: rest[0] });
} else if (domain === 'conversation' && cmd === 'list') {
  call('conversation.list');
} else if (domain === 'conversation' && cmd === 'read') {
  if (!rest[0] || !rest[1]) die('type and id are required');
  call('conversation.mark-read', { type: rest[0], id: rest[1] });
} else if (domain === 'conversation' && cmd === 'prefs') {
  if (!rest[0] || !rest[1]) die('type and id are required');
  call('conversation.update-prefs', { type: rest[0], id: rest[1], ...pairsToObject(rest.slice(2).map((x) => x.includes('=') ? x.split('=') : x).flat()) });
} else if (domain === 'friends' && cmd === 'list') {
  call('friends.list');
} else if (domain === 'friends' && cmd === 'requests') {
  call('friends.requests');
} else if (domain === 'friends' && cmd === 'request') {
  if (!rest[0]) die('userId is required');
  call('friends.request', { targetUserId: rest[0], message: rest.slice(1).join(' ') || undefined });
} else if (domain === 'friends' && cmd === 'accept') {
  if (!rest[0]) die('requestId is required');
  call('friends.accept', { requestId: rest[0] });
} else if (domain === 'friends' && cmd === 'reject') {
  if (!rest[0]) die('requestId is required');
  call('friends.reject', { requestId: rest[0] });
} else if (domain === 'dm' && cmd === 'open') {
  if (!rest[0]) die('userId is required');
  call('dm.open', { userId: rest[0] });
} else if (domain === 'dm' && ['messages', 'list'].includes(cmd)) {
  if (!rest[0]) die('conversationId is required');
  call('dm.messages', { conversationId: rest[0], limit: rest[1] || 30 });
} else if (domain === 'dm' && cmd === 'send') {
  if (!rest[0]) die('conversationId is required');
  const content = rest.slice(1).join(' ').trim();
  if (!content) die('content is required');
  call('dm.send', { conversationId: rest[0], content });
} else if (domain === 'selftest' && cmd === 'smoke') {
  selftestSmoke();
} else if (domain === 'raw') {
  call(cmd, rest[0] ? JSON.parse(rest[0]) : {});
} else {
  die('Unknown command: ' + [domain, cmd].filter(Boolean).join(' '));
}
`
}
