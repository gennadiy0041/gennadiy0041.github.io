import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { getImage } from 'astro:assets';
import {
  CATEGORY_GROUP,
  GROUP_LABEL,
  LEVEL_LABEL,
  dateKey,
  fmtDate,
  loc,
  localizePath,
  yearOf,
  type Group,
  type Lang,
} from '../i18n';

export type Achievement = CollectionEntry<'achievements'>;
export type Project = CollectionEntry<'projects'>;
export type Profile = CollectionEntry<'profile'>;

const isPublished = (e: { data: { draft?: boolean } }) => !e.data.draft;

/** Public achievements, newest first. */
export async function getAchievements(): Promise<Achievement[]> {
  const all = await getCollection('achievements', isPublished);
  return all.sort((a, b) => dateKey(b.data.date).localeCompare(dateKey(a.data.date)) || a.id.localeCompare(b.id));
}

/** Public projects in bento order. */
export async function getProjects(): Promise<Project[]> {
  const all = await getCollection('projects', isPublished);
  return all.sort((a, b) => a.data.order - b.data.order || dateKey(b.data.date).localeCompare(dateKey(a.data.date)));
}

export async function getProfile(): Promise<Profile['data']> {
  const p = await getEntry('profile', 'main');
  if (!p) throw new Error('content/profile.yaml must contain a "main" entry');
  return p.data;
}

export function groupOf(a: Achievement): Group {
  return CATEGORY_GROUP[a.data.category] ?? 'other';
}

export function projectHref(p: Project | string, lang: Lang): string {
  const id = typeof p === 'string' ? p : p.id;
  return localizePath(`/projects/${id}/`, lang);
}

export function achievementAnchor(a: Achievement | string): string {
  return `a-${typeof a === 'string' ? a : a.id}`;
}

/** Headline numbers for the stats block — all computed from content, nothing typed by hand. */
export async function getStats() {
  const [ach, prj] = await Promise.all([getAchievements(), getProjects()]);
  const podium = ach.filter((a) => a.data.podium).length;
  const science = ach.filter((a) => groupOf(a) === 'science').length;
  const startup = ach.filter((a) => groupOf(a) === 'startup').length;
  const docs = ach.filter((a) => a.data.image).length;
  const intl = ach.filter((a) => a.data.level === 'international').length;
  const years = new Set(ach.map((a) => yearOf(a.data.date)));
  return { achievements: ach.length, podium, science, startup, docs, intl, projects: prj.length, years: years.size };
}

/** Compact JSON for client features (Ctrl+K palette, lightbox captions). */
export async function buildClientIndex(lang: Lang) {
  const [ach, prj] = await Promise.all([getAchievements(), getProjects()]);
  const achievements = await Promise.all(
    ach.map(async (a) => {
      const g = groupOf(a);
      let thumb: string | undefined;
      if (a.data.image) {
        const img = await getImage({ src: a.data.image, width: 96, format: 'webp' });
        thumb = img.src;
      }
      return {
        id: a.id,
        t: loc(a.data.title, lang),
        alt: loc(a.data.title, lang === 'ru' ? 'en' : 'ru'),
        r: loc(a.data.result, lang),
        i: loc(a.data.issuer, lang),
        e: loc(a.data.event, lang),
        d: fmtDate(a.data.date, lang),
        y: yearOf(a.data.date),
        g,
        gl: loc(GROUP_LABEL[g], lang),
        lv: loc(LEVEL_LABEL[a.data.level], lang),
        p: a.data.podium,
        img: Boolean(a.data.image),
        thumb,
        href: `${localizePath('/', lang)}#${achievementAnchor(a)}`,
      };
    }),
  );
  const projects = prj.map((p) => ({
    id: p.id,
    t: p.data.name,
    s: loc(p.data.tagline, lang),
    alt: loc(p.data.tagline, lang === 'ru' ? 'en' : 'ru'),
    e: loc(p.data.event, lang),
    st: p.data.stack.join(' '),
    href: projectHref(p, lang),
  }));
  return { lang, achievements, projects };
}

export type ClientIndex = Awaited<ReturnType<typeof buildClientIndex>>;
