export type ImportFormat = "csv" | "ofx";

export type SignConvention = "negative_is_debit" | "negative_is_credit";

export const SIGN_CONVENTION_LABELS: Record<SignConvention, string> = {
  negative_is_debit: "Negative = money out (standard)",
  negative_is_credit: "Negative = money in (inverted, some card exports)",
};

export interface ColumnMapping {
  date_column: number;
  amount_column: number;
  description_column: number;
  sign_convention: SignConvention;
  has_header_row: boolean;
}

export interface ImportProfileFields {
  institution_name: string;
  date_column: number;
  amount_column: number;
  description_column: number;
  sign_convention: SignConvention;
  has_header_row: boolean;
}

export interface ImportProfile extends ImportProfileFields {
  id: number;
}

export type MatchStatus = "new" | "duplicate" | "needs_review";

export interface PreviewRow {
  date: string;
  amount_cents: number;
  description: string;
  status: MatchStatus;
}

export interface ParsedTransaction {
  date: string;
  amount_cents: number;
  description: string;
}

export interface ImportResult {
  imported_count: number;
  skipped_count: number;
}

export function previewRowToParsedTransaction(row: PreviewRow): ParsedTransaction {
  return {
    date: row.date,
    amount_cents: row.amount_cents,
    description: row.description,
  };
}
