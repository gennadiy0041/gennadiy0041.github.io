/**
 * Selection and formatting rules for the generated documents:
 *
 *   /resume/, /en/resume/      (ResumeDoc.astro) ── postbuild ──▶ /cv/gennadiy-kozlov-<lang>.pdf
 *   /og-card/<lang>-<key>/     (og/OgCard.astro) ── postbuild ──▶ /og/<lang>-<key>.png
 *
 * Everything is a pure function of the content collections (read through src/lib/data.ts), so the
 * PDF and the cards are rebuilt from the same data on every build. The caps keep the résumé within
 * two A4 pages with real-size content (~40 achievements, ~8 projects); whatever does not fit is
 * counted and linked to the site ("ещё N — на сайте").
 */
// @ts-expect-error -- `qrcode` ships without type declarations; `QrCodeApi` below types the one call we make.
import QRCode from 'qrcode';
import { groupOf, projectHref, type Achievement, type Profile, type Project, type getStats } from './data';
import { dateKey, fmtAchDate, fmtDate, loc, type Lang } from '../i18n';

type ProfileData = Profile['data'];
export type Contact = ProfileData['contacts'][number];
type Stats = Awaited<ReturnType<typeof getStats>>;

/**
 * How many entries of a list are printed. `regular` is used by the normal and compact layouts; `tight`
 * by the tight layout that scripts/postbuild.mjs falls back to when even the compact typography runs
 * past two pages. Every list of unbounded length is capped, so only very long texts can push the CV
 * past two pages — postbuild then fails the build.
 */
interface Limit {
  regular: number;
  tight: number;
}

export const RESUME_LIMITS = {
  projects: { regular: 6, tight: 4 },
  wins: { regular: 8, tight: 6 },
  science: { regular: 5, tight: 3 },
  startup: { regular: 5, tight: 3 },
  learning: { regular: 4, tight: 2 },
  mobility: { regular: 4, tight: 2 },
  other: { regular: 3, tight: 2 },
  education: { regular: 3, tight: 2 },
  experience: { regular: 4, tight: 3 },
  /** skill groups */
  skills: { regular: 6, tight: 4 },
} as const satisfies Record<string, Limit>;

/** Technologies printed per project. */
const STACK_LIMIT = 5;

/* ------------------------------------------------------------------ strings */

interface ResumeStrings {
  /** lower-case document noun, used in "<name> — резюме" */
  doc: string;
  kicker: string;
  location: string;
  projects: string;
  achievements: string;
  education: string;
  experience: string;
  skills: string;
  languages: string;
  updated: string;
  online: string;
  qr: string;
  more: (n: number) => string;
}

export const RESUME_T: Record<Lang, ResumeStrings> = {
  ru: {
    doc: 'резюме',
    kicker: 'Резюме',
    location: 'Город',
    projects: 'Проекты',
    achievements: 'Достижения',
    education: 'Образование',
    experience: 'Опыт',
    skills: 'Навыки',
    languages: 'Языки',
    updated: 'Обновлено',
    online: 'Все проекты, достижения и подтверждающие документы — на сайте.',
    qr: 'QR-код со ссылкой на сайт',
    more: (n) => `ещё ${n} — на сайте`,
  },
  en: {
    doc: 'CV',
    kicker: 'Curriculum vitae',
    location: 'Based in',
    projects: 'Projects',
    achievements: 'Achievements',
    education: 'Education',
    experience: 'Experience',
    skills: 'Skills',
    languages: 'Languages',
    updated: 'Updated',
    online: 'Every project, achievement and supporting document is on the site.',
    qr: 'QR code linking to the site',
    more: (n) => `${n} more on the site`,
  },
};

/** "Геннадий Козлов — резюме" — the <title>, which also becomes the PDF's Title metadata. */
export function resumeTitle(profile: ProfileData, lang: Lang): string {
  return `${loc(profile.name, lang)} — ${RESUME_T[lang].doc}`;
}

/* ------------------------------------------------------------------ numbers */

type PluralForms = { ru: readonly [one: string, few: string, many: string]; en: readonly [one: string, other: string] };

