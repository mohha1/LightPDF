import { BASE, chromium, FIXTURES, JSZip, OUT, PDFDocument } from './env.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const FX = (n) => `${FIXTURES}${n}`;
const SHOT = (n) => `${OUT}shots/editor-${n}.png`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());

const load = (b) => PDFDocument.load(b, { updateMetadata: false });
const rotations = async (b) => (await load(b)).getPages().map((p) => p.getRotation().angle);
const unzip = async (b) => {
  const z = await JSZip.loadAsync(b);
  return Promise.all(Object.values(z.files).map(async (f) => ({ name: f.name, data: await f.async('uint8array') })));
};
// Layout as the editor shows it: "name: source.index@rotation ..." using the card title.
const layout = () =>
  page.$$eval('.doc', (docs) =>
    docs.map((doc) => {
      const name = doc.querySelector('.doc-name').value;
      const pages = [...doc.querySelectorAll('.page')].map((p) => {
        const t = p.getAttribute('title').replace('.pdf, page ', '.').replace(/\.(jpg|png|webp)$/, '');
        const rot = p.querySelector('img').style.getPropertyValue('--rotation');
        return rot && rot !== '0deg' ? `${t}@${parseInt(rot)}` : t;
      });
      return `${name}: ${pages.join(' ')}`;
    }),
  );
async function fresh() {
  await page.goto('about:blank');
  await page.goto(BASE);
  await page.waitForSelector('.dropzone');
}
async function add(files) {
  const before = await page.$$eval('.page', (p) => p.length).catch(() => 0);
  await page.setInputFiles('input[type=file]', files.map(FX));
  await page.waitForFunction((n) => document.querySelectorAll('.page').length > n && !document.querySelector('.status:not([hidden])'), before);
}
const card = (doc, pageIndex) => `.doc >> nth=${doc} >> .page >> nth=${pageIndex}`;
async function exportNow(button = '.btn-action') {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(button)]);
  const path = `${OUT}downloads/editor-${download.suggestedFilename()}`;
  await download.saveAs(path);
  await page.waitForSelector('.dialog-line');
  const summary = (await page.$$eval('.dialog-line', (lines) => lines.slice(1).map((l) => l.textContent))).join(' ');
  await page.click('.dialog-actions >> text=Back to editor');
  return { name: download.suggestedFilename(), bytes: readFileSync(path), summary };
}

// Landing
await fresh();
await page.screenshot({ path: SHOT('landing'), fullPage: true });
check('landing shows dropzone', await page.isVisible('.dropzone'));

// Add two PDFs
await add(['alpha.pdf', 'bravo.pdf']);
await page.waitForFunction(() => document.querySelectorAll('.page img[src]').length === 8, null, { timeout: 15000 });
check('two documents, eight pages', JSON.stringify(await layout()) === JSON.stringify(['alpha: alpha.1 alpha.2 alpha.3', 'bravo: bravo.1 bravo.2 bravo.3 bravo.4 bravo.5']), JSON.stringify(await layout()));
check('download label', (await page.textContent('.btn-action')).includes('Download 2 PDFs'));
await page.screenshot({ path: SHOT('workspace') });

// Default export: one PDF per document, original kept for untouched files
let r = await exportNow();
let files = await unzip(r.bytes);
check('exports one PDF per file', r.name === 'lightpdf.zip' && files.map((f) => f.name).join() === 'alpha.pdf,bravo.pdf', r.name);
check('untouched file keeps its metadata', (await load(files[0].data)).getTitle() === 'alpha title');

// Selection: click, shift-click range across docs, then rotate with keyboard
await page.click(card(0, 1));
await page.click(card(1, 0), { modifiers: ['Shift'] });
check('shift-click selects a range', (await page.textContent('.selection-info')) === '3 pages selected');
await page.keyboard.press('r');
check('R rotates selection', JSON.stringify(await layout()) === JSON.stringify(['alpha: alpha.1 alpha.2@90 alpha.3@90', 'bravo: bravo.1@90 bravo.2 bravo.3 bravo.4 bravo.5']), JSON.stringify(await layout()));
await page.keyboard.press('Control+z');
check('undo restores', !(await layout()).join().includes('@'));
await page.keyboard.press('Control+Shift+z');
check('redo reapplies', (await layout()).join().includes('alpha.2@90'));
await page.keyboard.press('Escape');
check('escape clears selection', (await page.textContent('.selection-info')) === 'No pages selected');

// Drag a page from alpha into bravo (mouse)
const src = await page.locator(card(0, 0)).boundingBox();
const dst = await page.locator(card(1, 0)).boundingBox();
await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
await page.mouse.down();
await page.mouse.move(src.x + src.width / 2 + 20, src.y + src.height / 2 + 20, { steps: 4 });
await page.mouse.move(dst.x + 10, dst.y + dst.height / 2, { steps: 8 });
await page.waitForTimeout(100);
await page.screenshot({ path: SHOT('dragging') });
await page.mouse.up();
check('drag moves page between files', JSON.stringify(await layout()) === JSON.stringify(['alpha: alpha.2@90 alpha.3@90', 'bravo: alpha.1 bravo.1@90 bravo.2 bravo.3 bravo.4 bravo.5']), JSON.stringify(await layout()));
check('drag does not toggle selection', (await page.textContent('.selection-info')) === 'No pages selected');

// Multi-select drag within a document: move bravo.3 and bravo.4 to the front of bravo
await page.click(card(1, 3));
await page.click(card(1, 4));
const s2 = await page.locator(card(1, 3)).boundingBox();
const d2 = await page.locator(card(1, 0)).boundingBox();
await page.mouse.move(s2.x + s2.width / 2, s2.y + s2.height / 2);
await page.mouse.down();
await page.mouse.move(d2.x + 5, d2.y + d2.height / 2, { steps: 10 });
await page.mouse.up();
check('multi-page drag keeps order', (await layout())[1] === 'bravo: bravo.3 bravo.4 alpha.1 bravo.1@90 bravo.2 bravo.5', (await layout())[1]);
await page.keyboard.press('Escape');

