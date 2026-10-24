import { BASE, chromium, FIXTURES } from './env.mjs';
const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
await page.goto(BASE);
// The single-file build on disk (file://) needs no service worker to work offline.
if (!BASE.startsWith('file:')) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
}
await context.setOffline(true);
await page.reload();
await page.waitForSelector('.dropzone', { timeout: 10000 });
// jpx.pdf needs PDF.js's WebAssembly decoder, which must come from the cache too.
await page.setInputFiles('input[type=file]', [`${FIXTURES}alpha.pdf`, `${FIXTURES}bravo.pdf`, `${FIXTURES}jpx.pdf`]);
await page.waitForFunction(() => document.querySelectorAll('.page img[src]').length === 9, null, { timeout: 15000 });
const decoded = await page.$$eval('.page img', (images) => {
  const img = images.at(-1);
  const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
  const context = canvas.getContext('2d');
  context.drawImage(img, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 384) return true;
  return false;
});
if (!decoded) throw new Error('JPEG 2000 page is blank offline');
// The page editor loads on first use, so it must come from the cache too.
await page.dblclick('.page >> nth=0');
await page.waitForSelector('.page-editor .pe-canvas', { timeout: 10000 });
await page.keyboard.press('t');
const sheet = await page.$eval('.pe-sheet', (element) => element.getBoundingClientRect().toJSON());
await page.mouse.click(sheet.x + 60, sheet.y + 60);
await page.keyboard.type('Offline note');
await page.keyboard.press('Escape');
// Redaction too: MuPDF and its WebAssembly must come from the cache.
await page.keyboard.press('x');
await page.mouse.move(sheet.x + 20, sheet.y + 120);
await page.mouse.down();
await page.mouse.move(sheet.x + 200, sheet.y + 160, { steps: 5 });
await page.mouse.up();
await page.click('.pe-bar >> text=Done');
await page.waitForSelector('.page img[src^="data:image/svg"]', { timeout: 10000 });
await page.click('.tool >> text=Merge all');
await page.click('label.checkbox:has-text("Page numbers")');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('.btn-action')]);
console.log('OFFLINE EDIT, PAGE EDITOR, REDACTION + EXPORT OK', download.suggestedFilename());
await browser.close();
