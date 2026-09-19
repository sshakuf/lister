import type { Completion } from "../format";

interface Props {
  completion: Completion;
  selected: number;
  onHover(i: number): void;
  onPick(i: number): void;
}

/** Popup under a bullet listing annotation kinds that match what was typed after `[`. */
export function AnnotationMenu({ completion, selected, onHover, onPick }: Props) {
  return (
    <div className="ac-menu" role="listbox" onMouseDown={(e) => e.preventDefault()}>
      {completion.matches.map((m, i) => (
        <div
          key={m.kind}
          role="option"
          aria-selected={i === selected}
          className={`ac-item ${i === selected ? "selected" : ""}`}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(i)}
        >
          <span className={`ac-kind kind-${m.kind}`}>
            <b>{m.kind.slice(0, completion.query.length)}</b>
            {m.kind.slice(completion.query.length)}
          </span>
          <span className="ac-hint">{m.hint}</span>
        </div>
      ))}
      <div className="ac-foot">↑↓ choose · Enter/Tab insert · Esc close · type <b>:</b> to continue</div>
    </div>
  );
}
