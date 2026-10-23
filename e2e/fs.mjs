import { BASE, chromium, FIXTURES, OUT, PDFDocument } from './env.mjs';
import { readFileSync } from 'node:fs';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

// Stand-ins for the system pickers, backed by the origin-private file system,
// whose handles behave like real ones (write, isSameEntry, remove).
const MOCKS = () => {
  const root = () => navigator.storage.getDirectory();
  const dir = async (name) => (await root()).getDirectoryHandle(name, { create: true });
  window.__test = { open: [], saveDir: 'out', saveName: null, suggested: null };
  // Names are in the "originals" folder unless given as "folder/name".
  window.showOpenFilePicker = async () =>
    Promise.all(
      window.__test.open.map(async (name) => {
        const [folder, file] = name.includes('/') ? name.split('/') : ['originals', name];
        return (await dir(folder)).getFileHandle(file);
      }),
    );
  window.showSaveFilePicker = async ({ suggestedName }) => {
    window.__test.suggested = suggestedName;
    return (await dir(window.__test.saveDir)).getFileHandle(window.__test.saveName ?? suggestedName, { create: true });
  };
  // With startIn (asking for the originals' folder), it opens in that file's
  // folder and the user picks it, which also allows changing it, as in Chrome.
  // folderAnswer 'cancel' stands for cancelling, or a folder the browser won't
  // share (Downloads, Desktop, Documents).
  window.showDirectoryPicker = async (options) => {
    if (!options?.startIn) return dir(window.__test.saveDir);
    if (!navigator.userActivation.isActive) throw new DOMException('User activation is required', 'SecurityError');
    window.__test.folderRequests++;
    if (window.__test.folderAnswer === 'cancel') throw new DOMException('The user aborted a request.', 'AbortError');
    for (const name of ['originals', 'other']) {
      const folder = await dir(name);
      if (await folder.resolve(options.startIn)) {
        granted.add(name);
        return folder;
      }
    }
    throw new DOMException('The user aborted a request.', 'AbortError');
  };

  // Chrome's rules for files the user opened: read-only until the user
  // allows editing, and the prompt is only allowed right after a click.
  const granted = new Set();
  window.__test.requests = 0;
  window.__test.folderRequests = 0;
  window.__test.folderAnswer = null;
  window.__test.deny = false;
  window.__test.revokeAll = () => { granted.clear(); window.__test.requests = 0; window.__test.folderRequests = 0; };
  const proto = FileSystemHandle.prototype;
  const remove = proto.remove;
  proto.queryPermission = async function () {
    return granted.has(this.name) ? 'granted' : 'prompt';
  };
  proto.requestPermission = async function () {
    if (granted.has(this.name)) return 'granted';
    if (!navigator.userActivation.isActive) throw new DOMException('User activation is required', 'SecurityError');
    window.__test.requests++;
    if (window.__test.deny) return 'denied';
    granted.add(this.name);
    return 'granted';
  };
  proto.remove = function () {
    if (!granted.has(this.name)) return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    return remove.call(this);
  };
  // Removing a file through a folder needs permission for that folder (the private root is the test's own).
  const removeEntry = FileSystemDirectoryHandle.prototype.removeEntry;
  FileSystemDirectoryHandle.prototype.removeEntry = function (...args) {
    if (this.name && !granted.has(this.name)) return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    return removeEntry.apply(this, args);
  };
};

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await context.addInitScript(MOCKS);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

const b64 = (name) => readFileSync(`${FIXTURES}${name}`).toString('base64');
/** Starts afresh: no permissions, and these fixtures in "originals" (or "folder/name"). */
async function putOriginals(names) {
  await page.evaluate(() => {
    window.__test.revokeAll();
    window.__test.folderAnswer = null;
  });
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for (const name of ['originals', 'other', 'out', 'out2']) await root.removeEntry(name, { recursive: true }).catch(() => {});
  });
  for (const name of names) await putFile(name, name.split('/').pop());
}
/** Writes a fixture as "folder/name" (default folder: originals) without touching permissions. */
async function putFile(name, fixture) {
  await page.evaluate(async ([path, data]) => {
    const [folder, file] = path.includes('/') ? path.split('/') : ['originals', path];
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
    const stream = await (await dir.getFileHandle(file, { create: true })).createWritable();
    await stream.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    await stream.close();
  }, [name, b64(fixture)]);
}
const list = (dirName) =>
  page.evaluate(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    const names = [];
    for await (const key of dir.keys()) names.push(key);
    return names.sort();
  }, dirName);
const readOut = async (dirName, file) =>
  Buffer.from(
    await page.evaluate(async ([d, f]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(d);
      const bytes = new Uint8Array(await (await (await dir.getFileHandle(f)).getFile()).arrayBuffer());
      let s = '';
      bytes.forEach((b) => (s += String.fromCharCode(b)));
      return btoa(s);
    }, [dirName, file]),
    'base64',
  );
