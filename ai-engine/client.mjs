import { WebWorkerMLCEngine, prebuiltAppConfig, hasModelInCache, deleteModelAllInfoInCache } from '@mlc-ai/web-llm';
import { makeMessages, parseVerdict, verdictSchema } from './judge.mjs';

const baseURL = new URL('.', document.currentScript.src);
const families = [
  { name: 'Qwen 2.5 · 0.5B · лёгкая', prefix: 'Qwen2.5-0.5B-Instruct' },
  { name: 'Qwen 2.5 · 1.5B · больше памяти', prefix: 'Qwen2.5-1.5B-Instruct' }
];
const modelList = prebuiltAppConfig.model_list.filter(m => families.some(f => ['q4f16_1', 'q4f32_1'].some(q => m.model_id === `${f.prefix}-${q}-MLC`)));
if (modelList.length !== 4) throw new Error('Изменился каталог WebLLM. Нужна проверка сборки.');
const appConfig = { model_list: modelList, cacheBackend: 'cache' };
let worker, engine, abortCurrent, generation = 0, busy = false;
const ai = {
  enabled: false,
  status: { phase: 'idle', text: 'ИИ выключен. Словарь работает без модели.', progress: 0 },
  families, selected: 1, modelId: null,
  emit(phase, text, progress = 0) { ai.status = { phase, text, progress }; window.dispatchEvent(new Event('trainer-ai-status')); },
  async diagnose() {
    if (!isSecureContext || location.protocol === 'file:') throw new Error('Для ИИ открой PWA по HTTPS или версию ПК через localhost. Обычный HTML можно использовать без ИИ.');
    if (!navigator.gpu) throw new Error('В этом браузере WebGPU недоступен. Словарь и тренировка продолжают работать.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('Браузер не предоставил видеоустройство для WebGPU.');
    const f16 = adapter.features.has('shader-f16');
    const storage = await navigator.storage?.estimate().catch(() => ({}));
    return { f16, bufferMB: Math.round(adapter.limits.maxStorageBufferBindingSize / 1048576), freeMB: storage?.quota ? Math.round((storage.quota - storage.usage) / 1048576) : null };
  },
  model(index, info) { return modelList.find(m => m.model_id === `${families[index].prefix}-${info.f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`); },
  async cached(index, info) { return hasModelInCache(ai.model(index, info).model_id, appConfig); },
  cancel(message = 'Проверка отменена. Статистика не изменена.') {
    generation++; ai.enabled = false;
    const reject = abortCurrent; abortCurrent = null;
    worker?.terminate(); worker = null; engine = null; busy = false;
    ai.emit('idle', 'ИИ остановлен. Загруженные файлы модели остаются в кеше.');
    reject?.(new Error(message));
  },
  async run(action, timeout) {
    let timer, rejectThis;
    try { return await Promise.race([action(), new Promise((_, reject) => { rejectThis = reject; abortCurrent = reject; timer = setTimeout(() => ai.cancel('ИИ не успел закончить проверку. Статистика не изменена.'), timeout); })]); }
    finally { clearTimeout(timer); if (abortCurrent === rejectThis) abortCurrent = null; }
  },
  async load(index) {
    if (busy) return;
    ai.cancel(); busy = true; const token = generation;
    ai.emit('loading', 'Проверяем устройство…');
    try {
      const info = await ai.diagnose(); if (token !== generation) return;
      const model = ai.model(index, info); ai.modelId = model.model_id; ai.selected = index;
      if (!navigator.onLine && !(await hasModelInCache(model.model_id, appConfig))) throw new Error('Модель ещё не сохранена полностью. Подключись к интернету для первой загрузки.');
      if (token !== generation) return;
      // A separate worker keeps model compilation and generation out of the interface thread.
      worker = new Worker(new URL('ai-worker.js', baseURL));
      engine = new WebWorkerMLCEngine(worker, { appConfig, logLevel: 'WARN', initProgressCallback: report => {
        if (token === generation) {
          const percent = Math.round(Math.max(0, Math.min(1, report.progress || 0)) * 100);
          const loading = /Loading model from cache/i.test(report.text);
          ai.emit('loading', `${loading ? 'Открываем сохранённую модель' : 'Подготавливаем файлы модели'}: ${percent}%.`, percent / 100);
        }
      } });
      worker.onerror = () => { if (token === generation) { ai.cancel(); ai.emit('error', 'Поток ИИ остановился. Открой модель заново или попробуй другой браузер.'); } };
      // Context is bounded to reduce the memory used by an individual vocabulary check.
      await ai.run(() => engine.reload(model.model_id, { context_window_size: 2048 }), 20 * 60 * 1000);
      if (token !== generation) return;
      ai.emit('loading', 'Модель открыта. Готовим первую проверку — это может занять несколько минут…', 1);
      const warmup = await ai.run(() => engine.chat.completions.create({ messages: makeMessages({ prompt: 'hello', translations: ['привет'], direction: 'en-ru', answer: 'здравствуйте' }), temperature: 0, max_tokens: 40, seed: 7, response_format: { type: 'json_object', schema: JSON.stringify(verdictSchema) } }), 180000);
      parseVerdict(warmup);
      if (token !== generation) return;
      busy = false; ai.enabled = true; ai.emit('ready', 'Модель открыта. Неизвестные переводы проверяются на устройстве.');
      navigator.storage?.persist?.().catch(() => {});
    } catch (error) {
      if (token !== generation) return;
      ai.lastError = String(error?.message ?? error).slice(0, 1000);
      console.warn('WebLLM load failed:', ai.lastError);
      ai.cancel(); ai.emit('error', 'Модель не открылась. Повтори загрузку. Уже сохранённые файлы остаются в кеше; можно продолжить по словарю.');
    }
  },
  async check(data) {
    if (!engine || busy || ai.status.phase !== 'ready') throw new Error('Сначала открой модель.');
    const messages = makeMessages(data); busy = true; const token = generation;
    ai.emit('checking', 'Проверяем значение…');
    try {
      let reply;
      try { reply = await ai.run(() => engine.chat.completions.create({ messages, temperature: 0, max_tokens: 40, seed: 7, response_format: { type: 'json_object', schema: JSON.stringify(verdictSchema) } }), 45000); }
      catch (error) { if (token === generation) { ai.cancel(); ai.emit('error', 'Проверка прервалась. Открой модель заново или продолжай по словарю.'); } throw error; }
      if (token !== generation) throw new Error('Проверка отменена.');
      return parseVerdict(reply);
    } finally { if (token === generation) { busy = false; ai.emit('ready', 'Модель открыта. Проверка выполняется на устройстве.'); } }
  },
  async remove(index, info) {
    if (busy) throw new Error('Сначала останови ИИ.');
    ai.cancel();
    await deleteModelAllInfoInCache(ai.model(index, info).model_id, appConfig);
    ai.emit('idle', 'Файлы выбранной модели удалены. Словарь и прогресс сохранены.');
  }
};
window.TrainerAI = ai;
window.dispatchEvent(new Event('trainer-ai-ready'));
