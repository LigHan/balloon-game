# Графика

Основной игровой asset: `web/assets/balloon.png`, 1254×1254, PNG с прозрачностью. Создан встроенным инструментом imagegen для этого проекта и визуально просмотрен. В красной теме применяется CSS `hue-rotate`, исходный файл сохраняется. Этот же игровой объект показан на обложке презентации.

Промпт:

```text
Use case: stylized-concept
Asset type: transparent PNG game illustration, displayed about 220 pixels tall against pale blue sky in a Russian web crash game.
Primary request: ONE beautiful emerald green hot-air balloon with a small warm-gold basket, isolated on genuinely transparent alpha background.
Subject: upright classic rounded hot-air balloon with a vertically ribbed canopy in alternating lime green and emerald green, elegant tapered lower canopy, fine suspension ropes connected to a small warm golden basket. Friendly premium casual game art.
Style/medium: polished 3D soft clay render with smooth soft highlights and simple readable shapes.
Composition/framing: square image approximately 1:1, single centered object, fully visible vertical silhouette with comfortable transparent margin, canopy dominant and basket petite. Straight upright, mild three-quarter dimensionality.
Lighting/mood: gentle sunlight from upper left, cheerful soft depth, fresh bright greens, pleasing dimensional shading.
Constraints: actual transparent background with clean alpha edges. No text, no logos, no watermark, no landscape, no ground plane, no extra assets or objects, no clouds, no checkerboard painted into the image.
```

## Оформление в стиле «Столото»

Интерфейс игры, административная панель и презентация используют палитру официального сайта: основной цвет кнопок `#FFCD17`, наведение `#F6BA1E`, тёмный текст `#18222F`/`#212121`, светлые нейтральные поверхности. Цвета кнопок и шрифт сверены с действующими стилями главной страницы 12 сентября 2026 года. Для зелёного и красного маршрутов сохранены разные цвета игрового поля. Графические круги развивают мотив радара из фирменного стиля.

Локальные брендовые ресурсы:

| Файл | Источник |
| --- | --- |
| `web/assets/stoloto-logo.png` | [Официальный фотобанк](https://www.stoloto.ru/press/photobank), [PNG логотипа](https://static.stoloto.ru/files/i/photobank/323x138_Stoloto_rus.png) |
| `web/assets/favicon.svg` | [Иконка официального сайта](https://static.stoloto.ru/new/stat3/favicon/logo-icon.svg) |
| `web/assets/roboto-flex.woff2` | Roboto Flex, [файл шрифта на сайте «Столото»](https://static.stoloto.ru/new/_next/static/media/55f35dd89cf11e4e-s.p.woff2) |
| `web/assets/ROBOTO-FLEX-LICENSE.txt` | [SIL Open Font License 1.1 из Google Fonts](https://github.com/google/fonts/blob/main/ofl/robotoflex/OFL.txt) |

Логотип и иконка сохранены без изменений. Права на товарный знак принадлежат правообладателю, здесь он обозначает бренд конкурсного кейса. Прототип не является официальным сайтом лотерей и не принимает реальные деньги. Шрифт распространяется с текстом лицензии SIL OFL, резервный шрифт — Arial.

В красном режиме исходное изображение шара остаётся нижним слоем. Цвет купола меняет отдельный CSS-слой с обрезкой `clip-path`; корзина сохраняет исходный золотой цвет. Дополнительный растровый файл для красного режима не создаётся. Стрелка подсказки и кнопки закрытия нарисованы встроенным SVG.

Референсы: [главная страница «Столото»](https://www.stoloto.ru/), [описание фирменного паттерна студией Артемия Лебедева](https://www.artlebedev.ru/stoloto/identity/).

## Небесный дизайн страницы

`web/assets/cloud.svg` и `web/assets/village.svg` — оригинальные векторные иллюстрации, написанные для проекта: многослойные облака, холмы, деревья, домики, мельница и тропинка. Солнце и птицы дополняются CSS и встроенным SVG. Иллюстрации масштабируются без растровых копий.

В спокойном состоянии сцена занимает высоту всей страницы, а деревушка находится у её нижнего края. Во время полёта сцена закрепляется в окне браузера: `web/sky-scene.js` связывает вертикальное движение слоёв с серверным коэффициентом полёта, плавно интерполируя положение через `requestAnimationFrame`. Дальний слой движется медленнее ближнего. Красный маршрут меняет небо на тёплое закатное. `prefers-reduced-motion` отключает движение фона.

Остальные элементы используют символы и emoji. Звуки синтезируются через Web Audio. Все файлы поставляются внутри проекта: внешние CDN и runtime-запросы к генератору изображений не нужны. Макеты и изображения из PDF в проект не копировались.
