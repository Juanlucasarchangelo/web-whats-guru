/**
 * Local compatibility bridge: existing pages keep their Supabase-style query syntax,
 * but ALL data requests go through the authenticated Express/MySQL API.
 * This file does not import or connect to Supabase.
 */
import { apiRequest, getToken } from './api';

type Filter = { field: string; op: 'eq' | 'in' | 'is' | 'ilike'; value: unknown };
type LocalResponse = { data: any; error: Error | null; count?: number | null };
type Operation = 'query' | 'insert' | 'update' | 'delete';
class Query {
  private operation: Operation = 'query';
  private filters: Filter[] = [];
  private sort?: { field: string; ascending: boolean };
  private rows: unknown;
  private selected = '*';
  private max = 1000;
  private singular = false;
  private wantsCount = false;
  constructor(private table: string) {}
  select(fields = '*', options?: { count?: string }): this {
    this.selected = fields;
    if (options?.count) this.wantsCount = true;
    return this;
  }
  eq(field: string, value: unknown): this { this.filters.push({ field, op: 'eq', value }); return this; }
  is(field: string, value: unknown): this { this.filters.push({ field, op: 'is', value }); return this; }
  in(field: string, value: unknown[]): this { this.filters.push({ field, op: 'in', value }); return this; }
  ilike(field: string, value: string): this { this.filters.push({ field, op: 'ilike', value }); return this; }
  order(field: string, options: { ascending?: boolean } = {}): this { this.sort = { field, ascending: options.ascending !== false }; return this; }
  limit(max: number): this { this.max = max; return this; }
  maybeSingle(): this { this.singular = true; return this; }
  single(): this { this.singular = true; return this; }
  insert(rows: unknown): this { this.operation = 'insert'; this.rows = rows; return this; }
  update(row: unknown): this { this.operation = 'update'; this.rows = row; return this; }
  delete(): this { this.operation = 'delete'; return this; }
  private async execute(): Promise<LocalResponse> {
    try {
      const response: any = await apiRequest(this.operation === 'query' ? '/local/query' : '/local/mutate', {
        method: 'POST',
        body: JSON.stringify(this.operation === 'query'
          ? { table: this.table, filters: this.filters, sort: this.sort, limit: this.max, select: this.selected }
          : { table: this.table, action: this.operation, filters: this.filters, values: this.rows }),
      });
      const value = this.singular ? (response.data?.[0] ?? null) : response.data;
      return { data: this.operation === 'query' || this.selected !== '*' || this.singular ? value : null,
        error: null, count: response.count ?? (Array.isArray(response.data) ? response.data.length : null) };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e : new Error('Erro na API local.'), count: null };
    }
  }
  then<TResult1 = LocalResponse, TResult2 = never>(
    onfulfilled?: ((value: LocalResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected); }
}

export const supabase = {
  from: (table: string): Query => new Query(table),
  auth: {
    getSession: async () => ({ data: { session: getToken() ? { access_token: getToken() } : null }, error: null }),
    getUser: async () => {
      try {
        const response = await apiRequest<{ user: { id: string; email: string } }>('/auth/me');
        return { data: { user: response.user }, error: null };
      } catch (error) { return { data: { user: null }, error }; }
    },
  },
};
