// @ts-check
/**
 * Draft achievement for the reviewer: `.private/inbox/<sha12>/draft.md`.
 *
 * It is a ready-to-fill frontmatter in the shape of src/content.config.ts (every text field
 * as { ru, en }), with the source hash, the candidate redaction boxes and — as YAML comments —
 * the page text with private data already masked. Drafts never go to content/ directly:
 * the reviewer fills facts from the document and saves content/achievements/<id>.md.
 */
import { KIND_LABEL, categoriesIn, datesIn, hintPages } from './detect.mjs';
import { plural, today } from './util.mjs';

const CATEGORIES =
  'hackathon | pitch-startup | conference | publication | olympiad | competition | sport | course | language-test | grant-scholarship | academic-mobility | volunteering | work | other';
const LEVELS = 'international | national | regional | city | university | school | online | unknown';

/**
 * @param {object} d
 * @param {string} d.sha256
 * @param {string} d.ext
 * @param {number} d.pages
 * @param {import('./detect.mjs').Candidate[]} d.candidates numbered 1..n in this order
 * @param {import('./detect.mjs').Finding[]} d.findings text-only findings (DOCX/PPTX)
 * @param {{ page: number, from: string, lines: string[] }[]} d.texts masked text per page (page 0 = document text)
 * @param {number} d.pictures pictures embedded in a DOCX/PPTX
 * @param {import('./detect.mjs').DocHint[]} d.hints what the pages look like (see detect.docHints)
 * @param {Map<number, import('./geometry.mjs').Turn>} d.rotations pages that read upright only after a clockwise turn
 */
export function buildDraft(d) {
  const allLines = d.texts.flatMap((t) => t.lines);
  const dates = datesIn(allLines).slice(0, 8);
  const cats = categoriesIn(allLines);
  const sourcePages = d.pages > 1 ? `1-${d.pages}` : '1';
  const sha12 = d.sha256.slice(0, 12);
  /** turns of pages other than 1 (page 1 is the one this draft publishes) */
  const otherTurns = [...d.rotations].filter(([page]) => page !== 1);
  const out = [
    '---',
    `# Черновик из npm run sync, ${today()}. Источник ${sha12} · ${d.ext} · ${d.pages} стр.`,
    '# Факты — только из документа, все тексты на RU и EN. Проверь redact по review-*.png, затем сохрани',
    '# как content/achievements/<id>.md (id: yyyy-коротко-латиницей) и выполни npm run media. См. docs/SYNC.md.',
  ];
  for (const h of d.hints) {
    const where = hintPages(h, d.pages);
    out.push(`# Подсказка: ${where ? `${where}: ` : ''}${h.text}. Не публикуем → npm run sync -- --hide ${sha12} --reason ${h.reason}${where ? ` --pages …` : ''}`);
  }
  if (d.pages > 1) out.push(`# В файле ${d.pages} стр.: если это разные ачивки — по записи на страницу (source.pages + только её redact).`);
  if (otherTurns.length) {
    out.push(`# Повёрнуты (в записи с такой страницей — rotate): ${otherTurns.map(([page, turn]) => `стр. ${page} → rotate: ${turn}`).join(', ')}`);
  }
  if (d.pictures) out.push(`# Внутри документа ${d.pictures} ${plural(d.pictures, 'картинка', 'картинки', 'картинок')} — для обложки нужен скан или скриншот.`);
  out.push(`# Даты в тексте: ${dates.length ? dates.join(', ') : '—'}`);
  out.push(`# Похоже на category: ${cats.length ? cats.join(', ') : '—'}`);
  out.push(
    'title: { ru: "", en: "" }',
    'event: { ru: "", en: "" }',
    'issuer: { ru: "", en: "" }',
    'date: ""  # YYYY | YYYY-MM | YYYY-MM-DD',
    `category: ${cats.length === 1 ? `${cats[0]}  # угадано по тексту — проверь` : `other  # ${CATEGORIES}`}`,
    `level: unknown  # ${LEVELS}`,
    'result: { ru: "", en: "" }',
    'description: { ru: "", en: "" }',
    'imageAlt: { ru: "", en: "" }',
    'featured: false',
    'podium: false',
    'source:',
    `  - { sha256: "${d.sha256}", pages: "${sourcePages}" }`,
  );
  const turn = d.rotations.get(1);
  if (turn) out.push(`rotate: ${turn}  # стр. 1 лежит ${turn === 180 ? 'вверх ногами' : 'боком'}: media повернёт картинку; redact и crop — по неповёрнутой странице`);
  if (d.candidates.length) {
    out.push('redact:');
    let page = 0;
    d.candidates.forEach((c, i) => {
      if (c.page !== page) {
        page = c.page;
        out.push(`  # стр. ${page}`);
      }
      const box = `{ page: ${c.page}, x: ${c.x}, y: ${c.y}, w: ${c.w}, h: ${c.h}, kind: ${c.kind} }`;
      const low = c.confidence < 0.6 ? ' · низкая уверенность, проверь' : '';
      out.push(`  - ${box}  # #${i + 1} ${KIND_LABEL[c.kind]}: ${c.masked} (${c.from} ${c.confidence})${low}`);
    });
  } else out.push('redact: []');
  out.push('# crop: { x: 0, y: 0, w: 1, h: 1 }  # обрезка страницы (0..1), если нужна');
  if (d.findings.length) {
    out.push('#', '# В тексте документа найдено (без координат):');
    for (const f of d.findings) out.push(`#   ${KIND_LABEL[f.kind]}: ${f.masked} (${f.confidence})`);
  }
  for (const t of d.texts) {
    const head = t.page ? `стр. ${t.page} · ${t.from === 'textlayer' ? 'текстовый слой PDF' : 'OCR'}` : `текст ${t.from.toUpperCase()}`;
    out.push('#', `# ── ${head} (чувствительное замаскировано) ──`);
    if (!t.lines.length) out.push('#   (текста нет)');
    for (const line of t.lines) out.push(`#   ${line.replace(/[\u0000-\u001f\u007f]/g, ' ')}`);
  }
  out.push('---', '');
  return out.join('\n');
}
