interface Props { checked: boolean; onChange(checked: boolean): void }

export function Checkbox({ checked, onChange }: Props) {
  return <button type="button" className={`cb ${checked ? 'on' : ''}`} role="checkbox"
    aria-checked={checked} aria-label={checked ? 'Uncheck item' : 'Check item'}
    onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }}
    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
    onClick={e => { e.stopPropagation(); onChange(!checked); }}>
    <span className="cb-symbol" aria-hidden="true">{checked ? '✓' : ''}</span>
  </button>;
}
