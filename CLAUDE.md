# LightPDF: handoff notes

LightPDF is a static web app for editing PDFs and images entirely in the browser; nothing is uploaded. You add files, arrange their pages in one editor, and download or save the result. The README covers it from a user's point of view; this file covers how it is built and what was decided.

## Status

- Work reaches `main` through pull requests: #1 (the app), #2 (README, logo, SECURITY.md), #3 (single-file build, zip package, JPEG 2000 and scan fix), #4 (one folder permission for Delete originals), #5 (logo on the start page), #6 (sharper details, uncut thumbnails), #7 (flowing file cards, file drag, bolt mark in the header), #8 (cards on a grid that fills every row, More menu), #9 (the page editor: text, drawings, images, stamps, ticks, dates, crop, form filling, redaction with a black box or left blank with paper on scans; blank pages, document properties, Remove hidden data, and the fix for page numbers on duplicated pages).
- Everything listed below is built and tested. Nothing is half-done.
- Not yet verified in real Chrome or Edge: the permission prompts for **Delete originals** (per file and for the folder), and **Save as…** with real files. The tests use stand-ins that follow Chrome's rules; see "Testing".
- Not yet tried: the page editor on a real touch screen (pen and finger drawing) and with a real pinch on a touchpad.
- Not yet tried: `LightPDF.html` in Firefox and Safari (only Chromium is available in the cloud environment), and the start scripts on Windows and macOS.

## The owner's preferences

