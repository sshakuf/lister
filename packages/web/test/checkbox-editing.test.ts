import test from 'node:test';
import assert from 'node:assert/strict';
import * as editing from '../src/checkbox-editing.ts';

test('checkbox labels are editable without exposing syntax and preserve styles', () => {
  const parts = editing.editParts('[bold,checked:מטען] tail [checkbox:two]');
  assert.deepEqual(parts.map(p => [p.value, p.checked]), [['מטען', true], [' tail ', null], ['two', false]]);
  assert.equal(editing.replacePart(parts, 0, 'new [label]'), '[bold,checked:new \\[label\\]] tail [checkbox:two]');
});
test('Enter splits checkbox labels into valid items and continues unchecked', () => {
  assert.deepEqual(editing.splitBullet('[checked:hello world]', 14), { before: '[checked:hello]', after: '[checkbox: world]' });
  assert.deepEqual(editing.splitBullet('[checked:hello]', 14), { before: '[checked:hello]', after: '[checkbox:]' });
  assert.deepEqual(editing.splitBullet('plain', 2), { before: 'pl', after: 'ain' });
});
test('editing escapes and an empty checkbox round trip', () => {
  const parts = editing.editParts('[checkbox:a \\[b\\] \\\\ c]');
  assert.equal(parts[0].value, 'a [b] \\ c');
  assert.equal(editing.replacePart(parts, 0, parts[0].value), '[checkbox:a \\[b\\] \\\\ c]');
  assert.equal(editing.editParts('[checkbox:]')[0].value, '');
});

test('source and label carets round trip escaped characters and normalized checkbox headers', () => {
  for (const source of ['[checkbox]', '[ checked :]', '[checkbox:a \\[b\\]]']) {
    const initial = editing.editParts(source);
    const next = editing.replacePart(initial, 0, 'ab [c]');
    const p = editing.editParts(next)[0];
    for (let i = 0; i <= p.value.length; i++) {
      assert.equal(editing.labelCaret(p, editing.sourceCaret(p, i)), i);
    }
  }
});

test('Enter removes selected label text, preserves escapes, and unchecks the new item', () => {
  const source = '[bold,checked:a \\[b\\] c]';
  const p = editing.editParts(source)[0];
  const split = editing.splitBullet(source, editing.sourceCaret(p, 2), editing.sourceCaret(p, 5));
  assert.deepEqual(split, { before: '[bold,checked:a ]', after: '[bold,checkbox: c]' });
});
