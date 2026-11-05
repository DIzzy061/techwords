import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { addAI } from './build-ai-common.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist-pwa');
await fs.mkdir(out, { recursive: true });
let html = await fs.readFile(path.join(root, 'TechnoWords.html'), 'utf8');
const enhanced = await addAI(html); html = enhanced.html;
html = html.replace('img-src data: blob:', "img-src 'self' data: blob:");
html = html.replace('</head>', `<link data-pwa rel="manifest" href="./manifest.webmanifest"><link data-pwa rel="icon" href="./icon.svg" type="image/svg+xml"><link data-pwa rel="apple-touch-icon" href="./apple-touch-icon.png"><meta data-pwa name="apple-mobile-web-app-title" content="Технословарь"></head>`);
html = html.replace('<footer class="footer">', `<section data-pwa class="pwa-bar" aria-label="Установка и обновления"><span id="pwa-status" role="status">Подготовка офлайн-версии…</span><div><button class="button small" id="pwa-install" hidden>Установить приложение</button><button class="button small primary" id="pwa-update" hidden>Применить обновление</button><button class="text-button" id="pwa-check">Проверить обновления</button></div></section><footer class="footer">`);
html = html.replace('</style>', `.pwa-bar{display:flex;justify-content:space-between;align-items:center;gap:15px;padding:17px 0;border-top:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.7}.pwa-bar>div{display:flex;align-items:center;gap:12px;flex-wrap:wrap}@media(max-width:760px){.pwa-bar{flex-direction:column;align-items:start}}\n</style>`);
html = html.replace('const clone = document.documentElement.cloneNode(true);', `const clone = document.documentElement.cloneNode(true); clone.querySelectorAll('[data-pwa]').forEach(node => node.remove());`);
html = html.replace('</body>', '<script data-pwa src="./client.js" defer></script></body>');
const manifest = { id: './', name: 'Технословарь', short_name: 'Технословарь', description: 'Личный английский: свой Excel, тренировка и повторение ошибок.', lang: 'ru', start_url: './', scope: './', display: 'standalone', background_color: '#f5f6f0', theme_color: '#f5f6f0', icons: [{ src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] };
const files = {
  ...enhanced.files,
  'README.md': await fs.readFile(path.join(root, 'pwa/README.md'), 'utf8'),
  'AI-VALIDATION.md': await fs.readFile(path.join(root, 'AI-VALIDATION.md'), 'utf8'),
  'index.html': html,
  'client.js': await fs.readFile(path.join(root, 'pwa/client.js'), 'utf8'),
  'manifest.webmanifest': JSON.stringify(manifest, null, 2),
  'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#202c28"/><text x="195" y="370" text-anchor="middle" fill="#d7ef71" font-family="Georgia,serif" font-size="370" font-weight="bold">t</text><text x="320" y="192" fill="#d7ef71" font-family="Arial,sans-serif" font-size="130">×</text></svg>'
};
const hash = crypto.createHash('sha256');
for (const [name, body] of Object.entries(files)) { await fs.writeFile(path.join(out, name), body); hash.update(name).update(body); }
for (const name of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  const data = await fs.readFile(path.join(root, 'pwa', name)); await fs.writeFile(path.join(out, name), data); hash.update(data);
}
const template = await fs.readFile(path.join(root, 'pwa/service-worker.js'), 'utf8'); hash.update(template);
const version = hash.digest('hex').slice(0, 16);
await fs.writeFile(path.join(out, 'service-worker.js'), template.replace('__BUILD_HASH__', version));
await fs.writeFile(path.join(out, '.nojekyll'), '');
console.log(JSON.stringify({ out, version, status: 'Local WebLLM runtime included; physical-device model inference needs validation' }));
