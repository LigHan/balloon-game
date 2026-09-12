'use strict';
const slides = [...document.querySelectorAll('.slide')];
let index = Math.max(0, Math.min(slides.length - 1, Number(location.hash.slice(1) || 1) - 1));
function render() {
  slides.forEach((slide, i) => { slide.hidden = i !== index; });
  document.getElementById('slide-position').textContent = `${index + 1} / ${slides.length}`;
  document.getElementById('previous').disabled = index === 0;
  document.getElementById('next').disabled = index === slides.length - 1;
  history.replaceState(null, '', `#${index + 1}`);
}
function move(delta) { index = Math.max(0, Math.min(slides.length - 1, index + delta)); render(); }
document.getElementById('previous').addEventListener('click', () => move(-1));
document.getElementById('next').addEventListener('click', () => move(1));
document.addEventListener('keydown', (event) => {
  if (['ArrowRight','PageDown',' '].includes(event.key)) { event.preventDefault(); move(1); }
  if (['ArrowLeft','PageUp'].includes(event.key)) { event.preventDefault(); move(-1); }
  if (event.key === 'Home') { index = 0; render(); }
  if (event.key === 'End') { index = slides.length - 1; render(); }
});
document.getElementById('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { document.getElementById('fullscreen').textContent = 'Используй полноэкранный режим браузера'; }
});
render();
