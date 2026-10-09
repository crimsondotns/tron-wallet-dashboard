// pdfkit's prebuilt browser bundle (fs/zlib polyfilled); same API as "pdfkit".
declare module "pdfkit/js/pdfkit.standalone" {
  import PDFDocument from "pdfkit";
  export default PDFDocument;
}
