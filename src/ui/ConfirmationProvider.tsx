import { createContext, ReactNode, useCallback, useContext, useState } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

interface PendingConfirmation extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface ConfirmationContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function settle(confirmed: boolean) {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }

  // Enter and Escape both resolve to Cancel regardless of which button has
  // focus -- the destructive action must only ever fire from an explicit
  // click (see docs/ui-guidelines.md, Confirmation and destructive actions).
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      settle(false);
    }
  }

  return (
    <ConfirmationContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="confirmation-overlay">
          <div
            className="confirmation-panel"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            aria-describedby="confirmation-message"
            onKeyDown={handleKeyDown}
          >
            <h2 id="confirmation-title" className="confirmation-title">
              {pending.title}
            </h2>
            <p id="confirmation-message" className="confirmation-message">
              {pending.message}
            </p>
            <div className="confirmation-actions">
              <button type="button" className="confirmation-destructive" onClick={() => settle(true)}>
                {pending.confirmLabel}
              </button>
              <button type="button" className="confirmation-cancel" autoFocus onClick={() => settle(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation(): ConfirmationContextValue {
  const ctx = useContext(ConfirmationContext);
  if (!ctx) {
    throw new Error("useConfirmation must be used within a ConfirmationProvider");
  }
  return ctx;
}
