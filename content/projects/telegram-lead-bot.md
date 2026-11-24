---
name: "Telegram Lead Bot"
tagline: { ru: "Telegram-бот для фрилансеров и малого бизнеса: клиент оставляет заявку за 4 шага, владелец ведёт её статус в чате", en: "A Telegram bot for freelancers and small businesses: clients send a request in four steps, the owner tracks it in chat" }
event: { ru: "", en: "" }
date: 2026-06-30
period: { ru: "29–30 июня 2026", en: "29–30 June 2026" }
status: { ru: "Прототип: запускался локально, 19 из 19 тестов проходят", en: "Prototype: launched locally, all 19 tests pass" }
result: { ru: "", en: "" }
team: { ru: "Соло, вместе с ИИ-ассистентом Claude Sonnet 4.6", en: "Solo, working with the Claude Sonnet 4.6 AI assistant" }
problem: { ru: "Фрилансерам, агентствам, коучам и небольшим компаниям нужно принимать заявки круглосуточно — без менеджера и без отдельной CRM. Владельцу важно сразу видеть контакт, задачу и бюджет клиента и держать все заявки в одном месте, не переключаясь между сервисами.", en: "Freelancers, agencies, coaches and small businesses need to take client requests around the clock, without a manager or a separate CRM. The owner wants to see the client's contact, task and budget right away and keep every request in one place, without switching between tools." }
did:
  ru: |
    - Собрал бота на Python и aiogram 3 с кнопочным меню. Заявка — форма из четырёх шагов: имя, телефон или Telegram, задача и бюджет (четыре готовых варианта на кнопках). Имя, контакт и задача проверяются на минимальную длину; на этих шагах есть кнопка «Отмена».
    - После отправки клиент получает номер и сводку своей заявки, а все администраторы из настроек сразу получают уведомление: имя, контакт, ссылка на Telegram клиента, задача и бюджет.
    - Управление заявками — прямо в чате и только для администраторов: /leads показывает последние 10 заявок с фильтром по статусу, а статус («Новая», «В работе», «Закрыта», «Отказ») меняется инлайн-кнопкой под заявкой. /stats считает пользователей и заявки, /broadcast рассылает сообщение всем пользователям с отчётом: сколько отправлено и сколько с ошибкой.
    - Данные хранятся в SQLite (aiosqlite) в трёх таблицах: пользователи, сообщения, заявки. Middleware сам регистрирует каждого, кто обращается к боту, и логирует события через loguru; при старте бот до пяти раз пробует подключиться к Telegram API и при сбое выдаёт понятную подсказку.
    - Вынес название компании, слоган, приветствие и контакты в .env, чтобы оформление под нового клиента менялось без правки кода. Добавил 19 тестов на pytest и пять документов для продажи и установки: описание продукта с тремя пакетами, преимущества со сравнительной таблицей, FAQ на 14 вопросов, инструкцию по установке с автозапуском через systemd и памятку для владельца.
  en: |
    - Built the bot in Python using aiogram 3, with a button menu. A request is a four-step form: name, phone or Telegram handle, task and budget (four preset options on buttons). Name, contact and task are checked for a minimum length, and each of these steps has a Cancel button.
    - On submission the client gets the request number and a summary, and every admin listed in the settings is notified at once with the name, contact, a link to the client's Telegram, the task and the budget.
    - Request management lives right in the chat and is admin-only: /leads lists the latest 10 requests, optionally filtered by status, and the status (New, In progress, Closed, Rejected) is switched with an inline button under each request. /stats counts users and requests, and /broadcast messages every user and reports how many sends went through and how many failed.
    - Data is stored in SQLite (aiosqlite) in three tables: users, messages and requests. Middleware registers everyone who contacts the bot and logs events with loguru; on startup the bot tries to reach the Telegram API up to five times and gives a clear hint if it still fails.
    - Moved the company name, tagline, greeting and contacts into .env so the bot can be rebranded for a new client without touching the code. Added 19 pytest tests and five sales and setup documents: a product description with three packages, an advantages sheet with a comparison table, a 14-question FAQ, an installation guide with systemd autostart and a guide for the owner.
outcome: { ru: "Прототип: все 19 тестов проходят, 29 июня 2026 года бот подключался к Telegram при локальном запуске. Сведений о развёртывании, пользователях и продажах нет, репозиторий не опубликован.", en: "A prototype: all 19 tests pass, and on 29 June 2026 the bot connected to Telegram when run locally. There is no record of a deployment, users or sales, and the repository has not been published." }
stack: [ "Python", "aiogram 3", "Telegram Bot API", "SQLite", "aiosqlite", "python-dotenv", "loguru", "pytest" ]
metrics:
  - { value: "19/19", label: { ru: "автотестов pytest проходят: настройки и работа с базой данных", en: "pytest tests pass, covering the config and the database layer" } }
  - { value: "4", label: { ru: "шага в форме заявки: имя, контакт, задача, бюджет", en: "steps in the request form: name, contact, task, budget" } }
  - { value: "7", label: { ru: "команд бота, из них 3 — только для администраторов", en: "bot commands, 3 of them admin-only" } }
  - { value: "5", label: { ru: "документов для продажи и установки бота", en: "documents for selling and installing the bot" } }
links: []
gallery: []
size: sm
order: 12
featured: false
achievements: []
---
