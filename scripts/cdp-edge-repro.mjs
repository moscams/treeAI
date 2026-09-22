/*
 * Throwaway CDP harness: opens the real app in headless Edge, seeds IndexedDB
 * with a session, then measures the gap between each edge's target endpoint and
 * the target node's top handle centre. Run with:
 *   node scripts/cdp-edge-repro.mjs
 * Assumes Edge is already listening on 127.0.0.1:9222 (the shell script starts it).
 */
const BASE = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:5175/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`${BASE}/json`)).json();
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('Could not find a page target');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, awaitPromise = false) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error('eval failed: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result.value;
  }
}

async function main() {
  const target = await getPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const goto = async (url) => {
    await cdp.send('Page.navigate', { url });
    await sleep(1500);
  };

  // 1. Load once so Dexie creates the object stores.
  await goto(APP);

  // Wipe a possibly-poisoned DB (created empty by a failed raw open) and let
  // the app recreate it through Dexie, then wait until the stores exist.
  await cdp.eval("indexedDB.deleteDatabase('TreeChatDatabase')");
  await sleep(500);
  await goto(APP);
  let stores = [];
  for (let i = 0; i < 20; i++) {
    stores = await cdp.eval(`new Promise((resolve) => {
      const req = indexedDB.open('TreeChatDatabase');
      req.onsuccess = () => { const db = req.result; const names = Array.from(db.objectStoreNames); db.close(); resolve(names); };
      req.onerror = () => resolve([]);
    })`, true);
    if (stores.includes('sessions') && stores.includes('models')) break;
    await sleep(300);
  }
  console.log('stores:', JSON.stringify(stores));

  // 2. Seed a model + session (raw IndexedDB, same DB name as the app).
  const seed = `new Promise((resolve) => {
    const req = indexedDB.open('TreeChatDatabase');
    req.onsuccess = () => {
      const db = req.result;
      const names = Array.from(db.objectStoreNames);
      if (!names.includes('sessions') || !names.includes('models')) {
        resolve('missing stores: ' + names.join(','));
        return;
      }
      const now = new Date().toISOString();
      const tx = db.transaction(['models', 'sessions'], 'readwrite');
      tx.objectStore('models').put({ id: 'm1', name: 'Test Model', baseUrl: 'http://localhost:1', apiKey: 'k', modelName: 'x', defaultSystemPrompt: 'sys', maxTokens: 8192, temperature: 0.7 });
      const sys = { id: 'sys', parentId: null, type: 'system', userMessage: 'system prompt', assistantMessage: '', modelId: 'm1', temperature: 0.7, maxTokens: 8192, createdAt: now };
      const child = { id: 'c1', parentId: 'sys', type: 'chat', userMessage: 'hello', assistantMessage: 'world', modelId: 'm1', temperature: 0.7, maxTokens: 8192, createdAt: now, position: { x: -280, y: 620 } };
      tx.objectStore('sessions').put({ id: 's1', title: 'Repro', createdAt: now, updatedAt: now, nodes: [sys, child] });
      tx.oncomplete = () => resolve('seeded');
      tx.onerror = () => resolve('tx-error: ' + tx.error);
    };
    req.onerror = () => resolve('open-error');
  })`;
  console.log('seed:', await cdp.eval(seed, true));

  // 3. Reload so the app loads the seeded data.
  await goto(APP);
  await sleep(1200);

  // Install a measurement helper in the page.
  await cdp.eval(`window.__gap = (edgeId, nodeId) => {
    const group = document.querySelector('[data-testid="rf__edge-' + edgeId + '"]');
    const path = group && group.querySelector('.react-flow__edge-path');
    const handle = document.querySelector('.react-flow__node[data-id="' + nodeId + '"] .react-flow__handle-top');
    if (!path || !handle) return null;
    const end = path.getPointAtLength(path.getTotalLength());
    const screen = end.matrixTransform(path.getScreenCTM());
    const rect = handle.getBoundingClientRect();
    return Math.hypot(screen.x - (rect.left + rect.width / 2), screen.y - (rect.top + rect.height / 2));
  };
  window.__edges = () => Array.from(document.querySelectorAll('.react-flow__edge')).map(g => g.getAttribute('data-testid'));
  'ok'`);

  const report = async (label) => {
    const out = await cdp.eval(`(() => {
      const groups = Array.from(document.querySelectorAll('.react-flow__edge'));
      const rows = [];
      for (const g of groups) {
        const testid = g.getAttribute('data-testid') || '';
        const edgeId = testid.replace('rf__edge-', '');
        const label = g.getAttribute('aria-label') || '';
        const m = label.match(/from (.+) to (.+)$/);
        const target = m ? m[2] : '?';
        const gap = window.__gap(edgeId, target);
        rows.push(edgeId.slice(0, 26) + ' -> ' + target.slice(0, 10) + ': ' + (gap === null ? 'NULL' : gap.toFixed(1) + 'px'));
      }
      return { count: document.querySelectorAll('.react-flow__node').length, rows };
    })()`);
    console.log(`\n[${label}] nodes=${out.count}`);
    out.rows.forEach((r) => console.log('  ' + r));
    return out;
  };

  await report('seeded, initial render');

  // 4. Click the system node's "+" to add a child (the reported repro).
  await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="sys"]');
    const btn = node && Array.from(node.querySelectorAll('button')).find(b => b.title === '添加子节点');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  // Sample the target gap *during* the entrance animation, not just after it.
  await sleep(60);
  await report('mid-animation ~60ms');
  await sleep(140);
  await report('mid-animation ~200ms');
  await sleep(900);
  await report('after animation');

  // 5. Click the new child node (selection) to see whether it recovers.
  await cdp.eval(`(() => {
    const node = document.querySelector('.react-flow__node[data-id="c1"]');
    if (node) { node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); node.click(); }
    return 'clicked';
  })()`);
  await sleep(600);
  await report('after clicking c1');

  ws.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
