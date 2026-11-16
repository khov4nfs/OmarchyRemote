import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.setContent('<main id="host"></main>');
  await page.evaluate(() => {
    window.__calls = [];
    window.__providers = {};
    window.HyprlandUtil = {
      node(tag, className, text) {
        const element = document.createElement(tag);
        element.className = className || '';
        if (text) element.textContent = text;
        return element;
      },
      button(label, action, className) {
        const element = document.createElement('button');
        element.className = className || '';
        element.textContent = label;
        element.addEventListener('click', action);
        return element;
      },
    };
    window.HyprlandApps = {
      provide(name, provider) {
        window.__providers[name] = provider;
      },
    };
    window.fetch = async (url, options = {}) => {
      window.__calls.push({ url, options });
      if (url.startsWith('/api/host/apps?')) {
        return {
          ok: true,
          json: async () => ({
            apps: [{ id: 'org.gnome.Nautilus.desktop', name: 'Files' }],
          }),
        };
      }
      if (url === '/api/host/connect/status') {
        return {
          ok: true,
          json: async () => ({
            kdeconnect_cli: true,
            gsconnect: true,
            wdotool: true,
            devices: 'iPhone: paired-device',
          }),
        };
      }
      return { ok: true, json: async () => ({ requested: true }) };
    };
  });
  await page.addScriptTag({ path: 'public/host-control.js' });
}

test('Fedora launcher searches and requests GNOME desktop launch', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.__providers['host-apps'].create(document.querySelector('#host')).connect();
  });
  await page.getByRole('searchbox', { name: 'Search installed applications' }).fill('Files');
  await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
  await page.getByRole('button', { name: 'Files' }).click();
  await expect(page.locator('.host-control-status')).toContainText('Launch requested: Files');
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.some(call => call.url === '/api/host/apps?q=Files')).toBe(true);
  const launch = calls.find(call => call.url === '/api/host/apps/launch');
  expect(launch.options.method).toBe('POST');
  expect(JSON.parse(launch.options.body)).toEqual({ id: 'org.gnome.Nautilus.desktop' });
});

test('KDE Connect card sends selected file through the host gateway', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.__providers['kde-connect'].create(document.querySelector('#host')).connect();
  });
  await expect(page.locator('.host-control-status')).toContainText('KDE Connect CLI detected');
  await page.getByRole('textbox', { name: 'KDE Connect device ID' }).fill('paired-device');
  await page.getByRole('textbox', { name: 'Fedora file path' }).fill('/home/user/sample.txt');
  await page.getByRole('button', { name: 'Send file' }).click();
  await expect(page.locator('.host-control-status')).toContainText('KDE Connect request sent');
  const calls = await page.evaluate(() => window.__calls);
  const send = calls.find(call => call.url === '/api/host/connect/send');
  expect(send.options.method).toBe('POST');
  expect(JSON.parse(send.options.body)).toEqual({
    device: 'paired-device',
    path: '/home/user/sample.txt',
  });
});
test('embedded phone touchpad sends a pointer move and left click', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.__providers['kde-connect'].create(document.querySelector('#host')).connect();
  });
  const pad = page.getByRole('application', { name: 'Remote Fedora touchpad' });
  await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await page.evaluate(() => {
    const pad = document.querySelector('.host-touchpad-surface');
    const fire = (name, x, y) =>
      pad.dispatchEvent(
        new PointerEvent(name, {
          bubbles: true,
          pointerId: 7,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
        })
      );
    fire('pointerdown', 30, 30);
    fire('pointermove', 50, 40);
    fire('pointerup', 50, 40);
  });
  await page.getByRole('button', { name: 'Left click' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__calls.filter(call => call.url === '/api/host/input/event').length
      )
    )
    .toBeGreaterThanOrEqual(2);
  const events = await page.evaluate(() =>
    window.__calls
      .filter(call => call.url === '/api/host/input/event')
      .map(call => JSON.parse(call.options.body))
  );
  expect(events).toContainEqual({ action: 'move', dx: 30, dy: 15 });
  expect(events).toContainEqual({ action: 'click', button: 'left' });
});

test('touchpad actions stay disabled without a host input backend', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const previous = window.fetch;
    window.fetch = (url, options) => {
      if (url === '/api/host/connect/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ gsconnect: true, kdeconnect_cli: false, wdotool: false }),
        });
      }
      return previous(url, options);
    };
    window.__providers['kde-connect'].create(document.querySelector('#host')).connect();
  });
  await expect(page.getByRole('application', { name: 'Remote Fedora touchpad' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Left click' })).toBeDisabled();
});