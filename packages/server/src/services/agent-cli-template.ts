export interface AgentCliTemplateInput {
  apiUrl: string
  roomId: string
  token: string
}

export function renderAgentCli(input: AgentCliTemplateInput): string {
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
    '  - Project-visible files must go through ./freechat file ...',
    '  - Files are not visible in the File Tab unless added to tab config.',
    '  - User-visible UI pages must go through ./freechat tab ...',
    '',
    'Common workflows:',
    '  ./freechat chat send "我开始处理这个任务"',
    '  ./freechat file write docs/progress.md "进度内容" --show',
    '  ./freechat file write-local ui/dashboard.html res/dashboard.html --show',
    '  ./freechat tab create-local "数据看板" res/dashboard.html',
    '  ./freechat tab update-local <tabId> res/dashboard.html',
    '',
    'Commands:',
    '  ./freechat chat send <content>',
    '  ./freechat task list [status]',
    '  ./freechat task create <title> [description] [--assignee <agentNameOrId>]',
    '  ./freechat task update <taskId> <field> <value> [field value...]',
    '  ./freechat task progress <taskId> <note>',
    '  ./freechat task subtask list <taskId>',
    '  ./freechat task subtask add <taskId> <title> [description] [--assignee <agentNameOrId>]'
    '  ./freechat task subtask update <subtaskId> <field> <value> [field value...]',
    '  ./freechat task subtask delete <subtaskId>',
    '  ./freechat task plan create-json <localJsonPath>',
    '  ./freechat file list',
    '  ./freechat file read <path>',
    '  ./freechat file write <path> <content> [--show|--hide]',
    '  ./freechat file write-local <path> <localPath> [--show|--hide]',
    '  ./freechat file show <path> [tabKey]',
    '  ./freechat file hide <path> [tabKey]',
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
    '  ./freechat agent list-available',
    '  ./freechat agent add <agentNameOrId>',
    '  ./freechat agent create-request <name> --description <desc> --specialties <a,b>',
    '  ./freechat agent create-json <localJsonPath>',
    '  ./freechat room info',
    '  ./freechat interaction confirm <title> [description]',
    '  ./freechat interaction choice <title> <opt1|opt2|...> [description]',
    '  ./freechat interaction multi_choice <title> <opt1|opt2|...> [description]',
    '  ./freechat interaction create-json <localJsonPath>',
    '  ./freechat interaction list [status]',
    '  ./freechat interaction consume <interactionId>',
    '  ./freechat interaction show <interactionId>',
    '  ./freechat raw <action> \'<jsonArgs>\'',
    '',
    'Compatibility aliases:',
    '  tab create-from-file/update-from-file, tab create-from-local/update-from-local',
    '  file write <path> <content> true  (same as --show)',
  ].join('\n'));
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

const [domain, cmd, ...rest] = process.argv.slice(2);
if (!domain || ['-h', '--help', 'help'].includes(domain)) {
  usage();
  process.exit(0);
}

