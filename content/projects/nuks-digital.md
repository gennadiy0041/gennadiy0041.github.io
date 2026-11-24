---
name: "NUKS Digital"
tagline: { ru: "Веб-платформа для занятий с детьми с ЗПР по методике НУКс: оценка, план с объяснениями, зверушки-тренеры и отчёт семье", en: "A web platform for NUKS-method work with children with developmental delays: assessment, explained plans, animal coaches" }
event: { ru: "AQMOLA POWER 2026, Акмолинская область", en: "AQMOLA POWER 2026, Akmola Region" }
date: 2026-10
period: { ru: "сентябрь–ноябрь 2026", en: "September–November 2026" }
status: { ru: "MVP, демо работает онлайн", en: "MVP, demo live online" }
result: { ru: "", en: "" }
team: { ru: "Соло; методика НУКс используется с письменного согласия её авторов", en: "Solo; the NUKS method is used with its authors' written consent" }
problem: { ru: "Специалист, который занимается с ребёнком с задержкой психического развития (ЗПР), сам подбирает упражнения под его потребности и ограничения, держит посильную сложность, ведёт записи и пишет отчёт семье. Всё это обычно остаётся в тетради одного человека: если специалист меняется, маршрут ребёнка начинается заново. А авторская методика НУКс, на которой построен проект, применяется только очно.", en: "A specialist working with a child with a developmental delay picks exercises to fit the child's needs and limits, keeps the difficulty manageable, takes notes and writes reports for the family. All of it usually lives in one person's notebook, so when the specialist changes, the child's route starts over. And the NUKS method behind the project is delivered only face to face." }
did:
  ru: |
    - Собрал веб-MVP, который переводит в цифру части «Н» и «У» методики НУКс — нейро-физические упражнения и упражнения для ума (внимание, память, мышление, речь). Маршрут в 10 шагов ведёт от регистрации специалиста, профиля ребёнка с целями и ограничениями и первичной оценки (18 проб по 6 доменам) к плану, занятию, динамике и отчёту; ручные краниосакральные техники остаются очными.
    - Построил подбор плана: сначала правила допустимости — возраст, ограничения, стоп-сигналы, затем ранжирование по потребностям, целям, истории и вовлечённости; модель типа Эло оценивает, насколько ребёнок справится с упражнением, и в рейтинге выше идут упражнения с оценкой ближе к середине целевой зоны 60–80% (это ориентир, а не гарантия). У каждого упражнения есть объяснение «потому что», у исключённого — причина, а последнее слово за специалистом.
    - Добавил занятия со зверушками-тренерами (обезьянка показывает ребёнку движение), экран ребёнка, две игры — «Зоркий глаз» (Go/No-Go) и «Светлячки» (последовательности) — и страницу для телефона: по QR-коду открывается упражнение, и движение показывает зверушка. Родителям — отчёт простыми словами и задание домой.
    - Сделал серверную версию 1.0.0 на Node.js 24 со встроенным SQLite: аккаунты, подтверждение e-mail и восстановление пароля, загрузка документов о квалификации с ручной проверкой, раздельные учебный и рабочий кабинеты. Пароли хранятся как хеши scrypt, профили детей и документы шифруются AES-256-GCM, есть Dockerfile.
    - Проверил проект скриптами: движок подбора — на 1000 синтетических профилей (4000 планов без нарушений проверяемых правил), 10 из 10 регрессионных проверок основных сценариев и сохранения данных, 12 групп браузерных сценариев на Playwright и Edge без ошибок JavaScript и 11 браузерных проверок серверной версии.
    - Подготовил пакет для AQMOLA POWER 2026: заявку, пояснительную записку с дизайном пилота (2 центра, 8 недель, до 20 детей), видео на 2:56, финансовую модель на 2027–2029 годы, roll-up и материалы стенда. Затем собрал питч-дек для IDEA BATTLE DIGITAL AIMAQ с планом пилота в Айыртауском районе СКО.
  en: |
    - Built a web MVP that brings the ‘N’ and ‘U’ parts of the NUKS method into digital form: neuro-physical exercises and ‘exercises for the mind’ (attention, memory, thinking, speech). A 10-step route leads from the specialist's sign-up, a child profile with goals and limits and an initial assessment (18 probes across 6 domains) to the plan, the session, progress and a report; hands-on craniosacral techniques stay face to face.
    - Designed the plan builder: eligibility rules come first — age, restrictions, stop signals — then exercises are ranked by needs, goals, history and engagement, and an Elo-style model estimates how well the child will manage each exercise, so the ranking favours exercises whose estimate is closer to the middle of a 60–80% target zone (a guide, not a guarantee). Every exercise comes with a ‘because’, every excluded one with a reason, and the specialist has the final say.
    - Added sessions with cartoon animal coaches (a monkey shows the child each move), a child screen, two games — ‘Sharp Eye’ (Go/No-Go) and ‘Fireflies’ (sequences) — and a phone view that opens an exercise from a QR code, with a cartoon animal showing the move. Parents get a plain-language report and homework.
    - Built server version 1.0.0 on Node.js 24 with its built-in SQLite: accounts, e-mail confirmation and password recovery, qualification-document upload with manual review, and separate training and working spaces. Passwords are stored as scrypt hashes, child profiles and documents are encrypted with AES-256-GCM, and there is a Dockerfile.
    - Tested the project with scripts: the plan engine on 1,000 synthetic profiles (4,000 plans with no violations of the checked rules), 10 of 10 regression checks of core flows and data saving, 12 groups of Playwright + Edge browser scenarios with no JavaScript errors, and 11 browser checks of the server version.
    - Prepared the AQMOLA POWER 2026 package: the application, an explanatory note with a pilot design (2 centres, 8 weeks, up to 20 children), a 2:56 video, a 2027–2029 financial model, a roll-up and stand materials. Then put together a pitch deck for IDEA BATTLE DIGITAL AIMAQ with a pilot plan for Aiyrtau District in North Kazakhstan Region.
