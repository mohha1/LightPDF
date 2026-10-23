# LightPDF

Free PDF tools that run entirely in your browser. Merge, split, compress, convert and edit PDFs without uploading them anywhere.

LightPDF is a static web app: there is no server-side processing, no account and no tracking. Your files are read and written on your own device.

## Tools

| Organize | Optimize | Convert | Edit |
| --- | --- | --- | --- |
| Merge PDF | Compress PDF | JPG to PDF | Add page numbers |
| Split PDF | | PDF to JPG | Add watermark |
| Organize PDF (reorder, rotate, duplicate, delete pages) | | PDF to Text | Edit metadata |
| Rotate PDF | | | Flatten PDF (forms) |
| Remove pages | | | |
| Extract pages | | | |

Every result screen offers **Continue with this file**, so you can chain tools (for example, merge → compress → add page numbers) without downloading in between.

### Good to know

- **Compress PDF** has three levels. *Lossless* keeps the document exactly as it is and only re-packs it. *Recommended* and *Extreme* re-draw each page as an image, which shrinks scans and photo-heavy files a lot but makes text no longer selectable. LightPDF never hands back a file bigger than the original.
- **PDF to Text** reads real text only. Scanned pages are pictures of text and need OCR, which LightPDF doesn't do yet.
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

- **Vite + TypeScript**, no UI framework. The app shell (JS + CSS) is about 21 KB gzipped; PDF libraries load only when a tool runs.
- **[pdf-lib](https://github.com/Hopding/pdf-lib)** (MIT) edits and creates PDFs.
- **[PDF.js](https://github.com/mozilla/pdf.js)** (Apache-2.0) renders thumbnails and page images and extracts text.
- **[JSZip](https://github.com/Stuk/jszip)** (MIT) packs multiple results into one download.
- A small service worker, generated at build time, caches the app for offline use.

```
src/
  core/      PDF processing with pdf-lib. Pure functions, unit-tested in Node.
  browser/   Browser-only helpers: PDF.js rendering, images, downloads.
  tools/     One declarative definition per tool: options, labels and run().
  ui/        Home page, header, and the shared tool workspace.
tests/       Vitest unit tests for src/core.
```

Adding a tool means adding a `Tool` object in `src/tools/` and listing it in `src/tools/index.ts`. The workspace renders its upload screen, options sidebar, progress and result screens from that definition.

## License

MIT. See [LICENSE](LICENSE).
