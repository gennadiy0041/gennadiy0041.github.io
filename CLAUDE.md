# CLAUDE.md — портфолио Геннадия Козлова

Сайт: https://gennadiy0041.github.io (RU) и /en/ (EN). Репозиторий публичный: `gennadiy0041/gennadiy0041.github.io`.
Каждый push в `main` → GitHub Actions собирает сайт (страницы + PDF-резюме + превью для соцсетей) и публикует на GitHub Pages (~2–3 мин).

Владелец — Геннадий, пишет по-русски. Отвечай по-русски, коротко.

## Правила (обязательные, без исключений)

1. **Приватность.** На сайт, в репозиторий, в коммиты и в манифест никогда не попадают: ИИН/ЖСН, номера документов/сертификатов/регистрации, QR- и штрих-коды документов, телефоны, адреса, даты рождения, оценки/баллы/GPA, e-mail других людей. Если это есть на документе — закрашиваем через `redact` (см. ниже), не размытием.
2. **Исходники не коммитим.** Папка с документами: `C:\Dad\*chievements` (первая «А» кириллическая — ищи по маске, имя не хардкодь). Она только для чтения: ничего не переименовывать, не перемещать, не удалять. В репо попадают только обработанные картинки из `npm run media`. Имена исходных файлов могут содержать ИИН — не упоминай их в контенте, коммитах и сообщениях.
3. **Ничего не выдумывать.** Каждый факт (название, организатор, дата, место) — только из документа. Непонятное — спросить у Геннадия, а не угадывать.
4. **Без ярлыков.** Не называть его «разработчиком», «специалистом», «спортсменом» — описывать, что сделано.
5. **Чужие материалы.** Геннадий часто делает материалы для других людей. Если не уверен, что проект/документ его, — не публиковать и спросить.
6. Папка `.private/` (превью, OCR, черновики, таблица ревью) — локальная и в git не попадает.

## «Обнови ачивки» — процедура

Геннадий кладёт новый файл в папку достижений и пишет «обнови ачивки». Делай так:

1. `npm run sync` — находит файлы, которых нет в `content/.sync/manifest.json` (идентификация по SHA-256), рендерит страницы, делает OCR (Windows OCR), ищет приватные данные и кладёт всё в `.private/inbox/<sha12>/`:
   `page-N.png` (оригинал), `review-N.png` (найденные кандидаты на закраску в рамках), `redacted-N.webp`, `ocr-N.json`, `candidates.json`, `draft.md`.
2. Для каждого нового файла **посмотри** `page-*.png` и `review-*.png` (Read). Реши:
   - это ачивка Геннадия → создай `content/achievements/<id>.md` из `draft.md` (id: `yyyy-коротко-латиницей`), заполни все поля RU+EN только по документу;
   - не ачивка / личный документ / не его / дубль → `npm run sync -- --hide <sha12> --reason <код> --note "почему"`.
3. Проверь `redact`: каждый ИИН/номер/QR/телефон/адрес/оценки закрыт; название, ФИО и организатор — не закрыты. Координаты — доли страницы (0..1), их удобно брать из `ocr-N.json` (пиксели ÷ размер страницы). Для фото документа на столе добавь `crop`.
4. `npm run media -- --id <id>` → открой получившийся `content/achievements/media/<id>.webp` (Read) и убедись, что приватного не видно. Если видно — поправь `redact` и повтори.
5. `npm run sync -- --link <sha12> --entry <id> [--pages N]`.
6. `npm run build` (должен пройти без ошибок), затем `git add -A && git commit -m "Add achievement: <id>" && git push`.
7. `gh run watch` (или `gh run list --limit 1`) — дождись зелёной сборки, открой https://gennadiy0041.github.io/#a-<id> и проверь карточку и документ в лайтбоксе.
8. Коротко отчитайся Геннадию: что добавлено, что скрыто и почему, что спросить.

Подробности и коды причин: `docs/SYNC.md`.

## Поля ачивки (`content/achievements/<id>.md`)

```yaml
title: { ru: "...", en: "..." }        # коротко: что и где
event: { ru: "...", en: "..." }        # название конкурса/конференции/курса
issuer: { ru: "...", en: "..." }       # кто выдал
date: 2026-11-11                       # YYYY | YYYY-MM | YYYY-MM-DD — как на документе
category: hackathon                    # hackathon | pitch-startup | conference | publication | olympiad | competition | sport | course | language-test | grant-scholarship | academic-mobility | volunteering | work | other
level: national                        # international | national | regional | city | university | school | online | unknown
result: { ru: "Финалист", en: "Finalist" }
description: { ru: "1–2 предложения", en: "..." }
podium: true                           # призовое место / победа / финал → фильтр «Только призовые» и счётчик
featured: false                        # 8–10 сильнейших
project: tamyr                         # (необязательно) id проекта из content/projects
image: ./media/<id>.webp               # ставит `npm run media`
source: [{ sha256: "...", pages: "1" }]
redact: [{ page: 1, x: 0.71, y: 0.06, w: 0.22, h: 0.04, kind: doc-number }]
crop: { x: 0.05, y: 0.03, w: 0.9, h: 0.94 }   # необязательно
```

Черновики и скрытые записи в `content/` не кладём (файлы, начинающиеся с `_`, сборка игнорирует).

## Проекты и профиль

- `content/projects/<id>.md`: name, tagline, event, date, status, result, problem / did / outcome (RU+EN), stack, metrics, links, cover, gallery, size (xl|lg|md|sm — размер в bento), order.
- `content/profile.yaml`: имя, фразы для печатающейся строки (глаголы, не должности), intro, about, образование, опыт, навыки, языки, контакты, фото.
- Картинки проектов/профиля обрабатываются через `.private/media-map.json` → `npm run media`.

## Команды

```bash
npm run dev                 # локальный сервер
npm run build               # astro build + PDF-резюме + OG-картинки (scripts/postbuild.mjs)
npm run sync -- --status    # что из папки уже на сайте / скрыто / ждёт
npm run media -- --check    # проверить, что у всех ачивок есть обработанные картинки
```

## Устройство

- `src/content.config.ts` — схемы контента; `src/lib/data.ts` — выборки; `src/i18n/` — RU/EN строки.
- `src/components/` — секции главной (`home/*`), страница проекта, резюме (`ResumeDoc.astro`), OG-карточки (`pages/og-card`).
- `src/scripts/` — анимации (`motion.ts`: Lenis + GSAP), UI (`ui.ts`), WebGL-фон (`hero-gl.ts`), поиск Ctrl+K (`palette.ts`), лайтбокс (`lightbox.ts`).
- Тяжёлые эффекты только при `html.rich` (десктоп, мышь, без «уменьшить движение»); на телефонах и при reduced motion — статично.
