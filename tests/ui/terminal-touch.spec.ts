import { test, expect, type Page, type APIRequestContext, type CDPSession } from '@playwright/test';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

/**
 * The terminal on a phone: the touch key toolbar appears by itself, swipes
 * scroll the tmux scrollback, a long-press selects a word that can be copied,
 * and a pinch changes the font size. Touches are real CDP touch events in an
 * emulated touch device.
 */
test.describe.serial('Terminal on touch devices', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  let containerId: string;
  let displayName: string;
  let mainIndex: number;

  async function tmux(request: APIRequestContext, args: string): Promise<string> {
    const api = new ApiClient(request);
    const { status, body } = await api.execCommand(containerId, { command: `tmux ${args}` });
    expect(status).toBe(200);
    return String(body.stdout ?? '').trim();
  }

  async function capture(request: APIRequestContext): Promise<string> {
    const api = new ApiClient(request);
    const { body } = await api.captureTmuxWindow(containerId, mainIndex, 500);
    return String(body.content ?? '');
  }

  async function typeCommand(request: APIRequestContext, text: string) {
    const api = new ApiClient(request);
    const { status } = await api.sendTmuxKeys(containerId, mainIndex, { text, enter: true });
    expect(status).toBe(200);
  }

  async function openTerminal(page: Page) {
    await page.goto('/');
    const expand = page.locator('button[title="Expand sidebar"]');
    await expect(expand).toBeVisible({ timeout: 15_000 });
    await expand.tap();
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await card.locator('button').first().tap();
    const screen = page.locator('.terminal-surface .xterm-screen').first();
    await expect(screen).toBeVisible({ timeout: 15_000 });
    // Opening a pane closes the phone sidebar overlay.
    await expect(page.locator('.sidebar-backdrop')).toBeHidden();
    const box = (await screen.boundingBox())!;
    const rows = await page.locator('.terminal-surface .xterm-rows').first().locator('> div').count();
    return { box, rowH: box.height / Math.max(1, rows) };
  }

  type Point = { x: number; y: number };

  async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ x: Math.round(p.x), y: Math.round(p.y), id })),
    });
  }

  /** One-finger vertical swipe from `from` by `dy` pixels in small steps. */
  async function swipe(cdp: CDPSession, from: Point, dy: number) {
    await touch(cdp, 'touchStart', [from]);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await touch(cdp, 'touchMove', [{ x: from.x, y: from.y + (dy * i) / steps }]);
    }
    await touch(cdp, 'touchEnd', []);
  }

  test.beforeAll(async ({ request }) => {
    displayName = `TermTouch-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
    const api = new ApiClient(request);
    // The boot loading screen is a bash script too: wait for the respawned
    // init pane (`bash /home/agent/init.sh`) showing a prompt.
    await expect.poll(async () => {
      const { status, body } = await api.listPanes(containerId);
      if (status !== 200) return false;
      const main = (body as { index: number; name: string }[]).find((w) => w.name === 'main');
      if (!main) return false;
      mainIndex = main.index;
      const { body: out } = await api.execCommand(containerId, {
        command: `tmux display -p -t main:${main.index} '#{pane_start_command}|#{pane_current_command}'`,
      });
      const [start, current] = String(out.stdout ?? '').trim().split('|');
      if (!start?.includes('init.sh') || current !== 'bash') return false;
      return /\$\s*$/.test(await capture(request));
    }, { timeout: 120_000, intervals: [1000, 2000] }).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    if (containerId) await cleanupWorker(request, containerId);
  });

  test('touch key toolbar is shown automatically on touch devices', async ({ page }) => {
    await openTerminal(page);
    const toolbar = page.getByTestId('terminal-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Show keyboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide touch keys' })).toHaveAttribute('aria-pressed', 'true');
    // Opening the pane does not focus xterm on touch (that would pop up the soft keyboard).
    await expect(page.locator('.xterm-helper-textarea').first()).not.toBeFocused();
  });

  test('swiping down scrolls the tmux scrollback', async ({ page, request }) => {
    const { box, rowH } = await openTerminal(page);
    await typeCommand(request, 'clear; seq 7000 7300');
    await expect.poll(() => capture(request), { timeout: 15_000 }).toMatch(/^7299$/m);
    await expect.poll(() => tmux(request, `display -p -t main:${mainIndex} '#{pane_in_mode}'`)).toBe('0');

    const cdp = await page.context().newCDPSession(page);
    // Finger moves down = look at older output = wheel up (first report
    // enters copy-mode, the following ones scroll).
    await swipe(cdp, { x: box.x + box.width / 2, y: box.y + rowH * 3 }, rowH * 20);
    await expect.poll(() => tmux(request, `display -p -t main:${mainIndex} '#{pane_in_mode}'`)).toBe('1');
    await swipe(cdp, { x: box.x + box.width / 2, y: box.y + rowH * 3 }, rowH * 20);
    await expect.poll(async () => Number(await tmux(request, `display -p -t main:${mainIndex} '#{scroll_position}'`)))
      .toBeGreaterThan(0);

    await tmux(request, `send-keys -t main:${mainIndex} -X cancel 2>/dev/null; true`);
  });

  test('long-press selects the word under the finger and Copy puts it on the clipboard', async ({ page, request }) => {
    const { box, rowH } = await openTerminal(page);
    await typeCommand(request, 'clear; echo "LONGPRESS-$((5*5))"');
    await expect.poll(() => capture(request), { timeout: 15_000 }).toMatch(/^LONGPRESS-25$/m);
    await page.evaluate(() => navigator.clipboard.writeText(''));

    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + 6, y: box.y + rowH * 0.5 };
    await touch(cdp, 'touchStart', [point]);
    // Hold longer than the 450 ms long-press threshold.
    await page.waitForTimeout(800);
    await touch(cdp, 'touchEnd', []);

    const actions = page.getByTestId('terminal-selection-actions');
    await expect(actions).toBeVisible();
    await actions.getByRole('button', { name: 'Copy' }).tap();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('LONGPRESS-25');
    await expect(actions).toBeHidden();
  });

  test('pinching out enlarges the font and persists it', async ({ page }) => {
    const { box } = await openTerminal(page);
    const fontSize = () => page.evaluate(() => JSON.parse(localStorage.getItem('agentor-ui-state') || '{}').terminal?.fontSize ?? null);
    const before = (await fontSize()) ?? 12;

    const cdp = await page.context().newCDPSession(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await touch(cdp, 'touchStart', [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }]);
    for (let i = 1; i <= 10; i++) {
      await touch(cdp, 'touchMove', [{ x: cx - 30 - i * 8, y: cy }, { x: cx + 30 + i * 8, y: cy }]);
    }
    await touch(cdp, 'touchEnd', []);

    await expect.poll(fontSize).toBeGreaterThan(before);
  });
});
