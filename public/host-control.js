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
  class ConnectApp {
    constructor(root) {
      this.root = root;
      root.classList.add('host-control');
      this.status = node('p', 'host-control-status', 'Checking KDE Connect…');
      this.description = node('p', 'host-control-help');
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
        this.devices,
        this.device,
        this.path,
        actions,
        node(
          'p',
          'host-control-help',
          'Mouse and keyboard: pair KDE Connect for iPhone with GSConnect on Fedora, then select Remote Input in the iPhone app. For iPhone → Fedora files, use Files here or Share in KDE Connect.'
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
  window.HyprlandApps?.provide('host-apps', { create: root => new HostApps(root) });
  window.HyprlandApps?.provide('kde-connect', { create: root => new ConnectApp(root) });
})();