outcome: { ru: "Подал NUKS Digital на AQMOLA POWER 2026 и получил на конкурсе сертификат за активное участие. Демо на вымышленных данных опубликовано онлайн; серверная версия с аккаунтами работает локально и пока не размещена в интернете. С реальными специалистами и детьми платформа ещё не проверялась, а упражнения в ней демонстрационные — их предстоит заменить авторскими материалами НУКс по согласованию с авторами.", en: "Submitted NUKS Digital to AQMOLA POWER 2026 and received a certificate of active participation at the contest. The demo on fictional data is published online; the server version with accounts runs locally and is not hosted yet. The platform has not been tried with real specialists or children, and its exercises are demo versions, to be replaced with the authors' NUKS materials once agreed." }
stack: [ "JavaScript", "Node.js 24", "SQLite", "Elo rating", "HTML/CSS", "SVG", "scrypt", "AES-256-GCM", "Docker", "Playwright" ]
metrics:
  - { value: "0", label: { ru: "нарушений проверяемых правил в 4000 планах для 1000 синтетических профилей", en: "violations of the checked rules in 4,000 plans for 1,000 synthetic profiles" } }
  - { value: "18", label: { ru: "проб первичной оценки по 6 доменам", en: "assessment probes across 6 domains" } }
  - { value: "19", label: { ru: "упражнений в демо-каталоге", en: "exercises in the demo catalogue" } }
  - { value: "10/10", label: { ru: "регрессионных проверок: основные сценарии и сохранение данных", en: "regression checks: core flows and data saving" } }
links: []
cover: ./media/nuks-digital/cover.webp
coverAlt: { ru: "Экран занятия в демо-версии: план из шести упражнений, таймер и обезьянка-тренер показывает упражнение «Ухо — нос»", en: "Session screen in the demo: a six-exercise plan, a timer and a cartoon monkey coach showing the ‘Ear–nose’ exercise" }
gallery:
  - { src: ./media/nuks-digital/1.webp, caption: { ru: "Как собирается план: данные → безопасность → потребности → сложность → план (демо-профиль)", en: "How the plan is built: data → safety → needs → difficulty → plan (demo profile)" } }
  - { src: ./media/nuks-digital/2.webp, caption: { ru: "Правило безопасности: «Бревнышко» не попало в план — ребёнку нельзя кружиться (демо-профиль)", en: "A safety rule at work: ‘Log roll’ is left out because the child must not spin (demo profile)" } }
  - { src: ./media/nuks-digital/3.webp, caption: { ru: "Динамика по шести доменам за 8 занятий (демо-данные)", en: "Progress across six domains over 8 sessions (demo data)" } }
  - { src: ./media/nuks-digital/4.webp, caption: { ru: "Схема из демо-видео — так задумано: QR на карточке открывает упражнение на телефоне, его показывает зверушка (QR-карточки заложены в смету пилота)", en: "Diagram from the demo video, the planned flow: a QR code on a card opens the exercise on a phone, where a cartoon animal shows it (QR cards are in the pilot budget)" } }
size: sm
order: 4
featured: true
achievements: [ 2026-aqmola-power-participation ]
---
