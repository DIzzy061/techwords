(() => {
  'use strict';
  const status = document.getElementById('pwa-status');
  const update = document.getElementById('pwa-update');
  const install = document.getElementById('pwa-install');
  const check = document.getElementById('pwa-check');
  let registration, installPrompt, applying = false, checking = false;
  const tell = text => { status.textContent = text; };
  function offerUpdate() { update.hidden = false; tell('Новая версия загружена. Можно обновить после ответа.'); }
  function watch(worker) {
    if (!worker) return;
    const changed = () => {
      if (worker.state === 'installed' && registration.waiting) offerUpdate();
      if (worker.state === 'redundant') tell('Загрузка обновления не завершилась. Текущая версия остаётся доступна.');
    };
    worker.addEventListener('statechange', changed); changed();
  }
  async function checkUpdate(manual = false) {
    if (!registration || checking) return;
    if (!navigator.onLine) { if (manual) tell('Сейчас нет сети. Работаем с сохранённой версией.'); return; }
    checking = true; check.disabled = true;
    try {
      await registration.update();
      if (registration.waiting) offerUpdate();
      else if (manual && !registration.installing) tell('Новая версия не найдена. Сохранённая версия доступна офлайн.');
    } catch (_) { if (manual) tell('Сервер недоступен. Сохранённая версия остаётся доступна.'); }
    finally { checking = false; check.disabled = false; }
  }
  check.onclick = () => checkUpdate(true);
  update.onclick = () => {
    if (!registration?.waiting) return;
    // Reload only on an explicit click. Ordinary background updates cannot interrupt a question.
    applying = true; update.disabled = true; tell('Применяем обновление…');
    registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
  };
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; install.hidden = false; });
  install.onclick = async () => {
    if (!installPrompt) return;
    const prompt = installPrompt; installPrompt = null; install.hidden = true;
    try { await prompt.prompt(); await prompt.userChoice; } catch (_) { /* The browser may dismiss its install UI. */ }
  };
  window.addEventListener('appinstalled', () => { install.hidden = true; });
  window.addEventListener('online', () => checkUpdate());
  window.addEventListener('offline', () => { if (registration?.active) tell('Офлайн. Используем сохранённую версию.'); });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    tell('Для установки и офлайн-режима открой страницу по HTTPS или через localhost.'); check.disabled = true; return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) location.reload(); });
  (async () => {
    try {
      registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
      registration.addEventListener('updatefound', () => watch(registration.installing));
      watch(registration.installing);
      if (registration.waiting) offerUpdate();
      await navigator.serviceWorker.ready;
      if (!registration.waiting) tell(navigator.onLine ? 'Страница сохранена для офлайн-работы.' : 'Офлайн. Используем сохранённую версию.');
      await checkUpdate();
    } catch (_) { tell('Не удалось сохранить офлайн-версию. Проверь сеть и настройки браузера.'); check.disabled = true; }
  })();
})();
