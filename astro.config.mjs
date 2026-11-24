// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Kazakh needs cyrillic-ext (ә ғ қ ң ө ұ ү һ) on top of basic cyrillic (і).
/** @type {[string, ...string[]]} */
const subsets = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'];

export default defineConfig({
  site: 'https://gennadiy0041.github.io',
  trailingSlash: 'ignore',
  i18n: {
    defaultLocale: 'ru',
    locales: ['ru', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/og-card/') && !page.includes('/resume/'),
      i18n: { defaultLocale: 'ru', locales: { ru: 'ru-RU', en: 'en-US' } },
    }),
  ],
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Unbounded',
      cssVariable: '--font-display',
      weights: ['200 900'],
      styles: ['normal'],
      subsets,
      fallbacks: ['sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Onest',
      cssVariable: '--font-body',
      weights: ['100 900'],
      styles: ['normal'],
      subsets,
      fallbacks: ['sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'JetBrains Mono',
      cssVariable: '--font-code',
      weights: ['100 800'],
      styles: ['normal'],
      subsets,
      fallbacks: ['monospace'],
    },
  ],
  image: {
    // processed (already redacted) masters live in content/**/media; astro:assets makes AVIF/WebP variants
    layout: 'constrained',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
