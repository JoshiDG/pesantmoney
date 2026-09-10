import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CategoryForm } from "./CategoryForm";
import { CategoryGroupForm } from "./CategoryGroupForm";
import { Category, CategoryFields, CategoryGroup } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";

export function CategoriesScreen() {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [addingCategoryForGroupId, setAddingCategoryForGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();

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

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Categories</h2>
          <div className="account-title-meta">Group your transactions for budgeting and reports</div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

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
                <div className="row-actions">
                  <button type="button" onClick={() => setAddingCategoryForGroupId(group.id)}>
                    Add category
                  </button>
                  <button type="button" onClick={() => setEditingGroupId(group.id)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDeleteGroup(group)}>
                    Delete
                  </button>
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
                    <li key={category.id} className="category-row">
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
