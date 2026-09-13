'use strict';

function createBalloonMotion() {
  const track = document.getElementById('balloon-track');
  const artwork = track.querySelector('.balloon-image-stack');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let initialized = false, previousRound = null, previousDesign = null, animation = null;
  function cancel() { animation?.cancel(); animation = null; }
  function capture(round) {
    const flying = round?.status === 'flying';
    const launching = initialized && flying && round.id !== previousRound;
    const design = document.body.dataset.design;
    if (!flying || reducedMotion.matches || design !== previousDesign) cancel();
    initialized = true; previousRound = round?.id; previousDesign = design;
    return launching && !reducedMotion.matches && getComputedStyle(track).opacity === '1' ? artwork.getBoundingClientRect() : null;
  }
  function play(from) {
    if (!from || !from.width || reducedMotion.matches) return;
    cancel();
    const to = artwork.getBoundingClientRect(), box = track.getBoundingClientRect();
    if (!to.width) return;
    const scale = from.width / to.width;
    const originX = box.left + box.width / 2, originY = box.top + box.height / 2;
    const dx = from.left + from.width / 2 - (originX + (to.left + to.width / 2 - originX) * scale);
    const dy = from.top + from.height / 2 - (originY + (to.top + to.height / 2 - originY) * scale);
    // Start at the artwork's previous screen coordinates after the field changes layout.
    // Uniform scaling preserves the canopy and basket while the existing float continues.
    animation = track.animate([
      { transform: `translateX(-50%) translate(${dx}px, ${dy}px) scale(${scale})` },
      { transform: 'translateX(-50%) translate(0, 0) scale(1)' },
    ], { duration: 700, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    animation.onfinish = () => { animation = null; };
  }
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) cancel(); });
  window.addEventListener('resize', cancel);
  return { capture, play };
}

function createDialogController(root = document) {
  const pending = new Map();
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const syncScrollLock = () => root.documentElement.classList.toggle('has-dialog', !!root.querySelector('dialog[open]'));

  function clearClosing(dialog) {
    const closing = pending.get(dialog);
    if (!closing) return;
    clearTimeout(closing.timer);
    dialog.removeEventListener('animationend', closing.onEnd);
    pending.delete(dialog);
    dialog.classList.remove('is-closing');
    closing.resolve();
  }

  function open(dialog) {
    clearClosing(dialog);
    if (!dialog.open) {
      dialog.querySelectorAll('.dialog-body').forEach((body) => { body.scrollTop = 0; });
      dialog.showModal();
    }
    syncScrollLock();
  }

  function close(dialog) {
    if (!dialog.open) return Promise.resolve();
    if (pending.has(dialog)) return pending.get(dialog).promise;
    if (reducedMotion()) { dialog.close(); syncScrollLock(); return Promise.resolve(); }
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const finish = () => {
      if (!pending.has(dialog)) return;
      clearClosing(dialog);
      if (dialog.open) dialog.close();
      syncScrollLock();
    };
    const onEnd = (event) => {
      if (event.target === dialog && event.animationName === 'dialog-exit') finish();
    };
    pending.set(dialog, { promise, resolve, onEnd, timer: setTimeout(finish, 240) });
    dialog.addEventListener('animationend', onEnd);
    dialog.classList.add('is-closing');
    return promise;
  }

  root.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => close(button.closest('dialog')));
  });
  root.querySelectorAll('dialog').forEach((dialog) => {
    let pressedOutside = false;
    const outside = (event) => {
      const box = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
    };
    dialog.addEventListener('pointerdown', (event) => { pressedOutside = outside(event); });
    dialog.addEventListener('click', (event) => {
      if (pressedOutside && outside(event)) close(dialog);
      pressedOutside = false;
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(dialog); });
    dialog.addEventListener('close', () => { clearClosing(dialog); syncScrollLock(); });
  });
  return { open, close, isClosing: (dialog) => pending.has(dialog) };
}

function initGameDesign(onChange = () => {}) {
  const panel = document.getElementById('bet-panel');
  const dock = document.getElementById('bet-dock');
  const sidebar = document.getElementById('side-panel');
  const choices = document.querySelectorAll('[data-design-choice]');
  function apply(value, persist = true) {
    const design = value === 'classic' ? 'classic' : 'expanded';
    if (design === 'expanded') dock.append(panel);
    else sidebar.prepend(panel);
    document.body.dataset.design = design;
    choices.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.designChoice === design)));
    if (persist) { try { localStorage.setItem('balloon.design', design); } catch { /* The view still works without saved preferences. */ } }
    onChange(design);
  }
  let saved;
  try { saved = localStorage.getItem('balloon.design'); } catch { /* Use the default view. */ }
  apply(saved, false);
  choices.forEach((button) => button.addEventListener('click', () => apply(button.dataset.designChoice)));
  return { apply };
}
