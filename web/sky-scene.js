'use strict';

function createSkyScene() {
  const scene = document.getElementById('world-scene');
  const layout = document.querySelector('.game-layout');
  const choices = document.querySelector('.design-switch');
  const choiceHome = choices.parentElement;
  const choiceDock = document.getElementById('flight-design-slot');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const layers = [
    ['.cloud-layer.far', .38, '0'],
    ['.cloud-layer.near', .8, '0'],
    ['.world-land', 1.12, '-50%'],
    ['.world-birds', .2, '0'],
    ['.world-sun', .08, '0'],
  ].map(([selector, speed, x]) => ({ element: scene.querySelector(selector), speed, x, offset: 0 }));
  let locked = false, savedScroll = 0, previousHeight = '', frame = 0, previousTime = 0;
  let roundId = null, sampleStamp = null, sampleTime = 0, clockOrigin = 0, targetOrigin = 0;
  let progress = 0, progressRate = 0, travelRange = 0;

  function paint(travel) {
    for (const layer of layers) {
      layer.element.style.transform = `translate3d(${layer.x}, ${(layer.offset + travel * layer.speed).toFixed(3)}px, 0)`;
    }
  }
  function stop() {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0;
  }
  function start() {
    if (locked && roundId && !reducedMotion.matches && !frame) frame = requestAnimationFrame(animate);
  }
  function animate(time) {
    const delta = Math.min(64, previousTime ? time - previousTime : 16);
    previousTime = time;
    const easing = -Math.expm1(-delta / 180);
    // Server samples calibrate a continuous clock; they never restart the motion.
    clockOrigin += (targetOrigin - clockOrigin) * -Math.expm1(-delta / 600);
    const age = Math.max(0, time - sampleTime);
    // During a connection loss, coast to a stop instead of inventing an endless flight.
    const projectedAge = age <= 1000 ? age : 1000 + 500 * -Math.expm1(-(age - 1000) / 500);
    const target = Math.min(1, Math.max(0, (sampleTime + projectedAge - clockOrigin) * progressRate));
    progress += Math.max(0, target - progress) * easing;
    travelRange += (Math.max(1000, innerHeight * 1.8) - travelRange) * easing;
    paint(progress * travelRange);
    frame = requestAnimationFrame(animate);
  }
  function setLocked(active) {
    if (active === locked) return;
    locked = active;
    if (active) {
      const positions = layers.map(layer => layer.element.getBoundingClientRect().top);
      savedScroll = scrollY;
      previousHeight = layout.style.minHeight;
      layout.style.minHeight = `${layout.getBoundingClientRect().height}px`;
      choiceDock.append(choices);
      document.documentElement.classList.add('has-flight');
      document.body.classList.add('flight-view');
      // Preserve the visible scenery when its container changes from page to viewport.
      const fixedPositions = layers.map(layer => layer.element.getBoundingClientRect().top);
      layers.forEach((layer, i) => { layer.offset = positions[i] - fixedPositions[i]; });
      paint(0);
    } else {
      stop();
      choiceHome.append(choices);
      document.body.classList.remove('flight-view');
      document.documentElement.classList.remove('has-flight');
      layout.style.minHeight = previousHeight;
      window.scrollTo({ top: savedScroll, behavior: 'instant' });
      layers.forEach(layer => { layer.offset = 0; });
      paint(0);
      roundId = null; sampleStamp = null; progress = 0;
    }
  }
  function update(round, serverTime) {
    const active = document.body.dataset.design === 'expanded' && round?.status === 'flying';
    setLocked(!!active);
    scene.dataset.flying = String(!!active);
    if (!active) return;
    if (roundId !== round.id || sampleStamp !== serverTime) {
      const now = performance.now();
      const elapsed = Number.isFinite(serverTime) ? Math.max(0, serverTime - round.startedAt) : Math.log(Math.max(1, round.baseMultiplier)) / round.growthRate * 1000;
      targetOrigin = now - elapsed;
      progressRate = round.growthRate / (1000 * Math.log(round.boundaries.at(-1)));
      sampleTime = now; sampleStamp = serverTime;
      if (roundId !== round.id) {
        roundId = round.id; clockOrigin = targetOrigin; progress = 0;
        travelRange = Math.max(1000, innerHeight * 1.8);
      }
    }
    start();
  }
  reducedMotion.addEventListener('change', () => reducedMotion.matches ? stop() : start());
  return { update };
}
