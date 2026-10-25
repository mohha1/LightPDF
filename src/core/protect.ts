import type { MuPDFLibrary } from './redact';

/** The longest password AES-256 takes, in UTF-8 bytes. */
const MAX_PASSWORD_BYTES = 127;

/** Why a password can't protect a PDF, or undefined when it can. */
export function passwordProblem(password: string): string | undefined {
  if (!password) return 'Type a password to protect the PDF with, or untick Password.';
  // MuPDF reads its save options as a comma-separated list, with no way to escape a comma.
  if (password.includes(',')) return 'A password can’t contain a comma.';
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return 'That password is too long.';
  return undefined;
}

/**
 * Encrypts a PDF with AES-256. The password is needed to open it; once open,
 * nothing is restricted (the owner password is the same one).
 */
export function encryptPdf(mupdf: MuPDFLibrary, bytes: Uint8Array, password: string): Uint8Array {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = opened.asPDF();
    if (!pdf) throw new Error('This document could not be protected.');
    return pdf.saveToBuffer(`encrypt=aes-256,user-password=${password},owner-password=${password},compress,objstms`).asUint8Array().slice();
  } finally {
    opened.destroy();
  }
}

/**
 * The PDF without its encryption, or undefined when the password is wrong.
 * An empty password opens files that only restrict printing, copying or
 * editing; the copy has no restrictions.
 */
export function unlockPdf(mupdf: MuPDFLibrary, bytes: Uint8Array, password: string): Uint8Array | undefined {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = opened.asPDF();
    if (!pdf) throw new Error('This file could not be read as a PDF. It may be damaged or not a PDF.');
    if (pdf.needsPassword() && !pdf.authenticatePassword(password)) return undefined;
    return pdf.saveToBuffer('encrypt=none').asUint8Array().slice();
  } finally {
    opened.destroy();
  }
}
