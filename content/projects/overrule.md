---
name: "Overrule"
tagline: { ru: "Тренажёр для тех, кто работает с ИИ: 5 минут в день искать ошибки, которые ИИ спрятал в документе по своей профессии", en: "A five-minute daily drill for people who use AI at work: find the mistakes AI hid in a document from your own job" }
event: { ru: "Business Cup 2.0, Астана", en: "Business Cup 2.0, Astana" }
date: 2026-11-15
period: { ru: "14–15 ноября 2026 · 24 часа", en: "14–15 November 2026 · 24 hours" }
status: { ru: "MVP работает онлайн", en: "MVP live online" }
result: { ru: "", en: "" }
team: { ru: "Соло, вместе с ИИ-агентом Claude Code", en: "Solo, working with the Claude Code AI agent" }
problem: { ru: "Кейс хакатона, трек Skills: за 24 часа сделать B2C веб-продукт, который закрывает фундаментальную боль работающих взрослых в США и за который они заплатят. Выбранная боль: ИИ на работе уже обязателен, а за его ошибки отвечает человек — по данным KPMG (2025), 58% работников в США полагаются на результат ИИ, не проверяя его как следует. Курсы учат делать с ИИ больше, но ловить его ошибки на задачах своей профессии не учит никто.", en: "The hackathon brief, Skills track: in 24 hours, build a B2C web product that solves a fundamental pain for working US adults, one they will pay for. The pain I picked: AI is now expected at work, yet people still answer for its mistakes — per KPMG (2025), 58% of US workers rely on AI output without properly checking it. Courses teach people to do more with AI; nobody trains them to catch its mistakes on the tasks of their own job." }
did:
  ru: |
    - Написал подробное ТЗ для ИИ-агента Claude Code — продукт, механика заданий, подсчёт баллов, экраны, требования к коду, план по часам — и вместе с ним собрал и запустил Overrule: 37 коммитов за 15,5 часа, код открыт под MIT.
    - Карта влияния ИИ: скан профессии считает, какую долю работы ИИ уже может ускорить, по 19 265 задачам O*NET с разметкой из исследования «GPTs are GPTs». Расчёт воспроизводит опубликованные оценки всех 923 профессий с расхождением меньше 10⁻⁹.
    - Задания: Claude пишет рабочий документ по задаче пользователя с 3–4 ошибками и строками-ловушками, а код без ИИ проверяет структуру и пересчитывает каждое число. Если черновик не прошёл проверку — повтор с замечаниями, затем Gemini, затем пул из 54 проверенных заданий. Отметки пользователя код сверяет с ключом, рейтинг считается по Эло.
    - Утром в день дедлайна, после внешнего отзыва, добавил Defend your work: пользователь вставляет отчёт перед отправкой и получает пять вопросов к его строкам — таких, какие может задать руководитель. Вставленный текст не сохраняется.
    - 445 юнит- и API-тестов, 14 e2e-прогонов Playwright против прода на телефоне и компьютере, CI на GitHub Actions; потолок трат на модели — к сдаче ушло около $0,54 из $18.
    - Для жюри: дек из 10 слайдов, 30-секундный рекламный ролик, видео-демо, скрипт питча и ответы на вероятные вопросы.
  en: |
    - Wrote a detailed brief for the Claude Code AI agent — product, drill mechanics, scoring, screens, engineering requirements and an hour-by-hour plan — and built and shipped Overrule with it: 37 commits in 15.5 hours, open source under MIT.
    - AI-exposure map: a job scan estimates how much of the work AI can already speed up, from 19,265 O*NET tasks labelled in the “GPTs are GPTs” study. The engine reproduces the published scores of all 923 occupations to within 10⁻⁹.
    - Drills: Claude writes a work document for one of the user's tasks with 3–4 planted mistakes and decoy lines; plain code checks its structure and recomputes every number. If a draft fails, there is one retry with the findings, then Gemini, then a pool of 54 verified drills. Code checks each flag against the key, and the rating is Elo.
    - On the morning of the deadline, after outside feedback, added Defend your work: the user pastes a report before sending it and gets five questions about its lines, the kind a manager may ask. Nothing pasted is stored.
    - 445 unit and API tests, 14 Playwright end-to-end runs against production on phone and desktop, CI on GitHub Actions; a hard cap on model spend, with about $0.54 of $18 used by submission.
    - For the jury: a 10-slide deck, a 30-second ad film, a demo video, a pitch script and answers to likely questions.
outcome: { ru: "Кейс сдан в срок со всеми тремя обязательными частями: дек, продукт в проде и публичный репозиторий. Overrule работает онлайн без регистрации, CI на GitHub зелёный. Главное для бизнеса ещё не проверено — будут ли за это платить: оплата пока в демо-режиме и денег не списывает.", en: "Submitted on time with all three required parts: the deck, the product in production and a public repository. Overrule runs online with no sign-up, and CI on GitHub is green. The key business question is still open — whether people will pay: checkout is a demo that charges nothing." }
stack: [ TypeScript, React, Claude API, Gemini API, Bun, Hono, SQLite, Tailwind CSS, Playwright, Railway ]
metrics:
  - { value: "923", label: { ru: "профессии в карте влияния ИИ", en: "occupations in the AI-exposure map" } }
  - { value: "39/87", label: { ru: "черновиков модели отсеяла проверка кодом", en: "model drafts rejected by the code check" } }
  - { value: "445", label: { ru: "юнит- и API-тестов", en: "unit and API tests" } }
  - { value: "≈ $0.06", label: { ru: "расход на модель за одно задание", en: "model spend per drill" } }
links:
  - { label: { ru: "Живой продукт", en: "Live product" }, url: "https://overrule-production.up.railway.app", kind: demo }
  - { label: { ru: "Демо-профиль", en: "Demo profile" }, url: "https://overrule-production.up.railway.app/demo", kind: demo }
  - { label: { ru: "Код на GitHub", en: "Code on GitHub" }, url: "https://github.com/gennadiy0041/overrule", kind: repo }
  - { label: { ru: "Сайт Business Cup 2.0", en: "Business Cup 2.0 website" }, url: "https://businesscup.zimran.io", kind: event }
cover: ./media/overrule/cover.webp
coverAlt: { ru: "Дашборд Overrule в демо-профиле: задание дня Daily Catch, рейтинг Judgment Score и пойманные ошибки по пяти типам", en: "Overrule dashboard in the demo profile: today's Daily Catch, the Judgment Score and catches across five mistake types" }
gallery:
  - { src: ./media/overrule/1.webp, caption: { ru: "Скан профессии: личная карта влияния ИИ на работу", en: "Job scan: a personal map of AI exposure" } }
  - { src: ./media/overrule/2.webp, caption: { ru: "Задание: найти ошибки в письме, написанном ИИ", en: "Drill: flag the mistakes in an AI-written email" } }
  - { src: ./media/overrule/3.webp, caption: { ru: "Разбор: 5.5x был верным — ложная тревога стоит баллов", en: "Review: 5.5x was right, and a false alarm costs points" } }
  - { src: ./media/overrule/4.webp, caption: { ru: "Одна из 923 страниц «Заменит ли ИИ…?»", en: "One of 923 “Will AI replace…?” pages" } }
size: lg
order: 2
featured: true
achievements: [ 2026-business-cup-overrule ]
---
