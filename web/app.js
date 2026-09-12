'use strict';
const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
const x = (n) => `×${Number(n).toFixed(2)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null, theme = localStorage.getItem('balloon.theme') === 'red' ? 'red' : 'green', selected = null;
let busy = false, connected = false, lastSuccess = 0, lastRoundId = null, lastPoints = 0, lastBooster = false;
let shownResult = null, resultDeadline = 0, resultPending = null, fairData = null, toastTimer = null;
let betSignature = '', historySignature = '', rankSignature = '', linesSignature = '', audioContext = null, soundBusyUntil = 0;
let soundEnabled = localStorage.getItem('balloon.sound') === '1';
const snapshots = new Map();
const acknowledged = () => localStorage.getItem('balloon.acknowledged');

async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state?.csrf || '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие');
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Нет связи с сервером. Проверяем состояние полёта…');
    throw error;
  } finally { clearTimeout(timeout); }
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
function openDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function closeDialog(dialog) { dialog.close(); }
function sound(kind = 'tap') {
  if (!soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    if (kind === 'bird' && now < soundBusyUntil) return;
    const oscillator = audioContext.createOscillator(), volume = audioContext.createGain();
    const tones = { tap: [700, 330, .13], level: [550, 850, .2], booster: [500, 1450, .36], cashout: [820, 1250, .3], crash: [150, 45, .3], bird: [1600, 2500, .13] };
    const [from, to, duration] = tones[kind] || tones.tap;
    oscillator.type = kind === 'crash' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(from, now); oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    volume.gain.setValueAtTime(0, now); volume.gain.linearRampToValueAtTime(.045, now + .01); volume.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(volume); volume.connect(audioContext.destination); oscillator.start(now); oscillator.stop(now + duration); soundBusyUntil = now + duration;
  } catch { /* Audio is optional when a browser disallows it. */ }
}
function birdLoop() { if (!state?.round || state.round.status !== 'flying') sound('bird'); setTimeout(birdLoop, 1800 + Math.random() * 3200); }
function updateSoundButton() { $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled)); $('sound-toggle').querySelector('span').textContent = soundEnabled ? 'Звук включён' : 'Звук выключен'; }
function atmosphere() { document.querySelectorAll('.sky-cloud').forEach((cloud) => { cloud.style.animationDuration = `${30 + Math.random() * 20}s`; cloud.style.animationDelay = `${-Math.random() * 20}s`; }); }
function activeRound() { return state?.round?.status === 'flying' ? state.round : null; }
function applyTheme() {
  document.body.dataset.theme = theme;
  document.querySelectorAll('[data-theme-choice]').forEach((button) => { const active = button.dataset.themeChoice === theme; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.disabled = !!activeRound() || busy; });
  $('route-label').textContent = theme === 'green' ? 'МАРШРУТ 01 / ЗЕЛЁНЫЙ' : 'МАРШРУТ 02 / КРАСНЫЙ';
  $('total-levels').textContent = theme === 'green' ? '9' : '12';
}
function buildBets() {
  const cfg = state.config, flight = activeRound();
  const signature = JSON.stringify([cfg.stakes, cfg.boosters, state.player.balance, selected, !!flight, busy, theme]);
  if (betSignature === signature) return;
  betSignature = signature;
  $('bet-grid').innerHTML = cfg.stakes.map((stake, tier) => {
    const unavailable = stake > state.player.balance && !flight;
    return `<button class="bet-card${tier === selected ? ' selected' : ''}" data-tier="${tier}" aria-pressed="${tier === selected}" aria-disabled="${!!flight || unavailable || busy}" aria-label="Ставка ${stake} бонусов, ${tier === 0 ? 'без бустера' : 'бустер ×' + cfg.boosters[tier]}"><span class="puzzle" aria-hidden="true">🧩</span><strong>${money(stake)}</strong><small>бонусов</small><span class="tier">${tier === 0 ? 'Без бустера' : '×' + cfg.boosters[tier]}</span></button>`;
  }).join('');
  $('bet-grid').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    if (activeRound() || busy) return;
    const tier = Number(button.dataset.tier);
    if (cfg.stakes[tier] > state.player.balance) { toast('Не хватает бонусов'); return; }
    selected = tier; betSignature = ''; sound(); render();
  }));
}
function renderControls() {
  const r = activeRound();
  $('start').hidden = !!r; $('cashout').hidden = !r;
  $('live-ranking').hidden = !r;
  $('start').disabled = busy || !connected || !state.config.is_active || selected === null || state.config.stakes[selected] > state.player.balance;
  $('start').querySelector('span').textContent = !state.config.is_active ? 'Полёты приостановлены' : busy ? 'Готовимся к взлёту…' : 'Начать полёт';
  $('bet-heading').textContent = r ? 'Твой полёт' : 'Твой билет в небо';
  $('bet-intro').textContent = r ? (r.cashoutMultiplier !== null ? 'Выигрыш уже на твоём балансе' : 'Забери выигрыш до краха шара') : 'Выбери фрагмент и силу бустера';
  $('bet-total-label').textContent = r ? 'Ставка на этот полёт' : 'Стоимость полёта';
  $('bet-total').textContent = r ? `${money(r.stake)} бонусов` : selected === null ? 'Выбери ставку' : `${money(state.config.stakes[selected])} бонусов`;
  $('booster-explanation').querySelector('p').textContent = r ? (r.boosterLevel === 0 ? 'Полёт без бустера. Коэффициент растёт по мере подъёма.' : r.boosterActivated ? `Бустер ×${r.booster} активирован на уровне ${r.boosterLevel}. Он уже учтён в коэффициенте.` : r.cashoutMultiplier !== null ? 'После cashout бустер больше не активируется. Очки за уровни продолжают расти.' : `Бустер ×${r.booster} ждёт на уровне ${r.boosterLevel}. Активируется, если долетишь до него до cashout.`) : selected === 0 ? 'Без усиления: выплата равна ставке × текущий коэффициент. Забрать можно после первого уровня.' : selected === null ? 'Бустер ждёт на одном из уровней. Долети до него, чтобы умножить коэффициент.' : `Бустер ×${state.config.boosters[selected]} умножит коэффициент на случайном уровне, если к этому моменту ты ещё не забрал выигрыш.`;
  if (r) {
    const cashed = r.cashoutMultiplier !== null;
    $('cashout').disabled = busy || !connected || cashed || r.highestLine < 1;
    $('cashout').textContent = !connected ? 'Восстанавливаем связь…' : cashed ? `Забрано ${money(r.payout)} Б` : r.highestLine < 1 ? 'Забрать · после 1-го уровня' : `Забрать ${money(r.cashoutValue)} Б`;
    $('cashout-notice').hidden = !cashed;
    $('cashout-notice').textContent = cashed ? `Зафиксировано ${x(r.cashoutMultiplier)}. Могли бы забрать больше — шар продолжает полёт.` : '';
    $('button-caption').textContent = cashed ? 'Сумма выигрыша больше не изменится.' : 'Выплата рассчитывается сервером в момент запроса.';
  } else { $('cashout-notice').hidden = true; $('button-caption').textContent = 'Играем на бонусы. Без реальных денег.'; }
}
function renderField() {
  const round = state.round;
  const relevant = round && (round.status === 'flying' || (round.id !== acknowledged() && round.id !== shownResult));
  const r = relevant ? round : (round && $('result-dialog').open ? round : null);
  if (r) theme = r.theme;
  applyTheme();
  const n = theme === 'green' ? 9 : 12;
  const signature = `${theme}:${r?.id || 'idle'}`;
  if (linesSignature !== signature) {
    linesSignature = signature;
    $('level-lines').innerHTML = Array.from({ length: n }, (_, i) => `<div class="level-line" data-line="${i + 1}"><span class="level-number">${String(i + 1).padStart(2, '0')}</span>${r?.boosterLevel === i + 1 ? `<span class="loot-marker">✦ ×${r.booster}</span>` : ''}</div>`).join('');
  }
  $('sky').classList.toggle('flying', !!r); $('sky').classList.toggle('crashed', r?.status === 'finished');
  $('sky-title').hidden = !!r; $('sky-subtitle').hidden = !!r; $('route-label').hidden = !!r;
  $('multiplier-wrap').hidden = !r; $('sky-note').hidden = !!r;
  $('current-level').textContent = r?.highestLine || 0;
  $('flight-tag').textContent = r ? (r.status === 'finished' ? 'Полёт завершён' : r.cashoutMultiplier !== null ? 'Выигрыш получен' : 'Сейчас в небе') : 'К полёту готов';
  $('flight-status').textContent = !connected ? 'Восстанавливаем связь с сервером' : r ? `Раунд ${r.id.slice(0, 8)} · ${r.demoScenario !== 'random' ? 'ДЕМО-СЦЕНАРИЙ' : 'на сервере'}` : 'Случайность рассчитывает сервер';
  document.querySelectorAll('[data-line]').forEach((line) => { line.classList.toggle('passed', Number(line.dataset.line) <= (r?.highestLine || 0)); line.classList.toggle('boosted', !!r?.boosterActivated && Number(line.dataset.line) === r.boosterLevel); });
  if (!r) { $('balloon-track').style.bottom = ''; $('burst').hidden = true; return; }
  $('multiplier').textContent = x(r.multiplier);
  $('multiplier').className = `multiplier${r.highestLine >= 3 ? ' level-three' : r.highestLine === 2 ? ' level-two' : r.highestLine === 1 ? ' level-one' : ''}`;
  $('multiplier-label').textContent = r.status === 'finished' ? 'КОЭФФИЦИЕНТ КРАХА' : r.cashoutMultiplier !== null ? 'ПОЛЁТ ПРОДОЛЖАЕТСЯ' : 'ТЕКУЩИЙ КОЭФФИЦИЕНТ';
  $('flight-points').textContent = `${money(r.points)} очков за полёт`;
  const progress = Math.min(1, Math.log(Math.max(1, r.baseMultiplier)) / Math.log(r.boundaries.at(-1)));
  const height = $('sky').clientHeight, balloonHeight = $('balloon-track').clientHeight;
  $('balloon-track').style.bottom = `${35 + progress * Math.max(0, height - balloonHeight - 45)}px`;
  if (lastRoundId !== r.id) { lastRoundId = r.id; lastPoints = r.points; lastBooster = r.boosterActivated; }
  if (r.points > lastPoints) {
    $('point-pop').textContent = `+${r.points - lastPoints}${r.boosterActivated && !lastBooster ? ' · БУСТЕР!' : ' очков'}`;
    $('point-pop').classList.remove('show'); void $('point-pop').offsetWidth; $('point-pop').classList.add('show');
    sound(r.boosterActivated && !lastBooster ? 'booster' : 'level');
  }
  lastPoints = r.points; lastBooster = r.boosterActivated;
}
function rankRows(rows) { return rows.map((p) => `<div class="rank-row${p.me ? ' me' : ''}"><span class="rank-number">${p.rank < 10 ? '0' : ''}${p.rank}</span><span class="rank-name">${esc(p.name)}</span>${p.me ? '<span class="rank-you">ты</span>' : ''}<strong class="rank-points">${money(p.points)} оч.</strong></div>`).join(''); }
function renderLeaderboard() {
  const signature = JSON.stringify(state.leaderboard);
  if (signature === rankSignature) return;
  const hadRank = !!rankSignature; rankSignature = signature;
  const top = state.leaderboard.slice(0, 3), me = state.leaderboard.find((p) => p.me);
  const preview = top.some((p) => p.me) ? top : [...top.slice(0, 2), me].filter(Boolean);
  $('leaderboard-preview').innerHTML = rankRows(preview);
  $('live-ranking').innerHTML = state.leaderboard.map(p => `<div class="live-rank-item${p.me ? ' me' : ''}"><span>${p.rank}. ${esc(p.name)}</span><strong>${money(p.points)} оч.</strong></div>`).join('');
  $('leaderboard-top').innerHTML = rankRows(top);
  $('leaderboard-full').innerHTML = rankRows(state.leaderboard.slice(3)) || '<p class="empty-state">Открой игру в другом браузере, чтобы присоединился ещё один пилот.</p>';
  $('leaderboard-me').innerHTML = rankRows(me ? [me] : []);
  if (hadRank) document.querySelectorAll('.rank-row.me').forEach((row) => row.classList.add('updated'));
}
function renderHistory() {
  const signature = JSON.stringify(state.history);
  if (signature === historySignature) return;
  historySignature = signature;
  $('history-count').textContent = state.history.length ? ` / ${state.history.length}` : '';
  $('history').innerHTML = state.history.length ? state.history.map((h) => `<button class="history-chip${h.cashoutMultiplier === null ? ' loss' : ''}" data-proof-id="${h.id}" title="${esc(h.name)} · ${h.cashoutMultiplier === null ? 'Ставка потеряна' : 'Забрано ' + money(h.payout)} · нажми для проверки"><strong>${x(h.crashMultiplier)}</strong><small class="${h.me ? 'history-owner' : ''}">${esc(h.name)}${h.me ? ' · ты' : ''}</small></button>`).join('') : '<p class="empty-state">Пока не было завершённых полётов. Твой может стать первым.</p>';
  $('history').querySelectorAll('[data-proof-id]').forEach((button) => button.addEventListener('click', async () => {
    try { const proof = await api(`/api/rounds/${button.dataset.proofId}/proof`); showFair(proof); } catch (e) { toast(e.message); }
  }));
}
function renderCollection() {
  const owned = state.player.stamps.filter((n) => n > 0).length;
  $('collection-count').textContent = owned; $('album-bonus').textContent = money(state.config.album_bonus);
  $('collection-rules').textContent = `За каждый завершённый раунд ты получаешь одну случайную марку, даже при проигрыше. Собери все 6 разных: по одной обменяются на ${money(state.config.album_bonus)} бонусов. Дубликаты остаются для следующего альбома.`;
  const symbols = ['✧', '☁', '☀', '△', '✦', '☾'];
  $('stamp-grid').innerHTML = state.stampNames.map((name, i) => `<div class="stamp${state.player.stamps[i] ? ' owned' : ''}"><span aria-hidden="true">${symbols[i]}</span><strong>${esc(name)}</strong><small>${state.player.stamps[i] ? 'В коллекции: ' + state.player.stamps[i] : 'Ещё не найдена'}</small></div>`).join('');
  $('collection-summary').textContent = `Собрано альбомов: ${state.player.albums}. Сейчас в коллекции: ${owned} из 6 разных марок.`;
}
function render() {
  if (!state) return;
  $('balance').textContent = money(state.player.balance); $('player-name').textContent = state.player.name;
  document.querySelector('.avatar').textContent = [...state.player.name][0].toUpperCase();
  $('connection').hidden = connected; $('demo-banner').hidden = !state.devMode;
  $('topup').disabled = busy || !connected;
  renderField(); buildBets(); renderControls(); renderLeaderboard(); renderHistory(); renderCollection();
}
function acceptState(data) {
  if (state && data.serverTime < state.serverTime) { connected = true; lastSuccess = Date.now(); return; }
  state = data; connected = true; lastSuccess = Date.now();
  if (state.round?.status === 'flying') { selected = state.round.tier; theme = state.round.theme; sessionStorage.removeItem('balloon.pendingStart'); }
  if (state.round?.commitment) {
    const key = `balloon.commit.${state.round.id}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, state.round.commitment);
    snapshots.set(state.round.id, localStorage.getItem(key));
  }
  render();
  const r = state.round;
  if (r?.status === 'finished' && r.id !== acknowledged() && r.id !== shownResult && resultPending !== r.id) {
    resultPending = r.id; $('burst').hidden = false; sound('crash');
    setTimeout(() => { if (state.round?.id === r.id && r.id !== acknowledged()) showResult(state.round); resultPending = null; }, 600);
  }
}
async function refresh() { acceptState(await api('/api/state')); }
async function poll() {
  try { await refresh(); } catch { if (Date.now() - lastSuccess > 1500) { connected = false; $('connection').hidden = false; if (state) renderControls(); } }
  setTimeout(poll, connected ? 250 : 1000);
}
async function act(callback) {
  if (busy) return; busy = true; if (state) render();
  try { await callback(); await refresh(); } catch (error) { toast(error.message); try { await refresh(); } catch { connected = false; } }
  finally { busy = false; if (state) render(); }
}
function showResult(r) {
  shownResult = r.id; resultDeadline = Date.now() + 10000;
  const won = r.cashoutMultiplier !== null;
  $('result-symbol').textContent = won ? '✦' : '↘';
  $('result-title').textContent = won ? 'Высота взята!' : 'В этот раз — ветер сильнее';
  $('result-amount').textContent = `${won ? '+' : '−'}${money(won ? r.payout : r.stake)} Б`;
  $('result-amount').classList.toggle('loss', !won);
  $('result-description').textContent = won ? `Могли бы забрать больше: до ${money(r.potentialMaximum)} Б при ${x(r.potentialMultiplier)}. Это предел перед крахом; в момент взрыва забрать уже нельзя.` : 'Шар лопнул раньше, чем ты забрал выигрыш. Ставка потеряна, а очки и марка остаются.';
  $('result-multiplier').textContent = x(won ? r.cashoutMultiplier : r.multiplier); $('result-points').textContent = `+${money(r.points)}`;
  $('result-reward').textContent = r.reward.name;
  document.querySelector('.reward-card small').textContent = r.reward.isNew ? 'НОВАЯ МАРКА В КОЛЛЕКЦИИ' : 'ЕЩЁ ОДНА МАРКА В КОЛЛЕКЦИИ';
  $('result-album').textContent = r.reward.albumCompleted ? `Альбом собран! Начислено ещё ${r.reward.albumBonus} бонусов.` : r.reward.isNew ? 'На один маршрут ближе к полному альбому.' : 'Дубликат сохранён для следующих альбомов.';
  openDialog('result-dialog');
}
function acknowledgeResult() {
  if (shownResult) localStorage.setItem('balloon.acknowledged', shownResult);
  $('onboarding').hidden = true; resultDeadline = 0; $('burst').hidden = true; render();
}
function showFair(proof = state?.round) {
  if (!proof) { $('fair-hash').textContent = 'Хеш появится после начала полёта'; $('fair-proof-area').hidden = true; $('fair-wait').hidden = false; openDialog('fair-dialog'); return; }
  let expected = proof.commitment;
  if (proof.id) expected = snapshots.get(proof.id) || localStorage.getItem(`balloon.commit.${proof.id}`) || expected;
  fairData = { ...proof, expected }; $('fair-hash').textContent = expected;
  $('fair-proof-area').hidden = !proof.proof; $('fair-wait').hidden = !!proof.proof;
  $('fair-verdict').textContent = '';
  if (proof.proof) $('fair-proof').textContent = proof.proof;
  openDialog('fair-dialog');
}
function showRules() {
  if (!state) { toast('Загружаем правила с сервера…'); return; }
  const c = state.config, t = c[theme];
  $('rules-content').innerHTML = `<p>Это бонусная crash-игра. Реальных денег, покупок и денежных призов в прототипе нет.</p><h3>01. Выбери свой полёт</h3><p>Зелёный маршрут содержит <b>9 уровней</b>, красный — <b>12</b>. Четыре ставки: ${c.stakes.map(money).join(', ')} бонусов. Их бустеры: ${c.boosters.map(v => '×' + v).join(', ')}. Стоимость списывается один раз при старте.</p><h3>02. Успей забрать</h3><p>Коэффициент начинает расти с ×1.00. После первого уровня станет доступна кнопка «Забрать». Выплата = ставка × коэффициент на сервере в момент обработки cashout, округление вниз до 0,01 бонуса. Если шар лопнет раньше — ставка потеряна. После cashout полёт продолжается, но выплата зафиксирована.</p><h3>03. Поймай бустер</h3><p>Бустер ждёт на случайном уровне: более вероятные позиции задаются весами в конфигурации. Он умножает коэффициент только при достижении этого уровня до cashout. Уровни отсчитываются по базовому коэффициенту: скачок от бустера не перескакивает линии. ×1 означает полёт без усиления.</p><h3>04. Очки и коллекция</h3><p>Каждый пройденный уровень приносит ${c.points_per_line} очков; успешный cashout — ещё ${c.points_cashout_bonus}. Бонусы за активацию бустеров: ${c.points_xN_bonus.map((n,i) => '×'+c.boosters[i]+' → '+n).join('; ')} очков. Очки за новые уровни продолжают начисляться до краха, включая время после cashout. Это рейтинг, а не расходуемые бонусы.</p><p>После любого завершённого раунда выдаётся одна из шести случайных марок с равной вероятностью 1/6. Шесть разных марок автоматически обмениваются на ${c.album_bonus} бонусов. По одной каждого вида расходуется, дубликаты остаются.</p><h3>05. Как устроена случайность</h3><p>Точка краха и позиция бустера выбираются сервером до взлёта. Для текущей темы базовый предел — ×${t.max_multiplier}, минимальный крах — ×${t.min_crash_multiplier}, параметр риска α=${t.alpha}, рост ${t.multiplier_growth_rate} в секунду. Чем выше α, тем чаще ранние крахи; бустер может увеличить итоговый коэффициент сверх базового предела.</p><p>Границы уровней равномерны по времени полёта: Bᵢ = M^(i/(N+1)). Первый уровень сейчас примерно ${x(Math.pow(t.max_multiplier, 1 / (t.levels + 1)))}. Крах на границе имеет приоритет: сама граница ещё не пройдена. Случайный раунд может закончиться до первого уровня.</p><h3>06. Результат и возвращение</h3><p>Итог появится после краха. Через 10 секунд бездействия вернёмся к ставкам с сохранением темы. При закрытии страницы полёт продолжается на сервере; после возвращения загружается его актуальное состояние. При потере связи cashout недоступен до восстановления. Правила новых ставок соответствуют конфигурации ${esc(state.configVersion)}.</p>`;
  openDialog('rules-dialog');
}

