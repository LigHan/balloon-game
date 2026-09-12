'use strict';

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

function initGameDesign() {
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
  }
  let saved;
  try { saved = localStorage.getItem('balloon.design'); } catch { /* Use the default view. */ }
  apply(saved, false);
  choices.forEach((button) => button.addEventListener('click', () => apply(button.dataset.designChoice)));
  return { apply };
}
