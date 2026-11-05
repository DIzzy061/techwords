(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let info = null, checking = false, cacheToken = 0;
  const panel = $('ai-panel'), button = $('open-ai');
  const ai = () => window.TrainerAI;
  function paint() {
    const indicator = $('ai-study-status'), setup = $('study-open-ai'), status = ai()?.status;
    if (indicator) {
      indicator.textContent = status?.phase === 'loading' ? 'ИИ готовится · новые переводы ждут оценки' : status?.phase === 'checking' ? 'ИИ проверяет ответ на этом устройстве…' : ai()?.enabled && status?.phase === 'ready' ? 'Словарь + ИИ · новые переводы подтверждаются' : 'Проверка по словарю · ИИ не подключён';
      if (setup) setup.textContent = ai()?.enabled && status?.phase === 'ready' ? 'Настройки ИИ' : status?.phase === 'loading' ? 'Подготовка модели' : 'Подключить ИИ';
    }
    if (!ai()) { $('ai-status').textContent = 'Не загрузился модуль ИИ. Тренировка по словарю доступна.'; return; }
    const s = ai().status, busy = ['loading', 'checking'].includes(s.phase);
    $('ai-status').textContent = s.text;
    $('ai-progress').value = s.progress;
    $('ai-progress').hidden = s.phase !== 'loading';
    $('ai-enable').checked = ai().enabled;
    $('ai-enable').disabled = s.phase !== 'ready';
    $('ai-model').disabled = busy || checking;
    $('ai-load').disabled = busy || checking || !info || $('ai-model').value === '0';
    $('ai-delete').disabled = busy || checking || !info;
    $('ai-stop').disabled = !busy && s.phase !== 'ready';
    $('ai-diagnose').disabled = busy || checking;
    button.textContent = s.phase === 'checking' ? 'ИИ проверяет…' : ai().enabled ? 'ИИ включён' : 'Проверка с ИИ';
  }
  async function showCache() {
    const token = ++cacheToken;
    if (!info || !ai()) return;
    $('ai-cache').textContent = 'Проверяем кеш модели…';
    try {
      const yes = await ai().cached(Number($('ai-model').value), info);
      if (token === cacheToken) $('ai-cache').textContent = yes ? 'Веса модели найдены в кеше. Проверь запуск без сети: могут понадобиться дополнительные файлы.' : 'Полной модели в кеше пока нет. Первая загрузка требует интернета.';
      const legacy = await ai().cached(0, info);
      if (token === cacheToken) { $('ai-legacy-option').hidden = !legacy; $('ai-model-note').hidden = !legacy; }
      if (token === cacheToken && !legacy && $('ai-model').value === '0') { $('ai-model').value = '1'; paint(); return showCache(); }
    } catch (_) { if (token === cacheToken) $('ai-cache').textContent = 'Кеш недоступен. Проверь разрешения браузера на хранение данных.'; }
  }
  async function diagnose() {
    if (!ai() || checking) return;
    checking = true; info = null; paint(); $('ai-device').textContent = 'Проверяем WebGPU…';
    try {
      info = await ai().diagnose();
      $('ai-device').textContent = `WebGPU доступен · ${info.f16 ? 'f16' : 'f32'} · лимит одного буфера ${info.bufferMB} МБ${info.freeMB == null ? '' : ' · доступно хранилищу до ' + info.freeMB + ' МБ'}. Запуск модели проверяется отдельно.`;
      await showCache();
    } catch (error) { $('ai-device').textContent = error.message; }
    finally { checking = false; paint(); }
  }
  button.onclick = () => {
    window.dispatchEvent(new Event('trainer-ai-dialog'));
    if (!panel.open) panel.showModal();
    paint(); if (!info) diagnose(); else showCache();
  };
  $('ai-close').onclick = () => panel.close();
  $('ai-model').onchange = () => { paint(); showCache(); };
  $('ai-diagnose').onclick = diagnose;
  $('ai-load').onclick = async () => { if (!ai() || !info) return; await ai().load(Number($('ai-model').value)); paint(); await showCache(); };
  $('ai-stop').onclick = () => ai()?.cancel();
  $('ai-enable').onchange = event => { if (ai()) ai().enabled = event.target.checked; paint(); };
  $('ai-delete').onclick = async () => {
    if (!info || !ai() || !confirm('Удалить файлы выбранной модели с этого устройства? Слова и прогресс останутся.')) return;
    checking = true; paint();
    try { await ai().remove(Number($('ai-model').value), info); await showCache(); }
    catch (error) { $('ai-cache').textContent = error.message; }
    finally { checking = false; paint(); }
  };
  window.addEventListener('trainer-ai-status', paint);
  window.addEventListener('trainer-ai-ready', paint);
  window.addEventListener('trainer-render', paint);
  paint();
})();
