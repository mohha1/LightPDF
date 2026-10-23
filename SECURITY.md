# Security

LightPDF is built so that your documents never leave your device. This page explains how that works, what the app can and can't do with your files, how to host it safely, and how to report a vulnerability.

- [Security model](#security-model)
- [Hosting it securely](#hosting-it-securely)
- [Reporting a vulnerability](#reporting-a-vulnerability)

## Security model

### Files never leave your device

- LightPDF is a static web app. There is no backend, no API and no database, so there is nowhere for a file to be uploaded to.
- Files you add are read into the memory of your browser tab. They are opened by [PDF.js](https://github.com/mozilla/pdf.js), edited with [pdf-lib](https://github.com/Hopding/pdf-lib) and packed with [JSZip](https://github.com/Stuk/jszip), all inside the tab.
- Results are handed back to your browser as a download, or written to the file or folder you choose with **Save as…**.
- All code is bundled at build time and served from the same site as the page. The app loads no third-party scripts, styles, fonts, analytics, ads or trackers, and sets no cookies.
- After the first visit the app works with the network switched off.

The browser test [`e2e/privacy.mjs`](e2e/privacy.mjs) checks this: adding PDFs and images and exporting them as PDF, compressed PDF, JPG, PNG and plain text makes no network request outside the app's own origin. The only outside link in the app is **Source** in the header, which opens this repository when you click it.

The single-file `LightPDF.html` in the download package passes the same check when opened from disk.

### What is stored, and where

| What | Where | How long |
| --- | --- | --- |
| Your files and their thumbnails | The tab's memory | Until you close the tab or choose **Start over** |
| Download settings (format, compression, page number and watermark options, **including the watermark text**) and thumbnail zoom | `localStorage` for the site | Until you clear the site's data |
| The app's own files (HTML, JavaScript, CSS, icons) | Cache Storage, via the service worker | Replaced on each update |

The **Delete originals** setting is never stored. Your files are never written to `localStorage`, IndexedDB or the service worker cache. To remove everything LightPDF has stored, clear the site's data in your browser settings.

### Access to files on your computer

LightPDF relies on the browser's sandbox and adds its own limits on top:

- **Reading.** The page can only see the files you select or drop. It can't browse your disk.
- **Writing.** **Save as…** writes only to the file or folder you pick in the browser's save dialog.
- **Deleting.** Only **Delete originals** deletes anything, and only under all of these conditions:
  - You ticked the box during this visit. It is off by default and never remembered.
  - Your browser asked you for permission to edit those files and you allowed it.
  - The result has been saved or the download has started. Nothing is deleted before that.
  - The file is one you added. A saved file that replaced an original is never deleted.
- Permissions are granted and remembered by your browser, not by LightPDF. You can review or revoke them in the site settings of your browser.
- **Save as…** and **Delete originals** use the File System Access API, which is only available in Chromium-based browsers on desktop. Elsewhere these features are switched off.

### Opening untrusted PDFs

PDF files can be crafted to attack the software that opens them. LightPDF reduces that risk as follows:

- PDFs are parsed by PDF.js inside a separate Web Worker.
- Pages are drawn onto a canvas and shown as images. The editor doesn't display a PDF's links, form widgets or annotations as live page content.
- JavaScript embedded in a PDF is never run. LightPDF doesn't enable PDF.js scripting or XFA forms.
- PDF.js is kept up to date. LightPDF uses PDF.js 6, which is not affected by known issues such as [CVE-2024-4367](https://nvd.nist.gov/vuln/detail/CVE-2024-4367) (fixed in 4.2.67).

### What LightPDF does not do

- **It doesn't sanitise PDFs.** When a document is one PDF with its pages in their original order, LightPDF edits that PDF in place, so everything in it is kept: metadata, bookmarks, links, form fields, and any attachments or scripts it contains. If you need to strip hidden content before sharing a file, use **Recommended** or **Extreme** compression, or export to JPG or PNG. These redraw every page as an image in a new file, which keeps only how the pages look.
- **It doesn't encrypt, sign or password-protect files**, and it can't open password-protected PDFs.
- **It can't protect you from a compromised device or browser.** Malicious browser extensions, for example, can read any page you visit.

Output PDFs are tagged with `LightPDF` as the creator and producer, and with the time they were made. LightPDF adds no other information about you or your device.

### Dependencies

LightPDF has three runtime dependencies: `pdfjs-dist`, `pdf-lib` and `jszip`. They are bundled at build time, with exact versions pinned in `package-lock.json`, and CI installs them with `npm ci`. Run `npm audit` to check them for known vulnerabilities.

## Hosting it securely

LightPDF must be served over **HTTPS** (or from `localhost`). Browsers only allow service workers and the File System Access API in secure contexts.

If your host lets you set response headers, these are recommended:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

- The Content Security Policy only lets the page load code from its own site, and `frame-ancestors 'none'` stops other sites from embedding it. [`e2e/privacy.mjs`](e2e/privacy.mjs) tests it against the production build, adding PDFs and images and exporting in every format. `'unsafe-inline'` in `style-src` is needed because the editor sets some styles at runtime. No `'unsafe-eval'` is needed.
- If you serve LightPDF from a subfolder of a site that hosts other apps, give it its own origin (for example a subdomain) instead, so that its storage and permissions are kept apart.
- GitHub Pages can't set custom headers. It serves over HTTPS, which is the most important part.

Example for **Netlify** or **Cloudflare Pages**, in a `_headers` file inside `dist/`:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

Example for **nginx**:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
```

## Reporting a vulnerability

Please **don't report security problems in a public issue.**

Report them privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [the private report form](https://github.com/mohha1/LightPDF/security/advisories/new).

Helpful details to include:

- what the problem is and what an attacker could do with it;
- steps to reproduce it, and a sample file if one is needed (remove anything personal from it first);
- the browser and operating system you used;
- the version or commit of LightPDF, or the address of the copy you tested.

You'll get a reply as soon as possible. Once the problem is confirmed, a fix is prepared and released, and you'll be credited in the advisory unless you'd rather not be.

### Supported versions

Only the latest version on the `main` branch is supported. Self-hosted copies should be rebuilt from the latest `main` to pick up fixes.

### Scope

In scope:

- anything that sends file contents, file names or other user data off the device;
- running script or loading content from another origin through a crafted PDF or image;
- reading, writing or deleting files beyond what the user chose, or deleting files before the result is saved;
- storing file contents where they outlive the tab.

Out of scope:

- vulnerabilities in browsers themselves, or in PDF.js, pdf-lib or JSZip that don't affect LightPDF (please report those upstream);
- attacks that need a malicious browser extension or an already compromised device;
- missing security headers on a copy you host yourself;
- a PDF that crashes or freezes the tab without any further effect.
