import { parseSegments, checkState, setChecked } from './format';

export interface EditPart {
  raw: string;
  start: number;
  value: string;
  kinds: string[];
  checked: boolean | null;
}
export const escapeLabel = (value: string) => value.replace(/[\\\[\]]/g, '\\$&');
const labelText = (p: EditPart, value: string) => `[${p.kinds.join(',')}:${escapeLabel(value)}]`;

/** Keep ordinary source intact; expose only the values of checkbox annotations. */
export function editParts(text: string): EditPart[] {
  const parts: EditPart[] = [];
  const re = /\\[\s\S]|\[(?:[^\[\]\\]|\\[\s\S])*\]/g;
  let start = 0;
  for (const match of text.matchAll(re)) {
    if (!match[0].startsWith('[')) continue;
    const s = parseSegments(match[0])[0];
    if (s?.kind !== 'annotation' || !s.kinds.some(k => k === 'checkbox' || k === 'checked')) continue;
    if (match.index > start) parts.push({ raw: text.slice(start, match.index), start, value: text.slice(start, match.index), kinds: [], checked: null });
    parts.push({ raw: match[0], start: match.index, value: s.value ?? '', kinds: s.kinds, checked: s.kinds.includes('checked') });
    start = match.index + match[0].length;
  }
  if (start < text.length || !parts.length) parts.push({ raw: text.slice(start), start, value: text.slice(start), kinds: [], checked: null });
  return parts;
}
export function replacePart(parts: EditPart[], index: number, value: string): string {
  return parts.map((p, i) => i !== index ? p.raw : p.checked === null ? value : labelText(p, value)).join('');
}
export function sourceCaret(p: EditPart, caret: number): number {
  return p.start + (p.checked === null ? caret : (p.raw.includes(':') ? p.raw.indexOf(':') + 1 : p.raw.length - 1) + escapeLabel(p.value.slice(0, caret)).length);
}
export function labelCaret(p: EditPart, caret: number): number {
  let i = 0;
  while (i < p.value.length && sourceCaret(p, i) < caret) i++;
  return i;
}
export function splitBullet(text: string, caret: number, selectionEnd = caret): { before: string; after: string } {
  const parts = editParts(text);
  const cut = (pos: number, side: 'before' | 'after') => {
    const p = parts.find(p => p.checked !== null && pos >= p.start && pos <= p.start + p.raw.length);
    if (!p) return side === 'before' ? text.slice(0, pos) : text.slice(pos);
    const i = labelCaret(p, pos);
    return side === 'before'
      ? text.slice(0, p.start) + labelText(p, p.value.slice(0, i))
      : labelText({ ...p, kinds: p.kinds.map(k => k === 'checked' ? 'checkbox' : k) }, p.value.slice(i)) + text.slice(p.start + p.raw.length);
  };
  const before = cut(caret, 'before');
  let after = cut(selectionEnd, 'after');
  if (checkState(text) !== null) after = setChecked(after, false);
  if (checkState(text) !== null && checkState(after) === null) after = `[checkbox:]${after}`;
  return { before, after };
}
