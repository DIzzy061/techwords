import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export async function addAI(html) {
  // The runtime ships locally; only the explicit model-loading action uses the network.
  html = html.replace("script-src 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'")
    .replace("connect-src 'none'", "connect-src 'self' https://huggingface.co https://*.hf.co https://raw.githubusercontent.com; worker-src 'self'; manifest-src 'self'");
  html = html.replace('</style>', (await fs.readFile(path.join(root, 'pwa/ai.css'), 'utf8')) + '\n</style>');
  html = html.replace('<button class="text-button" id="help-button">', '<button data-ai class="text-button" id="open-ai">Проверка с ИИ</button><button class="text-button" id="help-button">');
  html = html.replace('</body>', `${await fs.readFile(path.join(root, 'pwa/ai-panel.html'), 'utf8')}<script data-ai src="./ai-runtime.js" defer></script><script data-ai src="./ai-panel.js" defer></script></body>`);
  const files = { 'ai-panel.js': await fs.readFile(path.join(root, 'pwa/ai-panel.js')) };
  for (const name of ['ai-runtime.js', 'ai-worker.js', 'WEBLLM-LICENSE.txt']) files[name] = await fs.readFile(path.join(root, 'ai-engine/bundle', name));
  return { html, files };
}
