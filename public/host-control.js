/* Fedora app launcher and KDE Connect companion; GNOME's input security is preserved. */
(() => {
  const { node, button } = window.HyprlandUtil;
  const request = async (path, data) => {
    const response = await fetch('/api/host/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        'X-Hyprland-Client': '1',
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Host unavailable');
    return result;
  };
  class HostApps {
    constructor(root) {
      this.root = root;
      root.classList.add('host-control');
      this.search = node('input', 'host-control-input');
      this.search.type = 'search';
      this.search.placeholder = 'Search installed Fedora applications…';
      this.search.setAttribute('aria-label', 'Search installed applications');
      this.search.oninput = () => this.refresh();
      this.status = node('p', 'host-control-status', 'Loading…');
      this.results = node('div', 'host-control-list');
      root.append(this.search, this.status, this.results);
    }
    async refresh() {
      const query = this.search.value;
      try {
        const { apps } = await request('apps?q=' + encodeURIComponent(query));
        if (this.disposed || query !== this.search.value) return;
        this.results.replaceChildren();
        for (const app of apps) {
          const element = button(
            app.name,
            async () => {
              try {
                await request('apps/launch', { id: app.id });
                this.status.textContent = 'Launch requested: ' + app.name;
              } catch (error) {
                this.status.textContent = error.message;
              }
            },
            'host-control-item'
          );
          element.title = app.id;
          this.results.append(element);
        }
        this.status.textContent = apps.length + ' applications';
      } catch (error) {
        this.status.textContent = error.message;
      }
    }
    connect() {
      this.refresh();
    }
    resume() {
      this.refresh();
    }
    dispose() {
      this.disposed = true;
    }
  }
  class Touchpad {
    constructor() {
      this.ready = false;
      this.disposed = false;
      this.pointers = new Map();
      this.queue = [];
      this.running = false;
      this.scrollRemainder = 0;
      this.root = node('section', 'host-touchpad-panel');
      this.root.append(node('h3', 'host-touchpad-title', 'Touchpad'));
      this.pad = node('div', 'host-touchpad-surface');
      this.pad.tabIndex = 0;
      this.pad.setAttribute('role', 'application');
      this.pad.setAttribute('aria-label', 'Remote Fedora touchpad');
      this.pad.append(
        node('span', 'host-touchpad-label', 'Move pointer'),
        node('span', 'host-touchpad-hint', 'Tap · click  |  Two fingers · scroll / right click')
      );
      this.pad.oncontextmenu = event => event.preventDefault();
      this.pad.onpointerdown = event => this.pointerDown(event);
      this.pad.onpointermove = event => this.pointerMove(event);
      this.pad.onpointerup = event => this.pointerEnd(event, false);
      this.pad.onpointercancel = event => this.pointerEnd(event, true);
      this.pad.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.enqueue({ action: 'click', button: 'left' });
        }
      };
      const actions = node('div', 'host-control-actions');
      this.actions = actions;
      actions.append(
        button('Left click', () => this.enqueue({ action: 'click', button: 'left' })),
        button('Right click', () => this.enqueue({ action: 'click', button: 'right' })),
        button('Scroll up', () => this.enqueue({ action: 'scroll', dx: 0, dy: -3 })),
        button('Scroll down', () => this.enqueue({ action: 'scroll', dx: 0, dy: 3 }))
      );
      this.message = node('p', 'host-control-help', 'Checking touchpad availability…');
      this.root.append(this.pad, actions, this.message);
      this.setReady(false);
    }
    setReady(ready) {
      this.ready = ready;
      this.pad.setAttribute('aria-disabled', String(!ready));
      for (const control of this.actions.querySelectorAll?.('button') || []) {
        control.disabled = !ready;
      }
      this.message.textContent = ready
        ? 'Input uses the host RemoteDesktop portal. Approve its first permission prompt on Fedora.'
        : 'Touchpad needs wdotool on Fedora. KDE Connect Remote Input remains available separately.';
    }
    enqueue(event) {
      if (!this.ready || this.disposed) return;
      const last = this.queue[this.queue.length - 1];
      if (
        last &&
        last.action === event.action &&
        (event.action === 'move' || event.action === 'scroll')
      ) {
        last.dx = Math.max(-150, Math.min(150, last.dx + event.dx));
        last.dy = Math.max(-150, Math.min(150, last.dy + event.dy));
      } else {
        if (this.queue.length >= 64) {
          const stale = this.queue.findIndex(
            pending => pending.action === 'move' || pending.action === 'scroll'
          );
          if (stale === -1) return;
          this.queue.splice(stale, 1);
        }
        this.queue.push(event);
      }
      if (!this.running) void this.flush();
    }
    async flush() {
      this.running = true;
      while (this.queue.length && !this.disposed && this.ready) {
        const event = this.queue.shift();
        try {
          await request('input/event', event);
        } catch (error) {
          if (!this.disposed) this.message.textContent = 'Touchpad: ' + error.message;
          this.queue.length = 0;
          break;
        }
      }
      this.running = false;
    }
    pointerDown(event) {
      if (!this.ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      if (!this.pointers.size) {
        this.gesture = { started: Date.now(), multi: false, moved: false };
        this.scrollRemainder = 0;
      }
      this.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
      });
      if (this.pointers.size > 1) this.gesture.multi = true;
      try {
        this.pad.setPointerCapture?.(event.pointerId);
      } catch {
        // A cancelled/synthetic pointer may no longer be capturable.
      }
    }
    pointerMove(event) {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer || !this.ready) return;
      event.preventDefault();
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 8) {
        this.gesture.moved = true;
      }
      if (this.gesture.multi) {
        this.scrollRemainder += dy / 22;
        const units = Math.trunc(this.scrollRemainder);
        if (units) {
          this.scrollRemainder -= units;
          this.enqueue({ action: 'scroll', dx: 0, dy: Math.max(-8, Math.min(8, units)) });
        }
      } else {
        const x = Math.max(-120, Math.min(120, Math.round(dx * 1.5)));
        const y = Math.max(-120, Math.min(120, Math.round(dy * 1.5)));
        if (x || y) this.enqueue({ action: 'move', dx: x, dy: y });
      }
    }
    pointerEnd(event, cancelled) {
      if (!this.pointers.has(event.pointerId)) return;
      event.preventDefault();
      this.pointers.delete(event.pointerId);
      if (this.pad.hasPointerCapture?.(event.pointerId)) {
        this.pad.releasePointerCapture(event.pointerId);
      }
      if (!this.pointers.size) {
        if (!cancelled && !this.gesture.moved && Date.now() - this.gesture.started < 450) {
          this.enqueue({ action: 'click', button: this.gesture.multi ? 'right' : 'left' });
        }
        this.gesture = null;
      } else if (cancelled) {
        this.gesture.moved = true;
      }
    }
    dispose() {
      this.disposed = true;
      this.pointers.clear();
      this.queue.length = 0;
    }
  }
  class ConnectApp {
    constructor(root) {
      this.root = root;
      root.classList.add('host-control');
      this.status = node('p', 'host-control-status', 'Checking KDE Connect…');
      this.description = node('p', 'host-control-help');
      this.touchpad = new Touchpad();
      this.devices = node('pre', 'host-control-devices');
      this.device = node('input', 'host-control-input');
      this.device.placeholder = 'Device ID (kdeconnect-cli)';
      this.device.setAttribute('aria-label', 'KDE Connect device ID');
      this.path = node('input', 'host-control-input');
      this.path.placeholder = 'Fedora file path to send';
      this.path.setAttribute('aria-label', 'Fedora file path');
      const actions = node('div', 'host-control-actions');
      actions.append(
        button('Refresh', () => this.refresh()),
        button('Pair', () => this.command('connect/pair', { device: this.device.value })),
        button('Send file', () =>
          this.command('connect/send', { device: this.device.value, path: this.path.value })
        )
      );
      root.append(
        this.status,
        this.description,
        this.touchpad.root,
        this.devices,
        this.device,
        this.path,
        actions,
        node(
          'p',
          'host-control-help',
          'For another input option, pair KDE Connect for iPhone with GSConnect on Fedora and select Remote Input in the iPhone app. For iPhone → Fedora files, use Files here or Share in KDE Connect.'
        )
      );
    }
    async command(route, body) {
      try {
        await request(route, body);
        this.status.textContent = 'KDE Connect request sent';
      } catch (error) {
        this.status.textContent = error.message;
      }
    }
    async refresh() {
      try {
        const state = await request('connect/status');
        if (this.disposed) return;
        this.status.textContent = state.kdeconnect_cli
          ? 'KDE Connect CLI detected'
          : state.gsconnect
            ? 'GSConnect installed'
            : 'KDE Connect / GSConnect not found';
        this.description.textContent = state.kdeconnect_cli
          ? 'Paired devices (copy the device ID):'
          : 'On GNOME, pair with GSConnect through the desktop UI. Pair/send-file buttons need kdeconnect-cli; GSConnect has its own pairing and file-sharing interface.';
        this.devices.textContent = state.devices || 'No CLI device list';
        this.touchpad.setReady(Boolean(state.wdotool));
      } catch (error) {
        this.status.textContent = error.message;
      }
    }
    connect() {
      this.refresh();
    }
    resume() {
      this.refresh();
    }
    dispose() {
      this.disposed = true;
      this.touchpad.dispose();
    }
  }
  window.HyprlandApps?.provide('host-apps', { create: root => new HostApps(root) });
  window.HyprlandApps?.provide('kde-connect', { create: root => new ConnectApp(root) });
})();