// pdfkit 0.20 ships no types and the community types predate its ESM API; the slice used is typed in
// lib/test-results/redaction/assemble.ts.
declare module "pdfkit" {
  const PDFDocument: unknown
  export default PDFDocument
}
declare module "pdfkit/output" {
  export function toBytes(doc: unknown): Promise<Uint8Array>
}
declare module "pdfkit/standard-fonts/Helvetica" {
  const font: unknown
  export default font
}
