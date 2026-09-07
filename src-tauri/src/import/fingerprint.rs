//! Fingerprinting for Import dedup (ADR-0002): a fingerprint is a hash of
//! (account_id, date, amount_cents, normalized description). Two Transactions
//! with the same fingerprint are treated as the exact same real-world event
//! and the second import silently skips it.

/// Lowercases, trims, and collapses internal whitespace so trivial
/// formatting differences between repeated exports of the same Transaction
/// (extra spaces, mixed case) don't produce different fingerprints.
pub fn normalize_description(description: &str) -> String {
    description
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// FNV-1a 64-bit hash, rendered as lowercase hex. Deterministic across runs
/// and platforms (unlike Rust's default `HashMap` hasher), with no extra
/// dependency — good enough for a non-cryptographic content fingerprint.
fn fnv1a_hex(input: &str) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

/// Computes the dedup fingerprint for a (would-be) Transaction.
pub fn compute(account_id: i64, date: &str, amount_cents: i64, description: &str) -> String {
    let normalized = normalize_description(description);
    fnv1a_hex(&format!("{account_id}|{date}|{amount_cents}|{normalized}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_inputs_produce_the_same_fingerprint() {
        let a = compute(1, "2026-08-01", -1250, "Coffee Shop");
        let b = compute(1, "2026-08-01", -1250, "Coffee Shop");
        assert_eq!(a, b);
    }

    #[test]
    fn different_accounts_produce_different_fingerprints() {
        let a = compute(1, "2026-08-01", -1250, "Coffee Shop");
        let b = compute(2, "2026-08-01", -1250, "Coffee Shop");
        assert_ne!(a, b);
    }

    #[test]
    fn different_dates_produce_different_fingerprints() {
        let a = compute(1, "2026-08-01", -1250, "Coffee Shop");
        let b = compute(1, "2026-08-02", -1250, "Coffee Shop");
        assert_ne!(a, b);
    }

    #[test]
    fn different_amounts_produce_different_fingerprints() {
        let a = compute(1, "2026-08-01", -1250, "Coffee Shop");
        let b = compute(1, "2026-08-01", -1251, "Coffee Shop");
        assert_ne!(a, b);
    }

    #[test]
    fn description_casing_and_whitespace_do_not_change_the_fingerprint() {
        let a = compute(1, "2026-08-01", -1250, "Coffee Shop");
        let b = compute(1, "2026-08-01", -1250, "  coffee   shop  ");
        assert_eq!(a, b);
    }

    #[test]
    fn different_descriptions_produce_different_fingerprints() {
        let a = compute(1, "2026-08-01", -1250, "Coffee Shop");
        let b = compute(1, "2026-08-01", -1250, "Grocery Store");
        assert_ne!(a, b);
    }
}
