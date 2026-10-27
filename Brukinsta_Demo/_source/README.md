# Исходники демо-контента Brukinsta

Remotion 4 (React) для видео и статики, Piper для озвучки, Python и numpy для музыки, SFX и сведения, FFmpeg для финальной сборки.

```
src/theme.ts            палитра и шрифты (Unbounded, Manrope, JetBrains Mono — OFL, лежат в public/fonts)
src/components/         общие элементы: окна, карточки заявок, кинетические заголовки, переходы, субтитры
src/Short.tsx           короткий ролик 1080×1920
src/Long.tsx            длинный ролик 1920×1080
src/Carousel.tsx        7 слайдов 1080×1350
src/Stories.tsx         Stories 1080×1920 и обложка Reels
src/data/*.json         таймлайны (сцены, реплики, слова с таймкодами), генерируются voice.py
scripts/*_script.json   тексты сценариев по сценам
scripts/voice.py        озвучка Piper (ru_RU-denis-medium) + пословное выравнивание через распознавание речи (sherpa-onnx)
scripts/sound.py        синтез музыки и SFX, ducking под голос, сведение
scripts/render.mjs      рендер видео и кадров через Remotion
scripts/stills.mjs      рендер PNG (карусель, Stories)
scripts/mux.sh          склейка видео и звука, нормализация −14 LUFS
scripts/make_srt.py     SRT-субтитры из таймлайна
scripts/verify_audio.py проверка готового MP4: распознавание речи в окнах реплик
```

## Пересборка

```bash
npm i
# голос: нужен venv с piper-tts, sherpa-onnx, soundfile, scipy и модели (см. пути в voice.py)
python scripts/voice.py scripts/short_script.json public/audio/short_voice.wav src/data/short.json 0.95
python scripts/sound.py short src/data/short.json public/audio/short_voice.wav out/short_mix.wav
node scripts/render.mjs Short video out/short_silent.mp4
scripts/mux.sh out/short_silent.mp4 out/short_mix.wav ../01_Short_Video/Brukinsta_Short_Zayavki_1080x1920.mp4
```

Для длинного ролика то же самое с `long` (length_scale 1.03). Если поменять текст сценария, тайминги анимации пересчитаются сами: сцены привязаны к репликам и словам из `src/data/*.json`.

Голосовые модели: `vits-piper-ru_RU-*-medium` (Piper, датасет NabuCasa voice-datasets, CC0), скачаны из релизов k2-fsa/sherpa-onnx. Модель распознавания: `sherpa-onnx-zipformer-ru-2024-09-18`.

Лицензия Remotion: бесплатна для частных лиц и компаний до трёх сотрудников. Для коммерческого производства более крупной командой нужна платная Company License (remotion.pro).