// Split with scissors after bravo page 2
await page.hover(card(1, 1));
await page.click(`${card(1, 1)} >> .split-gap`);
check('scissors split', JSON.stringify(await layout()) === JSON.stringify(['alpha: alpha.2@90 alpha.3@90', 'bravo: bravo.3 bravo.4', 'bravo-2: alpha.1 bravo.1@90 bravo.2 bravo.5']), JSON.stringify(await layout()));

// Rename, merge with next, extract, delete with undo toast
await page.fill('.doc >> nth=1 >> .doc-name', 'Chapter 2');
await page.press('.doc >> nth=1 >> .doc-name', 'Enter');
await page.click('.doc >> nth=1 >> [data-action="doc-merge-next"]');
check('rename + merge with next', (await layout())[1] === 'Chapter 2: bravo.3 bravo.4 alpha.1 bravo.1@90 bravo.2 bravo.5', (await layout())[1]);
await page.click(card(1, 0));
await page.click(card(1, 5));
await page.click('.tool >> text=New file');
check('copy selection to new file', (await layout())[2] === 'Chapter 2-extract: bravo.3 bravo.5', JSON.stringify(await layout()));
await page.keyboard.press('Delete');
check('delete selection', (await layout())[1] === 'Chapter 2: bravo.4 alpha.1 bravo.1@90 bravo.2', (await layout())[1]);
await page.click('.toast-action');
check('undo from toast', (await layout())[1].startsWith('Chapter 2: bravo.3'));
await page.keyboard.press('Escape');

// Merge all and export with page numbers + watermark
await page.click('.tool >> text=Merge all');
check('merge all', (await page.$$('.doc')).length === 1 && (await page.$$('.page')).length === 10);
await page.click('label.checkbox:has-text("Page numbers")');
await page.click('label.checkbox:has-text("Watermark")');
await page.screenshot({ path: SHOT('settings') });
r = await exportNow();
check('merged export is one PDF', r.name === 'alpha-merged.pdf' && (await load(r.bytes)).getPageCount() === 10, r.name);
check('rotations exported', JSON.stringify(await rotations(r.bytes)) === JSON.stringify([90, 90, 0, 0, 0, 90, 90, 0, 0, 0]), JSON.stringify(await rotations(r.bytes)));
await page.click('label.checkbox:has-text("Page numbers")');
await page.click('label.checkbox:has-text("Watermark")');

// Undo all the way back, then split into single pages and download one file
await page.screenshot({ path: SHOT('before-undo') });
while (await page.isEnabled('.tool[title^="Undo"]')) await page.click('.tool[title^="Undo"]');
check('undo to the start', (await page.$$('.doc')).length === 2 && (await page.$$('.page')).length === 8);
await page.click('.doc >> nth=0 >> [data-action="doc-explode"]');
check('split into single pages', (await page.$$('.doc')).length === 4);
r = await exportNow('.doc >> nth=1 >> [data-action="doc-download"]');
check('per-file download', r.name === 'alpha-2.pdf' && (await load(r.bytes)).getPageCount() === 1, r.name);

// Images and other formats
await page.click('.tool >> text=Start over');
await page.waitForSelector('.dropzone');
await add(['photo.jpg', 'rotated.jpg', 'alpha.pdf']);
check('image size field appears', await page.isVisible('#field-imagePageSize'));
await page.selectOption('#field-imagePageSize', 'a4');
await page.click('.choice:has-text("JPG")');
check('image download label', (await page.textContent('.btn-action')).includes('Download 5 images'));
r = await exportNow();
files = await unzip(r.bytes);
check('JPG export', files.map((f) => f.name).join() === 'photo.jpg,rotated.jpg,alpha-1.jpg,alpha-2.jpg,alpha-3.jpg', files.map((f) => f.name).join());
writeFileSync(`${OUT}shots/editor-rotated-a4.jpg`, files[1].data);
await page.click('.choice:has-text("Text")');
r = await exportNow();
files = await unzip(r.bytes);
check('text export', files.length === 3 && new TextDecoder().decode(files[2].data).includes('alpha page 1'), r.summary);
await page.click('.choice:has-text("PDF")');

// Compression
await page.click('.tool >> text=Start over');
await page.waitForSelector('.dropzone');
await add(['scan.pdf']);
await page.click('.choice:has-text("Recommended")');
r = await exportNow();
check('compression', r.bytes.length < readFileSync(FX('scan.pdf')).length * 0.5, r.summary);
await page.click('.choice:has-text("None")');

// Broken files
await add(['alpha.pdf']).catch(() => {});
await page.setInputFiles('input[type=file]', [FX('notapdf.pdf')]);
await page.waitForSelector('.toast');
check('broken file toast', /notapdf\.pdf/.test(await page.textContent('.toast')), await page.textContent('.toast'));

// Settings persist across reloads
await page.click('.choice:has-text("PNG")');
await fresh();
await add(['alpha.pdf']);
check('settings persist', (await page.getAttribute('.choice:has-text("PNG")', 'aria-checked')) === 'true');
await page.click('.choice:has-text("PDF")');

// Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: SHOT('mobile'), fullPage: false });
check('mobile no horizontal scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await fresh();
await page.screenshot({ path: SHOT('mobile-landing'), fullPage: true });

const unexpected = errors.filter((e) => !/password|could not be read/.test(e));
check('no unexpected errors', unexpected.length === 0, unexpected.join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
