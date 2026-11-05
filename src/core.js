(function (root) {
  'use strict';
  const uid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
  function variants(value) {
    const text = String(value ?? '').trim();
    const parts = []; let current = '', depth = 0;
    const sentence = text.length > 150 || /[.!?]\s+[A-ZА-ЯЁ]/.test(text) || /[.!?]$/.test(text) && text.split(/\s+/).length >= 7;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(') depth++;
      if (c === ')') depth = Math.max(0, depth - 1);
      const slash = c === '/' && (/\s/.test(text[i - 1] || '') || /\s/.test(text[i + 1] || '') || /[а-яё]/i.test(text[i - 1] || '') && /[а-яё]/i.test(text[i + 1] || ''));
      if (!depth && (/[;|\r\n]/.test(c) || c === ',' && !sentence || slash)) { if (current.trim()) parts.push(current.trim()); current = ''; }
      else current += c;
    }
    if (current.trim()) parts.push(current.trim());
    const result = [];
    for (const part of parts) {
      result.push(part);
      const base = part.replace(/\s*\([^()]*\)/g, '').trim();
      if (base && base !== part) result.push(base);
      const abbreviation = /^([A-ZА-ЯЁ.\d-]{2,})\s*\(([^()]+)\)$/.exec(part);
      if (abbreviation) result.push(abbreviation[2].trim());
      const dashExpansion = /^([A-ZА-ЯЁ.\d-]{2,})\s+[—–]\s+(.+)$/.exec(part);
      if (dashExpansion) result.push(dashExpansion[1], dashExpansion[2]);
    }
    return [...new Set(result.filter(Boolean))];
  }
  function editDistance(a, b) {
    a = Array.from(a); b = Array.from(b);
    if (Math.max(a.length, b.length) > 500) return Math.abs(a.length - b.length) + (a.join('') === b.join('') ? 0 : 2);
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + Number(a[i - 1] !== b[j - 1]));
      prev = row;
    }
    return prev[b.length];
  }
  function oneTypo(a, b) {
    if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
    if ((a.match(/\d+/g) || []).join('|') !== (b.match(/\d+/g) || []).join('|')) return false;
    if (a.length === b.length) {
      const different = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different.push(i);
      return different.length === 1 || different.length === 2 && different[1] === different[0] + 1 && a[different[0]] === b[different[1]] && a[different[1]] === b[different[0]];
    }
    if (a.length > b.length) [a, b] = [b, a];
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; } else { edits++; j++; if (edits > 1) return false; } }
    return true;
  }
  function compareAnswer(word, direction, words, value) {
    const targets = accepted(word, direction, words), input = normalize(value);
    const exact = targets.find(target => normalize(target) === input);
    if (exact !== undefined) return { kind: 'exact', correct: true, expected: exact };
    const typo = targets.find(target => oneTypo(input, normalize(target)));
    const targetColumn = columns(direction)[1];
    const anotherTranslation = typo && words.some(w => variants(w[targetColumn]).some(v => normalize(v) === input));
    if (typo && !anotherTranslation) return { kind: 'typo', correct: true, expected: typo };
    const closest = targets.slice().sort((a, b) => editDistance(input, normalize(a)) - editDistance(input, normalize(b)))[0];
    return { kind: 'wrong', correct: false, expected: closest || '' };
  }
  function diffText(value, expected) {
    const a = Array.from(normalize(value)), b = Array.from(normalize(expected));
    const answer = [], correct = [];
    if (Math.max(a.length, b.length) > 500) return { answer: [{ text: a.join(''), changed: true }], expected: [{ text: b.join(''), changed: true }] };
    const width = b.length + 1, matrix = new Uint16Array((a.length + 1) * width);
    const at = (i, j) => matrix[i * width + j];
    for (let i = 0; i <= a.length; i++) matrix[i * width] = i;
    for (let j = 0; j <= b.length; j++) matrix[j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) matrix[i * width + j] = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + Number(a[i - 1] !== b[j - 1]));
    let i = a.length, j = b.length;
    while (i || j) {
      if (i && j && a[i - 1] === b[j - 1]) { answer.push({ text: a[--i], changed: false }); correct.push({ text: b[--j], changed: false }); }
      else if (i && j && at(i, j) === at(i - 1, j - 1) + 1) { answer.push({ text: a[--i], changed: true }); correct.push({ text: b[--j], changed: true }); }
      else if (i && at(i, j) === at(i - 1, j) + 1) { answer.push({ text: a[--i], changed: true }); correct.push({ text: '·', changed: true, missing: true }); }
      else { answer.push({ text: '·', changed: true, missing: true }); correct.push({ text: b[--j], changed: true }); }
    }
    return { answer: answer.reverse(), expected: correct.reverse() };
  }
  function shuffle(items, random = Math.random) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
    return copy;
  }
  function progress() { return { answered: 0, correct: 0, seen: {}, reviews: [], bag: [], question: null, lastId: null }; }
  function fresh() { return { schema: 1, savedAt: 0, activeId: null, settings: { mode: 'choice', direction: 'en-ru', autoAdvance: true }, decks: [] }; }
  const columns = direction => direction === 'ru-en' ? ['ru', 'en'] : ['en', 'ru'];
  function accepted(word, direction, words) {
    const [source, target] = columns(direction);
    const prompt = normalize(variants(word[source])[0]);
    return [...new Set(words.filter(w => variants(w[source]).some(v => normalize(v) === prompt)).flatMap(w => [...variants(w[target]), ...(w.aliases?.[direction] || [])]))];
  }
  function addAlias(word, direction, value) {
    const text = String(value).trim();
    if (!['en-ru', 'ru-en'].includes(direction) || !text || text.length > 500) return false;
    const list = word.aliases?.[direction] || [];
    if (list.length >= 30 || [...variants(word[columns(direction)[1]]), ...list].some(v => normalize(v) === normalize(text))) return false;
    word.aliases = { ...word.aliases, [direction]: [...list, text] }; return true;
  }
  function choices(word, direction, words, random = Math.random) {
    const [, target] = columns(direction);
    const correct = accepted(word, direction, words);
    const used = new Set(correct.map(normalize));
    const wrong = [];
    for (const w of shuffle(words, random)) {
      if (w.excluded) continue;
      const options = variants(w[target]);
      // A term with even one valid alternative must never become a distractor.
      if (options.some(v => used.has(normalize(v)))) continue;
      const text = options[0];
      if (text) { wrong.push({ text, correct: false }); options.forEach(v => used.add(normalize(v))); }
      if (wrong.length === 3) break;
    }
    return shuffle([{ text: correct[0], correct: true }, ...wrong], random);
  }
  function next(deck, direction, random = Math.random) {
    const p = deck.progress[direction];
    if (p.question && deck.words.find(w => w.id === p.question.wordId)?.excluded) p.question = null;
    if (p.question && !p.question.outcome) return p.question;
    const existing = new Set(deck.words.filter(w => !w.excluded).map(w => w.id));
    p.reviews = p.reviews.filter(r => existing.has(r.wordId));
    const due = p.reviews.filter(r => r.due <= p.answered).sort((a, b) => a.due - b.due)[0];
    let wordId;
    if (due) wordId = due.wordId;
    else {
      const pending = new Set(p.reviews.map(r => r.wordId));
      const source = columns(direction)[0];
      const pendingPrompts = new Set(deck.words.filter(w => pending.has(w.id)).map(w => normalize(variants(w[source])[0])));
      const eligible = deck.words.filter(w => !w.excluded && !pending.has(w.id) && !pendingPrompts.has(normalize(variants(w[source])[0])));
      const valid = new Set(eligible.map(w => w.id));
      p.bag = p.bag.filter(id => valid.has(id));
      if (!p.bag.length) p.bag = shuffle(eligible.map(w => w.id), random);
      if (p.bag.length > 1 && p.bag[0] === p.lastId) [p.bag[0], p.bag[1]] = [p.bag[1], p.bag[0]];
      wordId = p.bag.shift();
    }
    if (!wordId) { p.question = null; return null; }
    p.question = { wordId, repeat: Boolean(due), options: choices(deck.words.find(w => w.id === wordId), direction, deck.words, random), outcome: null };
    return p.question;
  }
  function answer(deck, direction, value, random = Math.random, question = null, semantic = false) {
    const p = deck.progress[direction], q = question || p.question;
    if (!q || q.outcome) return null;
    const word = deck.words.find(w => w.id === q.wordId);
    if (!word || word.excluded) return null;
    const local = compareAnswer(word, direction, deck.words, value);
    const verdict = semantic === true && local.kind === 'wrong' && String(value).trim() ? { kind: 'semantic', correct: true, expected: String(value).trim() } : local;
    const correct = verdict.correct, needsReview = !correct || verdict.kind === 'typo';
    p.answered++;
    if (correct) p.correct++;
    const stat = p.seen[word.id] || { asked: 0, correct: 0, streak: 0, mistakes: 0 };
    stat.asked++; stat.correct += Number(correct); stat.streak = needsReview ? 0 : stat.streak + 1; stat.mistakes += Number(!correct);
    if (verdict.kind === 'typo') stat.typos = (stat.typos || 0) + 1;
    p.seen[word.id] = stat;
    p.reviews = p.reviews.filter(r => r.wordId !== word.id);
    let gap = null;
    if (needsReview) {
      const occupied = new Set(p.reviews.map(r => r.due));
      const slots = Array.from({ length: 11 }, (_, i) => p.answered + 20 + i).filter(n => !occupied.has(n));
      const due = slots[Math.floor(random() * slots.length)];
      gap = due - p.answered;
      p.reviews.push({ wordId: word.id, due, gap });
      p.bag = p.bag.filter(id => id !== word.id);
    }
    p.lastId = word.id;
    q.outcome = { ...verdict, answer: String(value), gap };
    return q.outcome;
  }
  function learningSummary(deck, direction) {
    const seen = deck.progress[direction].seen;
    const words = deck.words.filter(w => !w.excluded);
    return {
      answeredWords: words.filter(w => seen[w.id]?.asked > 0).length,
      correctWords: words.filter(w => seen[w.id]?.correct > 0).length,
      mastered: words.filter(w => seen[w.id]?.streak >= 3).length
    };
  }
  function difficultWords(deck, direction) {
    const seen = deck.progress[direction].seen;
    return deck.words.filter(w => !w.excluded && (seen[w.id]?.mistakes > 0 || seen[w.id]?.typos > 0)).map(word => {
      const stat = seen[word.id];
      return { word, mistakes: stat.mistakes || 0, typos: stat.typos || 0, streak: Math.min(3, stat.streak || 0), asked: stat.asked || 0 };
    }).sort((a, b) => b.mistakes - a.mistakes || b.typos - a.typos || a.streak - b.streak || a.word.en.localeCompare(b.word.en));
  }
  function practiceQuestion(deck, direction, ids, askedIds = [], lastId = null) {
    const selected = new Set(ids), asked = new Set(askedIds), p = deck.progress[direction];
    const candidates = difficultWords(deck, direction).filter(item => selected.has(item.word.id) && (!asked.has(item.word.id) || item.streak < 3));
    if (!candidates.length) return null;
    const word = (candidates.find(item => item.word.id !== lastId) || candidates[0]).word;
    return { wordId: word.id, repeat: true, options: choices(word, direction, deck.words), outcome: null };
  }
  function cleanRows(rows) {
    const words = [], keys = new Set();
    let empty = 0, duplicates = 0, headers = 0;
    const aHeaders = new Set(['english', 'english term', 'en', 'eng', 'английский', 'английское слово', 'англ', 'word', 'term', 'слово', 'термин']);
    const bHeaders = new Set(['russian', 'russian translation', 'ru', 'rus', 'русский', 'рус', 'перевод', 'translation', 'meaning', 'русский перевод']);
    let first = true, hasTranscription = true;
    for (const row of rows) {
      const en = String(row[0] ?? '').trim(), ru = String(row[1] ?? '').trim();
      if (!en && !ru) continue;
      if (first && aHeaders.has(normalize(en)) && bHeaders.has(normalize(ru))) { headers++; first = false; hasTranscription = !/^(topic|тема|category|категория)$/.test(normalize(row[2])); continue; }
      first = false;
      if (!en || !ru) { empty++; continue; }
      if (en.length > 4000 || ru.length > 4000) throw new Error('В ячейке больше 4000 символов. Раздели текст на отдельные термины.');
      const key = normalize(en) + '\u0000' + normalize(ru);
      if (keys.has(key)) { duplicates++; continue; }
      const ipa = hasTranscription ? String(row[2] ?? '').trim() : '';
      if (ipa.length > 8000) throw new Error('Транскрипция длиннее 8000 символов. Раздели фразу на части.');
      keys.add(key); words.push({ id: uid(), en, ru, ...(ipa ? { ipa } : {}) });
      if (words.length > 20000) throw new Error('В одном словаре можно сохранить до 20 000 терминов. Раздели файл на несколько частей.');
    }
    return { words, empty, duplicates, headers };
  }
  function makeDeck(name, words) { return { id: uid(), name: String(name).slice(0, 100) || 'Мой словарь', words, progress: { 'en-ru': progress(), 'ru-en': progress() } }; }
  function setExcluded(deck, wordId, excluded) {
    const word = deck.words.find(w => w.id === wordId);
    if (!word) return;
    const prompt = normalize(variants(word.en)[0]);
    const ids = new Set(deck.words.filter(w => normalize(variants(w.en)[0]) === prompt).map(w => { w.excluded = Boolean(excluded); return w.id; }));
    for (const dir of ['en-ru', 'ru-en']) {
      const p = deck.progress[dir];
      p.bag = p.bag.filter(id => !ids.has(id));
      if (excluded) {
        p.reviews = p.reviews.filter(r => !ids.has(r.wordId));
        if (p.question && ids.has(p.question.wordId)) p.question = null;
      }
      if (p.question && !p.question.outcome) p.question.options = choices(deck.words.find(w => w.id === p.question.wordId), dir, deck.words);
    }
  }
  function restore(raw) {
    if (!raw || raw.schema !== 1 || !Array.isArray(raw.decks) || raw.decks.length > 100) throw new Error('Это не резервная копия Технословаря.');
    const state = fresh();
    state.settings.mode = raw.settings?.mode === 'typing' ? 'typing' : 'choice';
    state.settings.direction = raw.settings?.direction === 'ru-en' ? 'ru-en' : 'en-ru';
    state.settings.autoAdvance = raw.settings?.autoAdvance !== false;
    const deckIds = new Set();
    state.decks = raw.decks.map(d => {
      if (!d || typeof d.id !== 'string' || deckIds.has(d.id) || !Array.isArray(d.words) || !d.words.length || d.words.length > 20000) throw new Error('Повреждённый словарь в копии.');
      deckIds.add(d.id);
      const wordIds = new Set();
      const words = d.words.map(w => {
        if (!w || typeof w.id !== 'string' || wordIds.has(w.id) || typeof w.en !== 'string' || typeof w.ru !== 'string' || !w.en.trim() || !w.ru.trim() || w.en.length > 4000 || w.ru.length > 4000) throw new Error('Повреждённый термин в копии.');
        wordIds.add(w.id);
        const word = { id: w.id, en: w.en, ru: w.ru, ...(typeof w.ipa === 'string' ? { ipa: w.ipa.slice(0, 8000) } : {}) };
        if (w.excluded === true) word.excluded = true;
        for (const dir of ['en-ru', 'ru-en']) if (Array.isArray(w.aliases?.[dir])) for (const alias of w.aliases[dir].slice(0, 30)) if (typeof alias === 'string') addAlias(word, dir, alias);
        return word;
      });
      const result = { id: d.id, name: String(d.name || 'Словарь').slice(0, 100), words, progress: {} };
      const excludedIds = new Set(words.filter(w => w.excluded).map(w => w.id));
      const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
      for (const dir of ['en-ru', 'ru-en']) {
        const src = d.progress?.[dir] || {}, p = progress();
        p.answered = count(src.answered); p.correct = Math.min(count(src.correct), p.answered);
        for (const [id, s] of Object.entries(src.seen || {})) if (wordIds.has(id) && s) p.seen[id] = { asked: count(s.asked), correct: count(s.correct), streak: count(s.streak), mistakes: count(s.mistakes), ...(count(s.typos) ? { typos: count(s.typos) } : {}) };
        p.reviews = (Array.isArray(src.reviews) ? src.reviews : []).filter(r => r && wordIds.has(r.wordId) && !excludedIds.has(r.wordId) && Number.isSafeInteger(r.due) && r.due >= 0).map(r => ({ wordId: r.wordId, due: r.due, gap: count(r.gap) }));
        p.bag = [...new Set(Array.isArray(src.bag) ? src.bag.filter(id => wordIds.has(id)) : [])];
        p.lastId = wordIds.has(src.lastId) ? src.lastId : null;
        const q = src.question;
        if (q && wordIds.has(q.wordId) && !excludedIds.has(q.wordId)) {
          const validOptions = Array.isArray(q.options) && q.options.length <= 4 && q.options.every(o => o && typeof o.text === 'string' && typeof o.correct === 'boolean');
          p.question = { wordId: q.wordId, repeat: Boolean(q.repeat), options: validOptions ? q.options.map(o => ({ text: o.text, correct: o.correct })) : choices(words.find(w => w.id === q.wordId), dir, words), outcome: q.outcome && typeof q.outcome.correct === 'boolean' ? { kind: ['exact', 'typo', 'wrong', 'semantic'].includes(q.outcome.kind) ? q.outcome.kind : q.outcome.correct ? 'exact' : 'wrong', correct: q.outcome.correct, expected: String(q.outcome.expected ?? ''), answer: String(q.outcome.answer ?? ''), gap: q.outcome.gap == null ? null : count(q.outcome.gap) } : null };
        }
        result.progress[dir] = p;
      }
      return result;
    });
    state.activeId = state.decks.some(d => d.id === raw.activeId) ? raw.activeId : state.decks[0]?.id || null;
    state.savedAt = Number(raw.savedAt) || 0;
    return state;
  }
  root.TrainerCore = { uid, normalize, variants, editDistance, oneTypo, compareAnswer, diffText, shuffle, progress, fresh, columns, accepted, addAlias, choices, next, answer, learningSummary, difficultWords, practiceQuestion, cleanRows, makeDeck, setExcluded, restore };
})(globalThis);
