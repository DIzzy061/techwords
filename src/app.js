(function () {
  'use strict';
  const C = TrainerCore;
  const KEY = 'technowords.offline.v1';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const number = value => Number(value).toLocaleString('ru-RU');
  const plural = (n, one, few, many) => n % 100 >= 11 && n % 100 <= 19 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
  let storageOK = true, state = C.fresh(), view = 'study', wordPage = 0, search = '', pending = null, toastTimer;
  let currentFileToken = 0;
  let autoAdvanceTimer = null, autoEpoch = 0, practice = null, hardSearch = '', hardFilter = 'active', hardPage = 0, wordFilter = 'all';
  let aiRequest = null;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) state = C.restore(JSON.parse(saved));
  } catch (error) {
    storageOK = false;
    console.warn('Не удалось прочитать локальное сохранение:', error.message);
  }
  try {
    const seed = JSON.parse($('portable-state').textContent);
    if (seed && (!state.decks.length || seed.savedAt > state.savedAt)) state = C.restore(seed);
  } catch (_) { /* A broken optional seed must not discard the local save. */ }
  function deck() { return state.decks.find(d => d.id === state.activeId) || null; }
  function pstate() { return deck()?.progress[state.settings.direction]; }
  function question() { return practice ? practice.question : pstate()?.question; }
  function cancelAutoAdvance() {
    clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; autoEpoch++;
    if ($('auto-next-note')) $('auto-next-note').hidden = true;
  }
  function scheduleAutoAdvance() {
    const q = question();
    if (!state.settings.autoAdvance || !q?.outcome?.correct || q.outcome.kind === 'typo' || document.hidden || $('modal').open) return;
    cancelAutoAdvance();
    const epoch = autoEpoch, activeId = state.activeId, direction = state.settings.direction, session = practice;
    if ($('auto-next-note')) {
      $('auto-next-note').hidden = false;
      $('pause-auto-next').onclick = cancelAutoAdvance;
    }
    autoAdvanceTimer = setTimeout(() => {
      if (epoch === autoEpoch && state.activeId === activeId && state.settings.direction === direction && view === 'study' && practice === session && question() === q && !document.hidden && !$('modal').open) advance();
    }, 1500);
  }
  function stopPractice() {
    cancelAutoAdvance();
    if (practice) {
      const d = state.decks.find(d => d.id === practice.deckId), p = d?.progress[practice.direction];
      if (p?.question && !p.question.outcome && p.reviews.some(r => r.wordId === p.question.wordId && r.due > p.answered)) p.question = null;
    }
    practice = null;
  }
  function navigate(nextView) { stopPractice(); view = nextView; render(); }
  function startPractice(ids) {
    stopPractice();
    const d = deck(), direction = state.settings.direction;
    practice = { deckId: d.id, direction, ids: [...new Set(ids)], asked: [], question: C.practiceQuestion(d, direction, ids) };
    view = 'study'; render();
  }
  function save() {
    state.savedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOK = true; }
    catch (_) { storageOK = false; }
    $('storage-warning').hidden = storageOK;
    $('save-state').innerHTML = `<span class="status-dot"></span>${storageOK ? (state.decks.length ? 'Прогресс сохранён на этом устройстве' : 'Всё работает без интернета') : 'Скачай резервную копию перед закрытием'}`;
  }
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
  }
  function modal(title, body, actions = '') {
    cancelAutoAdvance();
    $('modal-content').innerHTML = `<div class="modal-body"><div class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="close" aria-label="Закрыть" id="modal-close">×</button></div>${body}${actions ? `<div class="modal-actions">${actions}</div>` : ''}</div>`;
    $('modal-close').onclick = () => $('modal').close();
    if (!$('modal').open) $('modal').showModal();
  }
  function showError(message) { modal('Не получилось загрузить', `<p class="modal-copy">${esc(message)}</p>`, '<button class="button primary" id="error-ok">Понятно</button>'); $('error-ok').onclick = () => $('modal').close(); }
  function confirmAction(title, message, label, action) {
    modal(title, `<p class="modal-copy">${esc(message)}</p>`, `<button class="button" id="confirm-cancel">Отмена</button><button class="button danger" id="confirm-yes">${esc(label)}</button>`);
    $('confirm-cancel').onclick = () => $('modal').close();
    $('confirm-yes').onclick = () => { $('modal').close(); action(); };
  }
  function deckSelect() {
    return `<select class="deck-select" id="deck-select" aria-label="Текущий словарь">${state.decks.map(d => `<option value="${esc(d.id)}" ${d.id === state.activeId ? 'selected' : ''}>${esc(d.name)} · ${number(d.words.length)}</option>`).join('')}</select>`;
  }
  function heading(kicker, title, subtitle) {
    return `<div class="page-heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p class="subtle">${esc(subtitle)}</p></div>${deckSelect()}</div>`;
  }
  function render() {
    cancelAutoAdvance();
    cancelAI();
    const d = deck();
    if (practice && (practice.deckId !== d?.id || practice.direction !== state.settings.direction)) stopPractice();
    const activeView = d ? view : 'home';
    document.body.classList.toggle('training', Boolean(d) && view === 'study');
    for (const section of ['home', 'study', 'words', 'hard']) {
      $('nav-' + section).classList.toggle('active', activeView === section);
      $('nav-' + section).setAttribute('aria-current', activeView === section ? 'page' : 'false');
    }
    $('nav-count').textContent = d ? number(d.words.length) : '0';
    $('nav-hard-count').textContent = d ? number(C.difficultWords(d, state.settings.direction).filter(item => item.streak < 3).length) : '0';
    if (!d || view === 'home') renderWelcome();
    else if (view === 'words') renderWords();
    else if (view === 'hard') renderHard();
    else renderStudy();
    if ($('deck-select')) $('deck-select').onchange = event => { stopPractice(); state.activeId = event.target.value; wordPage = 0; hardPage = 0; search = ''; hardSearch = ''; render(); save(); };
    save();
    window.dispatchEvent(new Event('trainer-render'));
  }
  function renderWelcome() {
    $('main').innerHTML = `<section class="welcome"><div><div class="eyebrow">Твой словарь. Твой темп.</div><h1>Английский<br>для твоих<br><em>проектов.</em></h1><p class="welcome-description">От терминов в даташите до уверенного чтения документации. Загрузи свои слова из Excel и разбирай их по одному.</p><div class="welcome-actions"><button class="button primary" id="welcome-import">Загрузить Excel <span class="arrow" aria-hidden="true">↗</span></button><button class="button" id="demo-button">Попробовать на примере</button></div><p class="welcome-note"><span class="mini-dot"></span> Без интернета · Без регистрации · С сохранением</p></div><div class="import-visual" aria-label="Пример файла: столбец A — английский, B — русский"><div class="visual-top"><span class="file-icon">XLSX</span><span class="visual-name">my_technical_words.xlsx</span><span class="visual-badge">A → B</span></div><table class="sample-table"><thead><tr><th></th><th>A · ENGLISH</th><th>B · РУССКИЙ</th></tr></thead><tbody><tr><td>1</td><td>interrupt</td><td>прерывание</td></tr><tr><td>2</td><td>pull-up resistor</td><td>подтягивающий резистор</td></tr><tr><td>3</td><td>clock frequency</td><td>тактовая частота</td></tr><tr><td>4</td><td>buffer overflow</td><td>переполнение буфера</td></tr></tbody></table><div class="visual-bottom"><b aria-hidden="true">↳</b><span>Всего две колонки.<br>Форматирование и пустые строки уберём сами.</span></div></div></section><section class="feature-strip" aria-label="Возможности"><div class="feature-item"><span class="feature-index">01</span><div><h3>Два способа учить</h3><p>Выбирай из четырёх вариантов или вспоминай перевод сам.</p></div></div><div class="feature-item"><span class="feature-index">02</span><div><h3>Оба направления</h3><p>С английского на русский и обратно. Переключай в любой момент.</p></div></div><div class="feature-item"><span class="feature-index">03</span><div><h3>Ошибки возвращаются</h3><p>Повторим сложный термин через 20–30 других вопросов.</p></div></div></section>`;
    $('welcome-import').onclick = chooseFile;
    if (deck()) {
      $('demo-button').textContent = 'Продолжить тренировку →';
      $('demo-button').classList.add('primary'); $('welcome-import').classList.remove('primary');
      $('demo-button').id = 'continue-study';
      $('continue-study').onclick = () => navigate('study');
    } else $('demo-button').onclick = addDemo;
  }
  function sidebar(d, p) {
    const summary = C.learningSummary(d, state.settings.direction), total = d.words.filter(w => !w.excluded).length;
    const hard = C.difficultWords(d, state.settings.direction).filter(item => item.streak < 3);
    const accuracy = p.answered ? Math.round(p.correct / p.answered * 100) : 0;
    const reviews = p.reviews.slice().sort((a, b) => a.due - b.due);
    return `<aside class="sidebar"><section class="card progress-card"><div class="section-kicker">Твой прогресс · ${state.settings.direction === 'en-ru' ? 'EN → RU' : 'RU → EN'}</div><div class="progress-summary"><strong class="progress-big" id="correct-word-count">${summary.correctWords}</strong><span class="progress-total">/ ${number(total)}</span></div><p class="progress-label">из изучаемых слов с верным ответом</p><div class="stat-row"><span>Не спрашивать · уже знаю</span><strong>${d.words.length - total}</strong></div><div class="progress-track" role="progressbar" aria-label="Слова с верным ответом" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${summary.correctWords}"><div class="progress-fill" style="width:${total ? summary.correctWords / total * 100 : 0}%"></div></div><div class="stat-row"><span>Закреплено · 3 подряд</span><strong id="mastered-word-count">${summary.mastered}</strong></div><div class="stat-row"><span>Ответов</span><strong>${number(p.answered)}</strong></div><div class="stat-row"><span>Точность</span><strong>${accuracy}%</strong></div><div class="stat-row"><span>Ждут повторения</span><strong>${reviews.length}</strong></div><button class="button small full hard-shortcut" id="open-hard-list">Сложные слова · ${hard.length} →</button></section><section class="card insight-card"><div class="insight-icon" aria-hidden="true">↻</div><h3>Первый успех и закрепление</h3><p>После первого верного ответа растёт большой счётчик. Закреплено — три верных ответа подряд без опечаток. Ошибка сбрасывает только серию; история верных ответов остаётся.</p></section>${reviews.length ? `<section class="card progress-card repeat-card"><div class="section-kicker" style="margin-bottom:0">На повторение</div><div class="repeat-list">${reviews.slice(0, 3).map(r => { const w = d.words.find(w => w.id === r.wordId); return `<div class="repeat-item"><span>${esc(C.variants(w[C.columns(state.settings.direction)[0]])[0])}</span><span>${r.due <= p.answered ? 'следующим' : 'через ' + (r.due - p.answered)}</span></div>`; }).join('')}</div>${reviews.length > 3 ? `<p class="subtle" style="margin-top:15px">и ещё ${reviews.length - 3}</p>` : ''}</section>` : ''}</aside>`;
  }
  function feedbackHTML(d, p, q, w, direction) {
    const o = q.outcome;
    if (!o) return '';
    const kind = o.kind || (o.correct ? 'exact' : 'wrong');
    const target = C.accepted(w, direction, d.words);
    const expected = o.expected || target[0];
    let difference = '';
    if (o.answer && ['wrong', 'typo'].includes(kind) && state.settings.mode === 'typing') {
      const diff = C.diffText(o.answer, expected);
      const line = (parts, cls) => parts.map(part => '<span class="' + (part.changed ? cls : '') + (part.missing ? ' diff-missing' : '') + '">' + esc(part.text) + '</span>').join('');
      difference = '<div class="spelling-comparison"><div><small>Твой ответ</small><span class="diff-line">' + line(diff.answer, 'diff-bad') + '</span></div><div><small>Правильно</small><span class="diff-line">' + line(diff.expected, 'diff-good') + '</span></div></div>';
    }
    const streak = Math.min(3, p.seen[w.id]?.streak || 0);
    const title = kind === 'typo' ? 'Ответ принят. Есть опечатка.' : kind === 'semantic' ? '✓ ИИ принял перевод по смыслу.' : o.correct ? '✓ Верно. Двигаемся дальше!' : 'Пока не получилось. Запомним.';
    let note = kind === 'typo' ? 'Перевод засчитан. Повторим написание после ' + o.gap + ' других вопросов. Для закрепления нужен ответ без опечатки.' : !o.correct ? (o.answer ? '' : 'Ты пропустил ответ. ') + 'Повторим после ' + o.gap + ' других вопросов в этом направлении.' : '';
    if (practice && ['wrong', 'typo'].includes(kind)) note = kind === 'typo' ? 'Перевод засчитан. В этой тренировке повторим написание до трёх верных ответов подряд.' : 'В этой тренировке вернёмся к слову без ожидания 20–30 вопросов.';
    if (kind === 'semantic') note = 'Твой вариант: ' + o.answer + '. ИИ может ошибаться. Сохраняй вариант, только если согласен с оценкой.';
    return '<div class="feedback ' + (kind === 'typo' ? 'typo' : o.correct ? '' : 'wrong') + '" role="status"><div class="feedback-title">' + title + '</div>' + difference + '<div class="feedback-answer"><strong>Допустимые переводы:</strong> ' + target.map(esc).join(' / ') + '</div>' + (w.ipa && direction === 'ru-en' ? '<p class="feedback-pronunciation">' + esc(w.en) + ' <span class="ipa">' + esc(w.ipa) + '</span></p>' : '') + (note ? '<div class="feedback-note">' + esc(note) + '</div>' : '') + '<div class="mastery-state">' + (streak === 3 ? '✓ Закреплено: 3 верных ответа подряд без опечаток.' : 'До закрепления: ' + streak + '/3 верных ответа подряд без опечаток.') + '</div><div class="auto-next-note" id="auto-next-note" hidden>Следующее слово через 1,5 с <button class="pause-auto" id="pause-auto-next">Пауза</button></div></div>';
  }
  function renderStudy() {
    const d = deck(), direction = state.settings.direction, p = pstate();
    if (!practice && !p.question) C.next(d, direction);
    const q = question(), w = q && d.words.find(w => w.id === q.wordId);
    let card;
    if (d.words.every(w => w.excluded)) {
      card = '<section class="card empty"><h2>Все слова исключены из тренировки</h2><p>Словарь и история сохранены. Верни нужные слова в разделе «Словарь» или добавь новые.</p><button class="button primary" id="manage-excluded">Открыть словарь</button></section>';
    } else if (practice && !q) {
      card = `<section class="card empty practice-complete"><span class="completion-mark" aria-hidden="true">✓</span><h2>Сложные слова повторены</h2><p>В этой группе ${practice.ids.length} слов. У каждого — не меньше трёх верных ответов подряд без опечаток. История ошибок сохранена в разделе «Сложные».</p><div class="completion-actions"><button class="button primary" id="return-study">Продолжить обычную тренировку</button><button class="button" id="return-hard">К сложным словам</button></div></section>`;
    } else if (!q) {
      card = `<div class="card empty"><h2>Все термины ждут повторения</h2><p>Чтобы выдержать интервал в 20–30 вопросов, нужны другие слова. Добавь термины или начни повторение раньше.</p><button class="button primary" id="repeat-early">Повторить раньше</button></div>`;
    } else {
      const prompt = C.variants(w[C.columns(direction)[0]])[0];
      const target = C.accepted(w, direction, d.words);
      const outcome = q.outcome;
      const choiceMode = state.settings.mode === 'choice';
      const canChoose = q.options.length === 4;
      const answerArea = choiceMode ? (canChoose ? `<div class="options" aria-label="Варианты перевода">${q.options.map((option, i) => `<button class="option${outcome && option.correct ? ' correct' : ''}${outcome && !outcome.correct && C.normalize(option.text) === C.normalize(outcome.answer) ? ' wrong' : ''}" data-option="${i}" ${outcome ? 'disabled' : ''}><span class="option-number" aria-hidden="true">${outcome && option.correct ? '✓' : i + 1}</span><span>${esc(option.text)}</span></button>`).join('')}</div>` : `<div class="error-box">Для теста нужны четыре разных перевода. Сейчас подходящих вариантов: ${q.options.length}. Добавь слова или перейди к вводу ответа.<div style="margin-top:12px"><button class="button small" id="use-typing">Вводить ответ</button></div></div>`) : `<form class="answer-form" id="answer-form"><input class="answer-input" id="answer-input" aria-label="Твой перевод" placeholder="${direction === 'en-ru' ? 'Перевод на русском…' : 'Translation in English…'}" lang="${direction === 'en-ru' ? 'ru' : 'en'}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" maxlength="4000" ${outcome ? `disabled value="${esc(outcome.answer)}"` : ''}><button class="button primary" type="submit" ${outcome ? 'disabled' : ''}>Проверить</button></form>`;
      card = `<section class="card question-card" aria-label="Вопрос"><div class="question-meta"><span>ВОПРОС ${number(p.answered + (outcome ? 0 : 1))}</span><span class="pill ${q.repeat ? 'repeat' : ''}">${q.repeat ? '↻ ПОВТОРЕНИЕ' : 'ТВОЙ СЛОВАРЬ'}</span></div><div class="question-body"><p class="question-label">${choiceMode ? 'Выбери правильный перевод' : 'Вспомни и напиши перевод'}</p><h2 class="term ${prompt.length > 32 ? 'long' : ''}" lang="${direction === 'en-ru' ? 'en' : 'ru'}">${esc(prompt)}</h2>${w.ipa && direction === "en-ru" ? `<p class="term-ipa ipa" lang="en">${esc(w.ipa)}</p>` : ""}<p class="question-caption">${direction === 'en-ru' ? 'Английский → Русский' : 'Русский → Английский'}</p></div>${$("open-ai") ? '<div data-ai class="ai-study-status"><span id="ai-study-status">Проверка по словарю · ИИ не подключён</span><button type="button" class="button small" id="study-open-ai">Подключить ИИ</button></div>' : ""}${answerArea}<div id="ai-result" aria-live="polite"></div>${feedbackHTML(d, p, q, w, direction)}${outcome?.kind === 'semantic' ? '<button class="text-button" id="remember-alias">Сохранить мой перевод как допустимый</button>' : ''}<div class="question-bottom"><span class="keyboard-hint">${outcome ? '<kbd>Enter</kbd> следующий вопрос' : choiceMode ? '<kbd>1</kbd>–<kbd>4</kbd> выбрать ответ' : '<kbd>Enter</kbd> проверить ответ'}</span><span class="mobile-hint">${outcome ? 'Прогресс сохранён' : 'Вспоминай без спешки'}</span>${outcome ? '<button class="button dark small" id="next-question">Следующий <span aria-hidden="true">→</span></button>' : '<button class="skip" id="dont-know">Не знаю →</button>'}</div><button class="button exclude-question" id="exclude-current">Уже знаю — не спрашивать это слово</button></section>`;
    }
    $('main').innerHTML = `${heading('Практика / Technical vocabulary', 'Разберём по словам.', 'Маленький шаг сегодня. Понятнее документация завтра.')}<div class="grid"><div><div class="settings"><div class="segmented" role="group" aria-label="Режим тренировки"><button id="mode-choice" class="${state.settings.mode === 'choice' ? 'selected' : ''}" aria-pressed="${state.settings.mode === 'choice'}">4 варианта</button><button id="mode-typing" class="${state.settings.mode === 'typing' ? 'selected' : ''}" aria-pressed="${state.settings.mode === 'typing'}">Ввод ответа</button></div><select class="direction" id="direction" aria-label="Направление перевода"><option value="en-ru" ${direction === 'en-ru' ? 'selected' : ''}>EN → RU</option><option value="ru-en" ${direction === 'ru-en' ? 'selected' : ''}>RU → EN</option></select></div><div class="auto-settings"><label><input type="checkbox" id="auto-advance-toggle" ${state.settings.autoAdvance ? "checked" : ""}> Автопереход через 1,5 с</label><span>После верного ответа без опечатки</span></div>${practice ? `<div class="practice-banner"><div><strong>Тренировка сложных слов</strong><p>Только выбранные слова. Повторено: ${practice.ids.filter(id => practice.asked.includes(id) && p.seen[id]?.streak >= 3).length}/${practice.ids.length}</p></div><button class="button small" id="stop-practice">К списку</button></div>` : ""}${card}<p class="under-card">Длинные фразы тоже считаются. Не торопись — таймера здесь нет.</p></div>${sidebar(d, p)}</div>`;
    if ($('manage-excluded')) $('manage-excluded').onclick = () => navigate('words');
    if ($('exclude-current')) $('exclude-current').onclick = () => { cancelAI(); stopPractice(); C.setExcluded(d, w.id, true); render(); toast('Слово больше не спрашиваем в обоих направлениях. Вернуть можно в словаре.'); };
    if ($('study-open-ai')) $('study-open-ai').onclick = () => $('open-ai')?.click();
    $('mode-choice').onclick = () => setMode('choice');
    $('mode-typing').onclick = () => setMode('typing');
    $('direction').onchange = event => { stopPractice(); state.settings.direction = event.target.value; render(); };
    $('auto-advance-toggle').onchange = event => { state.settings.autoAdvance = event.target.checked; cancelAutoAdvance(); save(); if (event.target.checked) scheduleAutoAdvance(); };
    if ($('stop-practice')) $('stop-practice').onclick = () => navigate('hard');
    if ($('return-study')) $('return-study').onclick = () => navigate('study');
    if ($('return-hard')) $('return-hard').onclick = () => navigate('hard');
    if ($('open-hard-list')) $('open-hard-list').onclick = () => navigate('hard');
    document.querySelectorAll('[data-option]').forEach(button => { button.onclick = () => submit(q.options[Number(button.dataset.option)].text); });
    if ($('answer-form')) $('answer-form').onsubmit = event => { event.preventDefault(); const value = $('answer-input').value.trim(); if (value) submit(value); else $('answer-input').focus(); };
    if ($('remember-alias')) $('remember-alias').onclick = () => { cancelAutoAdvance(); C.addAlias(w, direction, q.outcome.answer); save(); $('remember-alias').disabled = true; $('remember-alias').textContent = 'Вариант сохранён в словаре'; };
    if ($('next-question')) $('next-question').onclick = advance;
    if ($('dont-know')) $('dont-know').onclick = () => submit('');
    if ($('use-typing')) $('use-typing').onclick = () => setMode('typing');
    if ($('repeat-early')) $('repeat-early').onclick = () => {
      const earliest = p.reviews.slice().sort((a, b) => a.due - b.due)[0];
      if (earliest) earliest.due = p.answered;
      render();
    };
  }
  function setMode(mode) { state.settings.mode = mode; render(); }
  function cancelAI() {
    if (!aiRequest) return;
    aiRequest = null;
    if (window.TrainerAI?.status.phase === 'checking') window.TrainerAI.cancel();
    if ($('ai-result')) $('ai-result').replaceChildren();
    document.querySelectorAll('#answer-form input, #answer-form button, #dont-know').forEach(node => { node.disabled = false; });
  }
  async function submit(value) {
    const q = question(), d = deck(), direction = state.settings.direction;
    if (!q || q.outcome || aiRequest) return;
    const w = d.words.find(w => w.id === q.wordId), ai = window.TrainerAI;
    if (!value || state.settings.mode !== 'typing' || C.compareAnswer(w, direction, d.words, value).correct || !$('open-ai')) { finishAnswer(value); return; }
    cancelAutoAdvance();
    const request = { q, d, direction }; aiRequest = request;
    document.querySelectorAll('#answer-form input, #answer-form button, #dont-know').forEach(node => { node.disabled = true; });
    if (!ai?.enabled || ai.status.phase !== 'ready') {
      const note = ai?.status.phase === 'loading' ? 'Модель ещё готовится. Можно дождаться её или оценить ответ самому.' : 'ИИ сейчас не участвует в проверке. Запуск через CMD открывает приложение; модель нужно открыть отдельно.';
      showAnswerReview(request, value, { verdict: 'unavailable', reason: note });
      return;
    }
    $('ai-result').innerHTML = '<div class="ai-verdict"><p>ИИ проверяет перевод на этом устройстве…</p><button class="button small" id="cancel-ai-answer">Отменить проверку</button></div>';
    $('cancel-ai-answer').onclick = cancelAI;
    let verdict;
    try { verdict = await ai.check({ prompt: C.variants(w[C.columns(direction)[0]])[0], translations: C.accepted(w, direction, d.words), direction, answer: value }); }
    catch (error) { verdict = { verdict: 'unsure', reason: error.message }; }
    showAnswerReview(request, value, verdict);
  }
  function showAnswerReview(request, value, verdict) {
    const { q, d, direction } = request;
    if (aiRequest !== request || question() !== q || deck() !== d || state.settings.direction !== direction || view !== 'study') return;
    const w = d.words.find(w => w.id === q.wordId);
    $('ai-result').innerHTML = `<div class="ai-verdict"><strong>${verdict.verdict === 'unavailable' ? 'Этого варианта нет в словаре — нужна оценка' : verdict.verdict === 'correct' ? 'ИИ считает перевод допустимым' : verdict.verdict === 'incorrect' ? 'ИИ не подтвердил перевод' : 'ИИ не смог уверенно оценить ответ'}</strong><p>${esc(verdict.reason || 'Выбери, как оценить ответ.')} Статистика ещё не изменена.</p><p>В словаре: ${C.accepted(w, direction, d.words).map(esc).join(' / ')}. Твой ответ: ${esc(value)}.</p><div class="ai-actions">${verdict.verdict === 'correct' ? '<button class="button primary small" id="ai-confirm-answer">Подтвердить ответ</button>' : ''}${verdict.verdict === 'unavailable' ? '<button class="button primary small" id="ai-connect-answer">Открыть настройки ИИ</button>' : ''}<button class="button small" id="ai-accept-answer">Верно — запомнить мой перевод</button><button class="button small" id="ai-use-dictionary">Засчитать как ошибку</button><button class="text-button" id="cancel-ai-answer">Изменить ответ</button></div></div>`;
    if ($('ai-confirm-answer')) $('ai-confirm-answer').onclick = () => finishAnswer(value, true);
    if ($('ai-connect-answer')) $('ai-connect-answer').onclick = () => $('open-ai').click();
    $('cancel-ai-answer').onclick = cancelAI;
    $('ai-use-dictionary').onclick = () => finishAnswer(value);
    $('ai-accept-answer').onclick = () => { C.addAlias(w, direction, value); finishAnswer(value, true); };
  }
  function finishAnswer(value, semantic = false) {
    aiRequest = null;
    const q = question();
    const result = C.answer(deck(), state.settings.direction, value, Math.random, practice ? q : null, semantic);
    if (result) {
      if (practice && !practice.asked.includes(q.wordId)) practice.asked.push(q.wordId);
      render(); scheduleAutoAdvance();
    }
  }
  window.addEventListener('trainer-ai-dialog', () => { cancelAutoAdvance(); cancelAI(); });
  function advance() {
    cancelAutoAdvance();
    const p = pstate(), q = question();
    if (!q?.outcome) return;
    if (practice) practice.question = C.practiceQuestion(deck(), state.settings.direction, practice.ids, practice.asked, q.wordId);
    else { p.question = null; C.next(deck(), state.settings.direction); }
    render();
    if (state.settings.mode === 'typing' && matchMedia('(pointer:fine)').matches) $('answer-input')?.focus();
  }
  function filteredHardWords() {
    return C.difficultWords(deck(), state.settings.direction).filter(item =>
      (hardFilter === 'all' || (hardFilter === 'active' ? item.streak < 3 : item.streak >= 3)) &&
      C.normalize(item.word.en + ' ' + item.word.ru).includes(C.normalize(hardSearch))
    );
  }
  function renderHard() {
    const d = deck(), direction = state.settings.direction;
    $('main').innerHTML = `${heading('Повторение / Difficult words', 'Слова, которым нужно внимание.', 'Ошибки сохраняются автоматически. Сначала — слова с наибольшим числом ошибок.')}<section class="hard-toolbar"><div class="hard-controls"><input class="search" id="hard-search" type="search" aria-label="Поиск по сложным словам" placeholder="Найти слово или перевод…" value="${esc(hardSearch)}"><select class="direction" id="hard-filter" aria-label="Какие сложные слова показать"><option value="active" ${hardFilter === 'active' ? 'selected' : ''}>Нужно закрепить</option><option value="all" ${hardFilter === 'all' ? 'selected' : ''}>Все с ошибками</option><option value="mastered" ${hardFilter === 'mastered' ? 'selected' : ''}>Уже закреплены</option></select><select class="direction" id="hard-direction" aria-label="Направление сложных слов"><option value="en-ru" ${direction === 'en-ru' ? 'selected' : ''}>EN → RU</option><option value="ru-en" ${direction === 'ru-en' ? 'selected' : ''}>RU → EN</option></select></div><div class="hard-summary"><p class="subtle" id="hard-summary-text"></p><button class="button primary" id="practice-hard">Учить этот список →</button></div></section><div class="hard-list" id="hard-list"></div><div class="pagination" id="hard-pagination"></div><p class="dictionary-note">В отдельной тренировке сложные слова повторяются до трёх верных ответов подряд без опечаток. Интервал 20–30 вопросов действует в обычной тренировке. После закрепления история остаётся в фильтре «Все с ошибками».</p>`;
    $('hard-search').oninput = event => { hardSearch = event.target.value; hardPage = 0; renderHardRows(); };
    $('hard-filter').onchange = event => { hardFilter = event.target.value; hardPage = 0; renderHardRows(); };
    $('hard-direction').onchange = event => { state.settings.direction = event.target.value; hardPage = 0; render(); };
    $('practice-hard').onclick = () => startPractice(filteredHardWords().map(item => item.word.id));
    renderHardRows();
  }
  function renderHardRows() {
    const all = C.difficultWords(deck(), state.settings.direction), filtered = filteredHardWords();
    const pages = Math.max(1, Math.ceil(filtered.length / 30));
    hardPage = Math.min(hardPage, pages - 1);
    $('hard-summary-text').textContent = `В списке: ${filtered.length}. Всего слов с ошибками или опечатками: ${all.length}.`;
    $('practice-hard').disabled = !filtered.length;
    $('hard-list').innerHTML = filtered.length ? filtered.slice(hardPage * 30, hardPage * 30 + 30).map(item => `<article class="hard-word-card" data-hard-word="${esc(item.word.id)}"><div class="hard-word-main"><h2 lang="en">${esc(item.word.en)}</h2>${item.word.ipa ? `<p class="dictionary-ipa ipa">${esc(item.word.ipa)}</p>` : ''}<p class="hard-translation" lang="ru">${esc(item.word.ru)}</p></div><div class="hard-word-stats"><span class="error-count">Ошибок: <strong>${item.mistakes}</strong></span><span>Опечаток: <strong>${item.typos}</strong></span><span class="${item.streak >= 3 ? 'mastered' : ''}">${item.streak >= 3 ? '✓ Закреплено' : 'Верно подряд: ' + item.streak + '/3'}</span></div><button class="button small" data-practice-word="${esc(item.word.id)}">${item.streak >= 3 ? 'Повторить ещё' : 'Учить слово'} →</button></article>`).join('') : `<section class="card empty"><h2>${all.length ? 'В этой группе пока нет слов' : 'Пока нет сложных слов'}</h2><p>${all.length ? 'Выбери «Все с ошибками», другое направление или измени поиск.' : 'Слова появятся здесь после неверного ответа или опечатки. Их можно будет посмотреть и отдельно потренировать.'}</p><button class="button primary" id="hard-start-study">Перейти к тренировке</button></section>`;
    document.querySelectorAll('[data-practice-word]').forEach(button => { button.onclick = () => startPractice([button.dataset.practiceWord]); });
    if ($('hard-start-study')) $('hard-start-study').onclick = () => navigate('study');
    $('hard-pagination').hidden = pages === 1;
    $('hard-pagination').innerHTML = `<button class="button small" id="hard-prev" aria-label="Предыдущая страница сложных слов" ${hardPage === 0 ? 'disabled' : ''}>←</button><span>${hardPage + 1} / ${pages}</span><button class="button small" id="hard-next" aria-label="Следующая страница сложных слов" ${hardPage === pages - 1 ? 'disabled' : ''}>→</button>`;
    $('hard-prev').onclick = () => { hardPage--; renderHardRows(); };
    $('hard-next').onclick = () => { hardPage++; renderHardRows(); };
  }
  function renderWords() {
    const d = deck();
    $('main').innerHTML = `${heading('Твоя база / Vocabulary', 'Слова, которые нужны тебе.', 'Термины и фразы из твоей документации.')}<div class="search-row"><select class="direction" id="word-filter" aria-label="Какие слова показать"><option value="all" ${wordFilter === "all" ? "selected" : ""}>Все слова</option><option value="active" ${wordFilter === "active" ? "selected" : ""}>Изучаю</option><option value="excluded" ${wordFilter === "excluded" ? "selected" : ""}>Уже знаю · не спрашивать</option></select><input class="search" id="word-search" type="search" placeholder="Найти слово или перевод…" aria-label="Поиск по словарю" value="${esc(search)}"><button class="button small" id="words-import">＋ Добавить слова</button></div><div class="card table-wrap"><table class="word-table"><thead><tr><th>English</th><th>Русский</th><th>Прогресс</th></tr></thead><tbody id="word-rows"></tbody></table><div id="pagination" class="pagination"></div></div><p class="dictionary-note">Закреплённый термин — три верных ответа подряд без опечаток. Статус показан для направления ${state.settings.direction === 'en-ru' ? 'EN → RU' : 'RU → EN'}.<br>Несколько допустимых переводов разделяй точкой с запятой: <span class="inline-code">вывод; контакт</span>. Также распознаются списки через запятую и / с пробелами. Одного перевода достаточно; пояснения в скобках необязательны.</p><div class="dictionary-actions"><button class="text-button" id="export-words">↓ Выгрузить слова (CSV)</button><button class="text-button" id="reset-progress">Сбросить прогресс словаря</button><button class="text-button" id="delete-deck">Удалить словарь</button></div>`;
    $('word-filter').onchange = event => { wordFilter = event.target.value; wordPage = 0; renderWordRows(); };
    $('word-search').oninput = event => { search = event.target.value; wordPage = 0; renderWordRows(); };
    $('words-import').onclick = chooseFile;
    $('export-words').onclick = () => downloadCSV(d);
    $('reset-progress').onclick = () => confirmAction('Сбросить прогресс?', `Слова из «${d.name}» останутся. Статистика и очередь повторений в обоих направлениях начнутся заново.`, 'Сбросить', () => { d.progress = { 'en-ru': C.progress(), 'ru-en': C.progress() }; render(); toast('Прогресс словаря сброшен.'); });
    $('delete-deck').onclick = () => confirmAction('Удалить словарь?', `«${d.name}»: ${d.words.length} терминов и весь их прогресс будут удалены с этого устройства.`, 'Удалить', () => { state.decks = state.decks.filter(x => x.id !== d.id); state.activeId = state.decks[0]?.id || null; render(); });
    renderWordRows();
  }
  function renderWordRows() {
    const d = deck(), p = pstate();
    const filtered = d.words.filter(w => (wordFilter === 'all' || (wordFilter === 'excluded' ? w.excluded : !w.excluded)) && C.normalize(w.en + ' ' + w.ru).includes(C.normalize(search)));
    const pages = Math.max(1, Math.ceil(filtered.length / 40));
    wordPage = Math.min(wordPage, pages - 1);
    $('word-rows').innerHTML = filtered.length ? filtered.slice(wordPage * 40, wordPage * 40 + 40).map(w => {
      const stat = p.seen[w.id], known = stat?.streak >= 3;
      return `<tr><td lang="en">${esc(w.en)}${w.ipa ? `<span class="dictionary-ipa ipa">${esc(w.ipa)}</span>` : ""}</td><td lang="ru">${esc(w.ru)}${["en-ru", "ru-en"].map(dir => (w.aliases?.[dir] || []).map((alias, i) => `<span class="alias-list">Мой вариант ${dir === "en-ru" ? "RU" : "EN"}: ${esc(alias)} <button class="text-button" data-remove-alias="${esc(w.id)}" data-dir="${dir}" data-index="${i}" aria-label="Удалить свой вариант ${esc(alias)}">×</button></span>`).join("")).join("")}</td><td><span class="word-status ${known ? 'mastered' : ''}">${w.excluded ? 'Не спрашивать' : known ? '✓ Закреплено' : stat ? 'В работе · ' + Math.min(stat.streak, 3) + '/3' : 'Новое'}</span><button class="button small exclude-toggle" data-toggle-excluded="${esc(w.id)}">${w.excluded ? 'Вернуть в тренировку' : 'Уже знаю · исключить'}</button></td></tr>`;
    }).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Ничего не найдено</td></tr>';
    document.querySelectorAll('[data-toggle-excluded]').forEach(button => { button.onclick = () => { const w = d.words.find(w => w.id === button.dataset.toggleExcluded); C.setExcluded(d, w.id, !w.excluded); save(); renderWordRows(); }; });
    document.querySelectorAll('[data-remove-alias]').forEach(button => { button.onclick = () => { const w = d.words.find(w => w.id === button.dataset.removeAlias); w.aliases[button.dataset.dir].splice(Number(button.dataset.index), 1); for (const dir of ['en-ru', 'ru-en']) { const q = d.progress[dir].question; if (q && !q.outcome) q.options = C.choices(d.words.find(w => w.id === q.wordId), dir, d.words); } save(); renderWordRows(); }; });
    $('pagination').innerHTML = `<button class="button small" id="prev-page" aria-label="Предыдущая страница" ${wordPage === 0 ? 'disabled' : ''}>←</button><span>${number(filtered.length)} терминов · ${wordPage + 1} / ${pages}</span><button class="button small" id="next-page" aria-label="Следующая страница" ${wordPage === pages - 1 ? 'disabled' : ''}>→</button>`;
    $('prev-page').onclick = () => { wordPage--; renderWordRows(); };
    $('next-page').onclick = () => { wordPage++; renderWordRows(); };
  }
  function addDemo() {
    const rows = [
      ['interrupt', 'прерывание'], ['pull-up resistor', 'подтягивающий резистор'], ['clock frequency', 'тактовая частота'], ['buffer overflow', 'переполнение буфера'], ['register', 'регистр'], ['firmware', 'прошивка; встроенное программное обеспечение'], ['power supply', 'источник питания; питание'], ['sampling rate', 'частота дискретизации'], ['direct memory access', 'прямой доступ к памяти'], ['watchdog timer', 'сторожевой таймер'], ['baud rate', 'скорость передачи в бодах'], ['rising edge', 'нарастающий фронт; передний фронт'], ['falling edge', 'спадающий фронт; задний фронт'], ['duty cycle', 'коэффициент заполнения'], ['input impedance', 'входное сопротивление; входной импеданс'], ['ground', 'земля; общий провод'], ['threshold', 'порог; пороговое значение'], ['latency', 'задержка'], ['throughput', 'пропускная способность'], ['timeout', 'тайм-аут; время ожидания'], ['checksum', 'контрольная сумма'], ['stack pointer', 'указатель стека'], ['volatile memory', 'энергозависимая память'], ['peripheral', 'периферийное устройство']
    ];
    const d = C.makeDeck('Пример · Embedded English', C.cleanRows(rows).words);
    state.decks.push(d); state.activeId = d.id; view = 'study'; render();
  }
  function chooseFile() { $('file-input').value = ''; $('file-input').click(); }
  function xml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Повреждённый XML внутри Excel. Пересохрани файл в формате .xlsx.');
    return doc;
  }
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  function richText(node) { return tags(node, 't').filter(t => !t.parentElement || t.parentElement.localName !== 'rPh').map(t => t.textContent).join(''); }
  function zipPath(target) {
    const parts = (target.startsWith('/') ? target.slice(1) : 'xl/' + target).split('/'), result = [];
    for (const part of parts) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part); }
    return result.join('/');
  }
  async function readWorkbook(buffer) {
    let zip;
    try { zip = await JSZip.loadAsync(buffer); } catch (_) { throw new Error('Не удалось прочитать Excel. Используй обычный .xlsx без пароля. Старый .xls нужно пересохранить как .xlsx.'); }
    const total = Object.values(zip.files).reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0);
    if (total > 80 * 1024 * 1024) throw new Error('В распакованном файле слишком много данных. Скопируй две колонки в отдельный Excel.');
    const get = async path => { const file = zip.file(path); if (!file) throw new Error('Не найдена часть Excel: ' + path); const text = await file.async('string'); if (text.length > 40 * 1024 * 1024) throw new Error('Лист слишком большой. Раздели его на части.'); return xml(text); };
    const workbook = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
    const relationships = new Map(tags(rels, 'Relationship').filter(r => r.getAttribute('TargetMode') !== 'External').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const sharedRel = tags(rels, 'Relationship').find(r => /\/sharedStrings$/.test(r.getAttribute('Type') || ''));
    const sharedPath = sharedRel ? zipPath(sharedRel.getAttribute('Target')) : 'xl/sharedStrings.xml';
    const shared = zip.file(sharedPath) ? tags(await get(sharedPath), 'si').map(richText) : [];
    const sheets = tags(workbook, 'sheet').map(s => { const id = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id'); const target = relationships.get(id); return target ? { name: s.getAttribute('name'), path: zipPath(target) } : null; }).filter(s => s && zip.file(s.path));
    if (!sheets.length) throw new Error('В файле нет доступных листов Excel.');
    return { names: sheets.map(s => s.name), async rows(index) {
      const doc = await get(sheets[index].path), rows = [];
      for (const row of tags(doc, 'row')) {
        const pair = ['', '', ''];
        let nextColumn = 0;
        for (const cell of tags(row, 'c')) {
          const ref = cell.getAttribute('r'), match = ref && /^([A-Z]+)[0-9]+$/i.exec(ref);
          let col = nextColumn;
          if (match) { col = 0; for (const c of match[1].toUpperCase()) col = col * 26 + c.charCodeAt(0) - 64; col--; }
          nextColumn = col + 1;
          if (col > 2) continue;
          const type = cell.getAttribute('t'), raw = tags(cell, 'v')[0]?.textContent || '';
          pair[col] = type === 's' ? shared[Number(raw)] || '' : type === 'inlineStr' ? richText(cell) : type === 'e' ? '' : raw;
        }
        rows.push(pair);
        if (rows.length > 100000) throw new Error('В листе больше 100 000 строк. Удали лишние строки или раздели файл.');
      }
      return rows;
    } };
  }
  function splitCSV(text, delimiter) {
    const rows = [], row = [];
    let value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { value += '"'; i++; }
        else if (quoted || value === '') quoted = !quoted;
        else value += c;
      } else if (c === delimiter && !quoted) { row.push(value); value = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(value); rows.push(row.splice(0)); value = '';
      } else value += c;
    }
    if (quoted) throw new Error('В CSV не закрыта кавычка. Пересохрани файл в Excel или используй .xlsx.');
    if (value || row.length) { row.push(value); rows.push(row); }
    return rows;
  }
  function readCSV(buffer, name) {
    let text;
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 255 && bytes[1] === 254) text = new TextDecoder('utf-16le').decode(buffer);
    else if (bytes[0] === 254 && bytes[1] === 255) text = new TextDecoder('utf-16be').decode(buffer);
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
      catch (_) { text = new TextDecoder('windows-1251').decode(buffer); }
    }
    text = text.replace(/^\uFEFF/, '');
    const separator = /^sep=(.)\r?\n/i.exec(text);
    if (separator) { text = text.slice(separator[0].length); return splitCSV(text, separator[1]); }
    const delimiters = /\.tsv$/i.test(name) ? ['\t'] : ['\t', ';', ','];
    const candidates = [];
    for (const delimiter of delimiters) {
      try { candidates.push({ delimiter, rows: splitCSV(text, delimiter) }); } catch (_) { /* Try the other CSV dialects before rejecting the file. */ }
    }
    if (!candidates.length) throw new Error('В CSV не закрыта кавычка. Пересохрани файл в Excel или используй .xlsx.');
    candidates.forEach(c => { const sample = c.rows.filter(row => row.some(v => v.trim())).slice(0, 30); c.score = sample.reduce((sum, row) => sum + ((row.length === 2 || row.length === 3) ? 5 : row.length > 3 ? 1 : -3), 0); });
    return candidates.sort((a, b) => b.score - a.score)[0].rows;
  }
  async function handleFile(file) {
    if (!file) return;
    const token = ++currentFileToken;
    if (file.size > 20 * 1024 * 1024) return showError('Файл больше 20 МБ. Сохрани только колонки A и B в отдельный Excel.');
    modal('Открываем файл…', '<div class="loading">Читаем слова на твоём устройстве.</div>');
    try {
      const buffer = await file.arrayBuffer();
      if (token !== currentFileToken) return;
      if (/\.json$/i.test(file.name)) {
        const restored = C.restore(JSON.parse(new TextDecoder().decode(buffer)));
        const count = restored.decks.reduce((sum, d) => sum + d.words.length, 0);
        confirmAction('Восстановить резервную копию?', `В копии ${restored.decks.length} словарей и ${count} терминов. Текущие словари и прогресс будут заменены данными из копии.`, 'Восстановить', () => { stopPractice(); state = restored; view = 'study'; render(); toast('Словари и прогресс восстановлены.'); });
        return;
      }
      let workbook;
      if (/\.(xlsx|xlsm)$/i.test(file.name)) workbook = await readWorkbook(buffer);
      else if (/\.(csv|tsv|txt)$/i.test(file.name)) { const rows = readCSV(buffer, file.name); workbook = { names: ['Слова'], rows: async () => rows }; }
      else throw new Error('Поддерживаются .xlsx, .xlsm, .csv и .tsv. Старый .xls пересохрани в Excel как .xlsx.');
      if (token !== currentFileToken) return;
      pending = { workbook, sheet: 0, name: file.name.replace(/\.[^.]+$/, ''), result: null, token };
      await previewImport();
    } catch (error) { if (token === currentFileToken) showError(error.message || 'Проверь формат файла и попробуй ещё раз.'); }
  }
  async function previewImport() {
    const data = pending;
    const result = C.cleanRows(await data.workbook.rows(data.sheet));
    if (data.token !== currentFileToken) return;
    data.result = result;
    const extra = [result.empty ? `без пары: ${result.empty}` : '', result.duplicates ? `дубликатов: ${result.duplicates}` : '', result.headers ? 'заголовки убраны' : ''].filter(Boolean).join(' · ');
    modal('Проверим слова перед стартом', `<p class="modal-copy">A → английский, B → русский, C → транскрипция (необязательно). Форматирование убрано.</p>${data.workbook.names.length > 1 ? `<label class="field">Лист Excel<select id="sheet-select">${data.workbook.names.map((name, i) => `<option value="${i}" ${i === data.sheet ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>` : ''}<label class="field">Название словаря<input id="deck-name" maxlength="100" value="${esc(data.name)}"></label>${deck() ? `<label class="field">Куда добавить<select id="import-destination"><option value="new">Создать отдельный словарь</option><option value="append">Дополнить «${esc(deck().name)}»</option></select></label>` : ''}<div class="preview"><table class="preview-table"><thead><tr><th>English · A</th><th>Русский · B</th><th>Транскрипция · C</th></tr></thead><tbody>${result.words.slice(0, 5).map(w => `<tr><td>${esc(w.en)}</td><td>${esc(w.ru)}</td><td class="ipa">${esc(w.ipa || "—")}</td></tr>`).join('') || '<tr><td colspan="3">На этом листе нет пар слов. Проверь колонки A и B.</td></tr>'}</tbody></table></div><p class="import-note"><strong>${number(result.words.length)} ${plural(result.words.length, "термин готов", "термина готовы", "терминов готовы")}</strong>${extra ? '<br>Пропущено: ' + esc(extra) : ''}<br>Допустимые переводы разделяй <strong>;</strong>, например: <span class="inline-code">вывод; контакт</span>.</p>`, `<button class="button" id="import-cancel">Отмена</button><button class="button primary" id="import-confirm" ${!result.words.length ? 'disabled' : ''}>Добавить и учить →</button>`);
    $('import-cancel').onclick = () => $('modal').close();
    if ($('sheet-select')) $('sheet-select').onchange = async event => {
      data.name = $('deck-name').value; data.sheet = Number(event.target.value);
      $('import-confirm').disabled = true;
      try { await previewImport(); } catch (error) { showError(error.message); }
    };
    $('import-confirm').onclick = () => {
      stopPractice();
      let added = result.words.length, updated = 0;
      if ($('import-destination')?.value === 'append') {
        const d = deck(), incoming = [], patches = [];
        const index = new Map();
        for (const w of d.words) for (const alias of C.variants(w.en)) index.set(C.normalize(alias), w);
        for (const word of result.words) {
          const existing = C.variants(word.en).map(alias => index.get(C.normalize(alias))).find(Boolean);
          if (existing) patches.push([existing, word]);
          else { incoming.push(word); for (const alias of C.variants(word.en)) index.set(C.normalize(alias), word); }
        }
        if (d.words.length + incoming.length > 20000) { toast('В одном словаре может быть до 20 000 терминов. Создай отдельный словарь.'); return; }
        for (const [existing, word] of patches) {
          const aliases = [...new Map([...C.variants(existing.ru), ...C.variants(word.ru)].map(v => [C.normalize(v), v])).values()];
          existing.ru = aliases.join('; ');
          if (word.ipa) existing.ipa = word.ipa;
        }
        updated = patches.length;
        d.words.push(...incoming); added = incoming.length;
        for (const dir of ['en-ru', 'ru-en']) {
          const p = d.progress[dir];
          p.bag = C.shuffle([...p.bag, ...incoming.map(w => w.id)]);
          if (p.question && !p.question.outcome) p.question.options = C.choices(d.words.find(w => w.id === p.question.wordId), dir, d.words);
        }
      } else {
        if (state.decks.length >= 100) { toast('Можно хранить до 100 словарей. Дополни существующий.'); return; }
        const d = C.makeDeck($('deck-name').value.trim(), result.words); state.decks.push(d); state.activeId = d.id;
      }
      $('modal').close(); pending = null; view = 'study'; search = ''; wordPage = 0; render(); toast(`Добавлено терминов: ${added}.${updated ? ' Обновлено: ' + updated + ', прогресс сохранён.' : ' Можно начинать!'}`);
    };
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function downloadCSV(d, template = false) {
    const rows = template ? [['English', 'Русский', 'Транскрипция (IPA)'], ['interrupt', 'прерывание', '/ˌɪntəˈrʌpt/'], ['pin', 'вывод; контакт', '/pɪn/'], ['clock frequency', 'тактовая частота', '/klɑk ˈfrikwənsi/']] : [['English', 'Русский', 'Транскрипция (IPA)'], ...d.words.map(w => [[w.en, ...(w.aliases?.['ru-en'] || [])].join('; '), [w.ru, ...(w.aliases?.['en-ru'] || [])].join('; '), w.ipa || ''])];
    const protect = value => /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
    const text = rows.map(row => row.map(v => '"' + protect(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    download(template ? 'example_words.csv' : 'my_words.csv', '\uFEFF' + text, 'text/csv;charset=utf-8');
  }
  function backup() {
    modal('Твой словарь — с тобой', '<p class="modal-copy">Словари, статистика и очередь повторений хранятся в этом браузере. Для переноса между телефоном и ПК скачай копию.</p><div class="backup-options"><button class="button" id="export-json"><span>↓ Резервная копия (.json)<small>Все словари и прогресс. Восстанови через «Загрузить копию».</small></span></button><button class="button" id="export-html"><span>↓ HTML с моим прогрессом<small>Готовый файл: открой на другом устройстве и продолжай учить.</small></span></button><button class="button" id="restore-json"><span>↑ Загрузить копию<small>Восстановить словари и прогресс из .json.</small></span></button></div>');
    $('export-json').onclick = () => { save(); download('technowords_backup_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(state, null, 2), 'application/json'); toast('Резервная копия подготовлена.'); };
    $('restore-json').onclick = chooseFile;
    $('export-html').onclick = () => {
      save();
      const clone = document.documentElement.cloneNode(true); clone.querySelectorAll('[data-ai]').forEach(node => node.remove());
      clone.querySelector('#portable-state').textContent = JSON.stringify(state).replace(/</g, '\\u003c');
      clone.querySelector('#main').replaceChildren();
      const dialog = clone.querySelector('#modal'); dialog.removeAttribute('open'); dialog.querySelector('#modal-content').replaceChildren();
      clone.querySelector('#toast').hidden = true;
      download('TechnoWords_with_progress.html', '<!doctype html>\n' + clone.outerHTML, 'text/html;charset=utf-8');
      toast('HTML с твоими словами и прогрессом подготовлен.');
    };
  }
  function help() {
    modal('Как пользоваться', `<div class="modal-copy"><ol><li><strong>Подготовь Excel.</strong> В A — английский, в B — русский, в C — транскрипция (IPA, необязательно). Заголовки «English / Русский» необязательны. Подойдут .xlsx, .xlsm, CSV и TSV. Старый .xls пересохрани как .xlsx.</li><li><strong>Добавь слова.</strong> Выбери лист, проверь предпросмотр и создай словарь или дополни текущий. Пустые пары и одинаковые строки пропускаются.</li><li><strong>Выбери режим.</strong> Четыре варианта или ввод с клавиатуры. EN → RU и RU → EN имеют отдельный прогресс и очередь повторений.</li><li><strong>Допустимые ответы.</strong> Разделяй синонимы точкой с запятой, переносом строки или знаком |. Регистр, лишние пробелы, ё/е и точка в конце не важны. Одного указанного перевода достаточно. Пояснение в скобках можно не писать. Одна замена, пропуск, лишняя буква или перестановка соседних букв засчитывается с подсветкой и повтором написания. Изменённые цифры и другой термин из словаря не засчитываются как опечатки. Тренажёр не угадывает произвольные синонимы.</li><li><strong>Навигация и переходы.</strong> На главную можно вернуться через логотип или «Главная». После верного ответа без опечатки следующий вопрос открывается через 1,5 секунды. Кнопка «Следующий» работает сразу; «Пауза» останавливает переход на текущем ответе, флажок над карточкой отключает его полностью.</li><li><strong>Сложные слова.</strong> Ошибки и опечатки попадают в отдельный раздел. Список отсортирован по ошибкам. Можно тренировать всю группу или отдельное слово до трёх верных ответов подряд. История остаётся после закрепления.</li><li><strong>Прогресс.</strong> Большой счётчик показывает слова хотя бы с одним верным ответом. «Закреплено» — три верных ответа подряд без опечаток; после ошибки серия начинается заново.</li><li><strong>Повторение.</strong> Ошибка и «Не знаю» возвращают слово после 20–30 других ответов в том же направлении. Если все слова ждут повтора, добавь новые или явно выбери «Повторить раньше».</li><li><strong>Сохранение.</strong> Продолжай в том же браузере. Приватный режим, очистка данных и перенос файла могут удалить доступ к сохранению. «Резервная копия» сохраняет слова и прогресс в JSON или прямо в HTML.</li></ol><p><strong>На Android:</strong> сохрани HTML на телефон и открой в браузере через файловый менеджер. Если открывается только просмотр кода, выбери приложение, которое открывает HTML как веб-страницу. Интернет и установка приложения для работы тренажёра не нужны.</p><p>Файл работает без внешних шрифтов, скриптов и сетевых запросов. Данные не отправляются на сервер.</p></div>`, '<button class="button" id="sample-csv">↓ Пример для Excel</button><button class="button primary" id="help-ok">Всё понятно</button>');
    $('sample-csv').onclick = () => downloadCSV(null, true);
    $('help-ok').onclick = () => $('modal').close();
  }
  $('import-top').onclick = chooseFile;
  $('file-input').onchange = event => handleFile(event.target.files[0]);
  $('nav-home').onclick = () => navigate('home');
  $('nav-study').onclick = () => navigate('study');
  $('nav-words').onclick = () => navigate('words');
  $('nav-hard').onclick = () => navigate('hard');
  $('brand').onclick = event => { event.preventDefault(); navigate('home'); };
  $('help-button').onclick = help;
  $('backup-button').onclick = backup;
  $('modal').addEventListener('click', event => { const box = $('modal').getBoundingClientRect(); if (event.target === $('modal') && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) $('modal').close(); });
  $('modal').addEventListener('close', () => { currentFileToken++; });
  document.addEventListener('keydown', event => {
    if ($('modal').open || $('ai-panel')?.open || view !== 'study' || !deck() || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    const target = event.target;
    if (['SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    const q = question();
    if (event.key === 'Enter' && q?.outcome && target.tagName !== 'BUTTON') { event.preventDefault(); advance(); return; }
    if (target.tagName === 'INPUT') return;
    if (state.settings.mode === 'choice' && /^[1-4]$/.test(event.key) && !q?.outcome) {
      const option = document.querySelector(`[data-option="${Number(event.key) - 1}"]`);
      if (option) { event.preventDefault(); option.click(); }
    }
  });
  let dragDepth = 0;
  document.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; document.body.classList.add('drop-active'); } });
  document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop-active'); } });
  document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; document.body.classList.remove('drop-active'); if (event.dataTransfer?.files.length) handleFile(event.dataTransfer.files[0]); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAutoAdvance(); });
  window.addEventListener('pagehide', () => { cancelAutoAdvance(); save(); });
  render();
})();
