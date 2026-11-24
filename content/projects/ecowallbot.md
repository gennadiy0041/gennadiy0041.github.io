---
name: "EcoWallBot"
tagline: { ru: "Telegram-бот о фитостенах для дома, офиса и школы: подбор растений по свету и влажности, советы по установке и уходу", en: "A Telegram bot on living walls for homes, offices and schools: plants matched to light and humidity, setup and care tips" }
event: { ru: "", en: "" }
date: 2025-04
period: { ru: "10–25 апреля 2025", en: "10–25 April 2025" }
status: { ru: "Прототип, две версии", en: "Prototype, two versions" }
result: { ru: "", en: "" }
team: { ru: "Соло", en: "Solo" }
problem: { ru: "Фитостена — вертикальный сад из живых растений: она украшает помещение, очищает воздух и поглощает CO₂. Но растения на стене приживаются, только если они подобраны под свет и влажность, стена правильно установлена и за ней следят. Тому, кто хочет завести такую стену дома, в офисе или в школе, нужны простые ответы: какие растения взять, где разместить стену и как за ней ухаживать.", en: "A living wall is a vertical garden of live plants: it brightens up a room, cleans the air and absorbs CO₂. But the plants only take hold if they suit the light and humidity, the wall is set up properly and someone looks after it. Anyone planning one at home, in an office or at a school needs straight answers: which plants to choose, where to put the wall and how to care for it." }
did:
  ru: |
    - Собрал Telegram-бота на Python и aiogram 3 с главным меню из пяти разделов: подбор растений, установка, уход, польза для климата и топ-7 растений, активно поглощающих CO₂.
    - Подбор растений сделал диалогом на inline-кнопках: сначала освещённость (много света, умеренный свет или мало света), затем влажность. На каждое из девяти сочетаний бот предлагает 3–5 растений — от монстеры и нефролеписа до сансевиерии и замиокулькаса.
    - Установку вынес в подменю «Где установить фитостену?»: отдельные советы для дома, офиса и школы — где разместить стену, какие растения подойдут и как ухаживать — плюс общие рекомендации. Для офиса бот отмечает снижение шума, для школы — устойчивую конструкцию, нетоксичные растения и участие учеников в уходе.
    - Составил памятку по уходу из шести тем: полив (автополив или вручную 1–2 раза в неделю, обязательно с дренажом), 6–8 часов рассеянного света или фитолампы 400–700 нм, +18…+25 °C и влажность от 40 %, подкормка раз в 3–4 недели, обрезка и защита от вредителей.
    - Добавил раздел о пользе зелёных стен для климата — поглощение CO₂, очистка воздуха, борьба с городскими «островами тепла» — и топ-7 растений-поглотителей CO₂: сансевиерия, хлорофитум, спатифиллум, фикус Бенджамина, нефролепис, алоэ вера и эпипремнум.
    - Через две недели после первой версии (10 апреля 2025) закончил вторую (25 апреля): приветствие от имени EcoWallBot с объяснением, что такое фитостены, иллюстрации к четырём разделам — ИИ-картинки из Microsoft Image Creator, — подменю установки вместо одного длинного сообщения и переписанные тексты. Код вырос с 316 до 439 строк.
  en: |
    - Built a Telegram bot in Python with aiogram 3 around a five-section main menu: plant picking, installation, care, climate benefits and a top 7 of plants that actively absorb CO₂.
    - Made plant picking a dialogue on inline buttons: light level first (bright, moderate or low), then humidity. For each of the nine combinations the bot suggests 3–5 plants, from monstera and Boston fern to snake plant and ZZ plant.
    - Moved installation into a 'Where to put a living wall?' submenu with separate advice for a home, an office and a school (where to place the wall, which plants to choose and how to care for them), plus general tips. For offices the bot points out noise reduction; for schools, a stable frame, non-toxic plants and getting pupils involved in the care.
    - Put together a six-part care guide: watering (automatic or drip, or by hand once or twice a week, always with drainage), 6–8 hours of diffused light or 400–700 nm grow lights, +18…+25 °C and at least 40 % humidity, feeding every 3–4 weeks, pruning and pest control.
    - Added a section on how green walls help the climate — absorbing CO₂, cleaning the air, easing urban heat islands — and a top 7 of CO₂ absorbers: snake plant, spider plant, peace lily, weeping fig, Boston fern, aloe vera and pothos.
    - Two weeks after the first version (10 April 2025) finished a second one (25 April): a welcome from EcoWallBot explaining what living walls are, pictures for four sections (AI images made in Microsoft Image Creator), an installation submenu instead of one long message, and rewritten texts. The code grew from 316 to 439 lines.
outcome: { ru: "Прототип в двух версиях; сведений о запуске для пользователей нет. Картинки бот подгружал по ссылкам с внешнего фотохостинга, а эти ссылки больше не открываются. Клавиатура меню приходит вместе с приветственной картинкой, поэтому перед повторным запуском иллюстрации нужно перенести.", en: "A prototype in two versions, with no record of a launch for users. The bot loaded its pictures by link from an external image host, and those links no longer open. Since the menu keyboard is sent together with the welcome picture, the images have to be re-hosted before the bot is relaunched." }
stack: [ "Python", "aiogram 3", "Telegram Bot API", "asyncio", "Microsoft Image Creator" ]
metrics:
  - { value: "9", label: { ru: "сочетаний света и влажности в подборе растений", en: "light-and-humidity combinations in the plant picker" } }
  - { value: "5", label: { ru: "разделов в главном меню бота", en: "sections in the bot's main menu" } }
  - { value: "3", label: { ru: "места установки с отдельными советами: дом, офис, школа", en: "places with their own setup advice: home, office, school" } }
  - { value: "316 → 439", label: { ru: "строк кода: первая версия (10.04) и вторая (25.04.2025)", en: "lines of code: first version (10 Apr) and second (25 Apr 2025)" } }
links: []
cover: ./media/ecowallbot/cover.webp
coverAlt: { ru: "ИИ-иллюстрация к боту: фитостена из свисающих папоротников, цветов и комнатных растений в солнечных лучах", en: "AI illustration for the bot: a living wall of trailing ferns, flowers and houseplants in a shaft of sunlight" }
gallery: []
size: sm
order: 14
featured: false
achievements: []
---
