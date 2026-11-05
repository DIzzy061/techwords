import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const deps = process.env.TRAINER_NODE_MODULES || 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
let html = fs.readFileSync(path.join(root, 'src/shell.html'), 'utf8');
const thirdPartyNotices = fs.readFileSync(path.join(deps, 'jszip/LICENSE.markdown'), 'utf8').split(/\r?\nGPL version 3/)[0]
  + '\n\nPako (bundled inside JSZip):\n' + fs.readFileSync(path.join(deps, 'pako/LICENSE'), 'utf8');
const sources = {
  CSS: fs.readFileSync(path.join(root, 'src/style.css'), 'utf8'),
  ZIP: '/*\nThird-party notices: JSZip and Pako, distributed under the MIT license.\n' + thirdPartyNotices + '\n*/\n' + fs.readFileSync(path.join(deps, 'jszip/dist/jszip.min.js'), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/m, ''),
  CORE: fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'),
  APP: fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
};
for (const [key, value] of Object.entries(sources)) {
  html = html.replace(`/*__${key}__*/`, () => key === 'CSS' ? value : value.replace(/<\/script/gi, '<\\/script'));
}
fs.writeFileSync(path.join(root, 'TechnoWords.html'), html);
console.log('TechnoWords.html — ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB, автономный HTML.');
