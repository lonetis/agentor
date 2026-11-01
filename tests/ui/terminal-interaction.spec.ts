import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { goToDashboard } from '../helpers/ui-helpers';
import { createWorker, cleanupWorker } from '../helpers/worker-lifecycle';
import { ApiClient } from '../helpers/api-client';

/**
 * Terminal interaction in the browser: selection, clipboard, wheel scrollback,
 * the touch key toolbar, the composer and the text view.
 *
 * Assertions read back what the *shell computed* (via the capture API), never a
 * literal that is also part of the typed command line (the shell echoes it).
 */
test.describe.serial('Terminal interaction', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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

  async function leaveCopyMode(request: APIRequestContext) {
    await tmux(request, `send-keys -t main:${mainIndex} -X cancel 2>/dev/null; true`);
  }

  async function openTerminal(page: Page) {
    await goToDashboard(page);
    const card = page.locator('.rounded-lg').filter({ hasText: displayName }).first();
    await expect(card.locator('text=running')).toBeVisible({ timeout: 60_000 });
    await card.locator('button').first().click();
    const screen = page.locator('.terminal-surface .xterm-screen').first();
    await expect(screen).toBeVisible({ timeout: 15_000 });
    return screen;
  }

  /** Geometry of the visible terminal: screen box + row height. */
  async function screenGeometry(page: Page) {
    const screen = page.locator('.terminal-surface .xterm-screen').first();
    const box = (await screen.boundingBox())!;
    const rows = await page.locator('.terminal-surface .xterm-rows').first().locator('> div').count();
    return { box, rowH: box.height / Math.max(1, rows) };
  }

  async function showToolbar(page: Page) {
    const toggle = page.getByRole('button', { name: /touch keys/ });
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    const toolbar = page.getByTestId('terminal-toolbar');
    await expect(toolbar).toBeVisible();
    return toolbar;
  }

  test.beforeAll(async ({ request }) => {
    displayName = `TermIx-${Date.now()}`;
    const container = await createWorker(request, { displayName });
    containerId = container.id;
    const api = new ApiClient(request);
    // Wait for the main window to run its interactive shell. The boot loading
    // screen is a bash script too, so wait for the respawned init pane
    // (`bash /home/agent/init.sh`) showing a prompt.
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

  test('selection survives mouse movement while the app tracks all mouse motion', async ({ page, request }) => {
    const screen = await openTerminal(page);
    // Ask (through tmux) for any-motion mouse tracking — the mode that used to
    // report every mouse move as input and wipe the selection.
    await typeCommand(request, `clear; printf '\\033[?1003h'; for i in 1 2 3 4 5 6; do echo "SEL-$((i*11))"; done`);
    await expect.poll(() => capture(request), { timeout: 15_000 }).toContain('SEL-66');
    await expect.poll(() => tmux(request, `display -p -t main:${mainIndex} '#{mouse_any_flag}'`)).toBe('1');

    const { box, rowH } = await screenGeometry(page);
    await page.mouse.move(box.x + 2, box.y + rowH * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + rowH * 3.5, { steps: 8 });
    await page.mouse.up();

    const selection = page.locator('.terminal-surface .xterm-selection div');
    await expect(selection.first()).toBeVisible();

    // Hover all over the terminal — the selection must stay.
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(box.x + (box.width * (i + 1)) / 12, box.y + (box.height * ((i % 5) + 1)) / 7, { steps: 3 });
    }
    await expect(selection.first()).toBeVisible();

    // Copy through the context menu and read the clipboard back.
    await page.mouse.click(box.x + box.width * 0.3, box.y + rowH * 1.5, { button: 'right' });
    const copyItem = page.getByRole('menuitem', { name: /^Copy/ });
    await expect(copyItem).toBeEnabled();
    await copyItem.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/SEL-\d\d/);

    await typeCommand(request, `printf '\\033[?1003l'`);
  });

  test('Ctrl+Shift+C copies the selection and Ctrl+C without a selection still interrupts', async ({ page, request }) => {
    const screen = await openTerminal(page);
    await typeCommand(request, 'clear; echo "KEYCOPY-$((7*6))"');
    await expect.poll(() => capture(request), { timeout: 15_000 }).toContain('KEYCOPY-42');

    await page.evaluate(() => navigator.clipboard.writeText(''));
    const { box, rowH } = await screenGeometry(page);
    await page.mouse.move(box.x + 2, box.y + rowH * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + rowH * 0.5, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press('Control+Shift+C');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('KEYCOPY-42');

    // No selection now: Ctrl+C interrupts a running command.
    await typeCommand(request, 'sleep 120');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('Control+C');
    await typeCommand(request, 'echo "INT-$((50+5))"');
    await expect.poll(() => capture(request), { timeout: 10_000 }).toMatch(/^INT-55$/m);
  });

  test('mouse wheel scrolls the tmux scrollback', async ({ page, request }) => {
    const screen = await openTerminal(page);
    await typeCommand(request, 'clear; seq 5000 5300');
    await expect.poll(() => capture(request), { timeout: 15_000 }).toMatch(/^5299$/m);
    await expect.poll(() => tmux(request, `display -p -t main:${mainIndex} '#{pane_in_mode}'`)).toBe('0');

    const box = (await screen.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // tmux: the first wheel-up report enters copy-mode, later ones scroll.
    await page.mouse.wheel(0, -800);
    await expect.poll(() => tmux(request, `display -p -t main:${mainIndex} '#{pane_in_mode}'`)).toBe('1');
    await page.mouse.wheel(0, -800);
    await page.mouse.wheel(0, -800);
    await expect.poll(async () => Number(await tmux(request, `display -p -t main:${mainIndex} '#{scroll_position}'`)))
      .toBeGreaterThan(0);

    await leaveCopyMode(request);
  });

  test('touch key toolbar: Ctrl latch and history navigation', async ({ page, request }) => {
    const screen = await openTerminal(page);
    const toolbar = await showToolbar(page);

    // Ctrl (latched) + c typed on the keyboard → interrupt.
    await typeCommand(request, 'sleep 120');
    const ctrl = toolbar.locator('[data-key="ctrl"]');
    await ctrl.click();
    await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
    const box = (await screen.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.type('c');
    await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
    await typeCommand(request, 'echo "LATCH-$((60+6))"');
    await expect.poll(() => capture(request), { timeout: 10_000 }).toMatch(/^LATCH-66$/m);

    // Up arrow recalls the previous command; running it again prints twice.
    await typeCommand(request, 'echo "HIST-$((20+3))"');
    await expect.poll(async () => (await capture(request)).match(/^HIST-23$/gm)?.length ?? 0, { timeout: 10_000 }).toBe(1);
    await toolbar.locator('[data-key="up"]').click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await capture(request)).match(/^HIST-23$/gm)?.length ?? 0, { timeout: 10_000 }).toBe(2);
  });

  test('composer sends text and Enter; text view shows the scrollback', async ({ page, request }) => {
    await openTerminal(page);
    const toolbar = await showToolbar(page);

    await toolbar.getByRole('button', { name: 'Compose text' }).click();
    const composer = page.getByTestId('terminal-composer');
    await expect(composer).toBeVisible();
    await composer.getByRole('textbox').fill('echo "COMPOSED-$((6*7))"');
    await composer.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => capture(request), { timeout: 10_000 }).toMatch(/^COMPOSED-42$/m);
    await composer.getByRole('button', { name: 'Close composer' }).click();
    await expect(composer).toBeHidden();

    await toolbar.getByRole('button', { name: 'Select text' }).click();
    const view = page.getByTestId('terminal-text-view');
    await expect(view).toBeVisible();
    await expect(view.locator('pre')).toContainText('COMPOSED-42');
    await view.getByRole('button', { name: 'Close text view' }).click();
    await expect(view).toBeHidden();
  });

  test('font size changes from the context menu persist', async ({ page }) => {
    const screen = await openTerminal(page);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('agentor-ui-state') || '{}').terminal?.fontSize ?? null);
    const box = (await screen.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Larger font' }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('agentor-ui-state') || '{}').terminal?.fontSize ?? null))
      .toBe((before ?? 14) + 1);

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Reset font size' }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('agentor-ui-state') || '{}').terminal?.fontSize ?? 'unset'))
      .toBe('unset');
  });
});
