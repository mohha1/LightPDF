// Shared setup for the browser tests. Playwright is not a project dependency:
// the scripts use a global install (npm root -g) unless PLAYWRIGHT_DIR points elsewhere.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

export const DIR = new URL('.', import.meta.url).pathname;
export const FIXTURES = `${DIR}fixtures/`;
export const OUT = `${DIR}.output/`;
export const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
mkdirSync(`${OUT}downloads`, { recursive: true });
mkdirSync(`${OUT}shots`, { recursive: true });

const fromRepo = createRequire(new URL('../package.json', import.meta.url));
const playwrightRoot = process.env.PLAYWRIGHT_DIR ?? execSync('npm root -g').toString().trim();
export const { chromium } = createRequire(`${playwrightRoot}/`)('playwright');
export const { PDFDocument, StandardFonts, rgb, degrees } = fromRepo('pdf-lib');
export const JSZip = fromRepo('jszip');