- **Credits go to the owner (mohha1) only.** No Claude attribution anywhere: no `Co-Authored-By: Claude` or `Claude-Session:` trailers in commits, no "Generated with Claude Code" line in PRs or comments. Commit as `mohha1 <69542851+mohha1@users.noreply.github.com>`, for example `git -c user.name=mohha1 -c user.email=69542851+mohha1@users.noreply.github.com commit …`. The environment's default git author is Claude, so set this every time.
- **Visual direction: "Monochrome"**, chosen from four proposals. Black on white, square corners, Helvetica at 13px, no accent colour, text-only toolbar (only "Add files" is filled black). Keep new UI in this style.
  - **File cards on a grid** (the owner picked cards from three layouts, so that 30 files don't mean scrolling up and down, then asked that rows leave no blank space): `.editor-canvas` is a grid of equal columns. `layoutCards()` in `editor.ts` sets `--cols` from the canvas width and the slider's size (a column is at least 104px inside, the width of a card's four action buttons), and each card's `--span`: one column per page, up to the full row. Rows end flush: a card that doesn't fit in what's left of a row takes that space and wraps its pages, unless that makes it more than one row of pages taller; then the row's last card widens instead (its pages keep their size). A `ResizeObserver` reruns it. Pages share their card's columns, so thumbnails are the same size everywhere. The card shows Rotate, Download, Remove and a **More** menu (Split into single pages, Merge with the next file, Move left, Move right). The page count hides in narrow cards (container query). Drag a card by its header (not the name or buttons; on touch, by `.doc-grip`) to reorder files.
  - Details that keep it crisp (`styles.css`): native checkboxes, the select and colour swatches are restyled square and black (sliders stay native with `accent-color`: the owner didn't like a square custom one) (`appearance: none`; the check and chevron are data: SVGs, which the CSP's `img-src data:` allows); controls share `--control-height` (32px); icon stroke widths are chosen to land on whole pixels; a hairline separates toolbar groups; hover and state changes fade over `--fast` (120ms), switched off under reduced motion except a slow spinner.
  - Thumbnails are absolutely positioned inside their square `.page-thumb`: as a grid item, `max-height: 100%` didn't resolve and portrait pages were cut off at the bottom.
- **Licences are not a constraint.** LightPDF is an internal tool, so libraries under any licence may be used (for example AGPL ones such as MuPDF.js for real redaction, Ghostscript for PDF/A, PyMuPDF), even though the repository itself says MIT. The no-outside-requests rule still holds: bundle them, don't load them from a CDN. Credit them in the README's "Built with" and in `packaging/` licences.
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
npm test           # Vitest unit tests (81)
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
  PageRef = { key, source, index, rotation, marks?, fields? }   marks, form values: from the page editor
  Doc.info? = properties set in the Properties dialog
                 │  Download / Save as
                 ▼
export.ts ─▶ Composer (core/compose.ts, pdf-lib): form values (forms.ts) ─▶ marks (annotate.ts) ─▶ crop ─▶ rotation
         │      ─▶ stamps ─▶ Remove hidden data (sanitize.ts) ─▶ properties ─▶ PDF
         ├─▶ redact.ts (MuPDF, loaded on demand) when a page has boxes to redact
         └─▶ raster.ts (PDF.js) for compression / JPG / PNG, pdfjs.ts for text
                 │
                 ▼
download (ZIP when several files) or filesystem.ts writeOutputs ─▶ optional deleteFiles
```

- **One card is one output file.** Each added file becomes a `Doc`. Merging joins `Doc`s and splitting cuts one.
- **The model is never mutated.** Every function in `src/editor/model.ts` returns a new project, or the same object when nothing changed, which `History.push` treats as no-op. Undo is a stack of snapshots.
- **Content changes happen only at export.** Page numbers, watermark, compression, format and flattening are settings in the Download panel (`src/editor/settings.ts`), applied by `exportDocs`. The page editor's marks are the same: data on the `PageRef`, drawn by `MarkPainter` when composing, before the extra rotation and before stamps.
- **The page editor** (`page-editor.ts`, loaded on first use) is a full-screen overlay over the editor, which sets `busy` so its own shortcuts and file drops pause. It keeps a `History` of marks per page key (drafts) and hands all changed pages to `onDone`, committed as one step; Cancel drops the drafts. Research behind the tool set: Sejda, Smallpdf, iLovePDF, PDF24 and PDF.js's own editor all offer text, freehand, highlight, shapes, whiteout, images and a signature; that set was built, then the owner asked for the signature tool to be taken out.
- **More page-editor tools** (built after research into BentoPDF, Stirling-PDF, PDF24, iLovePDF, Sejda, Firefox and Acrobat; the owner picked this batch): Redact, Stamp, Tick (✓ ✗ •), Date, Crop, and the PDF's own form fields as inputs (`registry.formFields`, from PDF.js widget annotations; values in `PageRef.fields` by full field name; the editor's canvas is rendered with `AnnotationMode.ENABLE_FORMS` so the old value doesn't show under the input). Blank pages are generated sources (`registry.addGenerated`, `source.generated`, never counted as originals to delete). Properties live on `Doc.info`.
- **Redaction** (`core/redact.ts`): `MarkPainter` turns redact marks into `/Redact` annotations and, at once, removes annotations and form widgets touching them (clearing the field's `/V` up the `/Parent` chain too, since the value lives in the field) and the page `/Thumb`. After composing, export runs MuPDF: `applyRedactions(black boxes, image pixels, line art if covered, text)`. **Leave blank** (the owner asked for it: "Name: moha" should become "Name:" with no box) is a redact mark with `blank`, written as a `/Redact` annotation without `/IC`; since one `applyRedactions` call treats every box on a page alike, blank ones are deleted, the black ones applied, then the blank ones re-created and applied with black boxes off. MuPDF turns removed image pixels white, which on a scan leaves a white hole, so (owner's request: old yellowed scans) the page is rendered before and after, the area that changed is found by comparing the two (renders are exact, so any change counts; MuPDF also blanks image pixels the box only touches), and where it differs from the paper `core/paper.ts` makes a patch from a band of pixels just outside it and `drawPatch` adds it, one pixel larger each way so no white seam shows, as an image on top (page contents wrapped in q/Q, placed through the page's transform so rotated pages work). Pages where the background already shows through (white or drawn) get no patch. Then it re-reads a fresh page and throws if any character is still under a box (fail closed). MuPDF leaves a character that a box covers by less than about 10% of its spacing box's width or height (measured), and on digital black-on-white text a box's edge often grazes the next letter or line that way, so the check ignores the outer 15% of each character (`GRAZE`); before, such exports failed. then saves with `garbage=4,compress,clean`. Everything after it (compression, images, text) works on the redacted PDF.
- **Remove hidden data** (`core/sanitize.ts`): clears Info, XMP, `/Names` JavaScript and EmbeddedFiles, `/AF`/`/EF`, risky actions (JavaScript, Launch, SubmitForm, ImportData, GoToE/R, media), risky annotations (file attachments, media), thumbnails, PieceInfo, XFA; then `dropUnreachable` deletes every object not reachable from the trailer (pdf-lib never does, so old revisions and removed attachments would otherwise stay). Properties set in Properties are applied after it.
- **Licences:** MuPDF is AGPL; the owner accepted that (internal tool).
- **Mark coordinates** (`core/marks.ts`): points, y down, on the page as viewers show the *original* file (its own /Rotate, not the editor's extra rotation). An image page is the image at 0.75 pt per pixel; at export the marks are scaled into the image's place on the paper. Text and images carry an `angle` (quarter turns) so text typed on a turned page reads upright there; `PageView` maps page ↔ turned view, `placeIn`/`placedPoint` handle turned boxes. Fonts are the standard 14 (WinAnsi only, same error as stamps). Text baselines use `FONTS[...].baseline` in both the SVG and the PDF, so they match exactly.
- **Pass-through.** When a `Doc` is exactly one PDF's pages in their original order, `Composer` edits that PDF itself, so bookmarks, links, forms and metadata survive. Otherwise it copies pages into a new PDF, parsing each source once per export.

## File map

| Path | What it does |
| --- | --- |
| `src/main.ts` | Mounts header and editor; registers the service worker in production. |
| `src/editor/editor.ts` | The app controller: landing vs. editor, toolbar, document cards, selection, keyboard shortcuts, Download panel, export flow, delete-originals flow. The largest file. |
| `src/editor/model.ts` | Pure document operations: rotate, delete, duplicate, move (drag), extract, merge, split, rename, reorder, sort, `setPageMarks`. Duplicates and extracts keep a page's marks. |
| `src/editor/page-editor.ts` | The page editor: tools (Select, Text, Draw, Highlight, Whiteout, Rectangle, Ellipse, Line, Arrow, Image), the bar of colour/size/thickness, pointer gestures (create, move, resize by corners, line ends), text typed in a `<textarea>` laid over the text, zoom, page navigation. Dynamically imported. |
| `src/editor/properties.ts` | The Properties dialog (title, author, subject, keywords; what else the file holds). Dynamically imported. |
| `src/editor/marks-svg.ts` | Draws marks as SVG: the editor's layer (with grab areas), and thumbnails of edited pages (an SVG data: URL wrapping the plain thumbnail; nested images must be data: URLs there). Loaded with the page editor. |
| `src/editor/history.ts` | Undo/redo stack. |
| `src/editor/sources.ts` | `SourceRegistry`: opens files, keeps an in-memory copy, the PDF.js document, the disk handle, and lazy thumbnails (2 at a time). Also `pageSize` (the marks' space) and `render` (a page for the page editor, turned). |
| `src/editor/drag.ts` | Pointer-event drag and drop of pages, and of whole files by their card header. Drop marks: a bar beside a page or card (`drop-before`/`drop-after`), above or below a card that fills its row (`drop-above`/`drop-below`). On touch, drags start from the `.page-grip` or `.doc-grip` handle. |
| `src/editor/export.ts` | Builds outputs per document for each format and compression. |
| `src/editor/settings.ts` | Download panel field definitions and conversion to `ExportSettings`. |
| `src/editor/naming.ts` | Output file names, safe names, "name (2).pdf" de-duplication. |
| `src/editor/landing.ts` | Start page. |
| `src/core/compose.ts` | `Composer`: builds a PDF from page references (PDF pages and images), flattening, pass-through, marks. |
| `src/core/marks.ts`, `annotate.ts` | Mark types and geometry (no pdf-lib, shared with the UI); `MarkPainter` draws them with pdf-lib (highlight uses the Multiply blend mode), marks redactions, and `applyCrop` sets the CropBox. |
| `src/core/forms.ts` | `fillFields`: sets text, checkbox, radio, dropdown and list values with pdf-lib and redraws their appearances (so copied pages show them). Each set of values gets its own loaded copy of the source in `Composer`. |
| `src/core/paper.ts` | Paper for blank redactions on pictures: a patch from the pixels around a box. Pure, unit-tested. Ink is told from paper against the local median and the paper's own grain (robust spread), letters' grey edges are dropped with it (`INK.edge`), and positions with ink in their band are skipped and filled from clean ones beside them (else letters next to the box streak grey across it on off-white office scans); sides are blended as a Coons patch, grain added, seeded. |
| `src/core/redact.ts`, `sanitize.ts` | Redaction with MuPDF (fail closed); Remove hidden data and `dropUnreachable`; `applyInfo` for properties. |
| `src/browser/mupdf.ts`, `mupdf-module.ts`, `mupdf-module.single.ts` | Loads MuPDF on demand: fetches its gzipped WebAssembly (`virtual:mupdf-wasm`), unzips it if the server didn't (sniffs the gzip magic), passes it as `wasmBinary` through the `$libmupdf_wasm_Module` global, then imports MuPDF (a chunk; in the single-file build, MuPDF's source from a blob: URL). |
| `src/core/stamp.ts` | Page numbers and watermark, drawn in *displayed* coordinates so rotated pages come out right (`displayToUser`). |
| `src/core/images.ts`, `exif.ts` | Image page layout; JPEG EXIF orientation. |
| `src/core/pdf.ts`, `angle.ts` | pdf-lib load/create/save helpers; angle normalising. |
| `src/browser/pdfjs.ts` | Lazy PDF.js loading, page rendering, thumbnails, text extraction. |
| `src/browser/raster.ts` | Rasterising compression; PDF to images. |
| `src/browser/files.ts` | Reading files, image preparation (re-encodes EXIF-rotated JPEGs and non-JPEG/PNG images), ZIP, download. |
| `src/browser/filesystem.ts` | File System Access API: pickers, drop handles, Save as, permissions, deleting. Includes type declarations the DOM lib lacks. |
| `src/ui/*` | `h()` DOM helper, icons (only the ones in use), the logo (`logo.ts`, same paths as `docs/images/logo.svg`), generic options panel, dialog, toast, header. |
| `src/browser/pdf-worker.ts`, `pdf-worker.single.ts` | PDF.js worker setup. The single-file build swaps in the second (alias in `vite.config.ts`). |
| `vite.config.ts` | `base: './'`; a small plugin that writes `sw.js`, caching every built file for offline use. `mupdf()` provides MuPDF's WebAssembly gzipped as `mupdf-wasm-*.bin` (a data: URL in the single file and in dev), strips MuPDF's own reference to its `.wasm` (else the bundler ships the raw 10 MB too), and for the single file joins MuPDF's two modules into one source string. `--mode single` adds `classicWorker()` and `singleFile()` for the one-file build. |
| `packaging/`, `scripts/package.mjs` | Contents of the zip besides the builds: `server.mjs` (no-dependency local server sending the SECURITY.md headers), start scripts, `README.txt`, third-party licences (the wasm decoders are BSD, which asks for them). The zip is deterministic (fixed dates). `.gitattributes` keeps `start.bat` CRLF. |
| `release/LightPDF.zip` | The ready-to-run package. Rebuild with `npm run package` after changes. |
| `tests/` | Unit tests for core, marks, model, history and naming. `annotate.test.ts` reads text positions back with PDF.js (legacy build) in Node. |
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
  - Copies of the same page made in one `copyPages` call share their `/Contents` array, so anything drawn on one copy showed on all of them (page numbers did, before). `ownContents` in `pdf.ts` gives each copied page its own array.
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
- **Bundle:** the app shell is about 29 KB gzipped (JS + CSS). pdf-lib, JSZip, the composer, the page editor, `marks-svg.ts`, the Properties dialog and MuPDF are dynamic imports; keep them out of the main chunk (`export.ts` checks for redact marks inline so `core/marks.ts` doesn't load at start).
- **MuPDF:**
  - Its module starts with top-level `await` and loads its WebAssembly then, so it must only ever be imported on demand, after `$libmupdf_wasm_Module = { wasmBinary }` is set.
  - Chromium refuses module workers from blob: URLs on `file://` (classic ones work), so MuPDF runs on the main thread during export; dynamic `import()` of a blob: module does work there.
  - Never name the asset `.gz`: `vite preview` (and other servers) then send it with `Content-Encoding: gzip`, the browser unzips it, and unzipping again fails ("Failed to fetch"). `mupdf.ts` also checks the gzip magic bytes.
  - It adds 4.7 MB to `dist/` (precached by the service worker) and makes `LightPDF.html` about 9 MB; start-up of the single file goes from about 0.1 s to 0.3 s.
  - After `applyRedactions`, annotation objects of that page object are stale ("annotation not bound to any page"); reload the page to inspect it.
  - `hasInteriorColor()` is always false for Redact annotations, even with `/IC`; read `getObject().get('IC')`.
- **Page editor:** `openPageEditor` calls `load()` last, after every `let` it touches is declared (calling it earlier hit the temporal dead zone and silently kept a default page size). The text box's blur ends typing unless the focus went to the bar (font and size selects), so changing them doesn't close the box. Whiteout covers, it doesn't redact (README and SECURITY.md say so).

## Testing

- **Unit tests** (`npm test`, 81): composing, stamping, page editor marks (geometry, and positions read back from the PDF), crop, form filling, redaction and Remove hidden data, image layout, EXIF, document model, history and naming. `everything()` in `tests/fixtures.ts` decodes every object in a file (streams decompressed, hex text decoded) so tests can prove content is gone, not just hidden; `redact.test.ts` uses the real MuPDF in Node, and a stub that does nothing to prove the export fails closed. `tests/fixtures.ts` builds PDFs whose page widths (100, 101, 102…) identify pages after reordering.
- **Browser tests** in `e2e/`. These are Playwright scripts against the production build, not part of `npm test` or CI:
  ```sh
  node e2e/make-fixtures.mjs && python3 e2e/make-images.py   # once; needs Pillow
  npm run build && npm run preview &                          # serves http://localhost:4173
  node e2e/editor.mjs    # 40 checks: editing, page and file drag, card rows, More menu, undo, formats, compression, JPEG 2000 + CCITT, persistence, mobile
  node e2e/page-editor.mjs  # 35 checks: every tool, undo, select/move/resize/delete, image, pages, Done/Cancel, text position in the PDF (incl. turned pages), phone
  node e2e/features.mjs  # 24 checks: blank pages, stamp, tick, date, redaction with a black box and left blank, also on an old yellowed scan (gone from every object of the download), crop, form filling, Properties, Remove hidden data
  node e2e/fs.mjs        # 40 checks: Save as, folders, delete originals, folder and per-file permissions, fallback
  node e2e/offline.mjs   # editing (page editor and redaction too) and exporting with the network off
  node e2e/privacy.mjs   # no requests outside the app's origin; works under the CSP in SECURITY.md (sent on every response)
  BASE_URL=file://$PWD/dist-single/LightPDF.html node e2e/editor.mjs   # any of them (except fs.mjs) against the single file
  ```
  - Playwright comes from a global install (`npm root -g`), or set `PLAYWRIGHT_DIR`. In the cloud environment, Chromium is preinstalled; don't run `playwright install`.
  - Screenshots and downloads go to `e2e/.output/`, which is gitignored along with `e2e/fixtures/`.
  - `fs.mjs` swaps the system pickers for stand-ins backed by the browser's private file system (real handles), and mimics Chrome's permission rules: read-only until allowed, prompt only after a click, removal fails without permission (for files, or through a folder for `removeEntry`). The folder dialog stand-in returns the folder holding `startIn` and allows it; `folderAnswer = 'cancel'` stands for cancelling or a folder Chromium won't share. A real Chrome or Edge check is still worth doing.

## Ideas not built yet

- Dark variant of the monochrome theme.
- Save as for a single document (only Download exists on document cards).
- Page editor: search-and-redact (find every occurrence of a word), editing the PDF's existing text, more fonts (embedding a TTF for non-Latin text), copy/paste of marks, sticky-note comments as real PDF annotations, underline/strikethrough snapped to text, links, ticks that turn with a turned view, form values in thumbnails.
- Selecting pages by typing ranges ("1-3, 7").
- Password protection and unlocking (MuPDF can do both now that it is bundled), OCR for scanned text, Office conversion, PDF/A.
- Keyboard-only page moving (Alt+arrows) for accessibility.
