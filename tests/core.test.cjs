const assert = require('node:assert/strict');
const test = require('node:test');
require('../src/core.js');
const C = globalThis.TrainerCore;
const make = (n = 80) => C.makeDeck('Test', C.cleanRows(Array.from({ length: n }, (_, i) => [`term ${i}`, `перевод ${i}`])).words);
function rng(seed = 77) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

test('cleans headers, incomplete rows and exact duplicates without truncating phrases', () => {
  const result = C.cleanRows([['English', 'Русский'], [], [' rising edge ', ' нарастающий фронт; передний фронт '], ['RISING EDGE', 'нарастающий фронт; передний фронт'], ['empty', ''], ['', 'русский']]);
  assert.equal(result.words.length, 1); assert.equal(result.empty, 2); assert.equal(result.duplicates, 1); assert.equal(result.headers, 1);
  assert.equal(result.words[0].ru, 'нарастающий фронт; передний фронт');
});
test('accepts listed alternatives and harmless typography, preserves technical punctuation', () => {
  assert.equal(C.normalize('  ЁМКОСТЬ. '), C.normalize('емкость'));
  assert.equal(C.normalize('pull–up resistor'), C.normalize('pull-up resistor'));
  assert.notEqual(C.normalize('PA1'), C.normalize('PA 1'));
  assert.notEqual(C.normalize('I/O'), C.normalize('IO'));
  assert.deepEqual(C.variants('вывод; контакт | пин\nножка'), ['вывод', 'контакт', 'пин', 'ножка']);
});
test('identical prompts accept every imported translation; no valid translation is a distractor', () => {
  const d = C.makeDeck('synonyms', C.cleanRows([['pin', 'вывод; контакт'], ['pin', 'ножка'], ['register', 'регистр'], ['interrupt', 'прерывание'], ['voltage', 'напряжение'], ['contact', 'контакт; вывод']]).words);
  const w = d.words[0];
  assert.deepEqual(C.accepted(w, 'en-ru', d.words), ['вывод', 'контакт', 'ножка']);
  const options = C.choices(w, 'en-ru', d.words, rng());
  assert.equal(options.length, 4); assert.equal(options.filter(x => x.correct).length, 1);
  assert.ok(options.filter(x => !x.correct).every(x => !['вывод', 'контакт', 'ножка'].includes(x.text)));
  d.progress['en-ru'].question = { wordId: w.id, options, outcome: null };
  assert.equal(C.answer(d, 'en-ru', ' НОЖКА. ').correct, true);
});
test('an error returns only after 20–30 OTHER answers, never as an ordinary question', () => {
  const d = make(), p = d.progress['en-ru'], random = rng();
  const first = C.next(d, 'en-ru', random), id = first.wordId;
  const outcome = C.answer(d, 'en-ru', 'wrong', random), firstCount = p.answered;
  assert.ok(outcome.gap >= 20 && outcome.gap <= 30);
  for (let i = 0; i < outcome.gap; i++) {
    p.question = null;
    const q = C.next(d, 'en-ru', random);
    assert.notEqual(q.wordId, id);
    C.answer(d, 'en-ru', d.words.find(w => w.id === q.wordId).ru, random);
  }
  p.question = null;
  const repeat = C.next(d, 'en-ru', random);
  assert.equal(repeat.wordId, id); assert.equal(repeat.repeat, true); assert.equal(p.answered - firstCount, outcome.gap);
});
test('2000 mixed answers keep collision-free review slots and never show a pending term early', () => {
  const d = make(100), p = d.progress['en-ru'], random = rng(509);
  for (let i = 0; i < 2000; i++) {
    p.question = null;
    const pending = p.reviews.map(r => ({ ...r }));
    const q = C.next(d, 'en-ru', random);
    assert.ok(q);
    const scheduled = pending.find(r => r.wordId === q.wordId);
    if (scheduled) { assert.equal(scheduled.due, p.answered); assert.equal(q.repeat, true); }
    const value = i % 3 === 0 ? 'wrong' : d.words.find(w => w.id === q.wordId).ru;
    const outcome = C.answer(d, 'en-ru', value, random);
    if (!outcome.correct) assert.ok(outcome.gap >= 20 && outcome.gap <= 30);
    assert.equal(new Set(p.reviews.map(r => r.due)).size, p.reviews.length);
  }
});
test('answers are idempotent and progress is independent in both directions', () => {
  const d = make(4), p = d.progress['en-ru'];
  const q = C.next(d, 'en-ru');
  C.answer(d, 'en-ru', d.words.find(w => w.id === q.wordId).ru);
  assert.equal(C.answer(d, 'en-ru', 'again'), null);
  assert.equal(p.answered, 1); assert.equal(p.correct, 1); assert.equal(d.progress['ru-en'].answered, 0);
  const reverse = C.next(d, 'ru-en'); C.answer(d, 'ru-en', d.words.find(w => w.id === reverse.wordId).en);
  assert.equal(d.progress['ru-en'].correct, 1); assert.equal(p.correct, 1);
});
test('a tiny exhausted dictionary pauses instead of breaking the review interval', () => {
  const d = make(1), p = d.progress['en-ru']; C.next(d, 'en-ru'); C.answer(d, 'en-ru', ''); p.question = null;
  assert.equal(C.next(d, 'en-ru'), null); assert.equal(p.answered, 1);
});
test('duplicate source terms with different translations cannot bypass the review interval', () => {
  const d = C.makeDeck('same prompt', C.cleanRows([['pin', 'вывод'], ['pin', 'контакт'], ['register', 'регистр'], ['ground', 'земля']]).words);
  const p = d.progress['en-ru']; p.bag = d.words.map(w => w.id);
  const first = C.next(d, 'en-ru'); assert.equal(first.wordId, d.words[0].id);
  C.answer(d, 'en-ru', 'wrong'); p.question = null;
  const next = C.next(d, 'en-ru'); assert.notEqual(d.words.find(w => w.id === next.wordId).en, 'pin');
});
test('save round trip retains the exact question, feedback and future review', () => {
  const s = C.fresh(), d = make(6); s.decks.push(d); s.activeId = d.id;
  C.next(d, 'en-ru'); C.answer(d, 'en-ru', 'wrong');
  const restored = C.restore(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s);
  const p = restored.decks[0].progress['en-ru']; assert.equal(p.answered, 1); assert.ok(p.question.outcome); assert.equal(p.reviews.length, 1);
});
test('rejects malformed backups and duplicate word IDs', () => {
  assert.throws(() => C.restore({ schema: 8, decks: [] }));
  const s = C.fresh(), d = make(2); s.decks.push(d); d.words[1].id = d.words[0].id;
  assert.throws(() => C.restore(s));
});
test('accepts a single comma/slash alternative and ignores optional context in parentheses', () => {
  const d = C.makeDeck('alternatives', C.cleanRows([['interference', 'помехи, взаимное влияние (по контексту)', '/ˌɪntərˈfɪrəns/'], ['powertrain', 'силовая установка / система привода'], ['I/O', 'ввод/вывод']]).words);
  assert.equal(C.compareAnswer(d.words[0], 'en-ru', d.words, 'взаимное влияние').kind, 'exact');
  assert.equal(C.compareAnswer(d.words[0], 'en-ru', d.words, 'помехи').kind, 'exact');
  assert.equal(C.compareAnswer(d.words[1], 'en-ru', d.words, 'система привода').kind, 'exact');
  assert.equal(C.compareAnswer(d.words[1], 'en-ru', d.words, 'система').correct, false);
  assert.deepEqual(C.variants('I/O'), ['I/O']);
  assert.equal(d.words[0].ipa, '/ˌɪntərˈfɪrəns/');
});
test('one-letter substitution/insertion/deletion/transposition is accepted with a spelling review', () => {
  const d = C.makeDeck('spelling', C.cleanRows([['controller', 'контроллер'], ['signal', 'сигнал']]).words);
  for (const value of ['контролер', 'контролллер', 'контрорлер', 'контроллре']) {
    const p = d.progress['en-ru']; p.question = { wordId: d.words[0].id, options: [], outcome: null };
    const result = C.answer(d, 'en-ru', value);
    assert.equal(result.correct, true, value); assert.equal(result.kind, 'typo'); assert.ok(result.gap >= 20 && result.gap <= 30); assert.equal(p.seen[d.words[0].id].streak, 0);
    const diff = C.diffText(value, 'контроллер'); assert.ok(diff.answer.some(s => s.changed)); assert.ok(diff.expected.some(s => s.changed));
  }
  assert.equal(C.oneTypo('stm32', 'stm33'), false);
  assert.equal(C.compareAnswer(d.words[0], 'en-ru', d.words, 'сигнал').kind, 'wrong');
});
test('an error then one exact repeat is 1/3, and three exact answers are required for mastery', () => {
  const d = make(4), w = d.words[0], p = d.progress['en-ru'];
  const ask = value => { p.question = { wordId: w.id, options: [], outcome: null }; return C.answer(d, 'en-ru', value); };
  ask(w.ru); ask(w.ru); ask('wrong'); assert.equal(p.seen[w.id].streak, 0);
  ask(w.ru); assert.equal(p.seen[w.id].streak, 1); ask(w.ru); assert.equal(p.seen[w.id].streak, 2); ask(w.ru); assert.equal(p.seen[w.id].streak, 3);
});
test('old backups survive and new backups retain IPA, typo feedback, and mastery', () => {
  const s = C.fresh(), d = C.makeDeck('IPA', C.cleanRows([['drone', 'беспилотник', '/droʊn/']]).words); s.decks.push(d); s.activeId = d.id;
  d.progress['en-ru'].question = { wordId: d.words[0].id, repeat: false, options: [], outcome: null }; C.answer(d, 'en-ru', 'беспилотнк');
  assert.deepEqual(C.restore(JSON.parse(JSON.stringify(s))), s);
  delete s.decks[0].words[0].ipa; delete s.decks[0].progress['en-ru'].question.outcome.kind; delete s.decks[0].progress['en-ru'].question.outcome.expected;
  assert.equal(C.restore(s).decks[0].words[0].en, 'drone');
});
test('first correct answer and mastery are separate unique-word counters', () => {
  const d = make(4), p = d.progress['en-ru'], w = d.words[0];
  const ask = value => { p.question = { wordId: w.id, options: [], outcome: null }; C.answer(d, 'en-ru', value); };
  ask(w.ru); assert.deepEqual(C.learningSummary(d, 'en-ru'), { answeredWords: 1, correctWords: 1, mastered: 0 });
  ask(w.ru); ask(w.ru); assert.equal(C.learningSummary(d, 'en-ru').mastered, 1);
  ask('wrong'); assert.equal(C.learningSummary(d, 'en-ru').correctWords, 1); assert.equal(C.learningSummary(d, 'en-ru').mastered, 0);
  assert.equal(C.learningSummary(d, 'ru-en').correctWords, 0);
});
test('difficult words include old mistakes and new typos, stay sorted and keep mastered history', () => {
  const d = C.makeDeck('hard', C.cleanRows([['controller', 'контроллер'], ['signal', 'сигнал'], ['drone', 'беспилотник'], ['ground', 'земля']]).words), p = d.progress['en-ru'];
  const ask = (i, value) => { p.question = { wordId: d.words[i].id, options: [], outcome: null }; C.answer(d, 'en-ru', value); };
  ask(0, 'wrong'); ask(0, 'wrong'); ask(1, 'wrong'); ask(2, 'беспилотнк');
  let hard = C.difficultWords(d, 'en-ru'); assert.equal(hard.length, 3); assert.equal(hard[0].word.id, d.words[0].id); assert.equal(hard[0].mistakes, 2); assert.equal(hard[2].typos, 1);
  for (let i = 0; i < 3; i++) ask(0, 'контроллер');
  hard = C.difficultWords(d, 'en-ru'); assert.equal(hard[0].streak, 3); assert.equal(hard[0].mistakes, 2); assert.equal(C.difficultWords(d, 'ru-en').length, 0);
});
test('focused practice asks only selected difficult terms and preserves the ordinary question', () => {
  const d = make(5), p = d.progress['en-ru']; p.seen[d.words[0].id] = { asked: 1, correct: 0, streak: 0, mistakes: 1 };
  const normal = C.next(d, 'en-ru'), snapshot = JSON.stringify(normal), ids = [d.words[0].id]; let asked = [];
  for (let i = 0; i < 3; i++) {
    const q = C.practiceQuestion(d, 'en-ru', ids, asked); assert.equal(q.wordId, ids[0]); assert.equal(q.options.length, 4);
    C.answer(d, 'en-ru', d.words[0].ru, Math.random, q); asked = ids;
    assert.equal(JSON.stringify(p.question), snapshot);
  }
  assert.equal(C.practiceQuestion(d, 'en-ru', ids, asked), null); assert.equal(p.seen[ids[0]].streak, 3);
  assert.ok(C.practiceQuestion(d, 'en-ru', ids, [])); // Explicitly reviewing a mastered term still asks it once.
});
test('auto advance preference and typo counts round-trip with legacy defaults', () => {
  const s = C.fresh(), d = C.makeDeck('typo', C.cleanRows([['controller', 'контроллер']]).words); s.decks.push(d); s.activeId = d.id;
  C.next(d, 'en-ru'); C.answer(d, 'en-ru', 'контролер'); s.settings.autoAdvance = false;
  assert.deepEqual(C.restore(JSON.parse(JSON.stringify(s))), s);
  delete s.settings.autoAdvance; assert.equal(C.restore(s).settings.autoAdvance, true);
});
