import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useAllCommands } from "./CommandRegistry";
import { fuzzyFilter } from "./fuzzy";

// The global Command Palette (#77, ADR-0020's primary keyboard interaction
// model): Cmd/Ctrl+K opens it from anywhere, fuzzy-searching every
// registered Command (Nav Rail destinations + cross-screen actions, see
// App.tsx's `useCommands("core-nav", ...)` / `useCommands("core-actions",
// ...)` calls). Escape closes it; arrow keys + Enter select.
//
// This component owns its own open/close state and its own Cmd+K/Escape/
// arrow-key handling, following the same self-contained pattern already
// used by ContextMenu.tsx and Dropdown.tsx (a capture-phase window
// `keydown` listener) rather than going through ReservedShortcuts' single
// "active screen" registration -- the palette is a global overlay, not a
// per-screen modal, and it must keep working no matter which screen is
// mounted underneath it.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useAllCommands();
  const results = useMemo(() => fuzzyFilter(query, commands), [query, commands]);

  function close() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function runCommand(index: number) {
    const command = results[index];
    if (!command) return;
    close();
    command.run();
  }

  // Cmd/Ctrl+K opens the palette from anywhere -- deliberately not gated by
  // `isTextInputTarget` (per #77's acceptance criteria, "invocable from
  // anywhere"): a modifier chord like this never inserts a character into a
  // focused input, so it's safe to always intercept, the same way editors
  // like VS Code treat their own command-palette chord.
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Escape/ArrowUp/ArrowDown/Enter are scoped to the palette itself while
  // it's open, via a capture-phase listener (matching ContextMenu.tsx /
  // Dropdown.tsx) so these keys never leak through to a focused input or
  // grid underneath -- the acceptance criterion "never intercepts keystrokes
  // intended for a focused text input outside itself" is satisfied by the
  // palette owning and consuming these keys only while it is the thing with
  // focus (its own search input).
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        runCommand(activeIndex);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, activeIndex]);

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette-overlay" onMouseDown={close}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="command-palette-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            aria-label="Search commands"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <ul className="command-palette-results" role="listbox" aria-label="Command results">
          {results.length === 0 && <li className="command-palette-empty">No matching commands</li>}
          {results.map((command, index) => (
            <li key={command.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={`command-palette-item${index === activeIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(index)}
              >
                <span>{command.label}</span>
                {command.section && <span className="command-palette-section">{command.section}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
