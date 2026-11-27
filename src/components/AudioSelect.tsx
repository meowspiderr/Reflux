import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, ChevronDown } from "lucide-react";

export interface AudioSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface AudioSelectProps {
  value: string;
  options: AudioSelectOption[];
  label: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  showHint?: boolean;
}

export function AudioSelect({
  value,
  options,
  label,
  onChange,
  disabled = false,
  showHint = false,
}: AudioSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[selectedIndex]?.focus({ preventScroll: true });

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, selectedIndex]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const activeIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
    let nextIndex = activeIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % options.length;
    else nextIndex = (activeIndex - 1 + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus({ preventScroll: true });
  };

  const selected = options[selectedIndex];

  return (
    <div className="audio-quality" ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        className="audio-quality-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={selected?.hint ? `${label}: ${selected.label}, ${selected.hint}` : `${label}: ${selected?.label ?? value}`}
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span>
          {selected?.label ?? value}
          {showHint && selected?.hint ? ` — ${selected.hint}` : ""}
        </span>
        <ChevronDown size={12} strokeWidth={2} className="audio-quality-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          className="audio-quality-menu"
          role="listbox"
          aria-label={label}
          onKeyDown={moveFocus}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                role="option"
                aria-selected={isSelected}
                className={`audio-quality-option${isSelected ? " is-selected" : ""}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => choose(option.value)}
              >
                <span className="audio-quality-option-label">{option.label}</span>
                {option.hint ? (
                  <span className="audio-quality-option-rate">{option.hint}</span>
                ) : null}
                {isSelected ? <Check size={12} strokeWidth={2.2} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
