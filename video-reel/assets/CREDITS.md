# Материалы и лицензии

## Фото-вставки (b-roll)

Все фото — из открытого датасета **Open Images** (Google), оригиналы с Flickr, лицензия **CC BY 2.0**
(можно использовать коммерчески и изменять **при указании автора**). Исходники лежат в `assets/photos_raw/`,
обработанные вертикальные кадры — в `public/broll/`. Фото обрезаны под 9:16, увеличены (EDSR ×2) и цветокорректированы.

> Это **иллюстративные** стоковые кадры, а не объекты клиента. Для финальной публикации лучше заменить их
> реальными съёмками ЖК — достаточно положить свои файлы в `public/broll/` под теми же именами.

| Файл | Где в ролике | Автор | Источник | Лицензия |
|---|---|---|---|---|
| `tower_white.jpg` | «на весь срок ипотеки» | Jared | https://www.flickr.com/photos/jared422/8772476293 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `towers_glass.jpg` | «с 1 января 2026» | xiquinhosilva | https://www.flickr.com/photos/xiquinho/16066621817 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `apartments.jpg` | «платёж 20–22 тысячи» | scevdog | https://www.flickr.com/photos/127878246@N03/15723114405 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `sea_condos.jpg` | «…моря» и «для вложений» (2 кадрировки) | GrapevineTxOnline.com | https://www.flickr.com/photos/grapevinetxonline/16910622609 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `coast_green.jpg` | «недвижимость на таких условиях» | Goynang | https://www.flickr.com/photos/goynang/161985137 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `resort.jpg` | «для жизни» | Bradley West | https://www.flickr.com/photos/wyldwest/69522737 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |

Строка для подписи к посту (атрибуция CC BY):

```
Фото: Bradley West, Goynang, GrapevineTxOnline.com, Jared, scevdog, xiquinhosilva / Flickr, CC BY 2.0
```

## Шрифты (SIL Open Font License 1.1 — свободное коммерческое использование)

| Шрифт | Роль | Файл |
|---|---|---|
| Unbounded (Black 900) | крупные заголовки | `public/fonts/Unbounded-VF.ttf` |
| Montserrat Alternates (Light 300) | тонкие строчные подписи | `public/fonts/MontserratAlternates-*.ttf` |
| Bebas Neue | тег с ником (если задан `HANDLE`) | `public/fonts/BebasNeue-Regular.ttf` |
| Montserrat (variable) | запасной вариант для заголовков | `assets/fonts/Montserrat-VF.ttf` |

Тексты лицензий — `assets/fonts/OFL-*.txt`.

## Музыка и звуковые эффекты

Музыкальная подложка, свуши, удары и «попы» **синтезированы скриптом** `scripts/make_audio.py` (numpy) —
сторонних треков нет, лицензионных ограничений нет. Стемы: `out/stems/voice.wav`, `music.wav`, `sfx.wav`.

## Графика

Иконки, календарь, плашки, график, «облачко» комментария нарисованы кодом (SVG/CSS) в `src/components/Graphics.tsx`.

## Нейросетевые модели (только для подготовки материалов, в git не хранятся)

- MediaPipe Selfie Multiclass (Apache 2.0) — маска спикера.
- EDSR ×2 (Saafke/EDSR_Tensorflow, Apache 2.0) — увеличение фото.
