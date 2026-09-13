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
  const watchBalloonLaunch = () => page.evaluate(() => {
    window.balloonMotionDone = new Promise(resolve => {
      const frames = [], track = document.getElementById('balloon-track'), art = track.querySelector('.balloon-image-stack');
      const begin = performance.now(); let launched = null;
      function sample(t) {
        const active = document.getElementById('sky').classList.contains('flying') && !document.getElementById('sky').classList.contains('crashed');
        if (active && launched === null) launched = t;
        const box = art.getBoundingClientRect();
        frames.push({ t, active, x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height, scale: new DOMMatrix(getComputedStyle(track).transform).a, shadow: Number(getComputedStyle(track.querySelector('.balloon-shadow')).opacity) });
        if ((launched === null && t - begin < 5000) || (launched !== null && t - launched < 850)) requestAnimationFrame(sample);
        else resolve(frames);
      }
      sample(begin);
    });
  });
  const checkBalloonLaunch = async label => {
    const frames = await page.evaluate(() => window.balloonMotionDone);
    const launch = frames.findIndex(f => f.active), first = frames[launch], prior = frames[launch - 1];
    check(launch > 0 && Math.hypot(first.x - prior.x, first.y - prior.y) < 8 && Math.abs(first.width - prior.width) < 3, `${label}: balloon position and size remain continuous at takeoff`);
    const moving = frames.filter(f => f.active && f.scale > 1.005);
    check(moving.length >= 12 && moving.at(-1).t - moving[0].t > 350 && Math.abs(frames.at(-1).scale - 1) < .001, `${label}: balloon settles gradually into the flight layout`);
    check(frames.every(f => Math.abs(f.width / f.height - 1) < .01), `${label}: balloon artwork keeps its proportions`);
    check(first.shadow > .8 && frames.at(-1).shadow === 0, `${label}: ground shadow fades on takeoff`);
  };
  const sceneFillsViewport = () => page.locator('#world-scene').evaluate(e => {
    const r = e.getBoundingClientRect();
    return Math.abs(r.left) < .5 && Math.abs(r.right - innerWidth) < .5;
  });
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
      if (design === 'expanded') check(await page.locator('#world-scene').evaluate(e => e.getBoundingClientRect().height >= document.body.scrollHeight - 2), 'Sky scenery covers the entire page');
      await page.screenshot({ path: path.join(artifacts, `${design}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  // The landscape must reach every bottom edge, including wide monitors and tall viewports.
  await page.locator('[data-design-choice="expanded"]').click();
  for (const [width, height] of [[375, 812], [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440], [1080, 2400]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const landscape = await page.evaluate(() => {
      const image = document.querySelector('.world-land img'), r = image.getBoundingClientRect();
      const scene = document.getElementById('world-scene').getBoundingClientRect();
      // The root may reserve a native scrollbar gutter outside the page's painted area.
      return { ratio: r.width / r.height, expected: Number(image.getAttribute('width')) / Number(image.getAttribute('height')), covers: r.left <= scene.left && r.right >= scene.right && r.bottom >= innerHeight, pageFills: document.body.getBoundingClientRect().height >= innerHeight, width: Math.floor(scene.right) };
    });
    check(Math.abs(landscape.ratio - landscape.expected) < .001, `Village retains its proportions in ${width}×${height}`);
    check(landscape.covers && landscape.pageFills, `Landscape reaches the viewport edges in ${width}×${height}`);
    const screenshot = await page.screenshot({ path: path.join(artifacts, `landscape-${width}x${height}.png`), animations: 'disabled' });
    const bottomPixels = await page.evaluate(async ({ png, width }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const village = document.querySelector('.world-land img'), r = village.getBoundingClientRect();
      const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
      const sourceContext = source.getContext('2d'); sourceContext.drawImage(village, r.x, r.y, r.width, r.height);
      return [2, Math.floor(width / 2), width - 3].map(x => ({ actual: Array.from(ctx.getImageData(x, image.height - 3, 1, 1).data), expected: Array.from(sourceContext.getImageData(x, image.height - 3, 1, 1).data) }));
    }, { png: screenshot.toString('base64'), width: landscape.width });
    check(bottomPixels.every(({ actual, expected }) => expected[3] === 255 && actual.every((value, i) => Math.abs(value - expected[i]) <= 3)), `Painted ground fills the bottom corners and center in ${width}×${height}: ${JSON.stringify(bottomPixels)}`);
  }
  await page.locator('[data-design-choice="classic"]').click();
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

  // Compare the artwork over an identical background, independently of the sky palette.
  await page.locator('.balloon-image-stack').evaluate(e => { e.style.background = '#eef5f8'; });
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
  await page.locator('.balloon-image-stack').evaluate(e => { e.style.background = ''; });

  const api = async (route, data) => {
    const current = await (await context.request.get(base + '/api/state')).json();
    const response = await context.request.post(base + route, { data, headers: { 'X-CSRF-Token': current.csrf } });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  await api('/api/admin/login', { password: 'browser-test-only' });
  await page.locator('.bet-card[data-tier="0"]').click();
  const balanceBeforeFailure = (await (await context.request.get(base + '/api/state')).json()).player.balance;
  const failLaunch = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Тест: запуск временно недоступен' }) });
  await page.route('**/api/rounds', failLaunch);
  await page.evaluate(() => { scrollTo(0, document.documentElement.scrollHeight); document.getElementById('start').click(); });
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Тест: запуск'));
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  check(await page.evaluate(() => !document.documentElement.classList.contains('has-flight') && !document.querySelector('[data-design-choice="classic"]').disabled), 'Failed launch leaves scrolling and design selection available');
  check((await (await context.request.get(base + '/api/state')).json()).player.balance === balanceBeforeFailure, 'Rejected launch does not deduct a stake');
  await page.unroute('**/api/rounds', failLaunch);
  for (const [design, theme] of [['expanded', 'green'], ['classic', 'red']]) {
    await page.locator(`[data-design-choice="${design}"]`).click();
    await page.locator(`[data-theme-choice="${theme}"]`).click();
    await api('/api/admin/scenario', { scenario: 'cashout' });
    await page.locator('.bet-card[data-tier="0"]').click();
    await page.locator('#start').scrollIntoViewIfNeeded();
    if (design === 'expanded') await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const savedScroll = await page.evaluate(() => scrollY);
    const fieldY = await page.locator('#sky').evaluate(e => e.getBoundingClientRect().top + scrollY);
    const launches = [];
    const recordLaunch = async route => {
      launches.push(await page.evaluate(() => ({ y: scrollY, maxScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight), top: document.querySelector('.flight-panel').getBoundingClientRect().top, inset: parseFloat(getComputedStyle(document.querySelector('.flight-panel')).scrollMarginTop), locked: document.documentElement.classList.contains('has-flight') })));
      await route.continue();
    };
    await page.route('**/api/rounds', recordLaunch);
    await watchBalloonLaunch();
    if (design === 'expanded') await page.evaluate(() => {
      window.sceneMotionDone = new Promise(resolve => {
        const frames = [], cloud = document.querySelector('.cloud-layer.near'), land = document.querySelector('.world-land');
        const begin = performance.now(); let launched = null;
        function sample(t) {
          const active = document.body.classList.contains('flight-view');
          if (active && launched === null) launched = t;
          frames.push({ t, active, scroll: scrollY, y: cloud.getBoundingClientRect().top, landY: land.getBoundingClientRect().top, offset: new DOMMatrix(getComputedStyle(cloud).transform).m42 });
          if ((launched === null && t - begin < 5000) || (launched !== null && t - launched < 2600)) requestAnimationFrame(sample);
          else resolve(frames);
        }
        sample(begin);
      });
    });
    if (design === 'expanded') {
      // Invoke from below the field without Playwright scrolling the button into view first.
      await page.evaluate(() => { const button = document.getElementById('start'); button.click(); button.click(); });
      check(await page.locator('[data-design-choice="classic"]').isDisabled(), 'Design cannot move the field during launch preparation');
    } else await page.locator('#start').click();
    await page.waitForFunction(() => !document.getElementById('cashout').hidden);
    await checkBalloonLaunch(design);
    await page.unroute('**/api/rounds', recordLaunch);
    const aligned = launches[0] && (Math.abs(launches[0].top - launches[0].inset) < 2 || (Math.abs(launches[0].y - launches[0].maxScroll) < 2 && launches[0].top > launches[0].inset));
    check(launches.length === 1 && !launches[0].locked && aligned, `${design}: one stake is sent only after the field is aligned within page scroll limits`);
    const activeY = await page.locator('#sky').evaluate(e => e.getBoundingClientRect().top + scrollY);
    if (design === 'classic') check(Math.abs(fieldY - activeY) < 1, 'Classic field does not move when a round starts');
    else {
      check(await page.evaluate(() => document.body.classList.contains('flight-view') && document.documentElement.classList.contains('has-flight')), 'Expanded flight fills and locks the viewport');
      check(await sceneFillsViewport(), 'Flight background reaches both viewport edges without an empty scrollbar gutter');
      const frames = await page.evaluate(() => window.sceneMotionDone);
      const scrolling = frames.filter(f => !f.active && f.scroll < savedScroll - 2 && f.scroll > launches[0].y + 2);
      check(scrolling.length >= 8 && scrolling.at(-1).t - scrolling[0].t >= 200, 'Starting below the field scrolls through intermediate frames before locking');
      check(scrolling.every((f, i) => i === 0 || f.scroll <= scrolling[i - 1].scroll), 'Launch scroll moves smoothly toward the field without reversing');
      const launch = frames.findIndex(f => f.active), first = frames[launch], prior = frames[launch - 1];
      check(launch > 0 && Math.abs(first.y - prior.y) < 3 && Math.abs(first.landY - prior.landY) < 3, 'Clouds and village do not jump when the screen locks');
      const velocities = frames.slice(1).flatMap((f, i) => f.active && f.t > first.t + 1500 && f.t > frames[i].t ? [(f.offset - frames[i].offset) / (f.t - frames[i].t)] : []).sort((a, b) => a - b);
      const slow = velocities[Math.floor(velocities.length * .1)], fast = velocities[Math.floor(velocities.length * .9)];
      check(velocities.length >= 15 && slow > 0 && fast / slow < 1.6, `Scenery maintains a steady speed between server samples (ratio ${fast / slow})`);
      await page.waitForTimeout(300);
      const before = await page.evaluate(() => ({ scroll: scrollY, cloud: new DOMMatrix(getComputedStyle(document.querySelector('.cloud-layer.near')).transform).m42, balloon: parseFloat(document.getElementById('balloon-track').style.bottom) }));
      await page.mouse.move(600, 400); await page.mouse.wheel(0, 1000); await page.waitForTimeout(650);
      const after = await page.evaluate(() => ({ scroll: scrollY, cloud: new DOMMatrix(getComputedStyle(document.querySelector('.cloud-layer.near')).transform).m42, balloon: parseFloat(document.getElementById('balloon-track').style.bottom) }));
      check(after.scroll === before.scroll, 'Wheel cannot scroll the page during flight');
      check(after.cloud > before.cloud + 2 && after.balloon > before.balloon, 'Clouds descend as the balloon rises');
      await page.locator('#fair-open').click(); await page.waitForTimeout(270); await page.keyboard.press('Escape');
      await page.locator('#fair-dialog').waitFor({ state: 'hidden' });
      check(await page.evaluate(() => document.documentElement.classList.contains('has-flight') && !document.documentElement.classList.contains('has-dialog')), 'Closing a dialog keeps the flight scroll lock');
      check(await sceneFillsViewport(), 'Closing a dialog during flight does not restore the empty right gutter');
    }
    await page.waitForFunction(() => !document.getElementById('cashout').disabled);
    if (design === 'expanded') {
      const hint = await page.locator('#onboarding').boundingBox(), button = await page.locator('#cashout').boundingBox();
      check(hint && hint.y + hint.height <= button.y, 'Onboarding sits above cashout and points down');
      await page.screenshot({ path: path.join(artifacts, 'active-onboarding.png') });
      const roundBefore = await (await context.request.get(base + '/api/state')).json();
      await page.locator('[data-design-choice="classic"]').click();
      check(await page.evaluate(() => !document.documentElement.classList.contains('has-flight')), 'Classic design releases the flight lock');
      await page.locator('[data-design-choice="expanded"]').click();
      const roundAfter = await (await context.request.get(base + '/api/state')).json();
      check(roundBefore.round.id === roundAfter.round.id && roundBefore.player.balance === roundAfter.player.balance, 'Switching design preserves the active round and balance');
    }
    const flightScroll = await page.evaluate(() => scrollY);
    await page.locator('#cashout').click();
    await page.locator('#result-dialog').waitFor({ state: 'visible', timeout: 15000 });
    check(await page.evaluate(() => !document.documentElement.classList.contains('has-flight')), 'The end of the round releases the flight lock');
    if (design === 'expanded') {
      const landedScroll = await page.evaluate(() => scrollY);
      check(Math.abs(landedScroll - flightScroll) < 2 && Math.abs(landedScroll - savedScroll) > 100, `Landing keeps the flight position instead of returning below the field (${flightScroll} -> ${landedScroll})`);
    }
    await page.waitForTimeout(270);
    check(await page.locator('#result-dialog').getAttribute('data-outcome') === 'win', `${design}: cashout reaches the result window`);
    await page.screenshot({ path: path.join(artifacts, `result-${design}.png`) });
    await page.locator('#result-fair').click();
    await page.keyboard.press('Escape');
    await page.locator('#fair-dialog').waitFor({ state: 'hidden' });
    check(await page.evaluate(() => document.getElementById('result-dialog').open && document.documentElement.classList.contains('has-dialog')), 'Closing a nested dialog preserves the result and scroll lock');
    await page.locator('#play-again').click();
    await page.locator('#result-dialog').waitFor({ state: 'hidden' });
    if (design === 'expanded') check(Math.abs(await page.evaluate(() => scrollY) - flightScroll) < 2, 'Closing the result keeps the page at its flight position');
  }

  // Short and narrow screens retain the game and cashout inside the locked viewport.
  await page.locator('[data-design-choice="expanded"]').click();
  await page.setViewportSize({ width: 375, height: 700 });
  await api('/api/admin/scenario', { scenario: 'cashout' });
  await page.locator('.bet-card[data-tier="0"]').click();
  await page.locator('#start').scrollIntoViewIfNeeded();
  const mobileBefore = await page.evaluate(() => scrollY);
  const mobileLaunches = [];
  const recordMobileLaunch = async route => {
    mobileLaunches.push(await page.evaluate(() => ({ scroll: scrollY, top: document.querySelector('.flight-panel').getBoundingClientRect().top })));
    await route.continue();
  };
  await page.route('**/api/rounds', recordMobileLaunch);
  await watchBalloonLaunch();
  await page.locator('#start').click();
  await page.waitForFunction(() => document.body.classList.contains('flight-view'));
  await checkBalloonLaunch('mobile');
  await page.unroute('**/api/rounds', recordMobileLaunch);
  check(mobileLaunches.length === 1 && mobileBefore - mobileLaunches[0].scroll > 100 && Math.abs(mobileLaunches[0].top - 76) < 2, 'Mobile Play button scrolls up from below the field before starting');
  for (const [width, height] of [[375, 700], [320, 568], [844, 390], [1024, 700]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => {
      const button = document.getElementById('cashout').getBoundingClientRect(), sky = document.getElementById('sky').getBoundingClientRect(), balloon = document.getElementById('balloon-track').getBoundingClientRect();
      return { fits: button.top >= 0 && button.bottom <= innerHeight && button.left >= 0 && button.right <= innerWidth, sky: sky.height, balloonFits: balloon.top >= sky.top - 2 && balloon.bottom <= sky.bottom + 2, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    await page.screenshot({ path: path.join(artifacts, `flight-${width}x${height}.png`) });
    check(metrics.fits && !metrics.overflow, `Cashout stays accessible in ${width}×${height}`);
    check(await sceneFillsViewport(), `Flight background has no right strip in ${width}×${height}`);
    check(metrics.sky >= 100 && metrics.balloonFits, `Balloon stays inside the flight field in ${width}×${height}`);
  }
  await page.setViewportSize({ width: 375, height: 700 });
  const touch = await context.newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touchScroll = await page.evaluate(() => scrollY);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 440 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y: 270 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.keyboard.press('PageDown'); await page.waitForTimeout(150);
  check(await page.evaluate(() => scrollY) === touchScroll, 'Touch swipe and PageDown cannot scroll an active flight');
  await touch.detach();
  const liveRound = (await (await context.request.get(base + '/api/state')).json()).round.id;
  await page.reload(); await page.waitForFunction(() => document.body.classList.contains('flight-view'));
  check((await (await context.request.get(base + '/api/state')).json()).round.id === liveRound, 'Reload restores the flight and screen lock without a new stake');
  await page.waitForFunction(() => !document.getElementById('cashout').disabled); await page.locator('#cashout').click();
  await page.locator('#result-dialog').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#play-again').click(); await page.locator('#result-dialog').waitFor({ state: 'hidden' });
  const landedScroll = await page.evaluate(() => scrollY);
  await page.mouse.move(180, 350); await page.mouse.wheel(0, 400); await page.waitForTimeout(150);
  check(await page.evaluate(() => scrollY) !== landedScroll, 'Page scrolling resumes after the round and result');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#rules-open').click();
  check(await page.locator('#rules-dialog').evaluate(d => getComputedStyle(d).animationName === 'none'), 'Reduced motion disables modal animation');
  const closedImmediately = await page.evaluate(() => { const d = document.getElementById('rules-dialog'); d.querySelector('[data-close]').click(); return !d.open; });
  check(closedImmediately, 'Reduced motion closes immediately');
  await api('/api/admin/scenario', { scenario: 'crash' });
  await page.locator('.bet-card[data-tier="0"]').click();
  await page.locator('#start').scrollIntoViewIfNeeded();
  const reducedScroll = await page.evaluate(() => {
    const from = scrollY;
    document.getElementById('start').click();
    return { distance: from - scrollY, top: document.querySelector('.flight-panel').getBoundingClientRect().top };
  });
  check(reducedScroll.distance > 100 && Math.abs(reducedScroll.top - 76) < 2, 'Reduced motion aligns the field immediately without scrolling animation');
  await page.waitForFunction(() => document.body.classList.contains('flight-view'));
  const reducedPosition = await page.locator('.cloud-layer.near').evaluate(e => getComputedStyle(e).transform);
  const reducedFlightScroll = await page.evaluate(() => scrollY);
  check(await page.locator('#balloon-track').evaluate(e => !e.getAnimations().some(a => a.effect.getKeyframes().some(k => k.transform))), 'Reduced motion skips the balloon layout transition');
  await page.waitForTimeout(100);
  check(await page.locator('.cloud-layer.near').evaluate((e, position) => getComputedStyle(e).transform === position && getComputedStyle(e.querySelector('.world-cloud')).animationName === 'none', reducedPosition), 'Reduced motion disables scenery travel and drifting while retaining the flight view');
  await page.locator('#result-dialog').waitFor({ state: 'visible', timeout: 10000 });
  check(await page.evaluate(() => !document.documentElement.classList.contains('has-flight')), 'A lost round also releases the flight lock');
  check(Math.abs(await page.evaluate(() => scrollY) - reducedFlightScroll) < 2, 'A lost round also keeps the page at its flight position');
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
