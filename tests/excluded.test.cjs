const test = require('node:test'), assert = require('node:assert/strict');
require('../src/core.js'); const C = globalThis.TrainerCore;
const make = () => C.makeDeck('test', C.cleanRows([['link', 'ссылка'], ['LINK', 'связь'], ['tree', 'дерево'], ['signal', 'сигнал'], ['current', 'ток'], ['firmware', 'прошивка'], ['voltage', 'напряжение']]).words);
test('excluding a known word removes both directions, duplicate prompts, reviews and choices, keeping history', () => {
  const d = make(), w = d.words[0];
  for (const dir of ['en-ru', 'ru-en']) {
    const p = d.progress[dir]; p.question = { wordId: w.id, options: C.choices(w, dir, d.words), outcome: null };
    C.answer(d, dir, 'wrong');
  }
  const history = JSON.stringify(d.progress['en-ru'].seen);
  C.setExcluded(d, w.id, true);
  assert.ok(d.words[0].excluded && d.words[1].excluded);
  assert.equal(JSON.stringify(d.progress['en-ru'].seen), history);
  assert.equal(C.difficultWords(d, 'en-ru').length, 0);
  for (const dir of ['en-ru', 'ru-en']) {
    assert.equal(d.progress[dir].reviews.length, 0);
    for (let i = 0; i < 100; i++) {
      const q = C.next(d, dir); assert.ok(!d.words.find(w => w.id === q.wordId).excluded);
      assert.ok(q.options.every(o => !['link', 'LINK', 'ссылка', 'связь'].includes(o.text)));
      const word = d.words.find(w => w.id === q.wordId); C.answer(d, dir, C.accepted(word, dir, d.words)[0]);
    }
  }
  C.setExcluded(d, w.id, false); assert.equal(C.difficultWords(d, 'en-ru').length, 1);
});
test('all-excluded state is recoverable and round trips through backups', () => {
  const d = make(); for (const w of d.words) C.setExcluded(d, w.id, true);
  assert.equal(C.next(d, 'en-ru'), null); assert.equal(C.next(d, 'ru-en'), null);
  const seed = C.fresh(); seed.decks = [d]; seed.activeId = d.id;
  const restored = C.restore(JSON.parse(JSON.stringify(seed))).decks[0]; assert.ok(restored.words.every(w => w.excluded));
  C.setExcluded(restored, restored.words[2].id, false); assert.equal(C.next(restored, 'en-ru').wordId, restored.words[2].id);
  assert.deepEqual(C.learningSummary(d, 'en-ru'), { answeredWords: 0, correctWords: 0, mastered: 0 });
});
