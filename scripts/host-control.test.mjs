import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Element {
  constructor(tag, cls, text) {
    this.tag = tag;
    this.cls = cls;
    this.textContent = text || '';
    this.value = '';
    this.children = [];
    this.classList = { add: () => {} };
  }
  append(...items) {
    this.children.push(...items);
  }
  replaceChildren(...items) {
    this.children = [...items];
  }
  setAttribute(key, value) {
    this[key] = value;
  }
}
function mountHost(routes) {
  const providers = {};
  const calls = [];
  const elements = [];
  const window = {
    HyprlandUtil: {
      node: (tag, cls, value) => {
        const el = new Element(tag, cls, value);
        elements.push(el);
        return el;
      },
      button: (name, run) => {
        const el = new Element('button', '', name);
        el.run = run;
        elements.push(el);
        return el;
      },
    },
    HyprlandApps: {
      provide: (key, provider) => {
        providers[key] = provider;
      },
    },
  };
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const name = url.split('?')[0];
    const value = routes[name] || {};
    return { ok: true, json: async () => value };
  };
  runInNewContext(readFileSync('public/host-control.js', 'utf8'), {
    window,
    fetch,
    encodeURIComponent,
  });
  return { providers, calls, elements };
}
const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
};

test('Applications searches desktop entries and launches selected desktop ID', async () => {
  const { providers, calls } = mountHost({
    '/api/host/apps': { apps: [{ id: 'org.gnome.Nautilus.desktop', name: 'Files' }] },
    '/api/host/apps/launch': { requested: true },
  });
  const root = new Element('div');
  const app = providers['host-apps'].create(root);
  app.search.value = 'file';
  await app.refresh();
  assert.equal(calls[0].url, '/api/host/apps?q=file');
  assert.equal(app.results.children[0].textContent, 'Files');
  await app.results.children[0].run();
  const launched = calls.find(item => item.url.endsWith('/apps/launch'));
  assert.equal(JSON.parse(launched.options.body).id, 'org.gnome.Nautilus.desktop');
  assert.equal(launched.options.method, 'POST');
  assert.match(app.status.textContent, /Launch requested/);
  app.dispose();
});

test('KDE Connect card reads status and sends a selected home file through the gateway', async () => {
  const { providers, calls } = mountHost({
    '/api/host/connect/status': {
      gsconnect: false,
      kdeconnect_cli: true,
      devices: 'Phone: abcdef',
      wdotool: true,
    },
    '/api/host/connect/send': { requested: true },
  });
  const root = new Element('div');
  const app = providers['kde-connect'].create(root);
  app.connect();
  await settle();
  assert.match(app.status.textContent, /CLI detected/);
  app.device.value = 'abcdef';
  app.path.value = '/home/user/report.txt';
  await app.command('connect/send', { device: app.device.value, path: app.path.value });
  const sent = calls.find(item => item.url.endsWith('/connect/send'));
  assert.deepEqual(JSON.parse(sent.options.body), {
    device: 'abcdef',
    path: '/home/user/report.txt',
  });
  app.dispose();
});

const pointer = (pointerId, clientX, clientY) => ({
  pointerId,
  clientX,
  clientY,
  pointerType: 'touch',
  button: 0,
  preventDefault() {},
});

test('embedded touchpad moves, clicks and scrolls using bounded host events', async () => {
  const { providers, calls } = mountHost({
    '/api/host/connect/status': {
      gsconnect: true,
      kdeconnect_cli: true,
      wdotool: true,
      devices: 'iPhone: paired',
    },
    '/api/host/input/event': { requested: true },
  });
  const app = providers['kde-connect'].create(new Element('div'));
  await app.refresh();
  assert.equal(app.touchpad.ready, true);
  const pad = app.touchpad.pad;
  pad.onpointerdown(pointer(1, 10, 15));
  pad.onpointermove(pointer(1, 30, 40));
  pad.onpointerup(pointer(1, 30, 40));
  await settle();
  pad.onpointerdown(pointer(2, 10, 10));
  pad.onpointerup(pointer(2, 10, 10));
  await settle();
  pad.onpointerdown(pointer(3, 10, 10));
  pad.onpointerdown(pointer(4, 20, 20));
  pad.onpointermove(pointer(3, 10, 70));
  pad.onpointerup(pointer(3, 10, 70));
  pad.onpointerup(pointer(4, 20, 20));
  await settle();
  pad.onpointerdown(pointer(5, 10, 10));
  pad.onpointerdown(pointer(6, 20, 20));
  pad.onpointerup(pointer(5, 10, 10));
  pad.onpointerup(pointer(6, 20, 20));
  await settle();
  const events = calls
    .filter(call => call.url === '/api/host/input/event')
    .map(call => JSON.parse(call.options.body));
  assert.deepEqual(events[0], { action: 'move', dx: 30, dy: 38 });
  assert.ok(events.some(event => event.action === 'click' && event.button === 'left'));
  assert.ok(events.some(event => event.action === 'scroll' && event.dy > 0));
  assert.ok(events.some(event => event.action === 'click' && event.button === 'right'));
  app.dispose();
});

test('touchpad is disabled when host does not advertise safe Wayland input', async () => {
  const { providers, calls } = mountHost({
    '/api/host/connect/status': { wdotool: false, gsconnect: true },
  });
  const app = providers['kde-connect'].create(new Element('div'));
  await app.refresh();
  app.touchpad.pad.onpointerdown(pointer(1, 10, 20));
  app.touchpad.pad.onpointerup(pointer(1, 10, 20));
  await settle();
  assert.equal(app.touchpad.ready, false);
  assert.equal(calls.filter(call => call.url === '/api/host/input/event').length, 0);
  app.dispose();
});
test('app catalog no longer exposes Corral but retains Fedora controls and assistant apps', () => {
  const window = {};
  runInNewContext(readFileSync('public/apps.js', 'utf8'), {
    window,
    localStorage: { getItem: () => null },
    document: { dispatchEvent() {} },
  });
  const apps = window.HyprlandApps;
  assert.equal(apps.get('corral'), null);
  assert.ok(!apps.DEFAULT_PINS.includes('corral'));
  for (const key of [
    'host-apps',
    'kde-connect',
    'terminal',
    'files',
    'herdr',
    'muster',
    'chat',
    'canvas',
  ]) {
    assert.ok(apps.get(key), `Missing app: ${key}`);
  }
  assert.ok(!readFileSync('public/index.html', 'utf8').includes('/corral.js'));
});
