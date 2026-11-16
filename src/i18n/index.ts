export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export type LStr = { ru: string; en: string } | undefined | null;

export function getLang(locale: string | undefined): Lang {
  return locale === 'en' ? 'en' : 'ru';
}

/** Pick the language variant of a bilingual field, falling back to the other one. */
export function loc(v: LStr, lang: Lang): string {
  if (!v) return '';
  return (v[lang] || v[lang === 'ru' ? 'en' : 'ru'] || '').trim();
}

/** '/projects/x/' -> '/en/projects/x/' for EN, unchanged for RU. */
export function localizePath(path: string, lang: Lang): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const stripped = clean.replace(/^\/en(\/|$)/, '/');
  return lang === 'en' ? `/en${stripped === '/' ? '/' : stripped}` : stripped;
}

/** Same page in the other language. */
export function switchLangPath(pathname: string, to: Lang): string {
  return localizePath(pathname, to);
}

const MONTHS: Record<Lang, string[]> = {
  ru: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const MONTHS_GEN_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Human date for YYYY | YYYY-MM | YYYY-MM-DD. */
export function fmtDate(d: string, lang: Lang, style: 'long' | 'short' = 'long'): string {
  const [y, m, day] = d.split('-').map((x) => Number(x));
  if (!m) return String(y);
  if (style === 'short') return `${String(m).padStart(2, '0')}.${y}`;
  if (!day) return lang === 'ru' ? `${MONTHS.ru[m - 1]} ${y}` : `${MONTHS.en[m - 1]} ${y}`;
  return lang === 'ru' ? `${day} ${MONTHS_GEN_RU[m - 1]} ${y}` : `${MONTHS.en[m - 1]} ${day}, ${y}`;
}

export function yearOf(d: string): number {
  return Number(d.slice(0, 4));
}

/** Sort key so that partial dates order sensibly (YYYY -> mid-year). */
export function dateKey(d: string): string {
  const [y, m = '06', day = '15'] = d.split('-');
  return `${y}-${m}-${day}`;
}

/** Category -> UI filter group. */
export const GROUPS = ['startup', 'science', 'contest', 'sport', 'learning', 'mobility', 'other'] as const;
export type Group = (typeof GROUPS)[number];

export const CATEGORY_GROUP: Record<string, Group> = {
  hackathon: 'startup',
  'pitch-startup': 'startup',
  conference: 'science',
  publication: 'science',
  olympiad: 'contest',
  competition: 'contest',
  sport: 'sport',
  course: 'learning',
  'language-test': 'learning',
  'grant-scholarship': 'mobility',
  'academic-mobility': 'mobility',
  volunteering: 'other',
  work: 'other',
  other: 'other',
};

export const ui = {
  ru: {
    'meta.title': 'Геннадий Козлов — проекты и достижения',
    'meta.description':
      'AI-продукты, стартапы, хакатоны, питч-батлы и научные конференции. Проекты, результаты и подтверждающие документы.',
    'nav.projects': 'Проекты',
    'nav.achievements': 'Достижения',
    'nav.certificates': 'Документы',
    'nav.skills': 'Навыки',
    'nav.about': 'Обо мне',
    'nav.contacts': 'Контакты',
    'nav.search': 'Поиск',
    'nav.resume': 'Резюме',
    'nav.menu': 'Меню',
    'nav.close': 'Закрыть',
    'nav.skip': 'Перейти к содержимому',
    'hero.cta.projects': 'Смотреть проекты',
    'hero.cta.resume': 'Скачать резюме (PDF)',
    'hero.scroll': 'Листайте',
    'stats.title': 'В цифрах',
    'stats.eyebrow': 'Цифры',
    'projects.eyebrow': 'Проекты',
    'projects.title': 'Что я сделал',
    'projects.lead': 'Продукты и прототипы, доведённые до защиты, финала или живого запуска.',
    'projects.open': 'Открыть проект',
    'timeline.eyebrow': 'Достижения',
    'timeline.title': 'Хронология результатов',
    'timeline.lead': 'Каждая строка подтверждена документом — откройте, чтобы посмотреть.',
    'timeline.filter.year': 'Год',
    'timeline.filter.type': 'Тип',
    'timeline.filter.all': 'Все',
    'timeline.filter.wins': 'Только призовые',
    'timeline.empty': 'По этому фильтру ничего нет.',
    'timeline.doc': 'Документ',
    'timeline.count': 'показано',
    'certs.eyebrow': 'Документы',
    'certs.title': 'Сертификаты и дипломы',
    'certs.lead': 'Оригиналы документов. Личные данные и номера скрыты.',
    'certs.more': 'Показать все',
    'certs.less': 'Свернуть',
    'skills.eyebrow': 'Навыки',
    'skills.title': 'Инструменты и умения',
    'about.eyebrow': 'Обо мне',
    'about.title': 'Коротко обо мне',
    'about.education': 'Образование',
    'about.experience': 'Опыт',
    'about.languages': 'Языки',
    'contacts.eyebrow': 'Контакты',
    'contacts.title': 'Есть задача или идея?',
    'contacts.lead': 'Пишите — отвечу и предложу, как довести её до результата.',
    'contacts.copy': 'Скопировать',
    'contacts.copied': 'Скопировано',
    'footer.updated': 'Обновлено',
    'footer.built': 'Сайт собран из подтверждающих документов',
    'project.back': 'Все проекты',
    'project.problem': 'Задача',
    'project.did': 'Что я сделал',
    'project.outcome': 'Результат',
    'project.stack': 'Стек',
    'project.links': 'Ссылки',
    'project.gallery': 'Фото и скриншоты',
    'project.related': 'Связанные достижения',
    'project.next': 'Следующий проект',
    'project.team': 'Команда',
    'project.event': 'Где',
    'project.status': 'Статус',
    'palette.placeholder': 'Найти достижение, проект, раздел…',
    'palette.empty': 'Ничего не найдено',
    'palette.hint.open': 'открыть',
    'palette.hint.move': 'выбрать',
    'palette.hint.close': 'закрыть',
    'palette.group.achievements': 'Достижения',
    'palette.group.projects': 'Проекты',
    'palette.group.sections': 'Разделы',
    'lightbox.close': 'Закрыть',
    'lightbox.prev': 'Предыдущий',
    'lightbox.next': 'Следующий',
    'lightbox.zoom': 'Увеличить',
    'lang.switch': 'English',
    'lang.short': 'EN',
    'notfound.title': 'Страница не найдена',
    'notfound.back': 'На главную',
  },
  en: {
    'meta.title': 'Gennadiy Kozlov — projects and achievements',
    'meta.description':
      'AI products, startups, hackathons, pitch battles and scientific conferences. Projects, results and the documents behind them.',
    'nav.projects': 'Projects',
    'nav.achievements': 'Achievements',
    'nav.certificates': 'Documents',
    'nav.skills': 'Skills',
    'nav.about': 'About',
    'nav.contacts': 'Contact',
    'nav.search': 'Search',
    'nav.resume': 'Resume',
    'nav.menu': 'Menu',
    'nav.close': 'Close',
    'nav.skip': 'Skip to content',
    'hero.cta.projects': 'See projects',
    'hero.cta.resume': 'Download CV (PDF)',
    'hero.scroll': 'Scroll',
    'stats.title': 'By the numbers',
    'stats.eyebrow': 'Numbers',
    'projects.eyebrow': 'Projects',
    'projects.title': 'Things I have built',
    'projects.lead': 'Products and prototypes taken all the way to a defence, a final or a live launch.',
    'projects.open': 'Open project',
    'timeline.eyebrow': 'Achievements',
    'timeline.title': 'Track record',
    'timeline.lead': 'Every line is backed by a document — open it to see.',
    'timeline.filter.year': 'Year',
    'timeline.filter.type': 'Type',
    'timeline.filter.all': 'All',
    'timeline.filter.wins': 'Podium only',
    'timeline.empty': 'Nothing matches this filter.',
    'timeline.doc': 'Document',
    'timeline.count': 'shown',
    'certs.eyebrow': 'Documents',
    'certs.title': 'Certificates & diplomas',
    'certs.lead': 'Original documents. Personal data and numbers are hidden.',
    'certs.more': 'Show all',
    'certs.less': 'Show less',
    'skills.eyebrow': 'Skills',
    'skills.title': 'Tools and abilities',
    'about.eyebrow': 'About',
    'about.title': 'About me',
    'about.education': 'Education',
    'about.experience': 'Experience',
    'about.languages': 'Languages',
    'contacts.eyebrow': 'Contact',
    'contacts.title': 'Have a problem or an idea?',
    'contacts.lead': 'Write to me — I will reply with a plan to get it done.',
    'contacts.copy': 'Copy',
    'contacts.copied': 'Copied',
    'footer.updated': 'Updated',
    'footer.built': 'Built from verifiable documents',
    'project.back': 'All projects',
    'project.problem': 'The problem',
    'project.did': 'What I did',
    'project.outcome': 'Outcome',
    'project.stack': 'Stack',
    'project.links': 'Links',
    'project.gallery': 'Photos & screenshots',
    'project.related': 'Related achievements',
    'project.next': 'Next project',
    'project.team': 'Team',
    'project.event': 'Where',
    'project.status': 'Status',
    'palette.placeholder': 'Find an achievement, project, section…',
    'palette.empty': 'No results',
    'palette.hint.open': 'open',
    'palette.hint.move': 'select',
    'palette.hint.close': 'close',
    'palette.group.achievements': 'Achievements',
    'palette.group.projects': 'Projects',
    'palette.group.sections': 'Sections',
    'lightbox.close': 'Close',
    'lightbox.prev': 'Previous',
    'lightbox.next': 'Next',
    'lightbox.zoom': 'Zoom',
    'lang.switch': 'Русский',
    'lang.short': 'RU',
    'notfound.title': 'Page not found',
    'notfound.back': 'Back home',
  },
} as const;

export type UiKey = keyof (typeof ui)['ru'];

export function useT(lang: Lang) {
  return (key: UiKey): string => ui[lang][key] ?? ui.ru[key] ?? key;
}

export const GROUP_LABEL: Record<Group, { ru: string; en: string }> = {
  startup: { ru: 'Стартапы и хакатоны', en: 'Startups & hackathons' },
  science: { ru: 'Наука и конференции', en: 'Science & conferences' },
  contest: { ru: 'Конкурсы и олимпиады', en: 'Contests & olympiads' },
  sport: { ru: 'Спорт', en: 'Sport' },
  learning: { ru: 'Курсы и сертификаты', en: 'Courses & certificates' },
  mobility: { ru: 'Гранты и мобильность', en: 'Grants & mobility' },
  other: { ru: 'Другое', en: 'Other' },
};

export const LEVEL_LABEL: Record<string, { ru: string; en: string }> = {
  international: { ru: 'Международный', en: 'International' },
  national: { ru: 'Республиканский', en: 'National' },
  regional: { ru: 'Областной', en: 'Regional' },
  city: { ru: 'Городской', en: 'City' },
  university: { ru: 'Университетский', en: 'University' },
  school: { ru: 'Школьный', en: 'School' },
  online: { ru: 'Онлайн', en: 'Online' },
  unknown: { ru: '', en: '' },
};
