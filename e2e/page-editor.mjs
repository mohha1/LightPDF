// The page editor: opening it, each tool, undo, pages, Done/Cancel, and what ends up in the PDF.
import { BASE, chromium, FIXTURES, OUT } from './env.mjs';
import { readFileSync } from 'node:fs';

const pdfjs = await import(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
const FX = (n) => `${FIXTURES}${n}`;
const SHOT = (n) => `${OUT}shots/page-editor-${n}.png`;
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
let confirmAnswer = true;
page.on('dialog', (d) => (confirmAnswer ? d.accept() : d.dismiss()));

const card = (doc, pageIndex) => `.doc >> nth=${doc} >> .page >> nth=${pageIndex}`;
const marks = () => page.$$eval('.pe-overlay .pe-mark', (m) => m.length);
const sheet = () => page.$eval('.pe-sheet', (s) => s.getBoundingClientRect().toJSON());

/** Where a point given in page points (y down) is on screen, for a page `width` points wide. */
async function at(x, y, width = 595) {
  const box = await sheet();
  const scale = box.width / width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}
async function drag(from, to, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
async function openEditor(selector) {
  await page.dblclick(selector);
  await page.waitForSelector('.page-editor .pe-canvas');
}
async function exportDoc(doc) {
  await page.hover(`.doc >> nth=${doc}`);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`.doc >> nth=${doc} >> [data-action=doc-download]`)]);
  const path = `${OUT}downloads/page-editor-${download.suggestedFilename()}`;
  await download.saveAs(path);
  await page.click('.dialog-actions >> text=Back to editor');
  return readFileSync(path);
}
/** Text on each page with its place as a viewer shows it (points, y down) and direction. */
async function readText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const viewport = p.getViewport({ scale: 1 });
    const content = await p.getTextContent();
    pages.push(
      content.items.map((item) => {
        const [a, b, , , e, f] = pdfjs.Util.transform(viewport.transform, item.transform);
        return { text: item.str, x: e, y: f, direction: (Math.round((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360 };
      }),
    );
  }
  await doc.loadingTask.destroy();
  return pages;
}

await page.goto(BASE);
await page.waitForSelector('.dropzone');
await page.setInputFiles('input[type=file]', [FX('alpha.pdf'), FX('bravo.pdf')]);
await page.waitForFunction(() => document.querySelectorAll('.page img[src]').length === 8, null, { timeout: 15000 });

// Opening: double-click, the Edit button, and the toolbar
await openEditor(card(0, 0));
check('double-click opens the page editor', await page.isVisible('.page-editor'));
check('it shows the page and where it is', (await page.textContent('.pe-title')).startsWith('Page 1 of 3'));
check('main shortcuts are paused underneath', await page.$eval('.page-editor', (e) => document.body.classList.contains('page-editor-open')));

// Text: click, type, click away
await page.keyboard.press('t');
let point = await at(60, 120);
await page.mouse.click(point.x, point.y);
await page.waitForSelector('.pe-text');
await page.keyboard.type('Hello LightPDF');
point = await at(400, 700);
await page.mouse.click(point.x, point.y);
check('text tool adds text', (await marks()) === 1 && !(await page.$('.pe-text')));
// The click marks the middle of the first line: its top is 0.6 × 14 pt higher.
const placed = await page.$eval('.pe-mark text', (t) => t.getAttribute('transform'));
const [tx, ty] = placed.match(/[\d.]+/g).map(Number);
check('text goes where the click was', Math.abs(tx - 60) < 1 && Math.abs(ty - (120 - 8.4)) < 1, placed);

// Whiteout, highlight, rectangle, ellipse, line, arrow, freehand
await page.keyboard.press('w');
await drag(await at(60, 250), await at(300, 280));
await page.keyboard.press('h');
await drag(await at(60, 300), await at(300, 316));
await page.keyboard.press('r');
await drag(await at(320, 250), await at(500, 320));
await page.keyboard.press('e');
await drag(await at(320, 340), await at(500, 400));
await page.keyboard.press('l');
await drag(await at(60, 420), await at(300, 420));
await page.keyboard.press('a');
await drag(await at(60, 450), await at(300, 480));
await page.keyboard.press('d');
await drag(await at(60, 520), await at(300, 560), 20);
check('every drawing tool adds a mark', (await marks()) === 8, String(await marks()));
check('a new shape is selected for adjusting', (await page.$$('.pe-handle')).length === 0); // freehand isn't selected
await page.screenshot({ path: SHOT('tools') });

// Undo and redo inside the editor
await page.keyboard.press('Control+z');
check('undo removes the last mark', (await marks()) === 7);
await page.keyboard.press('Control+Shift+z');
check('redo puts it back', (await marks()) === 8);

// Select, move and delete
await page.keyboard.press('v');
point = await at(100, 125);
await page.mouse.click(point.x, point.y);
check('clicking text selects it', (await page.$$('.pe-handle')).length === 4);
check('the bar offers its font, size and colour', (await page.isVisible('.pe-props >> text=Font')) && (await page.isVisible('.pe-props >> text=Colour')));
await page.selectOption('.pe-props select >> nth=1', '24');
const textMark = () => page.$eval('.pe-mark text', (t) => ({ size: Number(t.getAttribute('font-size')), transform: t.getAttribute('transform') }));
check('changing the size applies to the selected text', (await textMark()).size === 24);
const before = (await textMark()).transform;
await drag(await at(100, 128), await at(120, 168));
check('dragging moves it', (await textMark()).transform !== before, (await textMark()).transform);
// Resize the rectangle by its bottom-right corner
point = await at(410, 250);
await page.mouse.click(point.x, point.y);
const rectBox = () => page.$eval('.pe-mark rect:not([fill=transparent])[stroke]', (r) => Number(r.getAttribute('width')));
const narrow = await rectBox();
const corner = await page.$eval('.pe-handle-se', (h) => h.getBoundingClientRect().toJSON());
await drag({ x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, { x: corner.x + 60, y: corner.y + 30 });
check('dragging a corner resizes', (await rectBox()) > narrow + 50, `${narrow} → ${await rectBox()}`);
// Back to the text
point = await at(120, 168);
await page.mouse.click(point.x, point.y);
await page.click('.pe-props >> text=Delete');
check('Delete removes it', (await marks()) === 7);
await page.keyboard.press('Control+z');
check('and undo brings it back', (await marks()) === 8);

// Image and signature
await page.setInputFiles('.page-editor input[type=file]', FX('shape.png'));
await page.waitForFunction(() => document.querySelectorAll('.pe-overlay .pe-mark image').length === 1);
check('Image adds the picture, selected', (await page.$$('.pe-handle')).length === 4);
await page.click('.pe-tools >> text=Signature');
await page.waitForSelector('.signature-pad');
const pad = await page.$eval('.signature-pad', (c) => c.getBoundingClientRect().toJSON());
await drag({ x: pad.x + 40, y: pad.y + 120 }, { x: pad.x + 200, y: pad.y + 60 }, 15);
await drag({ x: pad.x + 200, y: pad.y + 60 }, { x: pad.x + 300, y: pad.y + 130 }, 15);
await page.screenshot({ path: SHOT('signature') });
await page.click('text=Add signature');
await page.waitForFunction(() => document.querySelectorAll('.pe-overlay .pe-mark image').length === 2);
check('Signature adds the drawing as an image', (await marks()) === 10);

// Next page, a note there, then Done
await page.click('.pe-bar >> text=›');
await page.waitForFunction(() => document.querySelector('.pe-title').textContent.startsWith('Page 2 of 3'));
await page.waitForSelector('.pe-canvas');
check('the next page starts empty', (await marks()) === 0);
await page.keyboard.press('t');
point = await at(300, 80);
await page.mouse.click(point.x, point.y);
await page.keyboard.type('Second');
await page.keyboard.press('Escape');
check('Escape ends typing and keeps the text', (await marks()) === 1);
await page.click('.pe-bar >> text=‹');
await page.waitForFunction(() => document.querySelectorAll('.pe-overlay .pe-mark').length === 10);
check('going back shows the first page’s marks', true);
await page.screenshot({ path: SHOT('editor') });
await page.click('.pe-bar >> text=Done');
await page.waitForSelector('.page-editor', { state: 'detached' });
check('Done closes the editor and says so', (await page.textContent('.toast')).includes('2 pages'));
await page.waitForFunction(() => document.querySelectorAll('.page img[src^="data:image/svg"]').length === 2);
check('edited pages show their marks in the thumbnails', true);
await page.screenshot({ path: SHOT('thumbnails') });

let pdf = await readText(await exportDoc(0));
let hello = pdf[0].find((item) => item.text === 'Hello LightPDF');
check('the text is in the downloaded PDF', Boolean(hello) && pdf[1].some((item) => item.text === 'Second'));
// Dragged by (20, 40) at 24 pt; the baseline is 0.94 × the size below the top.
check('where the editor showed it', hello && Math.abs(hello.x - (tx + 20)) < 1 && Math.abs(hello.y - (ty + 40 + 24 * 0.94)) < 1, JSON.stringify(hello));

// Undo in the main editor takes all of it back
await page.click('.editor-toolbar >> text=Undo');
await page.waitForFunction(() => document.querySelectorAll('.page img[src^="data:image/svg"]').length === 0);
check('one undo removes the edits of both pages', true);
await page.click('.editor-toolbar >> text=Redo');

// A page turned in the editor (and one with its own /Rotate): text typed on it reads upright
await page.click(card(1, 0));
await page.keyboard.press('r');
await page.click('.editor-toolbar >> text=Clear');
await page.hover(card(1, 0));
await page.click(`${card(1, 0)} >> [data-action=page-edit]`);
await page.waitForSelector('.page-editor .pe-canvas');
check('the editor shows the page turned', (await sheet()).width > (await sheet()).height);
await page.keyboard.press('t');
point = await at(100, 60, 842);
await page.mouse.click(point.x, point.y);
await page.keyboard.type('Turned');
await page.keyboard.press('Escape');
await page.screenshot({ path: SHOT('turned') });
await page.click('.pe-bar >> text=›');
await page.waitForFunction(() => document.querySelector('.pe-title').textContent.startsWith('Page 2 of 5'));
await page.waitForSelector('.pe-canvas');
await page.keyboard.press('t');
point = await at(100, 60, 842);
await page.mouse.click(point.x, point.y);
await page.keyboard.type('Own rotation');
await page.keyboard.press('Escape');
await page.click('.pe-bar >> text=Done');
pdf = await readText(await exportDoc(1));
const turned = pdf[0].find((item) => item.text === 'Turned');
const own = pdf[1].find((item) => item.text === 'Own rotation');
check('text on a turned page is upright in the PDF', turned?.direction === 0 && Math.abs(turned.x - 100) < 2, JSON.stringify(turned));
check('text on a page with its own rotation too', own?.direction === 0 && Math.abs(own.x - 100) < 2, JSON.stringify(own));

// Cancel: asks, and keeps nothing
await openEditor(card(0, 2));
await page.keyboard.press('r');
await drag(await at(60, 60), await at(200, 200));
confirmAnswer = false;
await page.click('.pe-bar >> text=Cancel');
check('Cancel asks before dropping changes', await page.isVisible('.page-editor'));
confirmAnswer = true;
await page.click('.pe-bar >> text=Cancel');
await page.waitForSelector('.page-editor', { state: 'detached' });
check('and then keeps nothing', !(await page.$eval(`${card(0, 2)} >> img`, (img) => img.src.startsWith('data:image/svg'))));

// Small screens
await page.setViewportSize({ width: 390, height: 844 });
await openEditor(card(0, 0));
const fits = await page.$eval('.pe-sheet', (s) => s.getBoundingClientRect().right <= innerWidth);
check('on a phone the page fits the screen', fits);
check('and Done stays in view', await page.$eval('.pe-bar .tool-primary', (b) => b.getBoundingClientRect().right <= innerWidth));
await page.screenshot({ path: SHOT('mobile') });
await page.keyboard.press('Escape');
await page.waitForSelector('.page-editor', { state: 'detached' });

check('no errors in the console', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
