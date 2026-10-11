// PDF source bytes stay in the existing immutable, hashed artifact body store.
export const MAX_PDF_BYTES=20_000_000;
export const MAX_PDF_BODY=Math.ceil(MAX_PDF_BYTES/3)*4+1024;
export const PDF_PREFIX='data:application/pdf;base64,';
export function pdfContent(bytes){
 if(bytes.length>MAX_PDF_BYTES)throw Error('PDF exceeds the 20 MB limit');
 if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw Error('The selected file is not a PDF');
 return PDF_PREFIX+bytes.toString('base64');
}
export function validatePdf(body){
 const text=body?.content;
 if(typeof text!=='string'||text.length>MAX_PDF_BODY||!text.startsWith(PDF_PREFIX))throw Error('A PDF requires its saved original bytes');
 const data=text.slice(PDF_PREFIX.length);
 if(/[^A-Za-z0-9+/=]/.test(data))throw Error('Invalid PDF encoding');
 if(pdfContent(Buffer.from(data,'base64'))!==text)throw Error('Invalid PDF encoding');
}
