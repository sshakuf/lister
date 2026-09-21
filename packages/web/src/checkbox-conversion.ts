import type { Bullet } from './types';
import { addCheckbox, checkState } from './format';

/** Only one level, independent of which rows happen to be expanded onscreen. */
export function checkboxChanges(bullet: Bullet, children = bullet.children): { id: string; before: string; text: string }[] {
  return [bullet, ...children].filter(b => checkState(b.text) === null).map(b => {
    const text = addCheckbox(b.text);
    return { id: b.id, before: b.text, text: checkState(text) === null ? `[checkbox:]${b.text}` : text };
  });
}
