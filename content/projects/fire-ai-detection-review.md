---
name: "AI in Fire Detection"
tagline: { ru: "Обзор ИИ-видеообнаружения пожаров: что показывают опубликованные результаты и что мешает внедрению", en: "A review of AI that spots fire on camera: what published results show and what stands in the way of real-world use" }
event: { ru: "К XVII МНПК по пожарной безопасности, Кокшетау", en: "For the 17th international fire safety conference, Kokshetau" }
date: 2026-10
period: { ru: "", en: "" }
status: { ru: "Тезисы и доклад готовы", en: "Paper and talk ready" }
result: { ru: "", en: "" }
team: { ru: "Соло, под научным руководством", en: "Solo, under academic supervision" }
problem: { ru: "Камеры с компьютерным зрением могут замечать огонь и дым раньше точечных извещателей — в больших помещениях и на открытых территориях. Но высокие цифры из статей не всегда переносятся на реальные объекты, а результаты разных работ трудно сравнивать. Цель обзора — по проверяемым публикациям сопоставить подходы, критерии их оценки и факторы, которые ограничивают применение; работа опирается только на опубликованные результаты, без собственных экспериментов.", en: "Cameras with computer vision can catch flame and smoke earlier than point smoke and heat detectors in large spaces and outdoors. But the high scores reported in papers do not always hold on real sites, and results from different studies are hard to compare. The review sets out to compare, from verifiable publications, the approaches, the criteria used to evaluate them and the factors that limit their use; it relies only on published results, with no experiments of its own." }
did:
  ru: |
    - Отобрал 13 проверяемых источников 2006–2024 годов — статьи, обзоры и стандарт ISO 7240-29:2024 — и свёл семь подходов, от цветовой модели YCbCr до CNN, YOLOv4 и SmokeyNet, в сравнительную таблицу: на каких данных их проверяли, какие результаты опубликованы и в чём ограничения.
    - Описал четыре критерия оценки с формулами — точность, полноту, долю ложных срабатываний и время обнаружения — и показал, как единица счёта искажает сравнение: в широко используемом наборе всего 17 роликов без огня, поэтому одна ошибка меняет долю ложных срабатываний на 5,88 п. п. Значения одной из CNN-работ на этом наборе не кратны 1/17 — их считали по другой процедуре, и сравнивать их напрямую нужно с осторожностью.
    - Оценил, во что превращается «малая» доля ошибок на практике: камера на 25 кадр/с даёт 2,16 млн кадров в сутки, и даже 0,01 % ложных срабатываний на кадр без подтверждения по последовательности кадров — это до 216 ложных тревог в сутки на одну камеру.
    - Разобрал, что мешает переносить модели на новые объекты: в опубликованных экспериментах доля верных решений падала с 94,31 до 76,23 %, когда кадры снимали другим БПЛА и камерой, и с 98,72 до 79,23 % на новом наборе, а «обучение без забывания» (LwF) частично возвращало её — до 91,41 %. У SmokeyNet ночные сцены исключены из оценки, а другие регионы и камеры не проверялись.
    - Сформулировал, что нужно для внедрения: испытывать систему как техническое средство по ISO 7240-29:2024, применять её вместе со вторым каналом обнаружения — мультикритериальными извещателями и тепловизорами, — считать ложные тревоги в сутки на камеру и время обнаружения вместо одной «точности», а модель проверять и дообучать на видео конкретного объекта, с подтверждением сигнала оператором.
    - Подготовил к конференции тезисы на 5 страниц, презентацию на 13 слайдов и текст доклада примерно на 7,5 минуты — с планом, как сократить его до 5 минут.
  en: |
    - Selected 13 verifiable sources from 2006–2024 (papers, reviews and the ISO 7240-29:2024 standard) and brought seven approaches, from a YCbCr colour model to CNNs, YOLOv4 and SmokeyNet, into one comparison table: what data each was tested on, what results were published and where it falls short.
    - Laid out four evaluation criteria with formulas (precision, recall, false-positive rate and detection time) and showed how the unit of count skews comparisons: a widely used benchmark has only 17 fire-free videos, so a single error changes the false-positive rate by 5.88 points. The figures one CNN paper reports on the same set are not multiples of 1/17, so they were computed another way and call for caution before any direct comparison.
    - Worked out what a ‘small’ error rate means in practice: a 25 fps camera produces 2.16 million frames a day, so even a 0.01% per-frame false-positive rate, with no confirmation across a sequence of frames, adds up to as many as 216 false alarms per camera per day.
    - Examined what keeps models from carrying over to new sites: in published experiments, accuracy fell from 94.31% to 76.23% on footage from another drone and camera, and from 98.72% to 79.23% on a new dataset, while Learning without Forgetting (LwF) won back part of the loss, up to 91.41%. SmokeyNet's evaluation leaves out night scenes, and it was not tested on other regions or cameras.
    - Set out what deployment takes: testing the system as fire detection equipment under ISO 7240-29:2024, running it alongside a second detection channel such as multi-criteria detectors and thermal cameras, tracking false alarms per camera per day and detection time instead of a single ‘accuracy’ figure, and checking and fine-tuning the model on video from the actual site, with alarms confirmed by an operator.
    - Prepared a 5-page paper, a 13-slide deck and a talk script of about 7.5 minutes for the conference, along with a plan for cutting the talk to 5 minutes.
