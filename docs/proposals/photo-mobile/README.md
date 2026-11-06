# КП PhotoAgent для Photo-mobile

Коммерческое предложение на разработку системы пакетной AI-обработки школьных и детсадовских фотосессий (хромакей, переодевание с неизменным лицом, АРМ ОТК, экспорт в WOCI).

| Файл | Что это |
|---|---|
| `KP-PhotoAgent-Photo-mobile.pdf` | Готовое КП для отправки заказчику |
| `KP-PhotoAgent-Photo-mobile.docx` | То же КП в Word для правок (собрано на базе шаблона заказчика) |
| `kp-photoagent.html` | Исходник: весь текст правится здесь |
| `build.mjs` | Сборка PDF (Playwright) + номера страниц в содержании + картинка схемы |
| `build_docx.py` | Сборка DOCX из того же HTML на стилях `template.docx` |
| `template.docx` | Исходный шаблон КП |
| `fonts/` | Noto Serif (SIL OFL) для PDF |

## Пересборка

```bash
node docs/proposals/photo-mobile/build.mjs        # PDF + diagram-to-be.png
python3 docs/proposals/photo-mobile/build_docx.py # DOCX (нужны python-docx, beautifulsoup4)
```

Нумерация страниц в содержании PDF проставляется автоматически (нужен `pdftotext` из poppler-utils). В DOCX колонка страниц убрана, потому что Word разбивает страницы по-своему.
