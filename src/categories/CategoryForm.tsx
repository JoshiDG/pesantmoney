import { FormEvent, useState } from "react";
import { Category, CategoryFields, CategoryGroup } from "./types";
import { CustomSelect } from "../ui/Dropdown";

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
      <CustomSelect
        ariaLabel="Category group"
        options={groups.map((group) => ({ value: group.id, label: group.name }))}
        value={groupId}
        onChange={(val) => setGroupId(Number(val))}
      />
      <button type="submit">{initial ? "Save" : "Add category"}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}
