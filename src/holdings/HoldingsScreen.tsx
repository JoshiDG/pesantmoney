import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { HoldingForm } from "./HoldingForm";
import { PriceForm } from "./PriceForm";
import { formatCents, Holding, HoldingFields, HoldingWithValue } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";

interface HoldingsScreenProps {
  account: Account;
}

export function HoldingsScreen({ account }: HoldingsScreenProps) {
  const [holdings, setHoldings] = useState<HoldingWithValue[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pricingTicker, setPricingTicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();

  async function refresh() {
    try {
      const holdingList = await invoke<HoldingWithValue[]>("list_holdings_with_values", {
        account_id: account.id,
      });
      setHoldings(holdingList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    setEditingId(null);
    setPricingTicker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  async function handleCreate(fields: HoldingFields) {
    try {
      await invoke("create_holding", { account_id: account.id, ...fields });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: HoldingFields) {
    try {
      await invoke("update_holding", { id, ...fields });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(holding: Holding) {
    const confirmed = await confirm({
      title: "Delete Holding",
      message: `Delete this holding ("${holding.ticker}")? This cannot be undone.`,
      confirmLabel: "Delete Holding",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_holding", { id: holding.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleSetPrice(priceCents: number, asOfDate: string) {
    if (!pricingTicker) {
      return;
    }
    try {
      await invoke("set_security_price", {
        ticker: pricingTicker,
        price_cents: priceCents,
        as_of_date: asOfDate,
      });
      setPricingTicker(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const totalValueCents = holdings.reduce((sum, h) => sum + (h.value_cents ?? 0), 0);
  const hasUnpriced = holdings.some((h) => h.value_cents == null);

  return (
    <section>
      {error && <p role="alert">{error}</p>}

      <div className="holdings-total">
        <span className="holdings-total-label">Total value</span>
        <span className="holdings-total-value">{formatCents(totalValueCents)}</span>
        {hasUnpriced && (
          <span className="holdings-unpriced-note">
            Excludes holdings with no price yet — see below
          </span>
        )}
      </div>

      <div className="holdings-list">
        <div className="holdings-head">
          <span>Ticker</span>
          <span>Quantity</span>
          <span>Price</span>
          <span>Value</span>
          <span></span>
        </div>

        {holdings.map((holding) =>
          editingId === holding.id ? (
            <HoldingForm
              key={holding.id}
              initial={holding}
              onSubmit={(fields) => handleUpdate(holding.id, fields)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="holdings-row" key={holding.id}>
              <span className="cell-ticker">{holding.ticker}</span>
              <span>{holding.quantity}</span>
              <span className="cell-price">
                {holding.price_cents != null ? (
                  <>
                    {formatCents(holding.price_cents)}
                    <span className="price-as-of"> as of {holding.as_of_date}</span>
                  </>
                ) : (
                  <span className="price-missing">No price yet</span>
                )}
              </span>
              <span className="amount credit">
                {holding.value_cents != null ? formatCents(holding.value_cents) : "—"}
              </span>
              <span className="row-actions">
                <button type="button" onClick={() => setPricingTicker(holding.ticker)}>
                  Update price
                </button>
                <button type="button" onClick={() => setEditingId(holding.id)}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(holding)}>
                  Delete
                </button>
              </span>
            </div>
          ),
        )}

        {pricingTicker && (
          <div className="price-form-row">
            <PriceForm ticker={pricingTicker} onSubmit={handleSetPrice} onCancel={() => setPricingTicker(null)} />
          </div>
        )}

        <HoldingForm onSubmit={handleCreate} />
      </div>
    </section>
  );
}
