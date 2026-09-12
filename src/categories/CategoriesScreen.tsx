import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CategoryForm } from "./CategoryForm";
import { CategoryGroupForm } from "./CategoryGroupForm";
import { Category, CategoryFields, CategoryGroup } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { isTextInputTarget, nextCellForKey } from "../ui/grid-nav";
import { selectRowRange, toggleRowSelection } from "../ui/selection";

export function CategoriesScreen() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [addingCategoryForGroupId, setAddingCategoryForGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Row selection (ADR-0020's generalized grid primitive, #76): a Set of
  // selected Category ids plus a shift-click range anchor, same semantics as
  // TransactionsGrid's checkbox selection -- feeds the "Delete selected" bulk
  // action below. `orderedCategoryIds` mirrors the exact group-by-group,
  // insertion order the list below renders in, since `selectRowRange` walks
  // that order to resolve a shift-click range.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  // Keyboard row cursor (#76): ArrowUp/ArrowDown move the native DOM focus
  // between category rows via `nextCellForKey` (colCount fixed at 1 -- these
  // rows have no per-cell column structure, unlike TransactionsGrid). Kept as
  // refs, not React state, since navigating never needs to swap out the
  // underlying row DOM node (only entering edit mode does).
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const { confirm } = useConfirmation();

  const orderedCategoryIds = useMemo(
    () =>
      groups.flatMap((group) =>
        categories.filter((category) => category.group_id === group.id).map((category) => category.id),
      ),
    [groups, categories],
  );

  async function refresh() {
    try {
      const [groupList, categoryList] = await Promise.all([
        invoke<CategoryGroup[]>("list_category_groups"),
        invoke<Category[]>("list_categories"),
      ]);
      setGroups(groupList);
      setCategories(categoryList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreateGroup(name: string) {
    try {
      await invoke("create_category_group", { name });
      setAddingGroup(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdateGroup(id: number, name: string) {
    try {
      await invoke("update_category_group", { id, name });
      setEditingGroupId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDeleteGroup(group: CategoryGroup) {
    const confirmed = await confirm({
      title: "Delete Group",
      message: `Delete the group "${group.name}" and all its categories? This cannot be undone.`,
      confirmLabel: "Delete Group",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_category_group", { id: group.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleCreateCategory(fields: CategoryFields) {
    try {
      await invoke("create_category", { ...fields });
      setAddingCategoryForGroupId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdateCategory(id: number, fields: CategoryFields) {
    try {
      await invoke("update_category", { id, ...fields });
      setEditingCategoryId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDeleteCategory(category: Category) {
    const confirmed = await confirm({
      title: "Delete Category",
      message: `Delete the category "${category.name}"? Transactions using it become uncategorized.`,
      confirmLabel: "Delete Category",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_category", { id: category.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  function toggleSelectCategory(categoryId: number, shiftKey: boolean) {
    if (shiftKey && anchorId != null) {
      setSelected(selectRowRange(orderedCategoryIds, anchorId, categoryId));
      return;
    }
    setSelected((prev) => toggleRowSelection(prev, categoryId));
    setAnchorId(categoryId);
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: "Delete Categories",
      message: `Delete ${ids.length} selected ${ids.length === 1 ? "category" : "categories"}? Transactions using them become uncategorized.`,
      confirmLabel: "Delete Categories",
    });
    if (!confirmed) {
      return;
    }
    try {
      for (const id of ids) {
        await invoke("delete_category", { id });
      }
      setSelected(new Set());
      setAnchorId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Scoped bare single-letter shortcut (ADR-0020: active only while a
  // category row has keyboard focus, never global, never firing while a
  // text input is focused -- `isTextInputTarget` guards that last case even
  // though this handler is only ever attached to the row element itself,
  // since a keydown inside a nested focusable/editable control still
  // bubbles up to it). `e` opens the focused row for editing -- the
  // highest-frequency in-grid action on this screen (renaming/re-grouping a
  // Category is far more common than deleting one).
  function handleRowKeyDown(e: KeyboardEvent<HTMLLIElement>, category: Category) {
    if (isTextInputTarget(e.target)) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const currentIndex = orderedCategoryIds.indexOf(category.id);
      const next = nextCellForKey({ row: currentIndex, col: 0 }, e.key, orderedCategoryIds.length, 1);
      const nextId = orderedCategoryIds[next.row];
      rowRefs.current[nextId]?.focus();
      return;
    }
    if (e.key === "e") {
      e.preventDefault();
      setEditingCategoryId(category.id);
    }
  }

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Categories</h2>
          <div className="account-title-meta">Group your transactions for budgeting and reports</div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      {selected.size > 0 && (
        <div className="bulk-actions-bar">
          <span>{selected.size} selected</span>
          <button type="button" onClick={handleDeleteSelected}>
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set());
              setAnchorId(null);
            }}
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="category-groups">
        {groups.map((group) => (
          <div className="category-group" key={group.id}>
            {editingGroupId === group.id ? (
              <CategoryGroupForm
                initial={group}
                onSubmit={(name) => handleUpdateGroup(group.id, name)}
                onCancel={() => setEditingGroupId(null)}
              />
            ) : (
              <div className="category-group-header">
                <h3>{group.name}</h3>
                <div className="category-group-actions">
                  <button type="button" onClick={() => setAddingCategoryForGroupId(group.id)}>
                    Add category
                  </button>
                  <div className="row-actions">
                    <button type="button" onClick={() => setEditingGroupId(group.id)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDeleteGroup(group)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            <ul className="category-list">
              {categories
                .filter((category) => category.group_id === group.id)
                .map((category) =>
                  editingCategoryId === category.id ? (
                    <li key={category.id}>
                      <CategoryForm
                        groups={groups}
                        initial={category}
                        onSubmit={(fields) => handleUpdateCategory(category.id, fields)}
                        onCancel={() => setEditingCategoryId(null)}
                      />
                    </li>
                  ) : (
                    <li
                      key={category.id}
                      className={`category-row${selected.has(category.id) ? " category-row-selected" : ""}`}
                      tabIndex={0}
                      ref={(el) => {
                        rowRefs.current[category.id] = el;
                      }}
                      onKeyDown={(e) => handleRowKeyDown(e, category)}
                    >
                      <input
                        type="checkbox"
                        className="row-select-checkbox"
                        aria-label={`Select ${category.name}`}
                        checked={selected.has(category.id)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleSelectCategory(category.id, e.shiftKey);
                        }}
                        onChange={() => {}}
                      />
                      <span className="category-row-name">{category.name}</span>
                      <div className="row-actions">
                        <button type="button" onClick={() => setEditingCategoryId(category.id)}>
                          Edit
                        </button>
                        <button type="button" onClick={() => handleDeleteCategory(category)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  ),
                )}
            </ul>

            {addingCategoryForGroupId === group.id && (
              <CategoryForm
                groups={groups}
                defaultGroupId={group.id}
                onSubmit={handleCreateCategory}
                onCancel={() => setAddingCategoryForGroupId(null)}
              />
            )}
          </div>
        ))}
      </div>

      {addingGroup ? (
        <CategoryGroupForm onSubmit={handleCreateGroup} onCancel={() => setAddingGroup(false)} />
      ) : (
        <button type="button" onClick={() => setAddingGroup(true)}>
          Add group
        </button>
      )}
    </section>
  );
}
