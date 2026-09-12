import { useEffect, useRef } from "react";

// The grid's own keyboard-shortcut reference, opened by `?` while a grid
// cell has focus (#92, ADR-0020's "Scoped bare single-letter shortcuts").
// Reuses the ConfirmCreateDialog's overlay/panel chrome (`.confirm-create-*`
// in App.css) rather than inventing new modal styling for a one-off list.
// Dismisses the same way ContextMenu does: Escape or a click outside the
// panel.
export interface ShortcutsOverlayProps {
  onClose: () => void;
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "↑ ↓ ← →", description: "Move focus one cell" },
  { keys: "Tab / Shift+Tab", description: "Next / previous cell" },
  { keys: "Home / End", description: "First / last cell in row" },
  { keys: "Ctrl+Home / Ctrl+End", description: "First / last cell in grid" },
  { keys: "Page Up / Page Down", description: "Jump 10 rows" },
  { keys: "Enter / F2", description: "Edit the focused cell" },
  { keys: "j / k", description: "Move row selection down / up" },
  { keys: "x", description: "Toggle the focused row's checkbox" },
  { keys: "/", description: "Focus search" },
  { keys: "?", description: "Show this shortcut list" },
];

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  return (
    <div className="confirm-create-overlay">
      <div
        ref={panelRef}
        className="confirm-create-panel shortcuts-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <h2 className="confirm-create-title">Keyboard shortcuts</h2>
        <dl className="shortcuts-overlay-list">
          {SHORTCUTS.map(({ keys, description }) => (
            <div className="shortcuts-overlay-row" key={keys}>
              <dt className="shortcuts-overlay-keys">{keys}</dt>
              <dd className="shortcuts-overlay-description">{description}</dd>
            </div>
          ))}
        </dl>
        <div className="confirm-create-actions">
          <button type="button" className="confirm-create-cancel" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