const PLURAL: Record<Lang, Intl.PluralRules> = { ru: new Intl.PluralRules('ru'), en: new Intl.PluralRules('en') };

export function plural(n: number, lang: Lang, forms: PluralForms): string {
  const category = PLURAL[lang].select(n);
  if (lang === 'ru') return forms.ru[category === 'one' ? 0 : category === 'few' ? 1 : 2];
  return forms.en[category === 'one' ? 0 : 1];
}

/**
 * Candidate headline numbers, most telling first; zeros are skipped. The labels say exactly what
 * getStats() counts: `podium` is "a prize, a place or a final" (content.config.ts), `science` every
 * conference and publication entry, whatever the result.
 */
const STAT_FORMS: ({ key: keyof Stats } & PluralForms)[] = [
  { key: 'achievements', ru: ['достижение', 'достижения', 'достижений'], en: ['achievement', 'achievements'] },
  { key: 'podium', ru: ['призовое место или финал', 'призовых места и финала', 'призовых мест и финалов'], en: ['podium or final', 'podiums & finals'] },
  { key: 'projects', ru: ['проект', 'проекта', 'проектов'], en: ['project', 'projects'] },
  { key: 'intl', ru: ['международное событие', 'международных события', 'международных событий'], en: ['international event', 'international events'] },
  { key: 'science', ru: ['конференция или публикация', 'конференции и публикации', 'конференций и публикаций'], en: ['conference or paper', 'conferences & papers'] },
  { key: 'startup', ru: ['хакатон или питч', 'хакатона и питча', 'хакатонов и питчей'], en: ['hackathon or pitch', 'hackathons & pitches'] },
  { key: 'docs', ru: ['подтверждающий документ', 'подтверждающих документа', 'подтверждающих документов'], en: ['supporting document', 'supporting documents'] },
];

export interface KeyNumber {
  key: keyof Stats;
  value: number;
  label: string;
}

/** The 3–4 numbers of the stats strip, computed by getStats() — nothing typed by hand. */
export function pickStats(stats: Stats, lang: Lang, max = 4): KeyNumber[] {
  return STAT_FORMS.filter((s) => stats[s.key] > 0)
    .slice(0, max)
    .map((s) => ({ key: s.key, value: stats[s.key], label: plural(stats[s.key], lang, s) }));
}

/* ------------------------------------------------------------------ caps */

export interface Capped<T> {
  /** entries printed by the regular layout */
  items: T[];
  total: number;
  /** how many the regular layout leaves out (printed as "ещё N — на сайте") */
  rest: number;
  /** printed entries that the tight layout drops as well */
  spare: ReadonlySet<T>;
  /** how many the tight layout leaves out */
  restTight: number;
}

/** Keeps the head of a list ranked most important first. */
function cap<T>(ranked: readonly T[], { regular, tight }: Limit): Capped<T> {
  const items = ranked.slice(0, regular);
  const kept = Math.min(tight, items.length);
  return {
    items,
    total: ranked.length,
    rest: ranked.length - items.length,
    spare: new Set(items.slice(kept)),
    restTight: ranked.length - kept,
  };
}

export interface RestNote {
  text: string;
  /** "hide": printed by the regular layouts only; "show": by the tight layout only; unset: by both */
  tight?: 'hide' | 'show';
}

/** "ещё N — на сайте" under a capped list; the tight layout drops more entries, so it gets its own count. */
export function restNotes(list: Capped<unknown>, lang: Lang): RestNote[] {
  const more = RESUME_T[lang].more;
  if (list.restTight === 0) return [];
  if (list.rest === list.restTight) return [{ text: more(list.rest) }];
  const tight: RestNote = { text: more(list.restTight), tight: 'show' };
  return list.rest > 0 ? [{ text: more(list.rest), tight: 'hide' }, tight] : [tight];
}

/** Education, experience and skill groups, in the profile's own order (most important first). */
export function capProfileList<T>(list: readonly T[], key: 'education' | 'experience' | 'skills'): Capped<T> {
  return cap(list, RESUME_LIMITS[key]);
}

