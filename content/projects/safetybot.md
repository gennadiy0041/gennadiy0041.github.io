---
name: "SafetyBot"
tagline: { ru: "Telegram-помощник по охране труда в Казахстане: правила, нормативные документы, советы и экстренные номера в одном меню", en: "A Telegram assistant for workplace safety in Kazakhstan: rules, regulations, tips and emergency numbers in one menu" }
event: { ru: "", en: "" }
date: 2025-03
period: { ru: "", en: "" }
status: { ru: "Прототип в одном файле", en: "Single-file prototype" }
result: { ru: "", en: "" }
team: { ru: "Соло — от идеи до кода", en: "Solo, from idea to code" }
problem: { ru: "Задача — собрать в одном Telegram-боте базовые правила охраны труда, нормативные документы Казахстана и экстренные номера. В приветствии SafetyBot называет себя персональным помощником по охране труда в Казахстане и предлагает узнать правила безопасности, пройти тест, получить советы и ознакомиться с нормативными документами.", en: "The aim was to bring basic workplace-safety rules, Kazakhstan's safety regulations and emergency numbers together in one Telegram bot. In its greeting, SafetyBot calls itself a personal workplace-safety assistant for Kazakhstan and invites you to learn the safety rules, take a quiz, get tips and read the regulations." }
did:
  ru: |
    - Собрал бота на Python и aiogram 3 (Dispatcher и Router) с главным меню из семи кнопок: «Пройти тест», «Справочник», «Документы», «Совет дня», «Экстренные контакты», «Сообщить о нарушении» и «Личный кабинет».
    - Наполнил «Справочник» основными правилами охраны труда в Казахстане по пяти темам: средства индивидуальной защиты, общие требования безопасности, эвакуация и действия в ЧС, электробезопасность, работа на высоте.
    - Составил для раздела «Документы» перечень из семи нормативных документов РК по охране труда — от Трудового кодекса до санитарных и строительных норм — с коротким пояснением, что регулирует каждый.
    - Подготовил 32 совета по безопасности — от средств защиты и исправного инструмента до работы на высоте, в замкнутых пространствах и с газовым оборудованием; кнопка «Совет дня» выдаёт случайный.
    - Добавил в «Экстренные контакты» шесть номеров — скорая, пожарная служба, полиция, 112, аварийная газовая служба и городской колл-центр, — а в «Сообщить о нарушении» подсказку, что указать в сообщении.
    - Заложил тест из двух вопросов: варианты ответов на инлайн-кнопках, подсчёт баллов и итог, который попадает в «Личный кабинет».
  en: |
    - Built the bot in Python on aiogram 3 (Dispatcher and Router) around a main menu of seven buttons: Take the quiz, Guide, Documents, Tip of the day, Emergency contacts, Report a violation and Personal page.
    - Filled the Guide with Kazakhstan's basic workplace-safety rules on five topics: personal protective equipment, general safety requirements, evacuation and emergencies, electrical safety, and work at height.
    - Compiled seven of Kazakhstan's workplace-safety regulations for the Documents section, from the Labour Code to sanitary and building codes, each with a short note on what it covers.
    - Prepared 32 safety tips, from protective gear and well-maintained tools to work at height, confined spaces and gas equipment; the Tip of the day button serves one at random.
    - Put six numbers under Emergency contacts (ambulance, fire service, police, 112, the gas emergency service and the city call centre) and, under Report a violation, a prompt on what to include in a report.
    - Wrote a two-question quiz: answer options on inline buttons, scoring, and a final score that goes to the Personal page.
outcome: { ru: "Прототип в одном файле на 228 строк: все семь разделов меню написаны. В текущей версии тест обрывается с ошибкой до первого вопроса (клавиатура для него написана в стиле aiogram 2), сообщения о нарушениях бот не обрабатывает, а из восьми команд, перечисленных в справке, обрабатываются только /start и /help. Данных о запуске бота для пользователей нет.", en: "A single-file prototype of 228 lines with all seven menu sections written. In the current version the quiz fails with an error before the first question (its keyboard is written in the aiogram 2 style), violation reports are not processed, and of the eight commands listed in the help text only /start and /help are handled. There is no record of the bot being launched for users." }
stack: [ "Python", "aiogram 3", "Telegram Bot API" ]
metrics:
  - { value: "7", label: { ru: "разделов в главном меню бота", en: "sections in the bot's main menu" } }
  - { value: "5", label: { ru: "тем в справочнике правил охраны труда", en: "topics in the workplace-safety rules guide" } }
  - { value: "32", label: { ru: "совета по безопасности для кнопки «Совет дня»", en: "safety tips behind the Tip of the day button" } }
  - { value: "6", label: { ru: "номеров в разделе «Экстренные контакты»", en: "numbers under Emergency contacts" } }
links: []
cover: ./media/safetybot/cover.webp
coverAlt: { ru: "Фрагмент кода SafetyBot: создание бота и главное меню из семи кнопок — от «Пройти тест» до «Личного кабинета»", en: "SafetyBot code excerpt: the bot setup and its main menu of seven buttons, from Take the quiz to Personal page" }
gallery:
  - { src: ./media/safetybot/1.webp, caption: { ru: "Код «Справочника»: правила по СИЗ, эвакуации, электробезопасности и работе на высоте", en: "The Guide in code: rules on PPE, evacuation, electrical safety and work at height" } }
  - { src: ./media/safetybot/2.webp, caption: { ru: "Код «Совета дня» и «Экстренных контактов»: случайный совет и шесть номеров служб", en: "Tip of the day and Emergency contacts in code: a random tip and six service numbers" } }
size: sm
order: 13
featured: false
achievements: []
---
