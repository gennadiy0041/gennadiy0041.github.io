---
name: "NUKSupport"
tagline: { ru: "Telegram-справочник для родителей детей с ЗПР по методике НУКс: упражнения для дома, советы и ответы ИИ на вопросы", en: "A Telegram guide to the NUKS method for parents of children with developmental delays: home exercises, tips, AI answers" }
event: { ru: "AQMOLA POWER 2024, Акмолинская область", en: "AQMOLA POWER 2024, Akmola Region" }
date: 2025-10
period: { ru: "сентябрь 2024 — октябрь 2025", en: "September 2024 – October 2025" }
status: { ru: "Прототип, последняя версия — октябрь 2025", en: "Prototype, last updated October 2025" }
result: { ru: "", en: "" }
team: { ru: "В боте авторами проекта названы двое: он и руководитель проекта; бота на Python написал он", en: "The bot names two project authors: him and the project supervisor; he wrote the Python bot" }
problem: { ru: "Родителям детей с задержкой психического развития (ЗПР) не хватает понятной информации о методике НУКс и упражнениях, которые можно делать с ребёнком дома. НУКс — методика работы с такими детьми, созданная двумя другими авторами; в ней три направления: нейро-физические занятия, упражнения на развитие когнитивных процессов и кранио-сакральная терапия. По оценке из презентации проекта, в Акмолинской области около 4 300 детей с ЗПР, и их число растёт.", en: "Parents of children with developmental delays lack clear information about the NUKS method and the exercises they can do with their child at home. NUKS, a method created by two other authors for working with such children, has three strands: neuro-physical exercises, exercises that train cognitive processes, and craniosacral therapy. The project deck puts the number of children with developmental delays in Akmola Region at about 4,300 and growing." }
did:
  ru: |
    - Написал Telegram-бота на Python и aiogram 3. В главном меню четыре раздела: «Методика НУКс», «Упражнения для детей», «Рекомендации для родителей» и «О проекте». В феврале 2025 года подготовил бота к запуску на Railway как фоновый процесс (worker).
    - Наполнил бота справочным материалом: описания трёх направлений методики, упражнения по каждому из них и 8 советов родителям — от чёткого распорядка дня до терпения и последовательности.
    - В версии октября 2025 года разбил упражнения на 15 карточек, по 5 на направление; в каждой — пошаговая инструкция и чем упражнение полезно. Подразделы и карточки открываются inline-кнопками в том же сообщении: бот редактирует его, а не засыпает чат новыми.
    - Там же подключил GPT-4o-mini через OpenAI API: на вопрос, заданный своими словами, бот отвечает с опорой на методику. Системный промпт запрещает ставить диагнозы и подменять врача, а вопросы не по теме мягко возвращает к развитию ребёнка.
    - Добавил учёт в SQLite (aiosqlite): пользователи и их действия пишутся в базу, а команда /stats показывает администратору число пользователей и действий и пять последних действий.
  en: |
    - Wrote the Telegram bot in Python with aiogram 3. Its main menu has four sections: the NUKS method, exercises for children, recommendations for parents and an About page. In February 2025 prepared the bot to run on Railway as a background worker.
    - Filled the bot with reference material: descriptions of the method's three strands, exercises for each of them and 8 tips for parents, from a clear daily routine to patience and consistency.
    - In the October 2025 version, split the exercises into 15 cards, 5 per strand, each with step-by-step instructions and what the exercise is good for. Subsections and cards open via inline buttons in the same message: the bot edits it instead of flooding the chat with new ones.
    - In the same version, connected GPT-4o-mini through the OpenAI API: the bot answers questions asked in a parent's own words, drawing on the method. The system prompt forbids making diagnoses or standing in for a doctor, and gently steers off-topic questions back to the child's development.
    - Added logging to SQLite (aiosqlite): users and their actions are written to a database, and the /stats command shows the admin the number of users and actions and the five latest actions.
outcome: { ru: "С этим проектом участвовал в областном конкурсе AQMOLA POWER 2024 и получил там диплом за III место в направлении «IT саласы»; название проекта в дипломе не указано. Следующие шаги по плану из презентации — тестирование на фокус-группе родителей и онлайн-консультации. К методике НУКс вернулся в 2026 году с веб-платформой NUKS Digital.", en: "Entered the project in AQMOLA POWER 2024, the Akmola Region contest of innovative ideas and projects, and received a diploma there for 3rd place in the IT track; the diploma does not name the project. The next steps in the deck's plan are testing with a focus group of parents and online consultations. Returned to the NUKS method in 2026 with the NUKS Digital web platform." }
stack: [ "Python", "aiogram 3", "OpenAI API", "GPT-4o-mini", "SQLite", "aiosqlite", "python-dotenv", "Railway" ]
metrics:
  - { value: "15", label: { ru: "карточек упражнений — по 5 на каждое направление методики", en: "exercise cards, 5 for each strand of the method" } }
  - { value: "8", label: { ru: "советов родителям в отдельном разделе", en: "tips for parents in their own section" } }
  - { value: "4", label: { ru: "раздела в главном меню бота", en: "sections in the bot's main menu" } }
  - { value: "≈4 300", label: { ru: "детей с ЗПР в Акмолинской области — оценка из презентации проекта", en: "children with developmental delays in Akmola Region, as estimated in the project deck" } }
links: []
cover: ./media/nuks-telegram-bot/cover.webp
coverAlt: { ru: "Титульный слайд презентации: «Telegram справочник для родителей» и логотип NUKS", en: "Title slide of the deck: ‘Telegram guide for parents’ and the NUKS logo" }
gallery:
  - { src: ./media/nuks-telegram-bot/1.webp, caption: { ru: "Слайд о проблеме: около 4 300 детей с ЗПР в Акмолинской области", en: "Problem slide: about 4,300 children with developmental delays in Akmola Region" } }
  - { src: ./media/nuks-telegram-bot/2.webp, caption: { ru: "Слайд «Идея»: Telegram-справочник для родителей по методике НУКс", en: "The ‘Idea’ slide: a Telegram guide for parents built on the NUKS method" } }
  - { src: ./media/nuks-telegram-bot/3.webp, caption: { ru: "Слайд «План»: бот создан, следующий шаг — тестирование на фокус-группе родителей", en: "The ‘Plan’ slide: the bot is built; next comes testing with a focus group of parents" } }
size: lg
order: 5
featured: false
achievements: [ 2024-aqmola-power-it-3rd ]
---
