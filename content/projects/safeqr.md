---
name: "SafeQR"
tagline: { ru: "Учёт огнетушителей, аптечек и выходов по QR: работник сообщает о неисправности, руководитель доводит её до устранения", en: "QR tracking of extinguishers, first-aid kits and exits: workers report faults by phone, managers follow them to the fix" }
event: { ru: "К конкурсу AQMOLA POWER 2026, Акмолинская область", en: "Built for AQMOLA POWER 2026, Akmola Region" }
date: 2026-09-21
period: { ru: "сентябрь 2026", en: "September 2026" }
status: { ru: "MVP опубликован на Vercel", en: "MVP deployed on Vercel" }
result: { ru: "", en: "" }
team: { ru: "Соло — от кода и базы данных до презентации и бизнес-плана", en: "Solo — from the code and database to the deck and business plan" }
problem: { ru: "Учёт огнетушителей, аптечек и эвакуационных выходов на предприятиях часто ведут на бумаге или в разрозненных таблицах Excel, и где какой огнетушитель, нередко знает только инженер по охране труда. Работнику, заметившему неисправность, некуда быстро о ней сообщить, а дошла ли проблема до устранения, никто не отслеживает: «обнаружено» ещё не значит «устранено».", en: "Fire extinguishers, first-aid kits and emergency exits are often tracked on paper or in scattered Excel sheets, and frequently only the safety engineer knows where each extinguisher is. A worker who spots a fault has no quick way to report it, and nobody checks whether the problem actually gets fixed: ‘found’ is not the same as ‘fixed’." }
did:
  ru: |
    - Собрал на Next.js 14 и Supabase веб-приложение из двух частей: карточка объекта открывается по QR-коду с телефона — без установки приложения и без входа, а панель руководителя закрыта входом через Supabase Auth.
    - В карточке — статус, место, ответственный, дата последней проверки и инструкция по применению. Отсюда работник проходит чек-лист (у огнетушителя шесть пунктов, в том числе пломба и манометр) или сообщает о проблеме: выбирает категорию, пишет комментарий и при необходимости прикладывает фото с камеры — оно сохраняется в Supabase Storage.
    - Научил систему реагировать на данные: категория задаёт приоритет («Выход заблокирован» и «Огнетушитель отсутствует» — критические), заявка получает номер вида SR-00001 от функции на PL/pgSQL, а когда в аптечке остаток падает ниже минимума, SafeQR сам открывает заявку «Требуется пополнение» и не создаёт вторую, пока первую ещё не взяли в работу (статус «Открыта»). Проверки, заявки, изменения в аптечке и устранение пишутся в историю объекта.
    - Сделал панель руководителя: счётчики объектов, открытых и критических проблем и просроченных проверок, список критических проблем и реестр всех объектов. В карточке заявки руководитель видит фото, назначает ответственного и отмечает устранение или возвращает заявку в работу; когда открытых заявок по объекту не остаётся, ему снова ставится статус «В норме».
    - Спроектировал базу из 7 таблиц PostgreSQL и разграничил права на уровне самой базы: Row Level Security включён на каждой таблице — 19 политик и ещё 4 для хранилища фото. Без входа можно смотреть карточки, отмечать проверки, оставлять заявки и менять остатки в аптечке; менять статусы заявок и вести реестр может только руководитель.
    - Написал скрипт, который делает SVG-QR для каждого объекта из базы и лист наклеек A4 для печати, и опубликовал приложение на Vercel. К конкурсу подготовил презентацию на 13 слайдов и бизнес-план из 11 разделов — со сценарием живой демонстрации, рынком, ценовой гипотезой и дорожной картой.
  en: |
    - Built a web app on Next.js 14 and Supabase with two sides: an item card that opens from a QR code on a phone, with no app to install and no sign-in, and a manager dashboard behind a Supabase Auth login.
    - The card shows the item's status, location, the person in charge, the last inspection date and instructions for use. From there a worker runs a checklist (six points for an extinguisher, including the seal and the pressure gauge) or reports a problem: picks a category, adds a comment and, if needed, a photo from the camera, which is stored in Supabase Storage.
    - Made the system react to data: the category sets the priority (a blocked exit or a missing extinguisher is critical), each request gets a number like SR-00001 from a PL/pgSQL function, and when a first-aid kit falls below its minimum stock, SafeQR opens a ‘Restock needed’ request on its own and won't open a second one while the first is still in the ‘Open’ status, before anyone has taken it on. Inspections, reports, first-aid stock changes and fixes all go into the item's history.
    - Built the manager dashboard: counters for items, open and critical issues and overdue inspections, a list of critical issues and a register of all items. On a request page the manager sees the photo, assigns someone, and marks it fixed or reopens it; once an item has no open requests left, it is back to ‘OK’.
    - Designed a 7-table PostgreSQL database and enforced access rights in the database itself: Row Level Security is on for every table, with 19 policies plus 4 more for photo storage. Without signing in, anyone can view cards, log inspections, file reports and update first-aid stock; only a signed-in manager can change request statuses or edit the register.
    - Wrote a script that generates an SVG QR code for every item in the database and an A4 sheet of stickers to print, and deployed the app on Vercel. For the contest, prepared a 13-slide deck and an 11-section business plan with a live demo script, the market, a pricing hypothesis and a roadmap.
