# LightPDF

Free PDF tools that run entirely in your browser. Merge, split, compress, convert and edit PDFs without uploading them anywhere.

LightPDF is a static web app: there is no server-side processing, no account and no tracking. Your files are read and written on your own device.

## How it works

1. **Add files.** Drop or select PDFs and images, one or many. Each file becomes a document in the editor.
2. **Arrange and edit.** Every page is shown as a thumbnail. Each document card is one file you'll download, so what you see is what you get.
3. **Download or save.** Pick the format and extras in the Download panel. **Download** puts everything in your downloads folder (as a ZIP when there's more than one file); **Save as…** lets you choose the file name, or a folder for several files. A single document can also be downloaded from its card.

### In the editor

| To… | Do this |
| --- | --- |
| Select pages | Click pages. Shift-click selects a range, even across documents. Ctrl/Cmd+A selects everything. |
| Reorder or move pages | Drag pages, or a whole selection, to a new spot in any document. On touch screens, drag the dotted handle. |
| Rotate | Hover a page and use its rotate button, select pages and press R (Shift+R for left), or rotate a whole document from its header. |
| Delete | Hover a page and use its bin button, or select pages and press Delete. |
| Duplicate | Select pages and choose **Duplicate**. |
| Extract | Select pages and choose **New file** to copy them into a new document. |
| Split | Click the scissors between two pages, or **Split into single pages** in a document's header. |
| Merge | **Merge all** in the toolbar, **Merge with the next file** in a document's header, or drag pages from one document into another. |
| Rename | Click a document's name. The name becomes the file name. |
| Undo | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z to redo. Deletions also show an Undo button. |

### Download options

- **Save as** PDF, JPG, PNG or plain text.
- **Compression**: *None* keeps text and quality exactly as they are. *Recommended* and *Extreme* redraw each page as an image, which shrinks scans and photo-heavy files a lot but makes text no longer selectable. LightPDF never hands back a bigger file than compression started with.
- **Page numbers** and a **watermark** can be added to every page.
- **Flatten form fields** locks filled-in answers into the page.
- **Delete originals** removes the files you added from your computer once the result is saved, so only the new file is left. After **Save as…** this happens as soon as the file is written. After **Download**, the browser can't tell when the download has finished, so LightPDF asks you to confirm with a **Delete originals** button instead. A saved file that replaces one of the originals is never deleted. This setting is never remembered between visits.
- **Page size for images** (same as the image, A4 or Letter) appears when your documents contain images.

Download settings are remembered in your browser.

**Save as…** and **Delete originals** need the File System Access API, which Chrome, Edge and other Chromium browsers support on desktop. Elsewhere **Save as…** is hidden and **Delete originals** is greyed out; Download works everywhere. Files you add are copied into memory, so the editor keeps working after the originals are deleted.

### Good to know

- A document that is exactly one uploaded PDF, with its pages in their original order, is edited in place, so its bookmarks, links, form fields and metadata survive. Rotating pages or adding page numbers keeps this. Rearranging pages, or mixing pages from several files, builds a new PDF, and bookmarks and fillable form fields from the originals don't carry over. Flatten forms first if you need their contents.
- **Text** output reads real text only. Scanned pages are pictures of text and need OCR, which LightPDF doesn't do yet.
- Password-protected PDFs can't be opened yet; remove the password first.
- Page numbers and watermarks use the built-in PDF fonts, which cover Latin text.

## Using it

**On any computer, with nothing to install:** open the hosted site in a modern browser (Chrome, Edge, Firefox or Safari). After the first visit LightPDF also works offline, and Chrome and Edge can install it as an app from the address bar.

**Hosting your own copy:** run `npm run build` and serve the `dist/` folder from any static web server (GitHub Pages, Netlify, Cloudflare Pages, nginx, Apache, …). Asset paths are relative, so it also works from a subfolder. Opening `dist/index.html` directly from disk (`file://`) does not work, because browsers block JavaScript modules there.

## Development

Requires Node.js 20.19 or newer.

```sh
npm install
npm run dev        # start a local dev server
npm test           # unit tests for the PDF processing code
npm run build      # type-check and build into dist/
npm run preview    # serve the production build locally
```

### How it's built

- **Vite + TypeScript**, no UI framework. The app shell (JS + CSS) is about 21 KB gzipped; pdf-lib and JSZip load only when you download.
- **[pdf-lib](https://github.com/Hopding/pdf-lib)** (MIT) edits and creates PDFs.
- **[PDF.js](https://github.com/mozilla/pdf.js)** (Apache-2.0) opens files, renders thumbnails (only those scrolled into view) and page images, and extracts text.
- **[JSZip](https://github.com/Stuk/jszip)** (MIT) packs multiple results into one download.
- A small service worker, generated at build time, caches the app for offline use.

```
src/
  core/      PDF building with pdf-lib (compose, stamps, image layout). Unit-tested in Node.
  editor/    The editor: document model, undo history, drag and drop, export, UI.
  browser/   Browser-only helpers: PDF.js rendering, image preparation, downloads.
  ui/        Shared UI pieces: DOM helper, icons, options panel, dialog, toast.
tests/       Vitest unit tests for src/core and the editor model.
```

The editor never changes your files while you work. A document is a list of references (`source file`, `page`, `extra rotation`), and every edit in `src/editor/model.ts` is a pure function that returns a new list, which makes undo/redo a stack of snapshots. Only when you download does `src/core/compose.ts` build the real PDFs, parsing each source file once.

## License

MIT. See [LICENSE](LICENSE).