outcome: { ru: "Главный вывод работы: ИИ-видеообнаружение стоит применять как дополнение к сертифицированной пожарной автоматике — с подтверждением сигнала оператором или вторым каналом, — а не как её замену. Тезисы, презентация и текст доклада подготовлены 12–13 октября 2026 года к XVII МНПК в Кокшетау (16 октября). Подтверждений того, что тезисы отправлены, приняты и вошли в сборник, а доклад прозвучал на конференции, пока нет.", en: "The paper's main conclusion: AI video detection should complement certified fire alarm systems, with alarms confirmed by an operator or a second channel, rather than replace them. The paper, deck and talk script were prepared on 12–13 October 2026 for the 17th conference in Kokshetau (16 October). There is no confirmation yet that the paper was submitted, accepted and included in the proceedings, or that the talk was given." }
stack: [ "CNN", "YOLOv4", "SmokeyNet", "ISO 7240-29:2024", "SqueezeNet", "Xception", "LwF", "YCbCr" ]
metrics:
  - { value: "13", label: { ru: "проверяемых источников 2006–2024 годов, включая стандарт ISO", en: "verifiable sources from 2006–2024, including an ISO standard" } }
  - { value: "7", label: { ru: "подходов в сравнительной таблице — от цветовой модели до SmokeyNet", en: "approaches in the comparison table, from a colour model to SmokeyNet" } }
  - { value: "1/17", label: { ru: "одна ошибка на 17 роликах без огня меняет долю ложных срабатываний на 5,88 п. п.", en: "one error across 17 fire-free videos changes the false-positive rate by 5.88 points" } }
  - { value: "≤ 216", label: { ru: "ложных тревог в сутки на камеру при 0,01 % ложных срабатываний на кадр (оценка)", en: "false alarms per camera per day at a 0.01% per-frame false-positive rate (estimate)" } }
links:
  - { label: { ru: "Страница конференции на сайте Академии гражданской защиты", en: "Conference page on the Academy of Civil Protection website (in Russian)" }, url: "https://agz.edu.kz/ezjegodnaa_mezjdynarodnaa_naychno_prakticheskaa_konferencia_aktyalnie_problemi_pozjarnoj_bezopasnosti__predyprezjdenia_i_likvidacii_chrezvichajnix_sityacij.html", kind: event }
cover: ./media/fire-ai-detection-review/cover.webp
coverAlt: { ru: "Титульный слайд доклада «Искусственный интеллект в обнаружении пожаров: возможности и ограничения применения», подготовленного к XVII МНПК в Кокшетау", en: "Title slide (in Russian) of the talk ‘Artificial Intelligence in Fire Detection: Capabilities and Limitations in Practice’, prepared for the 17th conference in Kokshetau" }
gallery:
  - { src: ./media/fire-ai-detection-review/1.webp, caption: { ru: "Тезисы, с. 2: как единица счёта искажает сравнение, и начало таблицы семи подходов", en: "Paper, p. 2: how the unit of count skews comparisons, and the start of the seven-approach table" } }
  - { src: ./media/fire-ai-detection-review/2.webp, caption: { ru: "Источники ложных тревог и оценка: до 216 ложных сигналов в сутки на одну камеру", en: "What triggers false alarms, and the estimate: up to 216 false alarms per camera per day" } }
  - { src: ./media/fire-ai-detection-review/3.webp, caption: { ru: "Перенос на новые объекты: доля верных решений 94,31 → 76,23 % и 98,72 → 79,23 %; с LwF — 91,41 %", en: "Moving to new sites: accuracy 94.31 → 76.23% and 98.72 → 79.23%; with LwF, back up to 91.41%" } }
  - { src: ./media/fire-ai-detection-review/4.webp, caption: { ru: "Что нужно для внедрения: испытания по ISO 7240-29:2024, второй канал, событийные метрики, оператор", en: "What deployment takes: ISO 7240-29:2024 testing, a second channel, event-based metrics and an operator" } }
size: sm
order: 6
featured: false
achievements: []
---
