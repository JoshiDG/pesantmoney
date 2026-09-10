import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MerchantForm } from "./MerchantForm";
import { Merchant, MerchantFields } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";

export function MerchantsScreen() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();

  async function refresh() {
    try {
      const merchantList = await invoke<Merchant[]>("list_merchants");
      setMerchants(merchantList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(fields: MerchantFields) {
    try {
      await invoke("create_merchant", { ...fields });
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: MerchantFields) {
    try {
      await invoke("update_merchant", { id, ...fields });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(merchant: Merchant) {
    const confirmed = await confirm({
      title: "Delete Merchant",
      message: "Delete this merchant entry? This cannot be undone.",
      confirmLabel: "Delete Merchant",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_merchant", { id: merchant.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Merchants</h2>
          <div className="account-title-meta">
            Identify a clean merchant name from imported transaction descriptions
          </div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <ul className="rule-list">
        {merchants.map((merchant) =>
          editingId === merchant.id ? (
            <li key={merchant.id}>
              <MerchantForm
                initial={merchant}
                onSubmit={(fields) => handleUpdate(merchant.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={merchant.id} className="rule-row">
              <span className="rule-row-summary">
                &ldquo;{merchant.keyword}&rdquo; &rarr; {merchant.merchant_name}
              </span>
              <div className="row-actions">
                <button type="button" onClick={() => setEditingId(merchant.id)}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(merchant)}>
                  Delete
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <MerchantForm onSubmit={handleCreate} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add merchant
        </button>
      )}
    </section>
  );
}
