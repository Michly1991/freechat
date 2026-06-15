import { api } from '../../lib/api'
import type { Tab } from '../room-page-model'

const BRIDGE_SCRIPT = `
<script>
(function () {
  function findAnchor(anchor) {
    if (!anchor) return null;
    try {
      return document.getElementById(anchor) || document.querySelector('[data-anchor="' + CSS.escape(anchor) + '"]') || document.querySelector('[name="' + CSS.escape(anchor) + '"]');
    } catch (_) {
      return document.getElementById(anchor) || document.querySelector('[data-anchor="' + String(anchor).replace(/"/g, '\\"') + '"]');
    }
  }
  function scrollToAnchor(anchor) {
    var el = findAnchor(anchor);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('[data-freechat-tab-id], [data-freechat-tab-title], [data-freechat-anchor]') : null;
    if (!link) return;
    var tabId = link.getAttribute('data-freechat-tab-id') || '';
    var title = link.getAttribute('data-freechat-tab-title') || '';
    var anchor = link.getAttribute('data-freechat-anchor') || '';
    if (!tabId && !title) return;
    event.preventDefault();
    parent.postMessage({ type: 'freechat.tab.open', tabId: tabId, title: title, anchor: anchor }, '*');
  });
  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'freechat.page.scrollTo') scrollToAnchor(data.anchor);
  });
})();
</script>`

const FILE_API_SCRIPT = `
<script>
(function () {
  window.freechat = window.freechat || {};
  if (!window.freechat.readFile) {
    window.freechat.readFile = function (path) {
      return new Promise(function (resolve, reject) {
        var requestId = 'fc_' + Date.now() + '_' + Math.random().toString(16).slice(2);
        function onMessage(event) {
          var data = event.data || {};
          if (data.type !== 'freechat.file.result' || data.requestId !== requestId) return;
          window.removeEventListener('message', onMessage);
          if (data.ok) resolve(data.content || '');
          else reject(new Error(data.error || '读取文件失败'));
        }
        window.addEventListener('message', onMessage);
        var attempts = 0;
        function sendRequest() {
          attempts += 1;
          parent.postMessage({ type: 'freechat.file.read', requestId: requestId, path: path }, '*');
          if (attempts < 20) window.setTimeout(sendRequest, 250);
          else window.setTimeout(function () {
            window.removeEventListener('message', onMessage);
            reject(new Error('读取超时：' + path));
          }, 260);
        }
        sendRequest();
      });
    };
  }
})();
</script>`

export function buildTabSrcDoc(content: string): string {
  let html = content || ''
  if (!html.includes('freechat.file.read')) {
    html = /<body[^>]*>/i.test(html)
      ? html.replace(/<body[^>]*>/i, (match) => `${match}${FILE_API_SCRIPT}`)
      : `${FILE_API_SCRIPT}${html}`
  }
  if (!(html.includes('freechat.tab.open') && html.includes('freechat.page.scrollTo'))) {
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${BRIDGE_SCRIPT}</body>`) : `${html}${BRIDGE_SCRIPT}`
  }
  return html
}

export function resolveTargetTab(tabs: Tab[], data: any): Tab | null {
  const tabId = typeof data?.tabId === 'string' ? data.tabId.trim() : ''
  const title = typeof data?.title === 'string' ? data.title.trim() : ''
  if (tabId) {
    const byId = tabs.find((tab) => tab.id === tabId)
    if (byId) return byId
  }
  if (title) {
    return tabs.find((tab) => (tab.title || tab.name || '').trim() === title) || null
  }
  return null
}

export async function handleFileReadMessage(roomId: string | undefined, iframe: HTMLIFrameElement | null, data: any) {
  if (!roomId || !iframe?.contentWindow || data?.type !== 'freechat.file.read') return
  const requestId = typeof data.requestId === 'string' ? data.requestId : ''
  const path = typeof data.path === 'string' ? data.path : ''
  if (!requestId || !path) return
  try {
    const result = await api.getFileContent(roomId, path)
    iframe.contentWindow.postMessage({ type: 'freechat.file.result', requestId, ok: true, content: result.content || '', path }, '*')
  } catch (err: any) {
    iframe.contentWindow.postMessage({ type: 'freechat.file.result', requestId, ok: false, error: err?.message || '读取文件失败', path }, '*')
  }
}
