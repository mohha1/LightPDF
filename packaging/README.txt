LightPDF
========

Private PDF tools that run entirely in your browser. Merge, split, reorder,
rotate, edit, fill in, redact, compress, password-protect and convert PDFs
and images. Nothing is uploaded.

Source, documentation and security policy: https://github.com/mohha1/LightPDF


Start it
--------

Double-click LightPDF.html. It opens in your browser and is ready to use:
nothing to install, no internet connection needed.

For "Save as..." and "Delete originals", open it in Chrome, Edge or another
Chromium browser on a desktop computer. Everything else works in any modern
browser.

LightPDF.html is the whole app in one file. You can copy it anywhere, put it
on a USB stick or send it to someone.


The local-server folder
-----------------------

The same app as a small website, with a local server to run it. You only
need it if you want to install LightPDF as an app (Chrome and Edge), or if
your browser won't run LightPDF.html from disk.

You need Node.js 18 or newer (https://nodejs.org). Python 3 also works.

  Windows   Double-click start.bat
  macOS     Double-click start.command
            (the first time: right-click it, choose Open, then Open again)
  Linux     Run ./start.sh

Your browser opens at http://localhost:8080/ (or the next free port). Keep
the window that opened alongside it while you use LightPDF, and close it,
or press Ctrl+C in it, when you are done. The server only accepts
connections from this computer, and your files never pass through it.


Putting it on a web server
--------------------------

local-server/app/ is the whole website. Upload its contents to any static
host (GitHub Pages, Netlify, Cloudflare Pages, nginx, Apache, ...) and serve
it over HTTPS. SECURITY.md in the repository lists recommended server
headers.


Contents
--------

  LightPDF.html             The app in a single file: double-click to open
  local-server/app/         The app as a website (static files)
  local-server/server.mjs   Small local web server, no dependencies
  local-server/start.bat    Starter for Windows
  local-server/start.command  Starter for macOS
  local-server/start.sh     Starter for Linux
  LICENSE.txt               MIT licence
  third-party-licenses/     Licences of PDF.js, pdf-lib, JSZip, MuPDF (AGPL-3.0)
                            and the image decoders
