---
name: "Tamyr"
tagline: { ru: "Старый смартфон на станке — датчик для небольших цехов: учит норму вибрации и звука и пишет механику в Telegram", en: "An old smartphone as a machine sensor for small workshops: it learns normal vibration and sound and alerts the mechanic" }
event: { ru: "National Founder Cup 2026, Шымкент", en: "National Founder Cup 2026, Shymkent" }
date: 2026-11-14
period: { ru: "7–9 ноября 2026 — к онлайн-отбору; финал — 14 ноября", en: "7–9 November 2026 for the online round; final on 14 November" }
status: { ru: "MVP работает онлайн", en: "MVP live online" }
result: { ru: "Финал National Founder Cup 2026", en: "National Founder Cup 2026 final" }
team: { ru: "На онлайн-отборе — вице-капитан команды Enactus Myrzakhmetov из 5 человек", en: "In the online round: vice-captain of the five-person Enactus Myrzakhmetov team" }
problem: { ru: "В небольших цехах вентиляторы, насосы и двигатели проверяют на обходах — на слух и на ощупь, а между обходами за ними никто не следит: о неисправности узнают, когда её уже слышно или агрегат встал. Стационарная вибродиагностика с отдельными датчиками, шлюзами и интегратором для таких цехов может быть слишком затратной. Это гипотеза команды: интервью с механиками и пилот пока не проводились.", en: "In small workshops, fans, pumps and motors are checked on inspection rounds by ear and by touch, and nobody watches them in between: a fault gets noticed once it can be heard or the unit stops. Fixed vibration monitoring, with its own sensors, gateways and integrator, can be too costly at that scale. This is the team's hypothesis: no interviews with mechanics and no pilot have been done yet." }
did:
  ru: |
    - С ИИ-агентом Claude Code собрал MVP: телефон открывает ссылку станка в браузере, без установки приложения, и сам считает признаки вибрации (своя DFT) и звука (16 полос от 50 Гц до 10 кГц) — сырой звук с телефона не уходит.
    - Сервер на FastAPI за 30–120 секунд запоминает норму конкретного станка (медиана и MAD), каждую секунду считает индекс здоровья 0–100 и открывает событие после 5 секунд устойчивого отклонения.
    - Четыре правила называют вероятную причину — дисбаланс, несоосность, подшипник, утечку; языковая модель Gemini 3.1 Flash-Lite пересказывает факты механику в четыре строки по-русски или по-казахски, а если не ответила за 15 секунд, текст собирается по шаблону.
    - Telegram-бот присылает алерт с кнопками «Нашёл неисправность» и «Ложная тревога»; ложную тревогу можно запомнить как новый режим нормы и отменить одной кнопкой.
    - Сделал дашборд цеха на React со спектром «норма vs сейчас», демо-цех из пяти станков-симуляторов, 33 автотеста и деплой в Docker на Railway.
    - Собрал презентацию на 12 слайдов и видео-демо к онлайн-отбору и подготовил техническую документацию для финала.
  en: |
    - Built the MVP with the Claude Code AI agent: the phone opens the machine's link in a browser, with no app to install, and computes vibration features (custom DFT) and 16 sound bands from 50 Hz to 10 kHz on the device — raw audio never leaves the phone.
    - A FastAPI server learns each machine's normal state in 30–120 seconds (median and MAD), scores a 0–100 health index every second and opens an event after 5 seconds of sustained deviation.
    - Four rules name the likely cause — imbalance, misalignment, bearing wear or a leak — and the Gemini 3.1 Flash-Lite language model turns the facts into a four-line note for the mechanic in Russian or Kazakh; if it does not reply within 15 seconds, a template writes the note.
    - A Telegram bot sends the alert with ‘Found the fault’ and ‘False alarm’ buttons; a false alarm can be saved as a new normal mode and undone with one tap.
    - Made a React workshop dashboard with a ‘normal vs now’ spectrum, a demo workshop of five simulated machines, 33 automated tests and a Docker deployment on Railway.
    - Put together the 12-slide deck and the demo video for the online round and prepared the technical documentation for the final.
outcome: { ru: "Проект прошёл онлайн-отбор и вышел в финал National Founder Cup 2026 (14 ноября, Шымкент), где его представляли двое других участников команды. Продукт работает онлайн. На синтетических данных Tamyr заметил все 60 смоделированных неисправностей, каждый раз верно назвал причину и ни разу не поднял ложную тревогу почти за 17 часов нормальной работы; на настоящем станке он ещё не испытывался.", en: "The project passed the online round and reached the National Founder Cup 2026 final (14 November, Shymkent), where two other team members presented it. The product runs online. On synthetic data Tamyr caught all 60 simulated faults, named the right cause every time and raised no false alarms in almost 17 hours of normal running; it has not yet been tested on a real machine." }
stack: [ "Python", "FastAPI", "NumPy", "React", "DeviceMotion + Web Audio", "Gemini API", "aiogram", "Docker", "Railway", "Claude Code" ]
metrics:
  - { value: "60/60", label: { ru: "синтетических неисправностей поймано", en: "synthetic faults caught" } }
  - { value: "0", label: { ru: "ложных тревог почти за 17 часов нормальной работы на модели", en: "false alarms in almost 17 hours of simulated normal running" } }
  - { value: "6–7", label: { ru: "секунд от утроения вибрации до тревоги (синтетический сигнал)", en: "seconds from tripled vibration to an alert (synthetic signal)" } }
  - { value: "33/33", label: { ru: "автотеста проходят", en: "automated tests pass" } }
links:
  - { label: { ru: "Живой продукт: демо-цех", en: "Live product: demo workshop" }, url: "https://tamyr-production.up.railway.app/w/2", kind: demo }
cover: ./media/tamyr/cover.webp
coverAlt: { ru: "Телефон-датчик показывает индекс 39 и тревогу, рядом дашборд: пик вибрации на частоте вращения и событие через 6,6 с (синтетический сигнал)", en: "The phone sensor shows index 39 and an alarm; next to it the dashboard shows a vibration peak at the rotation frequency and an event after 6.6 s (synthetic signal)" }
gallery:
  - { src: ./media/tamyr/1.webp, caption: { ru: "Телефон-датчик: калибровка, норма и тревога (синтетический сигнал)", en: "The phone sensor: calibration, normal state and an alarm (synthetic signal)" } }
  - { src: ./media/tamyr/2.webp, caption: { ru: "Событие демо-цеха в живом продукте: что отклонилось, что сделать и объяснение ИИ", en: "An event in the live product's demo workshop: what deviated, what to do and the AI explanation" } }
  - { src: ./media/tamyr/3.webp, caption: { ru: "Дашборд демо-цеха: пять станков-симуляторов, у двигателя М-4 индекс 36 и открытое событие", en: "Demo workshop dashboard: five simulated machines, motor M-4 at 36 with an open event" } }
  - { src: ./media/tamyr/4.webp, caption: { ru: "Слайд онлайн-отбора: индекс в одном тесте — вибрация ×3 даёт тревогу, ×1,9 — нет (синтетический сигнал)", en: "Online-round slide: the index in one test — ×3 vibration triggers an alarm, ×1.9 does not (synthetic signal)" } }
size: xl
order: 1
featured: true
achievements: [ 2026-national-founder-cup-finalist ]
---