$('start').addEventListener('click', () => act(async () => {
  if (selected === null || activeRound()) return;
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem('balloon.pendingStart')); } catch { /* Start a fresh request. */ }
  if (!pending || pending.theme !== theme || pending.tier !== selected) pending = { theme, tier: selected, requestId: crypto.randomUUID() };
  sessionStorage.setItem('balloon.pendingStart', JSON.stringify(pending));
  document.querySelector(`.bet-card[data-tier="${selected}"]`)?.classList.add('launching'); sound();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const round = await api('/api/rounds', pending);
  sessionStorage.removeItem('balloon.pendingStart'); localStorage.setItem(`balloon.commit.${round.id}`, round.commitment); snapshots.set(round.id, round.commitment);
  if (!localStorage.getItem('balloon.onboarded')) { $('onboarding').hidden = false; localStorage.setItem('balloon.onboarded', '1'); setTimeout(() => $('onboarding').hidden = true, 4000); }
}));
$('cashout').addEventListener('click', () => act(async () => { if (!activeRound()) return; await api(`/api/rounds/${state.round.id}/cashout`, {}); sound('cashout'); $('onboarding').hidden = true; }));
document.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => { if (activeRound() || busy) return; theme = button.dataset.themeChoice; localStorage.setItem('balloon.theme', theme); atmosphere(); sound(); render(); }));
$('topup').addEventListener('click', () => act(async () => { await api('/api/topup', {}); toast('Демобаланс пополнен на 1 000 бонусов'); }));
$('rules-open').addEventListener('click', showRules);
$('collection-open').addEventListener('click', () => openDialog('collection-dialog'));
$('leaderboard-open').addEventListener('click', () => openDialog('leaderboard-dialog'));
$('fair-open').addEventListener('click', () => showFair());
$('result-fair').addEventListener('click', () => { resultDeadline = Date.now() + 10000; showFair(); });
$('sound-toggle').addEventListener('click', () => { soundEnabled = !soundEnabled; localStorage.setItem('balloon.sound', soundEnabled ? '1' : '0'); updateSoundButton(); sound(); });
$('play-again').addEventListener('click', () => $('result-dialog').close());
$('result-dialog').addEventListener('close', acknowledgeResult);
$('result-dialog').addEventListener('pointerdown', () => resultDeadline = Date.now() + 10000);
$('result-dialog').addEventListener('keydown', () => resultDeadline = Date.now() + 10000);
$('fair-dialog').addEventListener('close', () => { if ($('result-dialog').open) resultDeadline = Date.now() + 10000; });
$('profile-open').addEventListener('click', () => { if (!state) return; $('profile-name').value = state.player.name; openDialog('profile-dialog'); });
$('profile-form').addEventListener('submit', (event) => { event.preventDefault(); act(async () => { await api('/api/profile', { name: $('profile-name').value }); $('profile-dialog').close(); }); });
$('verify-proof').addEventListener('click', async () => {
  try {
    if (!crypto.subtle) throw new Error('Для проверки открой игру на localhost или по HTTPS.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fairData.proof));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    $('fair-verdict').textContent = hash === fairData.expected ? '✓ Хеш совпал. Зафиксированные данные раунда не изменились.' : 'Хеш не совпал. Данные не соответствуют зафиксированному хешу.';
  } catch (error) { $('fair-verdict').textContent = error.message; }
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
});
let touchStart = 0;
$('leaderboard-dialog').addEventListener('touchstart', (event) => { touchStart = event.touches[0].clientY; }, { passive: true });
$('leaderboard-dialog').addEventListener('touchend', (event) => { if (event.changedTouches[0].clientY - touchStart > 100 && $('leaderboard-full').scrollTop === 0) $('leaderboard-dialog').close(); }, { passive: true });
setInterval(() => {
  if (lastSuccess && Date.now() - lastSuccess > 1500 && connected) { connected = false; $('connection').hidden = false; renderControls(); }
  if (!resultDeadline || !$('result-dialog').open || $('fair-dialog').open) return;
  const remaining = Math.max(0, Math.ceil((resultDeadline - Date.now()) / 1000)); $('result-countdown').textContent = remaining;
  if (!remaining) $('result-dialog').close();
}, 200);
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (Date.now() - lastSuccess > 1500) { connected = false; if (state) renderControls(); } });
updateSoundButton(); atmosphere(); birdLoop(); poll();