outcome: { ru: "Приложение опубликовано на Vercel 21 сентября 2026 года: стартовая страница и вход для руководителя открываются. MVP, презентация и бизнес-план готовились к AQMOLA POWER 2026. Следующий шаг в бизнес-плане — пилот на одном предприятии на 1–2 месяца: он должен проверить систему на реальных объектах и ценовую гипотезу — внедрение за 100–300 тыс. ₸ и подписку за 20–100 тыс. ₸ в месяц.", en: "The app went live on Vercel on September 21, 2026: the start page and the manager sign-in are up. The MVP, deck and business plan were prepared for AQMOLA POWER 2026. The next step in the business plan is a 1–2-month pilot at one company, meant to test the system on real equipment and the pricing hypothesis: 100–300 thousand tenge for setup and 20–100 thousand tenge a month." }
stack: [ "Next.js 14", "TypeScript", "Supabase", "PostgreSQL", "Row Level Security", "PL/pgSQL", "React 18", "Tailwind CSS", "Vercel", "node-qrcode" ]
metrics:
  - { value: "7", label: { ru: "типов объектов: огнетушители, аптечки, выходы, электрощиты и другие", en: "item types: extinguishers, first-aid kits, exits, electrical panels and more" } }
  - { value: "19 + 4", label: { ru: "политики Row Level Security — для 7 таблиц и хранилища фото", en: "Row Level Security policies for 7 tables and photo storage" } }
  - { value: "20", label: { ru: "объектов в 4 локациях в демо-данных", en: "items across 4 locations in the demo data" } }
  - { value: "13", label: { ru: "слайдов презентации и бизнес-план из 11 разделов", en: "deck slides, plus an 11-section business plan" } }
links:
  - { label: { ru: "Приложение на Vercel", en: "App on Vercel" }, url: "https://safeqr-omega.vercel.app", kind: demo }
cover: ./media/safeqr/cover.webp
coverAlt: { ru: "Слайд «Решение» из презентации SafeQR: QR на объекте → проверка или сообщение о проблеме → проблема сразу у руководителя", en: "The ‘Solution’ slide from the SafeQR deck: a QR code on the item → an inspection or a fault report → the issue goes straight to the manager" }
gallery:
  - { src: ./media/safeqr/1.webp, caption: { ru: "Аптечка на слайде презентации: бинтов 3 при минимуме 5 — SafeQR сам открывает заявку «Требуется пополнение»", en: "A first-aid kit on a deck slide: 3 bandages against a minimum of 5, so SafeQR opens a ‘Restock needed’ request on its own" } }
  - { src: ./media/safeqr/2.webp, caption: { ru: "Стартовая страница опубликованного приложения", en: "Start page of the live app" } }
  - { src: ./media/safeqr/4.webp, caption: { ru: "Бизнес-модель: внедрение под ключ и подписка; цены — гипотеза для проверки на пилоте", en: "Business model: turnkey setup plus a subscription; the prices are a hypothesis to test in a pilot" } }
size: sm
order: 7
featured: false
achievements: []
---
