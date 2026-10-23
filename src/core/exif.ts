/**
 * Reads the EXIF orientation (1-8) of a JPEG. Returns 1 when there is none.
 * Phone photos often store pixels sideways and rely on this tag to show upright.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  try {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return 1;
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      if (marker === 0xda) return 1; // Start of image data: no EXIF before it.
      if (marker === 0xe1 && isExifHeader(bytes, offset + 4)) {
        const tiff = offset + 10;
        const little = bytes[tiff] === 0x49;
        const firstIfd = tiff + view.getUint32(tiff + 4, little);
        const entries = view.getUint16(firstIfd, little);
        for (let i = 0; i < entries; i++) {
          const entry = firstIfd + 2 + i * 12;
          if (view.getUint16(entry, little) === 0x0112) {
            const value = view.getUint16(entry + 8, little);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
        return 1;
      }
      offset += 2 + length;
    }
  } catch {
    // Truncated or malformed EXIF data: treat as upright.
  }
  return 1;
}

function isExifHeader(bytes: Uint8Array, at: number): boolean {
  // "Exif\0\0"
  return [0x45, 0x78, 0x69, 0x66, 0, 0].every((byte, i) => bytes[at + i] === byte);
}