/* ------------------------------------------------------------------ projects */

/** Featured projects first, then the site's bento order (getProjects() already sorts by `order`; sort is stable). */
export function selectProjects(all: Project[]): Capped<Project> {
  return cap(
    [...all].sort((a, b) => Number(b.data.featured) - Number(a.data.featured)),
    RESUME_LIMITS.projects,
  );
}

export interface ProjectLine {
  id: string;
  name: string;
  tagline: string;
  /** period ("2025–2026") or the short date ("05.2026") */
  when: string;
  event: string;
  /** result, or the status when there is no result yet */
  result: string;
  stack: string[];
  /** absolute URL of the project page on the site */
  href: string;
}

export function projectLine(p: Project, lang: Lang, site: URL): ProjectLine {
  const d = p.data;
  return {
    id: p.id,
    name: d.name,
    tagline: loc(d.tagline, lang),
    when: loc(d.period, lang) || fmtDate(d.date, lang, 'short'),
    event: loc(d.event, lang),
    result: loc(d.result, lang) || loc(d.status, lang),
    stack: d.stack.slice(0, STACK_LIMIT),
    href: new URL(projectHref(p, lang), site).href,
  };
}

/* ------------------------------------------------------------------ achievements */

/** Résumé groups, in print order. Podium entries (a prize, a place or a final) of any category are lifted into "wins". */
export const RESUME_GROUPS = ['wins', 'science', 'startup', 'learning', 'mobility', 'other'] as const;
export type ResumeGroupKey = (typeof RESUME_GROUPS)[number];

const GROUP_LABEL: Record<ResumeGroupKey, Record<Lang, string>> = {
  wins: { ru: 'Победы, призовые места и финалы', en: 'Wins, podiums & finals' },
  science: { ru: 'Конференции и публикации', en: 'Conferences & publications' },
  startup: { ru: 'Стартапы и хакатоны', en: 'Startups & hackathons' },
  learning: { ru: 'Курсы и сертификаты', en: 'Courses & certificates' },
  mobility: { ru: 'Гранты и мобильность', en: 'Grants & mobility' },
  other: { ru: 'Конкурсы и другое', en: 'Contests & more' },
};

/** Used to decide which entries survive the cap (never shown). */
const LEVEL_WEIGHT: Record<string, number> = {
  international: 7,
  national: 6,
  regional: 5,
  city: 4,
  university: 3,
  online: 3,
  unknown: 2,
  school: 1,
};

export function resumeGroupOf(a: Achievement): ResumeGroupKey {
  if (a.data.podium) return 'wins';
  const g = groupOf(a);
  return g === 'science' || g === 'startup' || g === 'learning' || g === 'mobility' ? g : 'other';
}

const newestFirst = (a: Achievement, b: Achievement) => dateKey(b.data.date).localeCompare(dateKey(a.data.date));

/** Featured first, then the level of the event, then the newest. */
const mostImportantFirst = (a: Achievement, b: Achievement) =>
  Number(b.data.featured) - Number(a.data.featured) ||
  (LEVEL_WEIGHT[b.data.level] ?? 0) - (LEVEL_WEIGHT[a.data.level] ?? 0) ||
  newestFirst(a, b);

export interface ResumeGroup extends Capped<Achievement> {
  key: ResumeGroupKey;
  label: string;
}

/** Non-empty groups in print order; each keeps its most important entries, listed newest first. */
export function groupAchievements(list: Achievement[], lang: Lang): ResumeGroup[] {
  return RESUME_GROUPS.map((key) => {
    const picked = cap(
      list.filter((a) => resumeGroupOf(a) === key).sort(mostImportantFirst),
      RESUME_LIMITS[key],
    );
    return { ...picked, items: [...picked.items].sort(newestFirst), key, label: GROUP_LABEL[key][lang] };
  }).filter((g) => g.total > 0);
}

