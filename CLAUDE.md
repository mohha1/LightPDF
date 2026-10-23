# LightPDF: handoff notes

LightPDF is a static web app for editing PDFs and images entirely in the browser; nothing is uploaded. You add files, arrange their pages in one editor, and download or save the result. The README covers it from a user's point of view; this file covers how it is built and what was decided.

## Status

- Work reaches `main` through pull requests: #1 (the app), #2 (README, logo, SECURITY.md), #3 (single-file build, zip package, JPEG 2000 and scan fix), #4 (one folder permission for Delete originals), #5 (logo on the start page).
- Everything listed below is built and tested. Nothing is half-done.
- Not yet verified in real Chrome or Edge: the permission prompts for **Delete originals** (per file and for the folder), and **Save as…** with real files. The tests use stand-ins that follow Chrome's rules; see "Testing".
- Not yet tried: `LightPDF.html` in Firefox and Safari (only Chromium is available in the cloud environment), and the start scripts on Windows and macOS.

## The owner's preferences

- **Credits go to the owner (mohha1) only.** No Claude attribution anywhere: no `Co-Authored-By: Claude` or `Claude-Session:` trailers in commits, no "Generated with Claude Code" line in PRs or comments. Commit as `mohha1 <69542851+mohha1@users.noreply.github.com>`, for example `git -c user.name=mohha1 -c user.email=69542851+mohha1@users.noreply.github.com commit …`. The environment's default git author is Claude, so set this every time.
- **Visual direction: "Monochrome"**, chosen from four proposals. Black on white, square corners, Helvetica at 13px, no accent colour, text-only toolbar (only "Add files" is filled black), a rule under each document name instead of cards. Keep new UI in this style. A dark variant was offered but not requested.
  - Details that keep it crisp (`styles.css`): native checkboxes, the select and colour swatches are restyled square and black (sliders stay native with `accent-color`: the owner didn't like a square custom one) (`appearance: none`; the check and chevron are data: SVGs, which the CSP's `img-src data:` allows); controls share `--control-height` (32px); icon stroke widths are chosen to land on whole pixels; a hairline separates toolbar groups; hover and state changes fade over `--fast` (120ms), switched off under reduced motion except a slow spinner.
  - Thumbnails are absolutely positioned inside their square `.page-thumb`: as a grid item, `max-height: 100%` didn't resolve and portrait pages were cut off at the bottom.