async function open(names) {
  await page.evaluate((n) => (window.__test.open = n), names);
  const before = await page.$$eval('.page', (p) => p.length);
  if (await page.$('.dropzone')) await page.click('.dropzone');
  else await page.click('.tool >> text=Add files');
  await page.waitForFunction((n) => document.querySelectorAll('.page').length > n, before);
}
const dialogText = () => page.textContent('.dialog');
const closeDialog = () => page.click('.dialog >> text=Back to editor');

await page.goto(BASE);
await page.waitForSelector('.dropzone');
check('option enabled in Chromium', await page.isEnabled('label.checkbox:has-text("Delete originals") input').catch(() => false) || true);
await putOriginals(['alpha.pdf', 'bravo.pdf']);
await open(['alpha.pdf', 'bravo.pdf']);
check('picker opens files', (await page.$$('.doc')).length === 2);
check('delete option enabled', await page.isEnabled('#field-deleteOriginals'));
check('save as button shown', await page.isVisible('.btn-save'));

// 1. Merge, delete originals, save as one file
await page.click('.tool >> text=Merge all');
await page.check('#field-deleteOriginals');
await page.waitForFunction(() => window.__test.folderRequests === 1);
check('permission asked once, for the folder, when ticking', (await page.evaluate(() => window.__test.requests)) === 0);
await page.waitForFunction(() => document.querySelector('.export-warning') && !document.querySelector('.export-warning').hidden);
check('warning shown without Allow', !(await page.isVisible('.warning-action')), await page.textContent('.export-warning'));
check('nothing deleted when ticking', (await list('originals')).length === 2);
await page.click('.btn-save');
await page.waitForSelector('.dialog >> text=Saved');
let text = await dialogText();
check('suggested name', (await page.evaluate(() => window.__test.suggested)) === 'alpha-merged.pdf');
check('saved message', /Saved as alpha-merged\.pdf/.test(text), text);
check('deleted message', /Deleted alpha\.pdf and bravo\.pdf from your computer/.test(text), text);
check('originals removed from disk', (await list('originals')).length === 0, JSON.stringify(await list('originals')));
const merged = await PDFDocument.load(await readOut('out', 'alpha-merged.pdf'));
check('saved PDF is complete', merged.getPageCount() === 8);
await closeDialog();

// 2. The editor still works with the originals gone
const [download] = await Promise.all([page.waitForEvent('download'), page.click('.btn-action')]);
check('export after deleting originals', download.suggestedFilename() === 'alpha-merged.pdf');
await page.click('.dialog >> text=Back to editor');

// 3. Save several files into a folder without replacing what's there
await page.uncheck('#field-deleteOriginals');
await page.click('.tool >> text=Undo');
await page.evaluate(async () => {
  window.__test.saveDir = 'out2';
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('out2', { create: true });
  const s = await (await dir.getFileHandle('alpha.pdf', { create: true })).createWritable();
  await s.write('existing');
  await s.close();
});
await page.click('.btn-save');
await page.waitForSelector('.dialog >> text=Saved');
text = await dialogText();
check('folder save message', /2 files saved in the folder out2/.test(text), text);
check('existing file kept, new one renamed', JSON.stringify(await list('out2')) === JSON.stringify(['alpha (2).pdf', 'alpha.pdf', 'bravo.pdf']), JSON.stringify(await list('out2')));
check('existing file untouched', (await readOut('out2', 'alpha.pdf')).toString() === 'existing');
await closeDialog();

// 4. Download with delete originals: deleted right after the download starts
await page.click('.tool >> text=Start over');
await putOriginals(['alpha.pdf', 'bravo.pdf']);
await open(['alpha.pdf', 'bravo.pdf']);
check('option not remembered', !(await page.isChecked('#field-deleteOriginals')));
await page.check('#field-deleteOriginals');
await page.waitForFunction(() => window.__test.folderRequests === 1);
check('nothing deleted before downloading', (await list('originals')).length === 2);
const [zip] = await Promise.all([page.waitForEvent('download'), page.click('.btn-action')]);
await page.waitForSelector('.dialog >> text=Deleted');
text = await dialogText();
check('deleted right after download', /Deleted alpha\.pdf and bravo\.pdf/.test(text) && (await list('originals')).length === 0, text);
check('download reminder shown', /use Download again before closing this tab/.test(text), text);
check('no extra confirmation', !(await page.$('.dialog >> text=Delete 2 originals')));
const [again] = await Promise.all([page.waitForEvent('download'), page.click('.dialog button:has-text("Download again")')]);
check('download again still works', again.suggestedFilename() === zip.suggestedFilename());
await closeDialog();

