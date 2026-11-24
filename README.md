# gennadiy0041.github.io

Personal site of Gennadiy Kozlov — projects, achievements and the documents behind them.
Live: **https://gennadiy0041.github.io** (RU) · **https://gennadiy0041.github.io/en/** (EN)

## Stack

- [Astro 6](https://astro.build) + TypeScript, Tailwind CSS 4
- GSAP (ScrollTrigger, SplitText) + Lenis for motion, OGL for the WebGL hero
- `astro:assets` + sharp → AVIF/WebP; Astro Fonts API (Unbounded, Onest, JetBrains Mono with Kazakh glyphs)
- Resume PDF and social cards are rendered from the same content on every build (`scripts/postbuild.mjs`)
- GitHub Actions → GitHub Pages on every push to `main`

## Content

| What | Where |
| --- | --- |
| Achievements | `content/achievements/<id>.md` (+ processed images in `content/achievements/media/`) |
| Projects | `content/projects/<id>.md` (+ `content/projects/media/<id>/`) |
| Profile, skills, contacts | `content/profile.yaml` |
| Sync bookkeeping (hashes only) | `content/.sync/manifest.json` |

Every visible text exists in Russian and English. Source documents are never committed —
only processed images with private data painted over (see `docs/SYNC.md`).

## Commands

```bash
npm run dev      # local dev server
npm run build    # site + resume PDF + OG images into dist/
npm run sync     # find new files in the achievements folder, prepare drafts (local machine only)
npm run media    # render redacted public images from source documents (local machine only)
```

Maintenance procedure for new achievements: see `CLAUDE.md`.
