import { ChangeEvent, KeyboardEvent, useMemo, useState } from "react";

// Reusable autocomplete input backed by a caller-supplied list of known
// string values -- see #67's "SuggestionCombobox (new component)"
// Implementation Decision and CONTEXT.md's "Suggestion Combobox" glossary
// entry. This component is intentionally domain-agnostic: it knows nothing
// about Tags, Merchants, or Categories -- callers seed `knownValues` with
// whichever list is relevant and interpret the commit/create-new callbacks
// themselves.
//
// Two modes:
//  - "single": one value, typing replaces it (Payee/Category's eventual
//    usage, #72/#73).
//  - "multi": existing selections render as removable chips; typing and
//    committing adds a new chip (Tags' usage, this issue).
export type SuggestionComboboxMode = "single" | "multi";

export interface SuggestionComboboxProps {
  mode: SuggestionComboboxMode;
  // The full list of known values to prefix-match against (e.g. every
  // existing Tag name). Matching is case-insensitive, matching how
  // Tags/Merchants/Categories are compared elsewhere (e.g. `tags::get_or_create`).
  knownValues: string[];
  // Current selection(s). Single mode: 0 or 1 entries, used to seed the
  // input's initial text. Multi mode: rendered as chips; the component
  // never mutates this list itself -- callers own it and re-render with a
  // new array in response to onCommit/onCreateNew/onRemove.
  values: string[];
  // Fires when the committed text (ghosted or literal) matches a known
  // value -- called with that known value's canonical casing.
  onCommit: (value: string) => void;
  // Fires instead of onCommit when the committed text matches no known
  // value. The component does not gate this on a confirmation step --
  // that responsibility belongs entirely to the caller.
  onCreateNew: (value: string) => void;
  // Escape: discard the typed draft and any ghost, commit nothing.
  onCancel: () => void;
  // Optional "move to next cell" hook invoked after every commit
  // (matched or created). Grid callers wire this to their own nav logic;
  // callers that want to allow adding several chips in a row (e.g. Tags)
  // can simply omit it so the editor stays open.
  onAdvance?: () => void;
  // Multi mode only: fired when a chip's remove control is clicked.
  onRemove?: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  autoFocus?: boolean;
}

function findTopMatch(knownValues: string[], trimmedDraft: string): string | undefined {
  if (trimmedDraft === "") return undefined;
  const lower = trimmedDraft.toLowerCase();
  return (
    knownValues.find((v) => v.toLowerCase() === lower) ??
    knownValues.find((v) => v.toLowerCase().startsWith(lower))
  );
}

export function SuggestionCombobox({
  mode,
  knownValues,
  values,
  onCommit,
  onCreateNew,
  onCancel,
  onAdvance,
  onRemove,
  ariaLabel,
  placeholder,
  autoFocus = true,
}: SuggestionComboboxProps) {
  const [draft, setDraft] = useState(mode === "single" ? values[0] ?? "" : "");

  const trimmedDraft = draft.trim();
  const topMatch = useMemo(
    () => findTopMatch(knownValues, trimmedDraft),
    [knownValues, trimmedDraft],
  );
  const ghostSuffix =
    topMatch && topMatch.length > trimmedDraft.length ? topMatch.slice(trimmedDraft.length) : "";

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setDraft(e.currentTarget.value);
  }

  function isDuplicate(candidate: string): boolean {
    if (mode !== "multi") return false;
    const lower = candidate.toLowerCase();
    return values.some((v) => v.toLowerCase() === lower);
  }

  function commit() {
    if (trimmedDraft === "") return;
    const matched = topMatch;
    const candidate = matched ?? trimmedDraft;
    if (!isDuplicate(candidate)) {
      if (matched) {
        onCommit(matched);
      } else {
        onCreateNew(trimmedDraft);
      }
    }
    setDraft("");
    onAdvance?.();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft("");
      onCancel();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit();
    }
  }

  return (
    <div className="suggestion-combobox">
      <div className="suggestion-combobox-input-wrap">
        <div className="suggestion-combobox-backdrop" aria-hidden="true">
          <span className="suggestion-ghost-typed">{draft}</span>
          <span className="suggestion-ghost-suffix">{ghostSuffix}</span>
        </div>
        <input
          type="text"
          className="suggestion-combobox-input"
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={draft}
          autoFocus={autoFocus}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </div>
      {mode === "multi" && values.length > 0 && (
        <div className="suggestion-chip-list">
          {values.map((value) => (
            <span key={value} className="suggestion-chip">
              {value}
              <button
                type="button"
                className="suggestion-chip-remove"
                aria-label={`Remove ${value}`}
                onClick={() => onRemove?.(value)}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
