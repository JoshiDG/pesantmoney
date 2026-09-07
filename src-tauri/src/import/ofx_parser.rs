//! OFX/QFX parsing. These are bank export formats built on SGML (OFX 1.x,
//! tags often unclosed) or a thin XML wrapper around the same tag set
//! (OFX 2.x / QFX). Rather than pull in a full SGML/XML parser for a small,
//! well-known tag vocabulary, this does a lightweight line/tag scan over
//! `<STMTTRN>...</STMTTRN>` blocks, which is the shape both variants share.

use super::ParsedTransaction;

/// Finds `<TAG>value` (closing tag optional, per SGML-style OFX) and returns
/// the value up to the next `<` or end of line.
fn extract_tag_value(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let start = block.find(&open)? + open.len();
    let rest = &block[start..];
    let end = rest.find('<').unwrap_or_else(|| {
        rest.find(['\r', '\n']).unwrap_or(rest.len())
    });
    let value = rest[..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// `DTPOSTED` is `YYYYMMDD`, optionally followed by time/timezone
/// (`YYYYMMDDHHMMSS[.xxx][+TZ]`). Only the date portion is needed.
fn normalize_ofx_date(raw: &str) -> Result<String, String> {
    if raw.len() < 8 {
        return Err(format!("Unrecognized OFX date: {raw:?}"));
    }
    let (year, rest) = raw.split_at(4);
    let (month, rest) = rest.split_at(2);
    let (day, _) = rest.split_at(2);
    Ok(format!("{year}-{month}-{day}"))
}

fn parse_amount_cents(raw: &str) -> Result<i64, String> {
    let value: f64 = raw
        .trim()
        .parse()
        .map_err(|_| format!("Could not parse OFX amount: {raw:?}"))?;
    Ok((value * 100.0).round() as i64)
}

pub fn parse(contents: &str) -> Result<Vec<ParsedTransaction>, String> {
    let mut transactions = Vec::new();

    for block in contents.split("<STMTTRN>").skip(1) {
        let block = block.split("</STMTTRN>").next().unwrap_or(block);

        let date_raw = extract_tag_value(block, "DTPOSTED")
            .ok_or_else(|| "STMTTRN block missing DTPOSTED".to_string())?;
        let amount_raw = extract_tag_value(block, "TRNAMT")
            .ok_or_else(|| "STMTTRN block missing TRNAMT".to_string())?;
        let description = extract_tag_value(block, "NAME")
            .or_else(|| extract_tag_value(block, "MEMO"))
            .unwrap_or_else(|| "Imported transaction".to_string());

        transactions.push(ParsedTransaction {
            date: normalize_ofx_date(&date_raw)?,
            amount_cents: parse_amount_cents(&amount_raw)?,
            description,
        });
    }

    Ok(transactions)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_OFX: &str = "OFXHEADER:100\r
DATA:OFXSGML\r
VERSION:102\r
\r
<OFX>\r
<BANKMSGSRSV1>\r
<STMTTRNRS>\r
<STMTRS>\r
<BANKTRANLIST>\r
<STMTTRN>\r
<TRNTYPE>DEBIT\r
<DTPOSTED>20260801120000\r
<TRNAMT>-12.50\r
<NAME>COFFEE SHOP\r
<MEMO>Morning coffee\r
</STMTTRN>\r
<STMTTRN>\r
<TRNTYPE>CREDIT\r
<DTPOSTED>20260802\r
<TRNAMT>1500.00\r
<NAME>PAYCHECK\r
</STMTTRN>\r
</BANKTRANLIST>\r
</STMTRS>\r
</STMTTRNRS>\r
</BANKMSGSRSV1>\r
</OFX>\r
";

    #[test]
    fn parses_each_stmttrn_block_into_a_parsed_transaction() {
        let rows = parse(SAMPLE_OFX).expect("parse ofx");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].date, "2026-08-01");
        assert_eq!(rows[0].amount_cents, -1250);
        assert_eq!(rows[0].description, "COFFEE SHOP");
        assert_eq!(rows[1].date, "2026-08-02");
        assert_eq!(rows[1].amount_cents, 150_000);
        assert_eq!(rows[1].description, "PAYCHECK");
    }

    #[test]
    fn falls_back_to_memo_when_name_is_absent() {
        let ofx = "<STMTTRN>\n<DTPOSTED>20260801\n<TRNAMT>-5.00\n<MEMO>ATM Withdrawal\n</STMTTRN>\n";

        let rows = parse(ofx).expect("parse ofx");

        assert_eq!(rows[0].description, "ATM Withdrawal");
    }

    #[test]
    fn errors_when_dtposted_is_missing() {
        let ofx = "<STMTTRN>\n<TRNAMT>-5.00\n<NAME>Mystery\n</STMTTRN>\n";

        let result = parse(ofx);

        assert!(result.is_err());
    }

    #[test]
    fn returns_an_empty_vec_for_a_file_with_no_transactions() {
        let ofx = "<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>";

        let rows = parse(ofx).expect("parse ofx");

        assert!(rows.is_empty());
    }
}
