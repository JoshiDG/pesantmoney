import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// The Command Palette's action registry (#77, ADR-0020's "Command Palette"
// term): a plain source -> commands map, additive across sources rather
// than exclusive like ReservedShortcuts' single active screen. Nav Rail
// destinations and the "New Transaction"/"New Account" cross-screen actions
// register under fixed source ids at the App level (see App.tsx); any
// screen can register its own commands later via `useCommands` without
// CommandPalette.tsx ever needing to change -- this is the acceptance
// criterion "future screen can add its own commands without modifying the
// palette's core code."
export interface Command {
  id: string;
  label: string;
  // A short group label shown next to the command in the palette (e.g.
  // "Navigate", "New"). Purely cosmetic.
  section?: string;
  // Extra terms that match this command without being displayed (e.g. a
  // nav destination's key, or a common synonym).
  keywords?: string[];
  run: () => void;
}

interface CommandRegistryContextValue {
  registerCommands: (sourceId: string, commands: Command[]) => () => void;
  subscribe: (listener: () => void) => () => void;
  getAll: () => Command[];
}

const CommandRegistryContext = createContext<CommandRegistryContextValue | null>(null);

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const sourcesRef = useRef<Map<string, Command[]>>(new Map());
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    listenersRef.current.forEach((listener) => listener());
  }, []);

  const registerCommands = useCallback(
    (sourceId: string, commands: Command[]) => {
      sourcesRef.current.set(sourceId, commands);
      notify();
      return () => {
        sourcesRef.current.delete(sourceId);
        notify();
      };
    },
    [notify],
  );

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getAll = useCallback(() => Array.from(sourcesRef.current.values()).flat(), []);

  const value = useMemo(
    () => ({ registerCommands, subscribe, getAll }),
    [registerCommands, subscribe, getAll],
  );

  return <CommandRegistryContext.Provider value={value}>{children}</CommandRegistryContext.Provider>;
}

/**
 * Registers `commands` under `sourceId`, replacing any previous
 * registration from the same source on every render (so commands can close
 * over up-to-date state/handlers), and removing them on unmount.
 */
export function useCommands(sourceId: string, commands: Command[]): void {
  const ctx = useContext(CommandRegistryContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.registerCommands(sourceId, commands);
  });
}

/** Live, deduped-by-registration list of every currently-registered command. */
export function useAllCommands(): Command[] {
  const ctx = useContext(CommandRegistryContext);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(() => forceRender((n) => n + 1));
  }, [ctx]);

  return ctx ? ctx.getAll() : [];
}
