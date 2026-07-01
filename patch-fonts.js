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

code = code.replace('const content: any[] = [];\n  const lines = markdownText.split(\'\\n\');\n  const timeRegex', fontSetup + '\n  const content: any[] = [];\n  const lines = markdownText.split(\'\\n\');\n  const timeRegex');

fs.writeFileSync('server.ts', code);
