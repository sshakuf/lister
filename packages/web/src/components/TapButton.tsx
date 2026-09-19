import { useRef } from "react";
import { markToolbarTouch } from "../ui";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { onTap: () => void };

/**
 * A button that fires on `touchend` on touch screens and on `click` with a mouse, never both.
 * Preventing the default on touchend stops iOS Safari from moving focus (which would close the keyboard)
 * and from synthesizing the mouse events; mousedown is prevented for the same reason on desktop.
 */
export function TapButton({ onTap, children, ...rest }: Props) {
  const touched = useRef(false);
  return (
    <button
      type="button"
      tabIndex={-1}
      {...rest}
      onTouchStart={() => {
        touched.current = true;
        markToolbarTouch();
      }}
      onTouchEnd={(e) => {
        if (rest.disabled) return;
        e.preventDefault();
        markToolbarTouch();
        onTap();
      }}
      onTouchCancel={() => {
        touched.current = false;
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (touched.current) {
          touched.current = false;
          return;
        }
        onTap();
      }}
    >
      {children}
    </button>
  );
}