if (domain === 'chat' && cmd === 'send') {
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
} else if (domain === 'task' && cmd === 'progress') {
  if (!rest[0]) die('taskId is required');
  const note = rest.slice(1).join(' ').trim();
  if (!note) die('note is required');
  call('task.progress', { taskId: rest[0], note });
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
} else if (domain === 'task' && cmd === 'subtask' && rest[0] === 'delete') {
  if (!rest[1]) die('subtaskId is required');
  call('task.subtask_delete', { itemId: rest[1] });
} else if (domain === 'task' && cmd === 'plan' && rest[0] === 'create-json') {
  if (!rest[1]) die('localJsonPath is required');
  call('task.plan.create', JSON.parse(readLocalFile(rest[1])));
} else if (domain === 'file' && cmd === 'list') {
  call('file.list');
} else if (domain === 'file' && cmd === 'read') {
  if (!rest[0]) die('path is required');
  call('file.read', { path: rest[0] });
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
} else if (domain === 'file' && cmd === 'show') {
  if (!rest[0]) die('path is required');
  call('tab-config.add-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'file' && cmd === 'hide') {
  if (!rest[0]) die('path is required');
  call('tab-config.remove-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab-config' && cmd === 'list') {
  call('tab-config.list', { tabKey: rest[0] || 'files' });
} else if (domain === 'tab-config' && cmd === 'add-file') {
  if (!rest[0]) die('path is required');
  call('tab-config.add-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab-config' && cmd === 'remove-file') {
  if (!rest[0]) die('path is required');
  call('tab-config.remove-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab' && cmd === 'list') {
  call('tab.list');
} else if (domain === 'tab' && cmd === 'create') {
  if (!rest[0]) die('title is required');
  call('tab.create', { title: rest[0], content: rest.slice(1).join(' ') });
} else if (domain === 'tab' && ['create-file', 'create-from-file'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('title and projectFilePath are required');
  call('tab.create-from-file', { title: rest[0], path: rest[1] });
} else if (domain === 'tab' && ['create-local', 'create-from-local'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('title and localPath are required');
  call('tab.create', { title: rest[0], content: readLocalFile(rest[1]) });
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
} else if (domain === 'tab' && cmd === 'reorder') {
  if (rest.length === 0) die('at least one tabId is required');
  call('tab.reorder', { tabIds: rest });
} else if (domain === 'members' && cmd === 'list') {
  call('members.list');
} else if (domain === 'agent' && cmd === 'list-available') {
  call('agent.list_available');
} else if (domain === 'agent' && cmd === 'add') {
  if (!rest[0]) die('agentNameOrId is required');
  const opts = parseNamedOptions(rest.slice(1));
  call('agent.add', { agent: rest[0], roomRole: opts.roomRole || opts.role, autoEnabled: opts.autoEnabled === 'true', priority: opts.priority });
} else if (domain === 'agent' && (cmd === 'create-request' || cmd === 'create')) {
  if (!rest[0]) die('agent name is required');
  const opts = parseNamedOptions(rest.slice(1));
  const specialties = opts.specialties ? String(opts.specialties).split(',').map(s => s.trim()).filter(Boolean) : [];
  call('agent.create_request', { name: rest[0], description: opts.description || opts.desc, specialties, roleType: opts.roleType || opts.role || 'specialist', roomRole: opts.roomRole || 'specialist', autoEnabled: opts.autoEnabled === 'true', priority: opts.priority });
} else if (domain === 'agent' && cmd === 'create-json') {
  if (!rest[0]) die('localJsonPath is required');
  call('agent.create_request', JSON.parse(readLocalFile(rest[0])));
} else if (domain === 'room' && cmd === 'info') {
  call('room.info');
} else if (domain === 'interaction' && ['confirm', 'choice', 'multi_choice'].includes(cmd)) {
  if (!rest[0]) die('title is required');
  const options = cmd === 'confirm' ? [{value:'confirm',label:'确认',style:'primary'},{value:'cancel',label:'取消',style:'secondary'}] : (rest[1]||'').split('|').filter(Boolean).map((v,i)=>({value:'opt'+(i+1),label:v}));
  const desc = cmd === 'confirm' ? rest.slice(1).join(' ') : rest.slice(2).join(' ');
  call('interaction.create', { type: cmd, title: rest[0], description: desc || undefined, options });
} else if (domain === 'interaction' && cmd === 'list') {
  call('interaction.list', { status: rest[0] || 'pending' });
} else if (domain === 'interaction' && cmd === 'consume') {
  if (!rest[0]) die('interactionId is required');
  call('interaction.consume', { id: rest[0] });
} else if (domain === 'interaction' && cmd === 'create-json') {
  if (!rest[0]) die('localJsonPath is required');
  call('interaction.create', JSON.parse(readLocalFile(rest[0])));
} else if (domain === 'interaction' && cmd === 'show') {
  if (!rest[0]) die('interactionId is required');
  call('interaction.get', { id: rest[0] });
} else if (domain === 'raw') {
  call(cmd, rest[0] ? JSON.parse(rest[0]) : {});
} else {
  die('Unknown command: ' + [domain, cmd].filter(Boolean).join(' '));
}
`
}
