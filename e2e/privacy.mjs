// Checks the claims in SECURITY.md: editing and exporting in every format makes
// no request outside the app's origin, and works under the recommended CSP.
// With BASE_URL pointing at the single-file build on disk (file://), only the
// first check runs: there are no response headers to set a CSP with.
import { BASE, chromium, FIXTURES } from './env.mjs';

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
const fromDisk = BASE.startsWith('file:');
const origin = new URL(BASE).origin;
const local = (url) =>
  fromDisk ? /^(file|blob|data):/.test(url) : url.startsWith(origin) || url.startsWith(`blob:${origin}`) || url.startsWith('data:');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};

const browser = await chromium.launch();

async function run(withCsp) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const outside = [];
  const errors = [];
  page.on('request', (r) => {
    if (!local(r.url())) outside.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => (m.type() === 'error' || /Content Security Policy|wasm/i.test(m.text())) && errors.push(m.text()));
  if (withCsp) {
    // On every response, as a host would send it: the PDF.js worker follows its own file's policy.
    await page.route(`${origin}/**`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
    });
  }
  await page.goto(BASE);
  await page.waitForSelector('.dropzone');
  // jpx.pdf and ccitt.pdf need PDF.js's WebAssembly decoders.
  await page.setInputFiles('input[type=file]', ['alpha.pdf', 'photo.jpg', 'jpx.pdf', 'ccitt.pdf'].map((name) => `${FIXTURES}${name}`));
  await page.waitForFunction(() => document.querySelectorAll('.page img[src]').length === 6 && !document.querySelector('.status:not([hidden])'));
  const formats = [];
  for (const option of [null, 'Recommended', 'JPG', 'PNG', 'Text']) {
    if (option) await page.click(`text=${option}`);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.btn-action')]);
    await download.path();
    await page.click('.dialog-actions >> text=Back to editor');
    formats.push(option ?? 'PDF');
  }
  const label = withCsp ? 'with CSP' : 'without CSP';
  check(`exported ${formats.join(', ')} ${label}`, formats.length === 5);
  check(`no requests outside the app ${label}`, outside.length === 0, outside.join(' '));
  check(`no errors or CSP violations ${label}`, errors.length === 0, errors.join(' | '));
  await context.close();
}

await run(false);
if (!fromDisk) await run(true);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
