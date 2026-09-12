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

Интерфейс использует системные шрифты, символы и emoji. Звуки синтезируются через Web Audio. Нет внешних CDN, платных шрифтов и runtime-запросов к генератору изображений. Слово «столото» набрано текстом для обозначения кейса, официальный векторный логотип не включён. Макеты и изображения из PDF в проект не копировались.
