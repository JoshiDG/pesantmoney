import { createContext, ReactNode, useCallback, useContext, useEffect, useRef } from "react";
import { isTextInputTarget } from "./grid-nav";

// The Reserved Shortcut Set (ADR-0020, issue #78): a closed, app-wide set of
// macOS-native modifier shortcuts (with Ctrl-equivalent fallbacks for
// Windows/Linux, per ADR-0020's "Platform scope" section) that no screen may
// repurpose. Concrete bindings -- see docs/ui-guidelines.md's "Reserved
// Shortcut Set and command palette" section:
//
//   Cmd/Ctrl+N -- new record appropriate to the current screen
//   Cmd/Ctrl+F -- focus the current screen's search/filter input
//   Cmd/Ctrl+, -- open Settings (handled at the App level, not per-screen)
//   Cmd/Ctrl+W -- close the current modal/panel
//   Escape     -- cancel/dismiss the current modal/panel/in-progress edit
//   Delete/Backspace -- delete the current selection
//
// Exactly one screen is ever mounted in <main class="content"> at a time
// (see App.tsx's ContentView union), so "the current screen" is always
// singular -- a screen calls `useReservedShortcuts` with the handlers for
// whichever of the above actions it actually has, and this provider keeps a
// single active handler set, swapped out whenever the mounted screen
// changes. Screens that have no "new record"/"search"/"delete selection"
// concept simply omit that handler -- this module never invents one.
export interface ReservedShortcutHandlers {
  // Create a new record appropriate to this screen (Cmd/Ctrl+N). Omit if
  // this screen has no "create new record" action.
  onNew?: () => void;
  // Focus this screen's search/filter input (Cmd/Ctrl+F). Omit if this
  // screen has no search/filter input.
  onFocusSearch?: () => void;
  // Close whatever modal/panel/in-progress edit is currently open, for both
  // Cmd/Ctrl+W and Escape. Must return whether it actually closed something,
  // so Escape can compose safely with other Escape-handling components
  // (e.g. ConfirmationProvider, ContextMenu, Dropdown) that manage their own
  // dismissal independently -- returning false here is always a safe no-op.
  onCloseModal?: () => boolean;
  // Delete whatever this screen's "current selection" concept selects
  // (Delete/Backspace). Omit if this screen has no selection concept (most
  // don't -- see docs/ui-guidelines.md).
  onDeleteSelection?: () => void;
}

interface ReservedShortcutContextValue {
  registerScreen: (handlers: ReservedShortcutHandlers) => () => void;
}

const ReservedShortcutContext = createContext<ReservedShortcutContextValue | null>(null);

function isModKey(e: KeyboardEvent): boolean {
  // Cmd on macOS, Ctrl fallback on Windows/Linux (ADR-0020: macOS-first, not
  // macOS-only).
  return e.metaKey || e.ctrlKey;
}

export function ReservedShortcutProvider({
  children,
  onOpenSettings,
}: {
  children: ReactNode;
  onOpenSettings: () => void;
}) {
  const handlersRef = useRef<ReservedShortcutHandlers>({});

  const registerScreen = useCallback((handlers: ReservedShortcutHandlers) => {
    handlersRef.current = handlers;
    return () => {
      if (handlersRef.current === handlers) {
        handlersRef.current = {};
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = isModKey(e);
      const isDeleteKey = e.key === "Delete" || e.key === "Backspace";
      if (!mod && e.key !== "Escape" && !isDeleteKey) {
        return;
      }

      // Escape is explicitly input-aware (ADR-0020's keyboard architecture):
      // it must still reach the current screen's close/cancel handler even
      // while a text input has focus, so an in-progress form can be
      // dismissed without first blurring it. Every other reserved shortcut
      // is suppressed while a text input has focus, per #78's acceptance
      // criteria.
      if (e.key !== "Escape" && isTextInputTarget(e.target)) {
        return;
      }

      const handlers = handlersRef.current;

      if (mod && e.key.toLowerCase() === "n") {
        if (handlers.onNew) {
          e.preventDefault();
          handlers.onNew();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        if (handlers.onFocusSearch) {
          e.preventDefault();
          handlers.onFocusSearch();
        }
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        onOpenSettings();
        return;
      }
      if (mod && e.key.toLowerCase() === "w") {
        if (handlers.onCloseModal) {
          e.preventDefault();
          handlers.onCloseModal();
        }
        return;
      }
      if (e.key === "Escape") {
        if (handlers.onCloseModal?.()) {
          e.preventDefault();
        }
        return;
      }
      if (isDeleteKey) {
        if (handlers.onDeleteSelection) {
          e.preventDefault();
          handlers.onDeleteSelection();
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenSettings]);

  return (
    <ReservedShortcutContext.Provider value={{ registerScreen }}>
      {children}
    </ReservedShortcutContext.Provider>
  );
}

// Registers `handlers` as the active screen's Reserved Shortcut Set handlers
// for as long as the calling component is mounted. Re-registers on every
// render (cheap -- just a ref assignment) so handlers always close over
// fresh state, and hands control back to "no active handlers" on unmount.
export function useReservedShortcuts(handlers: ReservedShortcutHandlers): void {
  const ctx = useContext(ReservedShortcutContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.registerScreen(handlers);
  });
}
