'use strict';
// Optional browser regression suite. See docs/VALIDATION.md for setup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.UI_ARTIFACT_DIR || path.join(root, 'test-results/ui'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'balloon-browser-'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/game.json'), 'utf8'));
for (const theme of ['green', 'red']) config[theme].multiplier_growth_rate = .18;
fs.writeFileSync(path.join(temporary, 'game.json'), JSON.stringify(config));
fs.mkdirSync(artifacts, { recursive: true });
let server, browser, checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function run() {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const bundled = '/Applications/PyCharm CE.app/Contents/jbr/Contents/Home/bin/java';
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : fs.existsSync(bundled) ? bundled : 'java';
  server = spawn(java, ['--add-modules', 'jdk.httpserver', '-cp', 'build', 'balloon.Server'], {
    cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), GAME_CONFIG: path.join(temporary, 'game.json'), GAME_DATA: path.join(temporary, 'data'), GAME_DEV_MODE: '1', GAME_DEV_SEED: 'browser-suite', ADMIN_PASSWORD: 'browser-test-only' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  let ready = false;
  for (let i = 0; i < 70; i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try { ready = (await fetch(base + '/health')).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  check(ready, 'Isolated Java server starts');
  browser = await chromium.launch({ headless: true, ...(process.env.BALLOON_BROWSER_CHANNEL ? { channel: process.env.BALLOON_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForSelector('.bet-card');
  await page.evaluate(() => document.fonts.ready);
  check(await page.locator('body').getAttribute('data-design') === 'expanded', 'Design 2 is the default');

  for (const design of ['expanded', 'classic']) {
    for (const width of [320, 375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator(`[data-design-choice="${design}"]`).click();
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        titleFits: document.getElementById('sky-title').getBoundingClientRect().right <= document.querySelector('.flight-world').getBoundingClientRect().right,
        integrated: document.querySelector('.flight-panel').contains(document.getElementById('bet-panel')),
        controls: document.querySelectorAll('#start').length,
        boxes: ['.flight-panel', '#bet-panel'].map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right }; }),
      }));
      check(!metrics.overflow, `${design} fits ${width}px`);
      check(metrics.titleFits, `${design} field heading fits ${width}px`);
      check(metrics.boxes.every(box => box.left >= 0 && box.right <= width), `${design} cards stay inside ${width}px`);
      check(metrics.integrated === (design === 'expanded') && metrics.controls === 1, 'One functional stake panel moves between designs');
      await page.screenshot({ path: path.join(artifacts, `${design}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  await page.reload();
  await page.waitForSelector('.bet-card');
  check(await page.locator('body').getAttribute('data-design') === 'classic', 'Design preference survives reload');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('[data-design-choice="expanded"]').click();

  // All close paths preserve the native dialog until the exit animation ends.
  for (const [trigger, id, method] of [['#rules-open', 'rules-dialog', 'button'], ['#collection-open', 'collection-dialog', 'escape'], ['#leaderboard-open', 'leaderboard-dialog', 'backdrop'], ['#fair-open', 'fair-dialog', 'button']]) {
    await page.locator(trigger).click();
    await page.waitForFunction(id => document.getElementById(id).open, id);
    await page.waitForTimeout(270);
    check(await page.evaluate(() => !!document.activeElement.closest('dialog')), 'Focus is inside the opened dialog');
    await page.screenshot({ path: path.join(artifacts, `${id}.png`) });
    if (method === 'button') {
      const closing = await page.evaluate(id => {
        const d = document.getElementById(id); d.querySelector('[data-close]').click();
        return d.open && d.classList.contains('is-closing');
      }, id);
      check(closing, 'Close button runs exit animation before native close');
    } else if (method === 'escape') await page.keyboard.press('Escape');
    else await page.mouse.click(3, 3);
    await page.locator('#' + id).waitFor({ state: 'hidden' });
    check(await page.evaluate(() => !document.documentElement.classList.contains('has-dialog')), 'Page scroll unlocks after closing');
  }
  await page.locator('#rules-open').click();
  await page.evaluate(() => { const d = document.getElementById('rules-dialog'); dialogs.close(d); dialogs.open(d); });
  await page.waitForTimeout(300);
  check(await page.locator('#rules-dialog').evaluate(d => d.open && !d.classList.contains('is-closing')), 'Reopening cancels a pending close');
  await page.keyboard.press('Escape');
  await page.locator('#rules-dialog').waitFor({ state: 'hidden' });

  await page.setViewportSize({ width: 375, height: 700 });
  await page.locator('#rules-open').click();
  await page.waitForTimeout(270);
  const headerBefore = await page.locator('#rules-dialog .dialog-header').boundingBox();
  await page.locator('#rules-content').hover();
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(150);
  check(await page.locator('#rules-content').evaluate(e => e.scrollTop > 0), 'Long rules scroll on mobile');
  const headerAfter = await page.locator('#rules-dialog .dialog-header').boundingBox();
  check(Math.abs(headerAfter.y - headerBefore.y) < 1, 'Dialog header stays fixed while content scrolls');
  await page.screenshot({ path: path.join(artifacts, 'rules-mobile-scrolled.png') });
  await page.keyboard.press('Escape');
  await page.locator('#rules-dialog').waitFor({ state: 'hidden' });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#profile-open').click();
  await page.locator('#profile-name').fill('Проверка интерфейса');
  await page.locator('#profile-form [type="submit"]').click();
  await page.locator('#profile-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('player-name').textContent === 'Проверка интерфейса');
  check(true, 'Profile saves through animated close');

  for (const theme of ['green', 'red']) {
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await page.locator('.balloon-image-stack').screenshot({ path: path.join(artifacts, `balloon-${theme}.png`), animations: 'disabled' });
  }
  check(await page.locator('.balloon-art').evaluate(e => !getComputedStyle(e).filter.includes('hue-rotate')), 'Red mode never recolors the basket wrapper');
  const balloonImages = ['green', 'red'].map(theme => fs.readFileSync(path.join(artifacts, `balloon-${theme}.png`)).toString('base64'));
  const colorDifference = await page.evaluate(async images => {
    const samples = await Promise.all(images.map(async data => {
      const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(Math.floor(image.width * .46), Math.floor(image.height * .87), Math.floor(image.width * .08), Math.floor(image.height * .06)).data;
    }));
    return Math.max(...samples[0].map((value, i) => Math.abs(value - samples[1][i])));
  }, balloonImages);
  // Allow 8-bit rounding of the same translucent source over different skies.
  check(colorDifference <= 1, 'Basket colors match within one channel level');

  const api = async (route, data) => {
    const current = await (await context.request.get(base + '/api/state')).json();
    const response = await context.request.post(base + route, { data, headers: { 'X-CSRF-Token': current.csrf } });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  await api('/api/admin/login', { password: 'browser-test-only' });
  for (const [design, theme] of [['expanded', 'green'], ['classic', 'red']]) {
    await page.locator(`[data-design-choice="${design}"]`).click();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await api('/api/admin/scenario', { scenario: 'cashout' });
    await page.locator('.bet-card[data-tier="0"]').click();
    const fieldY = await page.locator('#sky').evaluate(e => e.getBoundingClientRect().top + scrollY);
    await page.locator('#start').click();
    await page.waitForFunction(() => !document.getElementById('cashout').hidden);
    const activeY = await page.locator('#sky').evaluate(e => e.getBoundingClientRect().top + scrollY);
    check(Math.abs(fieldY - activeY) < 1, `${design}: field does not move when a round starts`);
    await page.waitForFunction(() => !document.getElementById('cashout').disabled);
    if (design === 'expanded') {
      const hint = await page.locator('#onboarding').boundingBox(), button = await page.locator('#cashout').boundingBox();
      check(hint && hint.y + hint.height <= button.y, 'Onboarding sits above cashout and points down');
      await page.screenshot({ path: path.join(artifacts, 'active-onboarding.png'), fullPage: true });
      const roundBefore = await (await context.request.get(base + '/api/state')).json();
      await page.locator('[data-design-choice="classic"]').click();
      await page.locator('[data-design-choice="expanded"]').click();
      const roundAfter = await (await context.request.get(base + '/api/state')).json();
      check(roundBefore.round.id === roundAfter.round.id && roundBefore.player.balance === roundAfter.player.balance, 'Switching design preserves the active round and balance');
    }
    await page.locator('#cashout').click();
    await page.locator('#result-dialog').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(270);
    check(await page.locator('#result-dialog').getAttribute('data-outcome') === 'win', `${design}: cashout reaches the result window`);
    await page.screenshot({ path: path.join(artifacts, `result-${design}.png`) });
    await page.locator('#result-fair').click();
    await page.keyboard.press('Escape');
    await page.locator('#fair-dialog').waitFor({ state: 'hidden' });
    check(await page.evaluate(() => document.getElementById('result-dialog').open && document.documentElement.classList.contains('has-dialog')), 'Closing a nested dialog preserves the result and scroll lock');
    await page.locator('#play-again').click();
    await page.locator('#result-dialog').waitFor({ state: 'hidden' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#rules-open').click();
  check(await page.locator('#rules-dialog').evaluate(d => getComputedStyle(d).animationName === 'none'), 'Reduced motion disables modal animation');
  const closedImmediately = await page.evaluate(() => { const d = document.getElementById('rules-dialog'); d.querySelector('[data-close]').click(); return !d.open; });
  check(closedImmediately, 'Reduced motion closes immediately');
  check(errors.length === 0, `No JavaScript errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} browser checks; Chrome ${browser.version()}; screenshots in ${artifacts}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await new Promise(resolve => server.once('exit', resolve)); }
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});
