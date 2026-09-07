//! CSV parsing driven by a user-supplied (and optionally saved-as-an-
//! Import-Profile) column mapping, since CSV export shapes vary by
//! Institution and aren't self-describing the way OFX/QFX are.

use serde::{Deserialize, Serialize};

use super::ParsedTransaction;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignConvention {
    /// The file's amount sign already matches PesantMoney's convention:
    /// negative = money out (debit), positive = money in (credit).
    NegativeIsDebit,
    /// The file inverts that convention (seen in some credit card exports,
    /// where a positive number is a charge) — flip the sign on import.
    NegativeIsCredit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub date_column: usize,
    pub amount_column: usize,
    pub description_column: usize,
    pub sign_convention: SignConvention,
    pub has_header_row: bool,
}

/// Normalizes a handful of common bank export date shapes to `YYYY-MM-DD`.
/// Supports ISO (`2026-08-01`) and US slash format (`08/01/2026`); anything
/// else is passed through unchanged so it's visible (not silently dropped)
/// in the preview for the user to notice and fix.
fn normalize_date(raw: &str) -> String {
    let raw = raw.trim();
    if raw.len() == 10 && raw.as_bytes()[4] == b'-' && raw.as_bytes()[7] == b'-' {
        return raw.to_string();
    }
    let parts: Vec<&str> = raw.split('/').collect();
    if parts.len() == 3 {
        let (month, day, year) = (parts[0], parts[1], parts[2]);
        if month.len() <= 2 && day.len() <= 2 && year.len() == 4 {
            return format!("{year}-{month:0>2}-{day:0>2}");
        }
    }
    raw.to_string()
}

/// Parses a raw amount cell ("$1,234.56", "-23.50", "(23.50)") into cents.
/// Parenthesized amounts are a common accounting convention for negatives.
fn parse_amount_cents(raw: &str) -> Result<i64, String> {
    let trimmed = raw.trim();
    let negative_paren = trimmed.starts_with('(') && trimmed.ends_with(')');
    let cleaned: String = trimmed
        .trim_start_matches('(')
        .trim_end_matches(')')
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();

    let value: f64 = cleaned
        .parse()
        .map_err(|_| format!("Could not parse amount: {raw:?}"))?;
    let cents = (value * 100.0).round() as i64;
    Ok(if negative_paren { -cents.abs() } else { cents })
}

pub fn parse(contents: &str, mapping: &ColumnMapping) -> Result<Vec<ParsedTransaction>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(mapping.has_header_row)
        .flexible(true)
        .from_reader(contents.as_bytes());

    let max_column = mapping
        .date_column
        .max(mapping.amount_column)
        .max(mapping.description_column);

    let mut parsed = Vec::new();
    for (row_index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("CSV parse error on row {row_index}: {e}"))?;
        if record.len() <= max_column {
            return Err(format!(
                "Row {row_index} has only {} column(s), but the mapping needs column {max_column}",
                record.len()
            ));
        }

        let date = normalize_date(&record[mapping.date_column]);
        let mut amount_cents = parse_amount_cents(&record[mapping.amount_column])
            .map_err(|e| format!("Row {row_index}: {e}"))?;
        if mapping.sign_convention == SignConvention::NegativeIsCredit {
            amount_cents = -amount_cents;
        }
        let description = record[mapping.description_column].trim().to_string();

        parsed.push(ParsedTransaction {
            date,
            amount_cents,
            description,
            category_id: None,
        });
    }

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standard_mapping() -> ColumnMapping {
        ColumnMapping {
            date_column: 0,
            amount_column: 1,
            description_column: 2,
            sign_convention: SignConvention::NegativeIsDebit,
            has_header_row: true,
        }
    }

    #[test]
    fn parses_rows_with_a_header_into_parsed_transactions() {
        let csv = "Date,Amount,Description\n2026-08-01,-12.50,Coffee Shop\n2026-08-02,1500.00,Paycheck\n";

        let rows = parse(csv, &standard_mapping()).expect("parse csv");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].date, "2026-08-01");
        assert_eq!(rows[0].amount_cents, -1250);
        assert_eq!(rows[0].description, "Coffee Shop");
        assert_eq!(rows[1].amount_cents, 150_000);
    }

    #[test]
    fn parses_us_slash_dates_into_iso_format() {
        let csv = "Date,Amount,Description\n8/1/2026,-12.50,Coffee Shop\n";

        let rows = parse(csv, &standard_mapping()).expect("parse csv");

        assert_eq!(rows[0].date, "2026-08-01");
    }

    #[test]
    fn negative_is_credit_convention_flips_the_sign() {
        let csv = "Date,Amount,Description\n2026-08-01,12.50,Coffee Shop\n";
        let mut mapping = standard_mapping();
        mapping.sign_convention = SignConvention::NegativeIsCredit;

        let rows = parse(csv, &mapping).expect("parse csv");

        assert_eq!(rows[0].amount_cents, -1250);
    }

    #[test]
    fn parses_currency_formatted_amounts() {
        let csv = "Date,Amount,Description\n2026-08-01,\"$1,234.56\",Big Purchase\n";

        let rows = parse(csv, &standard_mapping()).expect("parse csv");

        assert_eq!(rows[0].amount_cents, 123_456);
    }

    #[test]
    fn parses_parenthesized_amounts_as_negative() {
        let csv = "Date,Amount,Description\n2026-08-01,(45.00),Refund Reversal\n";

        let rows = parse(csv, &standard_mapping()).expect("parse csv");

        assert_eq!(rows[0].amount_cents, -4500);
    }

    #[test]
    fn respects_has_header_row_false() {
        let csv = "2026-08-01,-12.50,Coffee Shop\n";
        let mut mapping = standard_mapping();
        mapping.has_header_row = false;

        let rows = parse(csv, &mapping).expect("parse csv");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].description, "Coffee Shop");
    }

    #[test]
    fn errors_on_a_row_missing_a_mapped_column() {
        let csv = "Date,Amount\n2026-08-01,-12.50\n";

        let result = parse(csv, &standard_mapping());

        assert!(result.is_err());
    }
}
