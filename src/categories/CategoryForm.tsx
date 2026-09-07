import { FormEvent, useState } from "react";
import { Category, CategoryFields, CategoryGroup } from "./types";

interface CategoryFormProps {
  groups: CategoryGroup[];
  initial?: Category;
  defaultGroupId?: number;
  onSubmit: (fields: CategoryFields) => void;
  onCancel?: () => void;
}

export function CategoryForm({ groups, initial, defaultGroupId, onSubmit, onCancel }: CategoryFormProps) {
  const [groupId, setGroupId] = useState(
    initial?.group_id ?? defaultGroupId ?? groups[0]?.id ?? 0,
  );
  const [name, setName] = useState(initial?.name ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ group_id: groupId, name });
  }

  return (
    <form onSubmit={handleSubmit} className="category-form">
      <input
        aria-label="Category name"
        placeholder="Category name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        required
      />
      <select
        aria-label="Category group"
        value={groupId}
        onChange={(e) => setGroupId(Number(e.currentTarget.value))}
      >
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      <button type="submit">{initial ? "Save" : "Add category"}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}