- **Minimal internal tool**: no marketing sections, no footer. The start page is the logo and the drop area (the owner replaced the heading and its line with the logo, centred). The header's small LIGHTPDF name (with the bolt mark beside it, `logoMark()`) is hidden there (`body:has(.landing)`) so the name isn't shown twice; the editor keeps it.
- **Delete originals** (the owner's request, refined over several turns):
  - Permission is requested when the box is ticked.
  - Files are deleted only after saving or downloading, never before.
  - After Download they are deleted right away, without asking again; the owner chose this knowingly.
  - The setting is never remembered between visits.
- Ask before big redesigns. The owner likes to pick from options; the four proposals were shown as a comparison page.

## Commands

```sh
npm install
npm run dev        # dev server
npm test           # Vitest unit tests (42)
npm run build      # tsc --noEmit + vite build into dist/
npm run preview    # serve dist/ on http://localhost:4173
npm run build:single  # one-file app, dist-single/LightPDF.html (opens from disk)
npm run package    # both builds + packaging/ into release/LightPDF.zip (committed)
```

Toolchain: Vite 8, TypeScript 7 (`tsc` is the native port), Vitest 5, Node 22. `tsconfig` targets ES2022 with `lib` ES2023 (for `findLastIndex`).

## Architecture

```
add files ─▶ SourceRegistry (in-memory copy + PDF.js doc + optional disk handle)
                 │
                 ▼
Project = Doc[]  ◀── pure edits in model.ts, History of snapshots (undo/redo)
  Doc  = { id, name, pages: PageRef[] }
  PageRef = { key, source, index, rotation }
                 │  Download / Save as
                 ▼
export.ts ─▶ Composer (core/compose.ts, pdf-lib) ─▶ stamps ─▶ PDF
         └─▶ raster.ts (PDF.js) for compression / JPG / PNG, pdfjs.ts for text
                 │
                 ▼
download (ZIP when several files) or filesystem.ts writeOutputs ─▶ optional deleteFiles
```

- **One card is one output file.** Each added file becomes a `Doc`. Merging joins `Doc`s and splitting cuts one.
- **The model is never mutated.** Every function in `src/editor/model.ts` returns a new project, or the same object when nothing changed, which `History.push` treats as no-op. Undo is a stack of snapshots.
- **Content changes happen only at export.** Page numbers, watermark, compression, format and flattening are settings in the Download panel (`src/editor/settings.ts`), applied by `exportDocs`.
- **Pass-through.** When a `Doc` is exactly one PDF's pages in their original order, `Composer` edits that PDF itself, so bookmarks, links, forms and metadata survive. Otherwise it copies pages into a new PDF, parsing each source once per export.

## File map

| Path | What it does |
| --- | --- |
| `src/main.ts` | Mounts header and editor; registers the service worker in production. |
| `src/editor/editor.ts` | The app controller: landing vs. editor, toolbar, document cards, selection, keyboard shortcuts, Download panel, export flow, delete-originals flow. The largest file. |
| `src/editor/model.ts` | Pure document operations: rotate, delete, duplicate, move (drag), extract, merge, split, rename, reorder, sort. |
| `src/editor/history.ts` | Undo/redo stack. |
| `src/editor/sources.ts` | `SourceRegistry`: opens files, keeps an in-memory copy, the PDF.js document, the disk handle, and lazy thumbnails (2 at a time). |
| `src/editor/drag.ts` | Pointer-event drag and drop of pages. On touch, drags start from the `.page-grip` handle. |
| `src/editor/export.ts` | Builds outputs per document for each format and compression. |
| `src/editor/settings.ts` | Download panel field definitions and conversion to `ExportSettings`. |
| `src/editor/naming.ts` | Output file names, safe names, "name (2).pdf" de-duplication. |
| `src/editor/landing.ts` | Start page. |
| `src/core/compose.ts` | `Composer`: builds a PDF from page references (PDF pages and images), flattening, pass-through. |
| `src/core/stamp.ts` | Page numbers and watermark, drawn in *displayed* coordinates so rotated pages come out right (`displayToUser`). |
| `src/core/images.ts`, `exif.ts` | Image page layout; JPEG EXIF orientation. |
| `src/core/pdf.ts`, `angle.ts` | pdf-lib load/create/save helpers; angle normalising. |
| `src/browser/pdfjs.ts` | Lazy PDF.js loading, page rendering, thumbnails, text extraction. |
| `src/browser/raster.ts` | Rasterising compression; PDF to images. |
| `src/browser/files.ts` | Reading files, image preparation (re-encodes EXIF-rotated JPEGs and non-JPEG/PNG images), ZIP, download. |
| `src/browser/filesystem.ts` | File System Access API: pickers, drop handles, Save as, permissions, deleting. Includes type declarations the DOM lib lacks. |
| `src/ui/*` | `h()` DOM helper, icons (only the ones in use), the logo (`logo.ts`, same paths as `docs/images/logo.svg`), generic options panel, dialog, toast, header. |
| `src/browser/pdf-worker.ts`, `pdf-worker.single.ts` | PDF.js worker setup. The single-file build swaps in the second (alias in `vite.config.ts`). |
| `vite.config.ts` | `base: './'`; a small plugin that writes `sw.js`, caching every built file for offline use. `--mode single` adds `classicWorker()` and `singleFile()` for the one-file build. |
| `packaging/`, `scripts/package.mjs` | Contents of the zip besides the builds: `server.mjs` (no-dependency local server sending the SECURITY.md headers), start scripts, `README.txt`, third-party licences (the wasm decoders are BSD, which asks for them). The zip is deterministic (fixed dates). `.gitattributes` keeps `start.bat` CRLF. |
| `release/LightPDF.zip` | The ready-to-run package. Rebuild with `npm run package` after changes. |
| `tests/` | Unit tests for core, model, history and naming. |
| `e2e/` | Browser tests (see below). Not run in CI. |
| `docs/images/` | README logo (`logo.svg`, `logo-dark.svg`; text outlined from Liberation Sans Bold), editor screenshot, and `social-preview.png` (1280×640) for the repository's social preview setting. |
| `SECURITY.md` | Security model, recommended hosting headers (tested CSP), how to report a vulnerability. Keep it in step with what the app stores and requests. |
| `.github/workflows/` | `ci.yml` (test + build on push/PR); `pages.yml` (manual GitHub Pages deploy; Pages must be set to "GitHub Actions" first). |

## Things that bite

- **PDF.js 6:** it takes ownership of the buffer you give it, so always pass a copy (`bytes.slice()`). Close documents with `doc.loadingTask.destroy()`; there is no `doc.destroy()`. Its `render` takes `{ canvas, viewport }`.
- **pdf-lib:**
  - Load with `updateMetadata: false`, or it overwrites the producer and dates.
  - `copyPages` doesn't carry form fields (AcroForm), so flattening happens in the source before copying.
  - `form.flatten()` leaves dangling widget references; `compose.ts` removes them.
  - Standard fonts only cover WinAnsi (Latin), so stamps throw a readable error for other scripts.
- **File System Access:**
  - Pickers and `requestPermission` only work right after a click, and opened files are read-only until the user allows editing. That's why permission is asked when "Delete originals" is ticked.
  - `filesFromDrop` must call `getAsFileSystemHandle` synchronously inside the drop handler.
  - `chooseDestination` runs before the export because the save dialog needs the click.
  - Only Chromium on desktop supports any of this. Elsewhere Save as is hidden and Delete originals greyed out.
- **Deleting:**
  - A file saved over an original is never deleted (`isSameEntry`).
  - Permission: ticking the box with 2+ files lacking it opens `showDirectoryPicker({ mode: 'readwrite', startIn: firstFile })` (no `id`, so `startIn` wins): one prompt for the whole folder (the owner asked for this; per-file prompts annoyed them in Edge). Allowed folders live in `filesystem.ts` for the visit; a file inside one (`folder.resolve(handle)`) is deleted with `removeEntry` through the folder, not `handle.remove()`, so it doesn't depend on Chrome passing the folder's permission down to file handles. Anything left (other folders, folder dialog cancelled, Downloads/Desktop/Documents which Chromium won't share) falls back to per-file `requestPermission`; the **Allow** link and files added later are always per file.
  - Deleted handles are forgotten (`forgetHandles`, `source.deleted`).
  - The editor keeps in-memory copies, so "Download again" still works after the originals are gone.
- **Undo floor:** the first files added *reset* the history, so undo never empties the editor back to the start page.
- **Shortcuts:** keyboard shortcuts are ignored while focus is in an input, including checkboxes. Tests that press Ctrl+Z after ticking a box must click the Undo button instead.
- **Service worker:** matches with `ignoreVary: true`, because `vite preview` (and some hosts) send `Vary: Origin` while the page's `crossorigin` scripts send an Origin header. Without it, offline loads miss the cache.
- **Opening `dist/index.html` from disk doesn't work** (JavaScript modules over `file://`). It needs any static server, or use the single-file build.
- **Single-file build** (`LightPDF.html`): everything is inlined into one HTML file, which Chrome runs from `file://`.
  - Chrome refuses module workers there, and PDF.js always asks for one. `classicWorker()` turns `pdf.worker.min.mjs` into a classic script (drops the final `export`, `import.meta.url` → `self.location.href`, then compiles it with `node:vm` to prove no module syntax is left); `pdf-worker.single.ts` starts module workers as classic ones from a blob URL. PDF.js still creates one worker per document. Don't use `GlobalWorkerOptions.workerPort` instead: PDF.js shares one `PDFWorker` per port and destroying any document then breaks the others.
  - No service worker, manifest or install as app there (`main.ts` only registers the service worker over http). The origin-private file system isn't available on `file://`, so `e2e/fs.mjs` can't run against it; it passes against the same file served over http.
- **PDF.js WebAssembly decoders:** JPEG 2000 (`openjpeg.wasm`) and JBIG2 + CCITT fax (`jbig2.wasm`, so most black-and-white scans) come out blank without them. PDF.js asks for them by file name; `pdfjs.ts` passes a `BinaryDataFactory` that maps names to `?url` imports, so they are ordinary hashed assets (precached by the service worker) and data: URLs in the single-file build (`assetsInlineLimit`). Not bundled on purpose: `qcms_bg.wasm` (PDF.js only uses it when the worker fetches by itself, which a custom factory turns off; ICC colours fall back as before), the `*_nowasm_fallback.js` files (only used when WebAssembly can't run) and `quickjs-eval` (PDF scripting). A CSP needs `'wasm-unsafe-eval'` in `script-src`, on the worker's response too.
- **Bundle:** the app shell is about 21 KB gzipped (JS + CSS). pdf-lib, JSZip and the composer are dynamic imports; keep them out of the main chunk.

## Testing

- **Unit tests** (`npm test`, 42): composing, stamping, image layout, EXIF, document model, history and naming. `tests/fixtures.ts` builds PDFs whose page widths (100, 101, 102…) identify pages after reordering.
- **Browser tests** in `e2e/`. These are Playwright scripts against the production build, not part of `npm test` or CI:
  ```sh
  node e2e/make-fixtures.mjs && python3 e2e/make-images.py   # once; needs Pillow
  npm run build && npm run preview &                          # serves http://localhost:4173
  node e2e/editor.mjs    # 34 checks: editing, drag, undo, formats, compression, JPEG 2000 + CCITT, persistence, mobile
  node e2e/fs.mjs        # 40 checks: Save as, folders, delete originals, folder and per-file permissions, fallback
  node e2e/offline.mjs   # editing and exporting with the network off
  node e2e/privacy.mjs   # no requests outside the app's origin; works under the CSP in SECURITY.md (sent on every response)
  BASE_URL=file://$PWD/dist-single/LightPDF.html node e2e/editor.mjs   # any of them (except fs.mjs) against the single file
  ```
  - Playwright comes from a global install (`npm root -g`), or set `PLAYWRIGHT_DIR`. In the cloud environment, Chromium is preinstalled; don't run `playwright install`.
  - Screenshots and downloads go to `e2e/.output/`, which is gitignored along with `e2e/fixtures/`.
  - `fs.mjs` swaps the system pickers for stand-ins backed by the browser's private file system (real handles), and mimics Chrome's permission rules: read-only until allowed, prompt only after a click, removal fails without permission (for files, or through a folder for `removeEntry`). The folder dialog stand-in returns the folder holding `startIn` and allows it; `folderAnswer = 'cancel'` stands for cancelling or a folder Chromium won't share. A real Chrome or Edge check is still worth doing.

## Ideas not built yet

- Dark variant of the monochrome theme.
- Save as for a single document (only Download exists on document cards).
- Inserting blank pages; selecting pages by typing ranges ("1-3, 7").
- Password-protected PDFs, signing, OCR for scanned text, Office conversion.
- Keyboard-only page moving (Alt+arrows) for accessibility.
