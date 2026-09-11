import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface DropdownOption<T extends string | number = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface DropdownProps<T extends string | number = string> {
  trigger: React.ReactNode;
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  isActive?: boolean;
}

export function Dropdown<T extends string | number = string>({
  trigger,
  options,
  value,
  onChange,
  ariaLabel,
  isActive = false,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    if (open) {
      window.addEventListener("mousedown", handleClickOutside, true);
      window.addEventListener("keydown", handleKeyDown, true);
    }
    return () => {
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div ref={containerRef} className="custom-dropdown-container">
      <button
        type="button"
        className={`toolbar-icon-btn ${open ? "active" : ""} ${isActive ? "has-active-state" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={ariaLabel}
        aria-expanded={open}
        title={selectedOption ? `${ariaLabel}: ${selectedOption.label}` : ariaLabel}
      >
        {trigger}
        {isActive && <span className="active-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="custom-dropdown-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`custom-dropdown-item ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.icon && <span className="dropdown-item-icon" aria-hidden="true">{opt.icon}</span>}
                <span className="dropdown-item-label">{opt.label}</span>
                {isSelected && <Check className="dropdown-item-check" size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CustomSelectProps<T extends string | number = string> {
  options: DropdownOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
}

export function CustomSelect<T extends string | number = string>({
  options,
  value,
  onChange,
  placeholder = "Select...",
  ariaLabel,
  id,
  className = "",
  disabled = false,
  required = false,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    if (open) {
      window.addEventListener("mousedown", handleClickOutside, true);
      window.addEventListener("keydown", handleKeyDown, true);
    }
    return () => {
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div ref={containerRef} className={`custom-select-container ${className}`}>
      {/* Hidden native select for form integration, testing-library, and accessibility compatibility */}
      <select
        id={id}
        aria-label={ariaLabel}
        value={value == null ? "" : String(value)}
        disabled={disabled}
        required={required}
        onChange={(e) => {
          const val = e.target.value;
          const matchedOpt = options.find((opt) => String(opt.value) === val);
          if (matchedOpt) {
            onChange(matchedOpt.value);
          }
        }}
        tabIndex={-1}
        className="visually-hidden-select"
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={`custom-select-trigger ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        tabIndex={0}
      >
        <span className="select-trigger-label">
          {selectedOption ? (
            <>
              {selectedOption.icon && <span className="option-icon" aria-hidden="true">{selectedOption.icon}</span>}
              <span>{selectedOption.label}</span>
            </>
          ) : (
            <span className="placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDown className="select-trigger-chevron" size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className="custom-dropdown-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                className={`custom-dropdown-item ${isSelected ? "selected" : ""} ${
                  opt.disabled ? "disabled" : ""
                }`}
                onClick={() => {
                  if (!opt.disabled) {
                    onChange(opt.value);
                    setOpen(false);
                  }
                }}
              >
                {opt.icon && <span className="dropdown-item-icon" aria-hidden="true">{opt.icon}</span>}
                <span className="dropdown-item-label">{opt.label}</span>
                {isSelected && <Check className="dropdown-item-check" size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
