export type RuleField = "description" | "amount" | "account";

export type MatchType = "contains" | "equals";

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  description: "Description",
  amount: "Amount",
  account: "Account",
};

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  contains: "Contains",
  equals: "Equals",
};

export interface RuleFields {
  field: RuleField;
  match_type: MatchType;
  match_value: string;
  category_id: number | null;
  rename_value: string | null;
  hide: boolean;
  tag_names: string[];
  priority: number;
}

export interface Rule {
  id: number;
  field: RuleField;
  match_type: MatchType;
  match_value: string;
  category_id: number | null;
  rename_value: string | null;
  hide: boolean;
  tag_ids: number[];
  priority: number;
}
