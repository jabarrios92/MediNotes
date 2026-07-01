const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const fontSetup = `
  pdfmake.setFonts({
    Helvetica: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
  });
`;

code = code.replace("function generateSlidesPDF", fontSetup + "\nfunction generateSlidesPDF");

fs.writeFileSync('server.ts', code);
