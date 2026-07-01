import pdfmake from 'pdfmake';
const docDefinition = {
  content: [ 'This is an sample PDF printed with pdfMake' ]
};
try {
  pdfmake.createPdf(docDefinition).write('test.pdf').then(() => console.log('success')).catch(console.error);
} catch (e) {
  console.log('Error', e);
}
