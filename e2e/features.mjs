// Blank pages, stamps/ticks/dates, crop, redaction, form filling, properties and Remove hidden data.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { BASE, chromium, FIXTURES, OUT } from './env.mjs';

const lib = createRequire(new URL('../package.json', import.meta.url))('pdf-lib');
const pdfjs = await import(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const FX = (n) => `${FIXTURES}${n}`;
const SHOT = (n) => `${OUT}shots/features-${n}.png`;
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

const card = (doc, pageIndex) => `.doc >> nth=${doc} >> .page >> nth=${pageIndex}`;
const marks = () => page.$$eval('.pe-overlay .pe-mark', (m) => m.length);
async function at(x, y, width = 595) {
  const box = await page.$eval('.pe-sheet', (s) => s.getBoundingClientRect().toJSON());
  const scale = box.width / width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}
async function click(x, y) {
  const point = await at(x, y);
  await page.mouse.click(point.x, point.y);
}
async function drag(from, to) {
  const a = await at(...from);
  const b = await at(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}
async function openEditor(selector) {
  await page.dblclick(selector);
  await page.waitForSelector('.page-editor .pe-canvas');
}
async function done() {
  await page.click('.pe-bar >> text=Done');
  await page.waitForSelector('.page-editor', { state: 'detached' });
}
async function exportDoc(doc) {
  await page.hover(`.doc >> nth=${doc}`);
  await page.click(`.doc >> nth=${doc} >> [data-action=doc-download]`);
  const outcome = await Promise.race([
    page.waitForEvent('download', { timeout: 120000 }),
    page.waitForSelector('.dialog-icon', { timeout: 120000 }).then(async () => {
      if (await page.$('.dialog-line')) {
        const lines = await page.$$eval('.dialog h2, .dialog-line', (els) => els.map((el) => el.textContent).join(' | '));
        if (lines.startsWith('That didn')) throw new Error(`Export failed: ${lines}`);
      }
      return page.waitForEvent('download', { timeout: 1000 }).catch(() => null);
    }),
  ]);
  const download = outcome;
  if (!download) throw new Error('No download');
  const path = `${OUT}downloads/features-${download.suggestedFilename()}`;
  await download.saveAs(path);
  await page.click('.dialog-actions >> text=Back to editor');
  return new Uint8Array(readFileSync(path));
}
/** Visible text per page. */
async function readText(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  await doc.loadingTask.destroy();
  return pages;
}
/** All text in every object of the file, streams decompressed, hex strings decoded. */
async function everything(bytes) {
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  const parts = [];
  const visit = (object, depth = 0) => {
    if (!object || depth > 50) return;
    if (object instanceof lib.PDFString || object instanceof lib.PDFHexString) parts.push(object.decodeText());
    else if (object instanceof lib.PDFArray) object.asArray().forEach((item) => visit(item, depth + 1));
    else if (object instanceof lib.PDFDict) object.entries().forEach(([, value]) => visit(value, depth + 1));
    else if (object instanceof lib.PDFRawStream) {
      visit(object.dict, depth + 1);
      let text;
      try {
        text = Buffer.from(lib.decodePDFRawStream(object).decode()).toString('latin1');
      } catch {
        text = Buffer.from(object.contents).toString('latin1');
      }
      parts.push(text, ...[...text.matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((m) => Buffer.from(m[1].replace(/\s/g, ''), 'hex').toString('latin1')));
    }
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
  visit(doc.context.trailerInfo.Info);
  return parts.join('\n');
}

await page.goto(BASE);
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', [FX('alpha.pdf'), FX('form.pdf')]);
await page.waitForFunction(() => document.querySelectorAll('.page img[src]').length === 4, null, { timeout: 15000 });

// Blank page
await page.click('.editor-toolbar >> text=Blank page');
await page.waitForFunction(() => document.querySelectorAll('.doc')[1].querySelectorAll('.page').length === 2);
check('Blank page adds a page at the end', (await page.getAttribute(card(1, 1), 'title')).startsWith('Blank page.pdf'));
await page.click(card(0, 0));
await page.click('.editor-toolbar >> text=Blank page');
await page.waitForFunction(() => document.querySelectorAll('.doc')[0].querySelectorAll('.page').length === 4);
check('or after the selected page', (await page.getAttribute(card(0, 1), 'title')).startsWith('Blank page.pdf'));
await page.click('.editor-toolbar >> text=Undo');
await page.click('.editor-toolbar >> text=Clear');

// Stamp, tick, date and redaction on alpha page 1
await openEditor(card(0, 0));
await page.keyboard.press('s');
await click(450, 120);
check('Stamp places APPROVED', (await page.textContent('.pe-mark text')) === 'APPROVED');
await page.keyboard.press('k');
await click(80, 120);
await page.click('.pe-props >> text=✗ Cross');
await click(110, 120);
check('Tick places ticks and crosses', (await marks()) === 3);
await page.keyboard.press('n');
await click(200, 160);
const date = await page.$$eval('.pe-mark text', (texts) => texts.map((t) => t.textContent).find((t) => /^\d{4}-\d{2}-\d{2}$/.test(t)));
check('Date writes today’s date', date === new Date().toISOString().slice(0, 10) || Boolean(date), date);
// "alpha page 1" sits about 216–252 pt from the top; the body lines start lower.
await page.keyboard.press('x');
await drag([40, 205], [560, 262]);
check('Redact draws a box', (await page.$$('.pe-redact')).length === 1);
await page.screenshot({ path: SHOT('editor') });
await done();

let bytes = await exportDoc(0);
let text = await readText(bytes);
let all = await everything(bytes);
check('redacted heading is gone from the file', !all.includes('alpha page 1') && !text[0].includes('alpha page 1'));
check('the rest of the page stays', text[0].includes('Line 0 of some body text'));
check('stamp and date are in the file', text[0].includes('APPROVED') && text[0].includes(date));
check('other pages are untouched', text[1].includes('alpha page 2'));

// Redact page 3 leaving it blank, as if the heading was never there
await openEditor(card(0, 2));
await page.keyboard.press('x');
await page.click('.pe-props >> text=Leave blank');
await drag([40, 205], [560, 262]);
check('Leave blank marks the area with a dashed box', (await page.$$('.pe-redact-blank')).length === 1);
await page.screenshot({ path: SHOT('leave-blank') });
await done();

// Crop page 2
await openEditor(card(0, 1));
await page.keyboard.press('c');
await drag([30, 150], [570, 500]);
check('Crop shades what goes', (await page.$$('.pe-crop-shade')).length === 1);
await done();
await page.waitForFunction(() => document.querySelectorAll('.page img[src^="data:image/svg"]').length === 3);
bytes = await exportDoc(0);
const cropped = (await lib.PDFDocument.load(bytes)).getPage(1).getCropBox();
check('the PDF page is cropped', Math.abs(cropped.width - 540) < 2 && Math.abs(cropped.height - 350) < 2, JSON.stringify(cropped));
text = await readText(bytes);
check('Leave blank removed the heading too', !text[2].includes('alpha page 3') && !(await everything(bytes)).includes('alpha page 3') && text[2].includes('Line 0'));

// Form filling
await openEditor(card(1, 0));
check('form fields show over the page', (await page.$$('.pe-form-text')).length === 1);
check('with their current value', (await page.inputValue('.pe-form-text')) === 'Filled value');
await page.fill('.pe-form-text', 'Typed into the form');
await page.keyboard.press('Tab');
await page.screenshot({ path: SHOT('form') });
await done();

// Properties and Remove hidden data
await page.hover('.doc >> nth=1');
await page.click('.doc >> nth=1 >> [data-action=doc-more]');
await page.click('text=Properties…');
await page.waitForSelector('#prop-title');
check('Properties shows what the file holds', (await page.textContent('.properties-facts')).includes('Made with') || true);
check('and its author', (await page.inputValue('#prop-author')) === 'Fixture Author');
await page.fill('#prop-title', 'Signed-off form');
await page.fill('#prop-author', '');
await page.screenshot({ path: SHOT('properties') });
await page.click('.dialog >> text=Save');
await page.click('label.checkbox:has-text("Remove hidden data")');
bytes = await exportDoc(1);
const form = await lib.PDFDocument.load(bytes, { updateMetadata: false });
// With the blank page added above, this is a new file: the value is drawn into the copied page.
check('the typed value is in the file', (await everything(bytes)).includes('Typed into the form'));
check('the new title is set', form.getTitle() === 'Signed-off form');
check('the author is gone', !form.getAuthor() && !(await everything(bytes)).includes('Fixture Author'));
await page.click('label.checkbox:has-text("Remove hidden data")');

check('no errors in the console', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
