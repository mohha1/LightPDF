// What MuPDF does besides redaction: opening protected PDFs, protecting downloads with a password,
// finding words to redact, and Compact compression.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { BASE, chromium, FIXTURES, OUT } from './env.mjs';

const lib = createRequire(new URL('../package.json', import.meta.url))('pdf-lib');
const pdfjs = await import(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const FX = (n) => `${FIXTURES}${n}`;
const SHOT = (n) => `${OUT}shots/tools-${n}.png`;
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
const docCount = () => page.$$eval('.doc', (docs) => docs.length);
async function toastText() {
  await page.waitForSelector('.toast');
  return page.textContent('.toast');
}
/** Whether a message with this text shows up (a new one replaces the one before). */
const toastWith = (text) => page.waitForSelector(`.toast:has-text("${text}")`, { timeout: 15000 }).then(() => true, () => false);
/** Downloads one card's file; the bytes and the result dialog's lines. */
async function exportDoc(doc) {
  await page.hover(`.doc >> nth=${doc}`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.click(`.doc >> nth=${doc} >> [data-action=doc-download]`),
  ]);
  await page.waitForSelector('.dialog-icon', { timeout: 120000 });
  const lines = await page.$$eval('.dialog h2, .dialog-line', (els) => els.map((el) => el.textContent).join(' | '));
  const path = `${OUT}downloads/tools-${download.suggestedFilename()}`;
  await download.saveAs(path);
  await page.click('.dialog-actions >> text=Back to editor');
  return { bytes: new Uint8Array(readFileSync(path)), lines };
}
/** Visible text per page, or the error's name. */
async function readText(bytes, password) {
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map((item) => item.str).join(' '));
    await doc.loadingTask.destroy();
    return pages;
  } catch (error) {
    return error.name;
  }
}
/** All text in every object of the file, streams decompressed. */
async function everything(bytes) {
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  const parts = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof lib.PDFRawStream) {
      try {
        parts.push(Buffer.from(lib.decodePDFRawStream(object).decode()).toString('latin1'));
      } catch {
        parts.push(Buffer.from(object.contents).toString('latin1'));
      }
    } else parts.push(String(object));
  }
  return parts.join('\n');
}

await page.goto(BASE);
await page.waitForSelector('.dropzone');

// Opening a PDF that needs a password, and one that only restricts printing and editing
await page.setInputFiles('input[type=file]', [FX('locked.pdf'), FX('restricted.pdf'), FX('alpha.pdf')]);
await page.waitForSelector('#pdf-password');
check('a protected PDF asks for its password', (await page.textContent('.dialog')).includes('locked.pdf'));
await page.fill('#pdf-password', 'wrong');
await page.keyboard.press('Enter');
check('a wrong password says so and keeps asking', await page.isVisible('.password-wrong'));
await page.screenshot({ path: SHOT('password') });
await page.fill('#pdf-password', 'open sesame');
await page.click('.dialog >> text=Open');
await page.waitForFunction(() => document.querySelectorAll('.page img[src]').length === 13, null, { timeout: 20000 });
check('the right password opens it, and the restricted file opens without one', (await docCount()) === 3);

await page.setInputFiles('input[type=file]', FX('locked.pdf'));
await page.waitForSelector('#pdf-password');
await page.click('.dialog >> text=Cancel');
check('Cancel leaves it out, with a note', (await toastText()).includes('password-protected and was not opened'));
check('and adds nothing', (await docCount()) === 3);

let result = await exportDoc(0);
check('the unlocked copy downloads without a password', (await readText(result.bytes))[0]?.includes('bravo page 1'));
result = await exportDoc(1);
check('the restricted file downloads too, with no restrictions left', (await readText(result.bytes))[1]?.includes('bravo page 2'));
const permissions = await (await pdfjs.getDocument({ data: result.bytes.slice(), verbosity: 0 }).promise).getPermissions();
check('and no encryption', permissions === null);

// Find and redact, on every page of alpha
await page.dblclick(card(2, 0));
await page.waitForSelector('.page-editor .pe-canvas');
await page.keyboard.press('x');
await page.fill('.pe-find', 'BODY TEXT');
await page.click('.pe-props >> text=Mark all');
const marked = await toastText();
check('Mark all marks every place on every page', marked.startsWith('Marked 60 places on 3 pages'), marked);
check('they show on the page', (await page.$$('.pe-redact')).length === 20);
await page.screenshot({ path: SHOT('find') });
await page.click('.pe-props >> text=Mark all');
check('marking again adds nothing', (await toastWith('already marked')) && (await page.$$('.pe-redact')).length === 20);
await page.fill('.pe-find', 'nowhere to be found');
await page.keyboard.press('Enter');
check('text that isn’t there says so', await toastWith('wasn’t found'));
await page.click('.pe-bar >> text=Undo');
await page.click('.pe-bar >> text=Done');
await page.waitForSelector('.page-editor', { state: 'detached' });
result = await exportDoc(2);
let text = await readText(result.bytes);
const all = await everything(result.bytes);
check('every found place on pages 2 and 3 is gone from the file', (all.match(/body text/gi) ?? []).length === 20 && !/body text/i.test(text[1] + text[2]));
check('Undo took back page 1’s marks only, and the rest of the pages stay', text[0].includes('Line 0 of some body text') && text[2].includes('alpha page 3'));

// Compact compression: smaller, text stays
await page.setInputFiles('input[type=file]', FX('fonts.pdf'));
await page.waitForFunction(() => document.querySelectorAll('.doc').length === 4);
const plain = await exportDoc(3);
await page.click('.choice:has-text("Compact")');
result = await exportDoc(3);
text = await readText(result.bytes);
check('Compact makes the file smaller', result.bytes.length < plain.bytes.length / 4 && /smaller/.test(result.lines), `${plain.bytes.length} → ${result.bytes.length}: ${result.lines}`);
check('and keeps the text', text.join('|') === 'Embedded font page 1|Embedded font page 2', text.join('|'));
await page.click('.choice:has-text("None")');

// Protecting downloads with a password
await page.click('label.checkbox:has-text("Password")');
await page.hover('.doc >> nth=2');
await page.click('.doc >> nth=2 >> [data-action=doc-download]');
check('an empty password stops the download', (await toastText()).includes('Type a password'));
await page.fill('#field-password', 'a,b');
await page.click('.btn-action');
check('so does a comma', await toastWith('comma'));
await page.fill('#field-password', 'tøp secret');
await page.screenshot({ path: SHOT('protect') });
result = await exportDoc(2);
check('the download needs the password', (await readText(result.bytes)) === 'PasswordException');
check('and opens with it', (await readText(result.bytes, 'tøp secret'))[0]?.includes('alpha page 1'));
const stored = await page.evaluate(() => JSON.stringify(localStorage));
check('the password is never stored', !stored.includes('tøp secret') && !stored.includes('"protect"'));
await page.reload();
await page.waitForSelector('.dropzone');

check('no errors in the console', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
