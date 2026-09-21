import test from 'node:test';
import assert from 'node:assert/strict';
import * as conversion from '../src/checkbox-conversion.ts';
import type { Bullet } from '../src/types.ts';

const bullet = (id: string, text: string, children: Bullet[] = []): Bullet => ({ id, text, children });

test('conversion includes only the selected bullet and direct children and preserves checked formatting', () => {
  const selected = bullet('parent', '[bold:Project]', [
    bullet('child', 'Task', [bullet('grandchild', 'Leave alone')]),
    bullet('checked', '[bold,checked:Finished]'),
    bullet('unchecked', '[checkbox:Already a task]'),
  ]);
  const before = structuredClone(selected);
  assert.deepEqual(conversion.checkboxChanges(selected), [
    { id: 'parent', before: '[bold:Project]', text: '[bold,checkbox:Project]' },
    { id: 'child', before: 'Task', text: '[checkbox:Task]' },
  ]);
  assert.deepEqual(selected, before);
});

test('folder children are supplied from their outline and conversion does not enter child folders', () => {
  const selected = { ...bullet('folder', 'Projects'), outline: 'otherfile' };
  const children = [{ ...bullet('subfolder', 'Subproject'), outline: 'deepfile' }, bullet('child', 'Task')];
  assert.deepEqual(conversion.checkboxChanges(selected, children).map(c => c.id), ['folder', 'subfolder', 'child']);
});

test('an empty bullet receives a usable checkbox', () => {
  assert.deepEqual(conversion.checkboxChanges(bullet('empty', '')), [{ id: 'empty', before: '', text: '[checkbox:]' }]);
});
