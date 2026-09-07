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
  category_id: number;
  priority: number;
}

export interface Rule extends RuleFields {
  id: number;
}
