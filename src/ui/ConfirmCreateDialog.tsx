// Reusable "create new" confirmation dialog (see #67's "Create-new flow
// (new, reusable)" Implementation Decision and CONTEXT.md's Payee entry).
// Payee's instance (#72) is the plain yes/no variant: "Add '{name}' to your
// Merchant dictionary for future imports?", no extra field. #73's Category
// instance reuses this same component with `extraField` populated (a Group
// dropdown, defaulted to the most-recently-used Group) -- this component
// stays domain-agnostic, same as `SuggestionCombobox`: callers own the
// copy/labels/options and interpret onConfirm/onCancel themselves.
export interface ConfirmCreateDialogExtraField {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export interface ConfirmCreateDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Optional single dropdown rendered between the message and the action
  // buttons -- #73's Category-Group picker is the first real user of this,
  // unused (undefined) by #72's Payee/Merchant instance.
  extraField?: ConfirmCreateDialogExtraField;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmCreateDialog({
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "No",
  extraField,
  onConfirm,
  onCancel,
}: ConfirmCreateDialogProps) {
  return (
    <div className="confirm-create-overlay">
      <div
        className="confirm-create-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-create-title"
        aria-describedby="confirm-create-message"
      >
        <h2 id="confirm-create-title" className="confirm-create-title">
          {title}
        </h2>
        <p id="confirm-create-message" className="confirm-create-message">
          {message}
        </p>
        {extraField && (
          <label className="confirm-create-extra-field">
            {extraField.label}
            <select
              aria-label={extraField.label}
              value={extraField.value}
              onChange={(e) => extraField.onChange(e.currentTarget.value)}
            >
              {extraField.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="confirm-create-actions">
          <button type="button" className="confirm-create-confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="confirm-create-cancel" autoFocus onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
