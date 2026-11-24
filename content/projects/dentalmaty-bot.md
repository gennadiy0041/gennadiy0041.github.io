---
name: "DentAlmatyBot"
tagline: { ru: "Telegram-бот для стоматологической клиники: GPT-4o отвечает пациентам, а заявки на приём уходят в Google Sheets", en: "A Telegram bot for a dental clinic: GPT-4o answers patients, and appointment requests go straight to Google Sheets" }
event: { ru: "", en: "" }
date: 2025-06-05
period: { ru: "2–5 июня 2025", en: "2–5 June 2025" }
status: { ru: "Рабочий прототип, показан в презентации для клиник", en: "Working prototype, shown in a deck for clinics" }
result: { ru: "", en: "" }
team: { ru: "Соло — план, код, оформление бота и презентация", en: "Solo: plan, code, bot branding and the deck" }
problem: { ru: "Пациенты стоматологических клиник не могут записаться ночью и в выходные, администраторы перегружены звонками, а ручной ввод данных приводит к ошибкам в записи. Задача — отдать боту типовые вопросы о процедурах и ценах, а заявки на приём сразу собирать в таблицу, без ручного переноса.", en: "Dental clinic patients cannot book at night or at weekends, front-desk staff are swamped with calls, and manual data entry leads to booking mistakes. The aim was to hand routine questions about procedures and prices to a bot and to collect appointment requests straight into a spreadsheet, with no retyping." }
did:
  ru: |
    - Написал Telegram-бота на Python и aiogram 3. По /start он присылает приветствие с фото и двумя инлайн-кнопками: «Хочу записаться» и «У меня есть вопрос».
    - Подключил GPT-4o через OpenAI API: каждое текстовое сообщение вне записи уходит модели с системным промптом доброжелательного консультанта клиники, который отвечает тепло и простым языком. В промпте — примерные цены на четыре услуги (консультация, пломбирование, удаление, отбеливание), указание деликатно приглашать в клинику, если вопрос сложный или нужен осмотр, и запрет ставить диагнозы и выдумывать то, чего бот не знает.
    - Сделал запись в два шага: имя и фамилия, затем телефон. Бот сам добавляет в Google Sheets строку с именем, телефоном, этапом «Запрос на консультацию» и временем заявки и дублирует заявку событием «Новая запись» в Google Calendar. К таблице и календарю он обращается через сервисный аккаунт Google; событие ставится на момент заявки и попадает в собственный календарь этого аккаунта.
    - Расписал план функций и стека: ИИ-автоответчик, приём заявок и передача их менеджеру, интеграция с CRM; Python и aiogram, OpenAI API, Google Sheets. Аватар и обложку бота с роботом-талисманом сгенерировал нейросетью.
    - Собрал в Gamma презентацию для стоматологических клиник на 8 слайдов: проблема, решение, демонстрация работы бота на реальных скриншотах, дальнейшие шаги и стоимость внедрения.
  en: |
    - Wrote the Telegram bot in Python with aiogram 3. On /start it sends a greeting with a photo and two inline buttons: ‘I want to book’ and ‘I have a question’.
    - Connected GPT-4o through the OpenAI API: every text message outside the booking flow goes to the model with a system prompt for a friendly clinic consultant who answers warmly and in plain words. The prompt holds approximate prices for four services (consultation, filling, extraction, whitening), tells the bot to gently invite people to the clinic when a question is complex or needs an examination, and forbids diagnoses and making things up.
    - Made booking a two-step flow: full name, then phone number. The bot itself adds a row to Google Sheets with the name, the phone, the stage ‘Consultation request’ and the time of the request, and mirrors the request as a ‘New booking’ event in Google Calendar. It reaches the sheet and the calendar through a Google service account; the event is timed to the moment of the request and goes into that account's own calendar.
    - Drew up a plan of the bot's features (AI auto-replies, taking requests and passing them to a manager, CRM integration) and its stack (Python with aiogram, the OpenAI API, Google Sheets). Made the bot's avatar and cover art, a robot mascot with a tooth, with an AI image generator.
    - Built an 8-slide Gamma deck for dental clinics: the problem, the solution, a demo of the bot using real screenshots, next steps and implementation pricing.
outcome: { ru: "Рабочий прототип: в презентации показан настоящий диалог с ботом в Telegram — ответы GPT-4o, в том числе на вопрос не по теме, — и строка заявки, которую бот сам записал в Google Sheets. Запись собирает только имя и телефон: время приёма бот не предлагает и напоминаний не отправляет, а после заявки сообщает, что клиника свяжется сама. Сведений о запуске бота в клинике и о продажах нет.", en: "A working prototype: the deck shows a real Telegram chat with the bot, including GPT-4o's reply to an off-topic question, and a request row the bot wrote to Google Sheets by itself. Booking collects only a name and a phone number: the bot does not offer appointment times or send reminders, and after a request it says the clinic will be in touch. There is no record of the bot running at a clinic or of any sales." }
stack: [ "Python", "aiogram 3", "OpenAI API", "GPT-4o", "Google Sheets API", "Google Calendar API", "aiohttp", "python-dotenv", "Gamma" ]
metrics:
  - { value: "2", label: { ru: "вопроса при записи — имя и телефон", en: "questions to book: name and phone number" } }
  - { value: "8", label: { ru: "столбцов в строке заявки: таблица устроена как простая CRM", en: "columns per request row: the sheet works like a simple CRM" } }
  - { value: "4", label: { ru: "услуги с примерными ценами в промпте консультанта", en: "services with approximate prices in the consultant prompt" } }
  - { value: "202", label: { ru: "строки на Python — весь бот в одном файле", en: "lines of Python: the whole bot in one file" } }
links: []
cover: ./media/dentalmaty-bot/cover.webp
coverAlt: { ru: "Обложка бота, сгенерированная нейросетью: название DentAlmatyBot, подпись «Ваш персональный помощник по стоматологии!» и робот-талисман с зубом", en: "The bot's AI-generated cover: the name DentAlmatyBot, the line ‘Your personal dental assistant!’ and a robot mascot with a tooth" }
gallery:
  - { src: ./media/dentalmaty-bot/1.webp, caption: { ru: "Приветствие по /start: фото, короткий текст и кнопки «Хочу записаться» и «У меня есть вопрос»", en: "The /start greeting: a photo, a short intro and the ‘I want to book’ and ‘I have a question’ buttons" } }
  - { src: ./media/dentalmaty-bot/2.webp, caption: { ru: "Ответы GPT-4o: цена отбеливания, удаление зуба, адрес (скрыт) и вопрос не по теме, который бот возвращает к услугам клиники", en: "GPT-4o replies: whitening prices, tooth extraction, the address (hidden) and an off-topic question steered back to the clinic's services" } }
  - { src: ./media/dentalmaty-bot/3.webp, caption: { ru: "Тестовая заявка, записанная ботом в Google Sheets; соседняя строка и номер телефона скрыты", en: "A test request the bot wrote to Google Sheets; the other row and the phone number are hidden" } }
size: sm
order: 15
featured: false
achievements: []
---
