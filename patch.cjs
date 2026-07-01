const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const safeJsonStr = `
const safeJson = async (res: Response, endpoint: string) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Invalid JSON from " + endpoint + ":", text.substring(0, 100));
    throw new Error("Invalid JSON from " + endpoint + ". HTML returned?");
  }
};
`;

code = code.replace('export default function App() {', safeJsonStr + '\nexport default function App() {');

code = code.replace(/await response\.json\(\)/g, 'await safeJson(response, "status")');
code = code.replace(/await driveRes\.json\(\)/g, 'await safeJson(driveRes, "drive")');
code = code.replace(/await initRes\.json\(\)/g, 'await safeJson(initRes, "init")');
code = code.replace(/await chunkRes\.json\(\)/g, 'await safeJson(chunkRes, "chunk")');

fs.writeFileSync('src/App.tsx', code);
