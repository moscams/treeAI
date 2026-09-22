/*
 * Smoke check for the sidebar (folders, search, icon alignment) against the real
 * app in headless Edge. Requires Edge already listening on 127.0.0.1:9222 and the
 * Vite dev server on 127.0.0.1:5175. Run: node scripts/smoke-check.mjs
 */
const BASE = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:5175/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`${BASE}/json`)).json();
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('Could not find a page target');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression, awaitPromise = false) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(res.exceptionDetails));
    return res.result.value;
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || 'exception');
    }
  });

  const goto = async (url) => { await cdp.send('Page.navigate', { url }); await sleep(1800); };

  await goto(APP);
  await cdp.eval("indexedDB.deleteDatabase('TreeChatDatabase')");
  await sleep(500);
  await goto(APP);

  // wait for stores
  for (let i = 0; i < 20; i++) {
    const ok = await cdp.eval(`new Promise((resolve) => {
      const req = indexedDB.open('TreeChatDatabase');
      req.onsuccess = () => { const n = Array.from(req.result.objectStoreNames); req.result.close(); resolve(n.includes('sessions') && n.includes('models') && n.includes('folders')); };
      req.onerror = () => resolve(false);
    })`, true);
    if (ok) break;
    await sleep(300);
  }

  const seed = `new Promise((resolve) => {
    const req = indexedDB.open('TreeChatDatabase');
    req.onsuccess = () => {
      const db = req.result;
      const now = new Date().toISOString();
      const tx = db.transaction(['models', 'sessions', 'folders'], 'readwrite');
      tx.objectStore('models').put({ id: 'm1', name: 'Test', baseUrl: 'http://localhost:1', apiKey: 'k', modelName: 'x', defaultSystemPrompt: 'sys', maxTokens: 8192, temperature: 0.7, sortOrder: 0 });
      tx.objectStore('models').put({ id: 'm2', name: 'Second', baseUrl: 'http://localhost:2', apiKey: 'k', modelName: 'y', defaultSystemPrompt: 'sys2', maxTokens: 8192, temperature: 0.7, sortOrder: 1 });
      tx.objectStore('folders').put({ id: 'f1', name: '工作', createdAt: now });
      const n1 = { id: 'n1', parentId: null, type: 'system', userMessage: 'sys', assistantMessage: '', modelId: 'm1', temperature: 0.7, maxTokens: 8192, createdAt: now };
      const n2 = { id: 'n2', parentId: 'n1', type: 'chat', userMessage: '苹果香蕉', assistantMessage: 'orange', modelId: 'm1', temperature: 0.7, maxTokens: 8192, createdAt: now };
      tx.objectStore('sessions').put({ id: 's1', title: 'Alpha', createdAt: now, updatedAt: now, nodes: [n1, n2] });
      tx.objectStore('sessions').put({ id: 's2', title: 'Beta', createdAt: now, updatedAt: now, nodes: [], folderId: 'f1' });
      tx.oncomplete = () => resolve('seeded');
      tx.onerror = () => resolve('tx-error:' + tx.error);
    };
    req.onerror = () => resolve('open-error');
  })`;
  const seedRes = await cdp.eval(seed, true);
  check('seed IndexedDB', seedRes === 'seeded', seedRes);

  await goto(APP);
  await sleep(1000);

  const setSearch = async (value) => {
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder^="搜索"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
    await sleep(400);
  };

  const visibleTitles = () => cdp.eval(`Array.from(document.querySelectorAll('.sidebar-session span.text-sm')).map(e => e.textContent)`);

  // 1. All sessions visible by default
  let titles = await visibleTitles();
  check('默认「全部」显示两条会话', titles.includes('Alpha') && titles.includes('Beta'), JSON.stringify(titles));

  // 2. Folder chip exists
  const hasFolderChip = await cdp.eval(`Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '工作')`);
  check('文件夹 chip 渲染', hasFolderChip === true);

  // 3. Content search (Chinese, appears only in node text not title)
  await setSearch('香蕉');
  titles = await visibleTitles();
  check('中文内容搜索命中（正文“香蕉”）', titles.length === 1 && titles[0] === 'Alpha', JSON.stringify(titles));

  await setSearch('Beta');
  titles = await visibleTitles();
  check('标题搜索命中', titles.length === 1 && titles[0] === 'Beta', JSON.stringify(titles));

  await setSearch('');
  titles = await visibleTitles();

  // 4. Folder filter
  await cdp.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '工作').click()`);
  await sleep(400);
  titles = await visibleTitles();
  check('切到文件夹只显示该文件夹会话', titles.length === 1 && titles[0] === 'Beta', JSON.stringify(titles));

  await cdp.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '全部').click()`);
  await sleep(300);

  // 5. Icon alignment in search box
  const align = await cdp.eval(`(() => {
    const input = document.querySelector('input[placeholder^="搜索"]');
    const box = input.parentElement;
    const center = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const magnifier = box.querySelector('.lucide-search');
    const star = box.querySelector('.lucide-star');
    return { input: center(input), magnifier: center(magnifier), star: center(star) };
  })()`);
  const mDiff = Math.abs(align.magnifier - align.input);
  const sDiff = Math.abs(align.star - align.input);
  check('放大镜与输入框垂直居中 (<1.5px)', mDiff < 1.5, `Δ${mDiff.toFixed(2)}px`);
  check('收藏星与输入框垂直居中 (<1.5px)', sDiff < 1.5, `Δ${sDiff.toFixed(2)}px`);

  // 6. Default model = first in sorted order is verified by the unit-level
  // sortByOrder/badge logic; here we only assert the panel renders it.

  // 6. Auto-focus the input of a freshly added node.
  await cdp.eval(`(() => {
    const sys = document.querySelector('.react-flow__node[data-id="n1"]');
    const btn = sys && Array.from(sys.querySelectorAll('button')).find(b => b.title === '添加子节点');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(1200);
  const focusState = await cdp.eval(`(() => {
    const el = document.activeElement;
    const node = el && el.closest ? el.closest('.react-flow__node') : null;
    return { tag: el ? el.tagName : null, id: node ? node.getAttribute('data-id') : null, ph: el ? el.placeholder : null };
  })()`);
  check('新建子节点后光标直接在输入框里', focusState.tag === 'TEXTAREA', JSON.stringify(focusState));

  // 7. Ctrl+Enter 发送：要真的触发一次生成，并且退出编辑态（否则样式前后不一致）。
  const newNodeId = focusState.id;
  await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="${newNodeId}"]');
    const ta = node && node.querySelector('textarea');
    if (!ta) return 'no-textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '123');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(150);
  await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="${newNodeId}"]');
    const ta = node && node.querySelector('textarea');
    if (!ta) return 'no-textarea';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    return 'sent';
  })()`);
  await sleep(700);
  const afterSend = await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="${newNodeId}"]');
    return {
      hasTextarea: !!(node && node.querySelector('textarea')),
      text: node ? (node.textContent || '').slice(0, 40) : null,
    };
  })()`);
  check('Ctrl+Enter 发送后退出编辑态', afterSend.hasTextarea === false && (afterSend.text || '').includes('123'), JSON.stringify(afterSend));

  // 8. 编辑一个「已经有回答」的节点后发送 → 应该另起一个兄弟分支，旧回答保留。
  const beforeBranch = await cdp.eval(`document.querySelectorAll('.react-flow__node').length`);
  await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="n2"]');
    const div = node && node.querySelector('div.pr-8');
    if (div) div.click();
    return !!div;
  })()`);
  await sleep(250);
  await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="n2"]');
    const ta = node && node.querySelector('textarea');
    if (!ta) return 'no-ta';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '456');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(150);
  await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="n2"]');
    const ta = node && node.querySelector('textarea');
    if (ta) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    return !!ta;
  })()`);
  await sleep(800);
  const afterEdit = await cdp.eval(`(() => {
    const n2 = document.querySelector('.react-flow__node[data-id="n2"]');
    return {
      nodeCount: document.querySelectorAll('.react-flow__node').length,
      n2HasTextarea: !!document.querySelector('.react-flow__node[data-id="n2"] textarea'),
      n2Text: n2 ? n2.textContent : '',
    };
  })()`);
  check('编辑已有回答后发送：退出编辑并原地重出（不新增分支）',
    afterEdit.n2HasTextarea === false &&
    afterEdit.nodeCount === beforeBranch &&
    (afterEdit.n2Text || '').includes('456') &&
    !(afterEdit.n2Text || '').includes('orange'),
    JSON.stringify({ beforeBranch, ...afterEdit }));

  // 9. Models panel: first (sorted) model carries the 默认 badge and rows are draggable.
  await cdp.eval(`Array.from(document.querySelectorAll('button')).find(b => b.title === '设置').click()`);
  await sleep(900);
  const modelsPanel = await cdp.eval(`(() => {
    const modal = document.querySelector('.fixed.inset-0.z-50');
    if (!modal) return { error: 'no modal' };
    const rows = Array.from(modal.querySelectorAll('div[draggable="true"]'));
    return {
      count: rows.length,
      names: rows.map(r => (r.textContent || '').trim()),
      firstHasDefault: rows[0] ? (rows[0].textContent || '').includes('默认') : false,
      secondHasDefault: rows[1] ? (rows[1].textContent || '').includes('默认') : false,
    };
  })()`);
  check('模型列表可拖拽，仅第一项带「默认」徽标',
    modelsPanel.count === 2 && modelsPanel.firstHasDefault && !modelsPanel.secondHasDefault,
    JSON.stringify(modelsPanel));

  check('无运行时报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  ws.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
