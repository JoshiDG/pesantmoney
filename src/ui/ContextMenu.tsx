import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  // When set (true or false), the item renders as a checkbox-style menu
  // item (role="menuitemcheckbox", reflecting this checked state) instead
  // of a plain action item. Used by Column Management (#68) to show a
  // checklist of Column Set columns.
  checked?: boolean;
  // Defaults to true (matches every pre-existing caller's expectation that
  // clicking an item closes the menu). Column Management sets this to
  // false so multiple columns can be toggled in one right-click
  // interaction without the menu closing after each click.
  closeOnClick?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

  const menuWidth = 185;
  const menuHeight = items.length * 36 + 12;
  const adjustedX = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const adjustedY = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
          aria-checked={item.checked !== undefined ? item.checked : undefined}
          className={`context-menu-item ${item.danger ? "context-menu-item--danger" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            if (item.closeOnClick !== false) {
              onClose();
            }
            item.onClick();
          }}
        >
          {item.checked !== undefined && (
            <span className="context-menu-checkbox" aria-hidden="true">
              {item.checked ? "✓" : ""}
            </span>
          )}
          {item.icon && <span className="context-menu-icon" aria-hidden="true">{item.icon}</span>}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
