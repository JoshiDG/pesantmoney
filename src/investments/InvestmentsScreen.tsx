import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { HoldingForm } from "../holdings/HoldingForm";
import { PriceForm } from "../holdings/PriceForm";
import { formatCents, Holding, HoldingFields, HoldingWithAccount } from "../holdings/types";
import { useBreakpoint } from "../ui/BreakpointProvider";
import { useConfirmation } from "../ui/ConfirmationProvider";

// All-Accounts Investments screen (#53, part of the nav-rail IA restructuring
// in #49): lists every Holding across every investment Account in one view,
// carrying over the same create/edit/delete/set-price capability the
// per-Account Holdings tab had. Backed by `list_all_holdings_with_values`,
// the all-Accounts sibling of the per-Account `list_holdings_with_values`
// (which is untouched and still used by the per-Account context).
export function InvestmentsScreen() {
  const [holdings, setHoldings] = useState<HoldingWithAccount[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pricingTicker, setPricingTicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useConfirmation();
  const tier = useBreakpoint();
  const isMobile = tier === "mobile";

  async function refresh() {
    try {
      const [holdingList, accountList] = await Promise.all([
        invoke<HoldingWithAccount[]>("list_all_holdings_with_values"),
        invoke<Account[]>("list_accounts"),
      ]);
      setHoldings(holdingList);
      setInvestmentAccounts(accountList.filter((account) => account.account_type === "investment"));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(fields: HoldingFields, accountId?: number) {
    if (accountId == null) {
      return;
    }
    try {
      await invoke("create_holding", { account_id: accountId, ...fields });
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

  function renderRow(holding: HoldingWithAccount) {
    return (
      <div className="holdings-row" key={holding.id}>
        <span className="cell-account">{holding.account_name}</span>
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
    );
  }

  // Mobile tier (<768px, ADR-0018, issue #65): one card per Holding instead
  // of a grid row -- column headers don't apply to cards, so each field
  // carries its own label. Same create/edit/delete/set-price actions as the
  // grid row, just arranged as a card.
  function renderCard(holding: HoldingWithAccount) {
    return (
      <div className="holdings-card" key={holding.id}>
        <div className="holdings-card-field">
          <span className="holdings-card-label">Account</span>
          <span className="cell-account">{holding.account_name}</span>
        </div>
        <div className="holdings-card-field">
          <span className="holdings-card-label">Ticker</span>
          <span className="cell-ticker">{holding.ticker}</span>
        </div>
        <div className="holdings-card-field">
          <span className="holdings-card-label">Quantity</span>
          <span>{holding.quantity}</span>
        </div>
        <div className="holdings-card-field">
          <span className="holdings-card-label">Price</span>
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
        </div>
        <div className="holdings-card-field">
          <span className="holdings-card-label">Value</span>
          <span className="amount credit">
            {holding.value_cents != null ? formatCents(holding.value_cents) : "—"}
          </span>
        </div>
        <div className="holdings-card-actions">
          <button type="button" onClick={() => setPricingTicker(holding.ticker)}>
            Update price
          </button>
          <button type="button" onClick={() => setEditingId(holding.id)}>
            Edit
          </button>
          <button type="button" onClick={() => handleDelete(holding)}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="content-header">
        <h2>Investments</h2>
      </div>

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

      {investmentAccounts.length === 0 ? (
        <p className="empty-state">
          Add an investment Account to start tracking Holdings.
        </p>
      ) : (
        <div className={isMobile ? "holdings-list holdings-list--cards" : "holdings-list"}>
          {!isMobile && (
            <div className="holdings-head">
              <span>Account</span>
              <span>Ticker</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Value</span>
              <span></span>
            </div>
          )}

          {holdings.map((holding) =>
            editingId === holding.id ? (
              <HoldingForm
                key={holding.id}
                initial={holding}
                onSubmit={(fields) => handleUpdate(holding.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            ) : isMobile ? (
              renderCard(holding)
            ) : (
              renderRow(holding)
            ),
          )}

          {pricingTicker && (
            <div className="price-form-row">
              <PriceForm ticker={pricingTicker} onSubmit={handleSetPrice} onCancel={() => setPricingTicker(null)} />
            </div>
          )}

          <HoldingForm accounts={investmentAccounts} onSubmit={handleCreate} />
        </div>
      )}
    </section>
  );
}
