# ViewPeople

**Автор:** Ильин Константин Юрьевич ИУ5-81Б

Десктопное приложение (Windows): **две** веб-камеры одновременно (счёт по каждой), **или** один видеофайл, **или** **ссылка на трансляцию** (Twitch и др. через **yt-dlp**, подтягивается в `npm run setup:assets`); по заданному интервалу — оценка числа людей (COCO-SSD или YOLOv8n ONNX).

## Требования

- Node.js 20+ (рекомендуется LTS)
- npm (идёт с Node.js). В репозитории закоммичен **`package-lock.json`** — для воспроизводимых сборок используйте **`npm ci`**.

## Разработка

```bash
npm install
npm run dev
```

## Сборка установщика Windows

Перед сборкой подтягивается модель YOLO (`resources/models/yolov8n.onnx`), затем бандл и NSIS:

```bash
npm run build:win
```

Артефакты — в каталоге `release/`. Подробнее: `docs/Сборка Windows exe.md` (Obsidian-vault в `docs/`).

В `package.json` для Windows задано **`signAndEditExecutable: false`**, чтобы сборка не требовала распаковки вспомогательного архива с симлинками (на части ПК без режима разработчика это приводило к ошибке 7-Zip). Имя приложения и установщика по-прежнему задаются через `productName` / NSIS; при необходимости полной правки ресурсов `.exe` включите [режим разработчика Windows](https://learn.microsoft.com/windows/apps/get-started/enable-your-device-for-development) и уберите эту опцию.

## CI

В GitHub Actions на **Windows** выполняется полная **`npm run build:win`**, установщик выкладывается как **artifact** прогона (см. вкладка Actions → выбранный workflow → Artifacts).

## Лицензия

MIT
