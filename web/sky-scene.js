'use strict';

function createSkyScene() {
  const scene = document.getElementById('world-scene');
  const layout = document.querySelector('.game-layout');
  const choices = document.querySelector('.design-switch');
  const choiceHome = choices.parentElement;
  const choiceDock = document.getElementById('flight-design-slot');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let locked = false, savedScroll = 0, previousHeight = '', current = 0, target = 0, frame = 0, previousTime = 0;

  function animate(time) {
    const delta = Math.min(64, previousTime ? time - previousTime : 16);
    previousTime = time;
    current += (target - current) * (1 - Math.exp(-delta / 180));
    if (Math.abs(target - current) < .05) current = target;
    scene.style.setProperty('--flight-travel', `${current.toFixed(2)}px`);
    if (current !== target) frame = requestAnimationFrame(animate);
    else { frame = 0; previousTime = 0; }
  }
  function setTarget(progress) {
    target = reducedMotion.matches ? 0 : progress * Math.max(1000, innerHeight * 1.8);
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame); frame = 0; current = 0; previousTime = 0;
      scene.style.setProperty('--flight-travel', '0px');
    } else if (!frame) frame = requestAnimationFrame(animate);
  }
  function setLocked(active) {
    if (active === locked) return;
    locked = active;
    if (active) {
      savedScroll = scrollY;
      previousHeight = layout.style.minHeight;
      layout.style.minHeight = `${layout.getBoundingClientRect().height}px`;
      choiceDock.append(choices);
      document.documentElement.classList.add('has-flight');
      document.body.classList.add('flight-view');
    } else {
      choiceHome.append(choices);
      document.body.classList.remove('flight-view');
      document.documentElement.classList.remove('has-flight');
      layout.style.minHeight = previousHeight;
      window.scrollTo({ top: savedScroll, behavior: 'instant' });
    }
  }
  function update(round) {
    const active = document.body.dataset.design === 'expanded' && round?.status === 'flying';
    setLocked(!!active);
    const maximum = round?.boundaries?.at(-1) || 2;
    const progress = active ? Math.min(1, Math.max(0, Math.log(Math.max(1, round.baseMultiplier)) / Math.log(maximum))) : 0;
    setTarget(progress);
    scene.dataset.flying = String(!!active);
  }
  reducedMotion.addEventListener('change', () => setTarget(0));
  return { update };
}
