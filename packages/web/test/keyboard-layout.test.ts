import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardLayout } from '../src/keyboard-layout.ts';

test('toolbar tracks the visible viewport including iOS panning', () => {
  assert.deepEqual(keyboardLayout(844, { height: 360, offsetTop: 92 }), { top: 452, keyboard: true });
  assert.deepEqual(keyboardLayout(844, { height: 844, offsetTop: 0 }), { top: 844, keyboard: false });
  assert.deepEqual(keyboardLayout(500), { top: 500, keyboard: false });
});
