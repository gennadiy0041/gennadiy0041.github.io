import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

/** A bilingual string. Every visible text on the site exists in RU and EN. */
const L = z.object({ ru: z.string(), en: z.string() });
const Lopt = z.object({ ru: z.string().default(''), en: z.string().default('') }).optional();

/** YYYY | YYYY-MM | YYYY-MM-DD (kept as text: many certificates only print a year). */
const PartialDate = z
  .union([z.string(), z.date(), z.number()])
  .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)))
  .refine((v) => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v), 'date must be YYYY, YYYY-MM or YYYY-MM-DD');

export const CATEGORIES = [
  'hackathon',
  'pitch-startup',
  'conference',
  'publication',
  'olympiad',
  'competition',
  'sport',
  'course',
  'language-test',
  'grant-scholarship',
  'academic-mobility',
  'volunteering',
  'work',
  'other',
] as const;
export const LEVELS = ['international', 'national', 'regional', 'city', 'university', 'school', 'online', 'unknown'] as const;

/** Bookkeeping for `npm run sync`: which source file (by SHA-256, never by name) this entry came from. */
const Source = z.object({ sha256: z.string(), pages: z.string().default('') });
/** Page-relative boxes (0..1) that `npm run media` paints over before an image is published. */
const Redact = z.object({
  page: z.number().int().default(1),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  kind: z.string().default('private'),
});

const achievements = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './content/achievements' }),
  schema: ({ image }) =>
    z.object({
      title: L,
      event: Lopt,
      issuer: Lopt,
      date: PartialDate,
      category: z.enum(CATEGORIES),
      level: z.enum(LEVELS).default('unknown'),
      result: Lopt,
      description: Lopt,
      image: image().optional(),
      imageAlt: Lopt,
      photos: z.array(image()).default([]),
      link: z.string().optional(),
      featured: z.boolean().default(false),
      /** a prize / place / final — powers the "podium only" filter and the wins counter */
      podium: z.boolean().default(false),
      project: z.string().optional(),
      draft: z.boolean().default(false),
      source: z.array(Source).default([]),
      redact: z.array(Redact).default([]),
      /** optional page-relative crop (0..1) applied by `npm run media` before redaction boxes are painted */
      crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
    }),
});

const Link = z.object({ label: L, url: z.string(), kind: z.string().default('link') });

const projects = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './content/projects' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      tagline: L,
      event: Lopt,
      date: PartialDate,
      period: Lopt,
      status: Lopt,
      result: Lopt,
      problem: L,
      did: L,
      outcome: L,
      team: Lopt,
      stack: z.array(z.string()).default([]),
      metrics: z.array(z.object({ value: z.string(), label: L })).default([]),
      links: z.array(Link).default([]),
      cover: image().optional(),
      coverAlt: Lopt,
      gallery: z.array(z.object({ src: image(), caption: Lopt })).default([]),
      size: z.enum(['xl', 'lg', 'md', 'sm']).default('md'),
      order: z.number().default(100),
      featured: z.boolean().default(false),
      achievements: z.array(z.string()).default([]),
      accent: z.string().optional(),
      draft: z.boolean().default(false),
    }),
});

const profile = defineCollection({
  loader: file('./content/profile.yaml'),
  schema: ({ image }) =>
    z.object({
      name: L,
      typed: z.object({ ru: z.array(z.string()), en: z.array(z.string()) }),
      intro: L,
      about: z.object({ ru: z.array(z.string()), en: z.array(z.string()) }),
      location: L,
      heroPhotos: z.array(z.object({ src: image(), alt: L })).default([]),
      aboutPhoto: z.object({ src: image(), alt: L }).optional(),
      education: z.array(z.object({ title: L, place: L, period: z.string() })).default([]),
      experience: z.array(z.object({ org: L, role: L, period: z.string(), text: Lopt })).default([]),
      skills: z.array(z.object({ group: L, items: z.array(z.string()), evidence: Lopt })).default([]),
      languages: z.array(z.object({ name: L, level: L })).default([]),
      contacts: z
        .array(z.object({ kind: z.string(), label: z.string(), url: z.string(), primary: z.boolean().default(false) }))
        .default([]),
      updated: z.string().optional(),
    }),
});

export const collections = { achievements, projects, profile };