export interface AchievementLine {
  id: string;
  /** "05.2026", "2024", or "≈ 2024" when the document prints no date and the year is inferred */
  date: string;
  title: string;
  /** event, or issuer when there is no event; empty when the title already names it */
  context: string;
  /** empty when the title already states it */
  result: string;
}

/** True when `part` is already said by `whole` — avoids "1 место на хакатоне · 1 место". */
function mentions(whole: string, part: string): boolean {
  return part !== '' && whole.toLocaleLowerCase().includes(part.toLocaleLowerCase());
}

export function achievementLine(a: Achievement, lang: Lang): AchievementLine {
  const title = loc(a.data.title, lang);
  const context = loc(a.data.event, lang) || loc(a.data.issuer, lang);
  const result = loc(a.data.result, lang);
  return {
    id: a.id,
    date: fmtAchDate(a.data.date, a.data.dateApprox, lang, 'short'),
    title,
    context: mentions(title, context) ? '' : context,
    result: mentions(title, result) ? '' : result,
  };
}

/* ------------------------------------------------------------------ profile */

/*
 * The site never shows a phone number or an address, so a contact is printed only when nothing about
 * it can be one: its kind does not name a phone, a number-based messenger or an address (any language,
 * any spelling: "Phone", "WhatsApp", "тел.", "Адрес"…), its URL neither dials nor messages a number
 * (tel:, sms:, wa.me, t.me/+<number>, …?phone=…), and neither its label nor its URL contains a
 * phone-shaped run of digits.
 */
const PRIVATE_KIND =
  /phone|mobile|whats\s*app|viber|signal|address|(?<!\p{L})(?:tel|sms|fax|тел)(?!\p{L})|телеф|мобил|сотов|ватсап|вотсап|вайбер|адрес|факс/iu;