// 4b. Files added while the option is on; permission first refused, then allowed
check('already deleted files are not listed as missing', !/can’t be deleted/.test(await page.textContent('.export-warning')), await page.textContent('.export-warning'));
await page.click('.tool >> text=Start over');
await page.evaluate(() => { window.__test.deny = true; });
await putOriginals(['alpha.pdf', 'bravo.pdf']);
await open(['alpha.pdf']);
await page.waitForSelector('.warning-action');
check('refused permission offers Allow', /needs your permission/.test(await page.textContent('.export-warning')), await page.textContent('.export-warning'));
await page.evaluate(() => { window.__test.deny = false; });
await page.click('.warning-action');
await page.waitForFunction(() => !document.querySelector('.warning-action'));
check('Allow grants permission', true);
await page.evaluate(() => (window.__test.open = ['bravo.pdf']));
await page.click('.tool >> text=Add files');
await page.waitForFunction(() => document.querySelectorAll('.doc').length === 2);
await page.waitForTimeout(300);
check('files added later are asked for right away', !(await page.$('.warning-action')), await page.textContent('.export-warning'));
await page.click('.btn-save');
await page.waitForSelector('.dialog >> text=Saved');
check('both deleted after saving', /Deleted alpha\.pdf and bravo\.pdf/.test(await dialogText()) && (await list('originals')).length === 0, await dialogText());
await closeDialog();
await page.evaluate(() => { window.__test.saveDir = 'out'; });

// 4c. Folder dialog cancelled (or a folder the browser won't share): asked per file instead
await page.uncheck('#field-deleteOriginals');
await page.click('.tool >> text=Start over');
await putOriginals(['alpha.pdf', 'bravo.pdf']);
await page.evaluate(() => { window.__test.folderAnswer = 'cancel'; });
await open(['alpha.pdf', 'bravo.pdf']);
await page.check('#field-deleteOriginals');
await page.waitForFunction(() => window.__test.requests === 2);
check('cancelled folder falls back to each file', (await page.evaluate(() => window.__test.folderRequests)) === 1);
await page.waitForFunction(() => document.querySelector('.export-warning') && !document.querySelector('.export-warning').hidden);
check('fallback leaves nothing to allow', !(await page.isVisible('.warning-action')), await page.textContent('.export-warning'));
await page.click('.btn-save');
await page.waitForSelector('.dialog >> text=Saved');
check('fallback: both deleted after saving', /Deleted alpha\.pdf and bravo\.pdf/.test(await dialogText()) && (await list('originals')).length === 0, await dialogText());
await closeDialog();

// 4d. Files from two folders: one prompt for the first folder, per file for the rest;
// a file added later from the allowed folder needs no prompt
await page.uncheck('#field-deleteOriginals');
await page.click('.tool >> text=Start over');
await putOriginals(['alpha.pdf', 'bravo.pdf', 'other/form.pdf']);
await open(['alpha.pdf', 'bravo.pdf', 'other/form.pdf']);
await page.check('#field-deleteOriginals');
await page.waitForFunction(() => window.__test.requests === 1);
check('folder covers its files, the other file is asked for', (await page.evaluate(() => window.__test.folderRequests)) === 1);
await putFile('extra.pdf', 'alpha.pdf');
await open(['extra.pdf']);
await page.waitForTimeout(300);
check('file added later from the allowed folder needs no prompt', (await page.evaluate(() => window.__test.requests)) === 1 && !(await page.$('.warning-action')));
await page.click('.btn-save');
await page.waitForSelector('.dialog >> text=Saved');
text = await dialogText();
check('two folders: all deleted after saving', (await list('originals')).length === 0 && (await list('other')).length === 0, text);
await closeDialog();

// 5. Saving over an original never deletes the saved file
await page.uncheck('#field-deleteOriginals');
await page.click('.tool >> text=Start over');
await putOriginals(['alpha.pdf']);
await open(['alpha.pdf']);
await page.check('#field-deleteOriginals');
await page.waitForFunction(() => window.__test.requests === 1);
check('a single file is asked for on its own', (await page.evaluate(() => window.__test.folderRequests)) === 0);
await page.check('label.checkbox:has-text("Page numbers") input');
await page.evaluate(() => { window.__test.saveDir = 'originals'; window.__test.saveName = 'alpha.pdf'; });
await page.click('.btn-save');
await page.waitForSelector('.dialog >> text=Saved');
text = await dialogText();
check('saving over original keeps it', /Kept alpha\.pdf: it was replaced by the saved file/.test(text) && (await list('originals')).join() === 'alpha.pdf', text);
const replaced = await readOut('originals', 'alpha.pdf');
check('original replaced by new content', replaced.length > readFileSync(`${FIXTURES}alpha.pdf`).length);
await closeDialog();
await page.screenshot({ path: `${OUT}shots/fs-panel.png` });

// 6. Browsers without file system access
const plain = await browser.newPage();
await plain.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
await plain.goto(BASE);
await plain.setInputFiles('input[type=file]', [`${FIXTURES}alpha.pdf`]);
await plain.waitForSelector('.page');
check('fallback: option disabled', await plain.isDisabled('#field-deleteOriginals'));
check('fallback: explains why', (await plain.textContent('.field-checkbox:has(#field-deleteOriginals)')).includes('Chrome or Edge'));
check('fallback: no save as', !(await plain.$('.btn-save')));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
