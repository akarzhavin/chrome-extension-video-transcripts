# Dev-флаги в URL

Работают **только в dev-сборках** (`npm run build:dev`) — в проде ветки вырезаются
минификатором через гард `__EXT_ENV__ !== 'dev'`, в бандле их нет.

Флаги ставятся в **хеш** URL, не в query: YouTube (SPA) переписывает адресную
строку при загрузке плеера и выбрасывает чужие query-параметры до того, как
контент-скрипт успевает их прочитать; HDrezka срезает `?…` на редиректе. Хеш
переживает и то и другое. Regex в коде принимает `[?#&]`, но надёжна именно
хеш-форма.

## `lingogram_rate=1` — карточка «оцените нас»

```
https://www.youtube.com/watch?v=<id>#lingogram_rate=1
https://rezka.ag/…/12345-….html#t:238-s:1&lingogram_rate=1
```

Принудительно рендерит рейтинг-промпт (P1.8) — карточку «Enjoying Lingogram?»
в правом нижнем углу. В обычной жизни она показывается **один раз за установку**,
после 30-го сохранённого слова, поэтому без флага посмотреть на неё повторно
можно только сбросив `chrome.storage`.

Флаг не трогает состояние: счётчик `rate.savedWordCount` не инкрементируется,
one-shot `rate.promptShown` не выжигается. Вход в аккаунт не нужен.

Из карточки достижимы обе ветки:

- **«Да!»** → шаг 2 со ссылкой на страницу отзывов в Web Store;
- **«Не очень»** → форма обратной связи (textarea + «Отправить»). Отправка
  идёт в Firestore **по-настоящему**, в тот проект, на который собран билд —
  проверяя её, следи, чтобы это был не прод. Работает и без входа в аккаунт.

Реализация: `applyDevRatePromptOverride()` в
`packages/shared/src/content/quick-add-overlay.ts` (вызывается из
`installQuickAddOverlay`). Боевая логика порога — `ADD_WORD` в
`packages/shared/src/auth/background.ts`.

### Препрод-сборка для проверки отправки

`npm run build:dev` уводит Firestore на `localhost:8080` (эмулятор) независимо
от `EXT_FIREBASE_PROJECT_ID`, поэтому для проверки записи в настоящий препрод
нужен гибрид: background в prod-режиме (боевой Firestore препрода), content в
dev (иначе флаг вырежется). Порядок важен — `--mode background` чистит
`build/`, так что он всегда первый:

```sh
cd apps/youtube
export EXT_FIREBASE_PROJECT_ID=lingogram-preprod
export EXT_FRONTEND_BASE_URL=https://preprod.lingogram.ai
../../node_modules/.bin/vite build --mode background
EXT_ENV=dev ../../node_modules/.bin/vite build --mode content
../../node_modules/.bin/vite build --mode page-script
../../node_modules/.bin/vite build --mode popup
```

Chrome 138+ игнорирует `--load-extension`, так что распакованное расширение
ставится в постоянный профиль руками один раз, а дальше им управляют по CDP —
см. `apps/youtube/screenshots/run-all.sh`.

## `lng=<locale>` — подмена локали (rezka)

```
https://rezka.ag/…/84221-….html#t:238-s:1-e:1&lng=ru
```

Подменяет i18n-сообщения расширения локалью из `_locales/<locale>/messages.json`
без смены языка Chrome (на macOS его флагом не сменить). Только rezka-edition.

Реализация: `applyDevLocaleOverride()` в `apps/rezka/src/content/index.ts`,
обработчик `DEV_LOAD_LOCALE` в `apps/rezka/src/background/background.ts`.
