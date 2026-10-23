// Packs dist/ and dist-single/ with the files in packaging/ into
// release/LightPDF.zip. Run through `npm run package`, which builds both first.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';

const root = new URL('..', import.meta.url).pathname;
const from = (path) => join(root, path);
for (const built of ['dist/index.html', 'dist-single/LightPDF.html']) {
  if (!existsSync(from(built))) throw new Error(`${built} is missing; run npm run package`);
}

// A fixed date keeps the zip unchanged when the files are.
const date = new Date('2026-01-01T00:00:00Z');
const zip = new JSZip();
// Regular files (0o100000), executable or not. Folder entries are left out.
const add = (name, path, executable = false) =>
  zip.file(`LightPDF/${name}`, readFileSync(from(path)), { date, createFolders: false, unixPermissions: executable ? 0o100755 : 0o100644 });

function addFolder(name, path) {
  for (const entry of readdirSync(from(path)).sort()) {
    if (statSync(from(join(path, entry))).isDirectory()) addFolder(`${name}/${entry}`, join(path, entry));
    else add(`${name}/${entry}`, join(path, entry));
  }
}

add('LightPDF.html', 'dist-single/LightPDF.html');
add('README.txt', 'packaging/README.txt');
add('LICENSE.txt', 'LICENSE');
addFolder('local-server/app', 'dist');
add('local-server/server.mjs', 'packaging/server.mjs');
add('local-server/start.bat', 'packaging/start.bat');
add('local-server/start.command', 'packaging/start.command', true);
add('local-server/start.sh', 'packaging/start.sh', true);

const bytes = await zip.generateAsync({ type: 'uint8array', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 9 } });
mkdirSync(from('release'), { recursive: true });
writeFileSync(from('release/LightPDF.zip'), bytes);
console.log(`release/LightPDF.zip (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
