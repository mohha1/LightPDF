/** A module file turned into classic script source by the single-file build. */
declare module '*?classic' {
  const source: string;
  export default source;
}

declare module 'virtual:mupdf-wasm' {
  /** The URL of MuPDF's WebAssembly, gzipped. */
  const url: string;
  export default url;
}

declare module 'virtual:mupdf-source' {
  /** MuPDF as the source text of one module (single-file build only). */
  const source: string;
  export default source;
}
