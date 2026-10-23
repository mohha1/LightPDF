import { loadPdf, savePdf, type Bytes } from './pdf';

export interface Metadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export async function readMetadata(bytes: Bytes): Promise<Metadata> {
  const doc = await loadPdf(bytes);
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
  };
}

export async function writeMetadata(bytes: Bytes, metadata: Metadata): Promise<Bytes> {
  const doc = await loadPdf(bytes);
  doc.setTitle(metadata.title.trim());
  doc.setAuthor(metadata.author.trim());
  doc.setSubject(metadata.subject.trim());
  doc.setKeywords(
    metadata.keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  );
  doc.setCreator(metadata.creator.trim());
  doc.setProducer(metadata.producer.trim());
  doc.setModificationDate(new Date());
  return savePdf(doc);
}

/** Bakes form fields into the page content so they can no longer be edited. */
export async function flattenForms(bytes: Bytes): Promise<{ bytes: Bytes; fieldCount: number }> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  const fieldCount = form.getFields().length;
  if (fieldCount > 0) {
    try {
      form.flatten();
    } catch {
      throw new Error("This PDF's form uses features that can't be flattened in the browser.");
    }
  }
  return { bytes: await savePdf(doc), fieldCount };
}

/** Re-saves the document with compressed object streams. Lossless. */
export async function optimizeLossless(bytes: Bytes): Promise<Bytes> {
  return savePdf(await loadPdf(bytes));
}
