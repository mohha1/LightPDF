import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { encryptPdf, passwordProblem, unlockPdf } from '../src/core/protect';
import { makePdf, pageWidths } from './fixtures';

/** Opens a PDF with PDF.js, as the app does; the error's name when it can't. */
async function open(bytes: Uint8Array, password?: string): Promise<number | string> {
  try {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise;
    const pages = doc.numPages;
    await doc.loadingTask.destroy();
    return pages;
  } catch (error) {
    return (error as Error).name;
  }
}

/** A file that opens without a password but forbids printing, copying and editing. */
function restricted(bytes: Uint8Array): Uint8Array {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  return doc.asPDF()!.saveToBuffer('encrypt=aes-128,owner-password=owner,permissions=-3904').asUint8Array().slice();
}

describe('passwords', () => {
  it('says why a password can’t be used', () => {
    expect(passwordProblem('')).toMatch(/Type a password/);
    expect(passwordProblem('a,b')).toMatch(/comma/);
    expect(passwordProblem('x'.repeat(128))).toMatch(/too long/);
    expect(passwordProblem('ü'.repeat(64))).toMatch(/too long/); // 128 bytes in UTF-8
    expect(passwordProblem('correct horse = battery')).toBeUndefined();
  });

  it('encrypts so the file only opens with the password', async () => {
    for (const password of ['s3cret', 'pässwört mit Leerzeichen']) {
      const locked = encryptPdf(mupdf, await makePdf(3), password);
      expect(await open(locked)).toBe('PasswordException');
      expect(await open(locked, 'wrong')).toBe('PasswordException');
      expect(await open(locked, password)).toBe(3);
      expect(Buffer.from(locked).toString('latin1')).toContain('/AESV3');
    }
  });

  it('refuses passwords MuPDF can’t take, rather than saving with a different one', async () => {
    expect(() => encryptPdf(mupdf, new Uint8Array(), 'a,b')).toThrow(/comma/);
  });

  it('unlocks with the right password and keeps the pages', async () => {
    const original = await makePdf(3);
    const locked = encryptPdf(mupdf, original, 'open sesame');
    expect(unlockPdf(mupdf, locked, '')).toBeUndefined();
    expect(unlockPdf(mupdf, locked, 'wrong')).toBeUndefined();
    const unlocked = unlockPdf(mupdf, locked, 'open sesame')!;
    expect(await open(unlocked)).toBe(3);
    // pdf-lib, which builds every download, can read it now.
    expect(await pageWidths(unlocked)).toEqual([100, 101, 102]);
  });

  it('lifts restrictions on printing and editing without a password', async () => {
    const locked = restricted(await makePdf(2));
    // PDF.js shows it, but pdf-lib can't edit it as it is.
    expect(await open(locked)).toBe(2);
    await expect(pageWidths(locked)).rejects.toThrow();
    const unlocked = unlockPdf(mupdf, locked, '')!;
    expect(await pageWidths(unlocked)).toEqual([100, 101]);
    const doc = await pdfjs.getDocument({ data: unlocked.slice(), verbosity: 0 }).promise;
    expect(await doc.getPermissions()).toBeNull();
    await doc.loadingTask.destroy();
  });
});
