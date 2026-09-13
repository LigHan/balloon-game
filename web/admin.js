'use strict';
const $ = (id) => document.getElementById(id);
const escapeText = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrf = '', config = null, saving = false;
const fields = [
  ['game_id', 'Идентификатор игры', 'text', 'До 80 символов'],
  ['game_name', 'Название', 'text', 'Название игры в конфигурации'],
  ['game_type', 'Тип игры', 'text', 'До 80 символов'],
  ['points_per_line', 'Очков за уровень', 'number', 'Целое число от 0 до 10 000', 0, 10000, 1],
  ['points_cashout_bonus', 'Очков за полученный выигрыш', 'number', 'Целое число от 0 до 10 000', 0, 10000, 1]
];
const economy = [
  ['stakes', 'Четыре ставки', 'array', 'Четыре целых числа 1–10 000, через запятую'],
  ['boosters', 'Множители бустеров', 'array', 'Четыре числа 1–10. Первое строго 1, остальные больше 1'],
  ['points_xN_bonus', 'Очки за бустеры', 'array', 'Четыре целых числа 0–10 000, через запятую'],
  ['album_bonus', 'Бонусов за полный альбом', 'number', 'Целое число от 0 до 10 000', 0, 10000, 1]
];
const themeFields = [
  ['alpha', 'Параметр риска α', 'number', '0,2–5. Больше значение — чаще ранние крахи', .2, 5, .01],
  ['min_crash_multiplier', 'Минимальный крах', 'number', '1–10, строго меньше максимума', 1, 10, .01],
  ['max_multiplier', 'Предел базового коэффициента', 'number', '2–100. Бустер может увеличить итоговый коэффициент выше', 2, 100, .01],
  ['multiplier_growth_rate', 'Скорость роста', 'number', '0,03–1. Выше значение — короче полёт', .03, 1, .01],
  ['loot_weights', 'Веса уровней для бустера', 'array', 'Зелёный: 9 значений. Красный: 12. Каждый вес 0–100 000, сумма больше 0']
];
function fieldHtml(field, prefix, values) {
  const [key, label, type, help, min, max, step] = field, id = `${prefix}${key}`, value = values[key];
  return `<div class="admin-field"><label class="field-label" for="${id}">${escapeText(label)}</label><input id="${id}" name="${id}" type="${type === 'array' ? 'text' : type}" value="${escapeText(Array.isArray(value) ? value.join(', ') : value)}" ${type === 'number' ? `min="${min}" max="${max}" step="${step}"` : 'maxlength="400"'} required><small>${escapeText(help)}</small></div>`;
}
async function request(path, body) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос'); return data;
}
function fill(data) {
  config = data.config; $('login-card').hidden = true; $('admin-workspace').hidden = false; $('scenarios-card').hidden = !data.devMode;
  $('config-version').textContent = `Версия ${data.version}`;
  $('base-fields').innerHTML = fields.map(f => fieldHtml(f, '', config)).join('');
  $('economy-fields').innerHTML = economy.map(f => fieldHtml(f, '', config)).join('');
  for (const theme of ['green','red']) $(theme + '-fields').innerHTML = themeFields.map(f => fieldHtml(f, theme + '.', config[theme])).join('');
  $('is_active').checked = config.is_active;
  $('config-error').textContent = data.error ? `Не удалось применить настройки. Сохранены предыдущие значения: ${data.error}` : '';
  $('model-summary').textContent = ['green','red'].map(theme => {
    const t = config[theme], survival = Math.pow(t.min_crash_multiplier / Math.max(2, t.min_crash_multiplier), t.alpha) * 100;
    return `${theme === 'green' ? 'Зелёный' : 'Красный'}: шанс достичь базового ×2 около ${survival.toFixed(1)}%, время до ×2 ${(Math.log(2) / t.multiplier_growth_rate).toFixed(1)} с, максимальная длительность ${(Math.log(t.max_multiplier) / t.multiplier_growth_rate).toFixed(1)} с.`;
  }).join(' ');
}
function collect() {
  const data = structuredClone(config);
  function read(field, prefix, target) {
    const [key, , type] = field, raw = $(prefix + key).value.trim();
    if (type === 'number') target[key] = Number(raw);
    else if (type === 'array') { const parts = raw.split(','); if (parts.some(v => !v.trim() || !Number.isFinite(Number(v.trim())))) throw new Error(`Поле «${field[1]}»: укажи числа через запятую`); target[key] = parts.map(v => Number(v.trim())); }
    else target[key] = raw;
  }
  [...fields, ...economy].forEach(f => read(f, '', data));
  ['green','red'].forEach(theme => themeFields.forEach(f => read(f, theme + '.', data[theme])));
  data.is_active = $('is_active').checked; return data;
}
$('login-form').addEventListener('submit', async (event) => { event.preventDefault(); $('login-error').textContent = ''; try { if (!csrf) csrf = (await request('/api/state')).csrf; fill(await request('/api/admin/login', { password: $('password').value })); $('password').value = ''; } catch (error) { $('login-error').textContent = error.message; } });
$('config-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (saving) return; saving = true; $('save').disabled = true; $('config-error').textContent = '';
  try { fill(await request('/api/admin/config', collect())); $('save-status').textContent = 'Сохранено. Настройки применятся к следующим раундам.'; }
  catch (error) { $('config-error').textContent = error.message; $('save-status').textContent = 'Изменения не сохранены'; }
  finally { saving = false; $('save').disabled = false; }
});
$('config-form').addEventListener('input', () => { $('save-status').textContent = 'Есть несохранённые изменения'; });
$('logout').addEventListener('click', async () => { try { await request('/api/admin/logout', {}); location.reload(); } catch (error) { $('config-error').textContent = error.message; } });
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', async () => {
  try { await request('/api/admin/scenario', { scenario: button.dataset.scenario }); $('scenario-status').textContent = `Следующий раунд: ${button.textContent}. Вернись в игру и выбери ставку.`; }
  catch (error) { $('scenario-status').textContent = error.message; }
}));
(async () => { try { csrf = (await request('/api/state')).csrf; try { fill(await request('/api/admin/config')); } catch { /* The login form is already visible. */ } } catch (error) { $('login-error').textContent = error.message; } })();