const PRIVATE_URL =
  /^(?:tel|sms|smsto|mms|callto|whatsapp|viber|facetime(?:-audio)?|sgnl):|\/\/(?:[\w-]+\.)*(?:wa\.me|whatsapp\.com|viber\.click)(?:[/:?#]|$)|\/\/(?:www\.)?(?:t|telegram)\.me\/\+\d|signal\.me\/#p\/|[?&](?:phone|tel)=/i;

/**
 * True when `text` holds something shaped like a phone number: "+" and 7+ digits, 7+ digits grouped by
 * spaces, dots, dashes or brackets ("8 (701) 234-56-78", "234-56-78"), or 10+ digits in a row. Plain
 * runs of up to 9 digits pass — profile ids such as vk.com/id580123456 look like that.
 */
function hasPhoneNumber(text: string): boolean {
  for (const [run] of text.matchAll(/\+?[\s(]*\d(?:[\s().-]*\d)*/g)) {
    const digits = run.replace(/\D/g, '').length;
    const grouped = /\d[\s().-]+\d/.test(run);
    if (digits >= 10 || (digits >= 7 && (grouped || run.startsWith('+')))) return true;
  }
  return false;
}

function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** Why a contact must stay off the page, or `undefined` when it may be printed. */
export function privateContactReason(c: Contact): string | undefined {
  const url = safeDecode(c.url);
  if (PRIVATE_KIND.test(c.kind)) return `its kind "${c.kind}" is a phone, a number-based messenger or an address`;
  if (PRIVATE_URL.test(url)) return 'its URL dials or messages a phone number';
  if (hasPhoneNumber(c.label) || hasPhoneNumber(url)) return 'its label or URL contains a phone number';
  return undefined;
}

/** Contacts already reported, so that every page printing the contact sheet warns only once per build. */
const reported = new Set<string>();

/** Public contacts, primary first. Left-out contacts are reported in the build log (never printed). */
export function publicContacts(profile: ProfileData): Contact[] {
  return profile.contacts
    .filter((c) => {
      const reason = privateContactReason(c);
      if (reason && !reported.has(c.url + c.label)) {
        reported.add(c.url + c.label);
        console.warn(`[resume] contact #${profile.contacts.indexOf(c) + 1} (${c.kind}) is left out: ${reason}.`);
      }
      return !reason;
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** Platform names by kind; the kind is free text in the profile, so common aliases are listed too. */
const KIND_NAME: Record<string, string> = {
  email: 'Email',
  'e-mail': 'Email',
  mail: 'Email',
  почта: 'Email',
  telegram: 'Telegram',
  tg: 'Telegram',
  телеграм: 'Telegram',
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  twitter: 'X',
  vk: 'VK',
  вконтакте: 'VK',
  habr: 'Habr',
  kaggle: 'Kaggle',
  medium: 'Medium',
  website: 'Web',
  site: 'Web',
  web: 'Web',
  сайт: 'Web',
};

/**
 * Platform name printed as the contact's label ("Telegram"). Unknown kinds are capitalised as written,
 * except that the English CV prints a Cyrillic kind ("портфолио") as the neutral "Web".
 */
export function contactKind(c: Contact, lang: Lang): string {
  const kind = c.kind.trim();
  const known = KIND_NAME[kind.toLocaleLowerCase()];
  if (known) return known;
  if (lang === 'en' && /\p{Script=Cyrillic}/u.test(kind)) return 'Web';
  return kind.charAt(0).toLocaleUpperCase() + kind.slice(1);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The contact's label without a leading platform name that the sheet already prints beside it
 * ("Telegram · @handle" → "@handle").
 */
export function contactLabel(c: Contact, lang: Lang): string {
  const label = c.label.trim();
  for (const name of new Set([contactKind(c, lang), c.kind.trim()])) {
    const prefix = new RegExp(`^${escapeRegExp(name)}\\s*[·:|•—–-]\\s*(?=\\S)`, 'iu');
    if (name && prefix.test(label)) return label.replace(prefix, '');
  }
  return label;
}

/** Date the content was last updated (YYYY-MM-DD) — same rule as the site footer. */
export function updatedOn(profile: ProfileData): string {
  return profile.updated ?? new Date().toISOString().slice(0, 10);
}

/**
 * `period` is a single string in the schema ("2023 — н.в.", "2024 — ..."): print an open end as
 * "н. в." / "present" in the reader's language.
 */
const PRESENT_RE = /(?:по\s+)?(?:настоящее\s+время|н\.\s?в\.?)|\b(?:present|now|today)\b|(?<=[—–-]\s*)(?:\.{3}|…)\s*$/giu;
const PRESENT: Record<Lang, string> = { ru: 'н. в.', en: 'present' };

export function localizePeriod(period: string, lang: Lang): string {
  return period.replace(PRESENT_RE, PRESENT[lang]);
}

/** "https://gennadiy0041.github.io/en/" -> "gennadiy0041.github.io/en" */
export function displayUrl(href: string): string {
  return href.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/* ------------------------------------------------------------------ social cards */

/**
 * Home-card subtitle: the hero's typed phrases exactly as the hero prints them, after its "›" prompt
 * ("› строю AI-продукты / довожу стартапы до финала") — lower case, so the English ones do not read
 * as orders to the viewer — or the intro sentence when the profile has no phrases.
 */
export type HomeSubtitle = { phrases: string[] } | { intro: string };

export function homeSubtitle(profile: ProfileData, lang: Lang): HomeSubtitle | undefined {
  const phrases = profile.typed[lang].map((s) => s.trim()).filter(Boolean);
  if (phrases.length > 0) return { phrases };
  const intro = loc(profile.intro, lang);
  return intro ? { intro } : undefined;
}

/* ------------------------------------------------------------------ QR */

interface QrCodeApi {
  toString(
    text: string,
    options: {
      type: 'svg';
      margin: number;
      errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
      color: { dark: string; light: string };
    },
  ): Promise<string>;
}

/**
 * Inline SVG QR code: ink modules on a transparent background, no quiet zone (the layout keeps
 * white space around it), sized by CSS. Hidden from assistive tech — the URL is printed beside it.
 */
export async function qrSvg(url: string, ink = '#0b0c0e'): Promise<string> {
  const svg = await (QRCode as QrCodeApi).toString(url, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'Q',
    color: { dark: ink, light: '#0000' },
  });
  return svg.trim().replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
}
