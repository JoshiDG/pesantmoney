import { FormEvent, useState } from "react";
import { CategoryGroup } from "./types";

interface CategoryGroupFormProps {
  initial?: CategoryGroup;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}

export function CategoryGroupForm({ initial, onSubmit, onCancel }: CategoryGroupFormProps) {
  const [name, setName] = useState(initial?.name ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(name);
  }

  return (
    <form onSubmit={handleSubmit} className="category-group-form">
      <input
        aria-label="Group name"
        placeholder="Group name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        required
      />
      <button type="submit">{initial ? "Save" : "Add group"}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}
