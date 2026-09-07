export interface CategoryGroup {
  id: number;
  name: string;
}

export interface CategoryFields {
  group_id: number;
  name: string;
}

export interface Category extends CategoryFields {
  id: number;
}
