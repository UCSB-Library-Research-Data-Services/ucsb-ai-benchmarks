export interface CatalogBenchmarked {
  performance: boolean;
  scicode: boolean;
  rise: boolean;
}

export interface CatalogModel {
  service: string;
  model: string;
  slug: string;
  in_api: boolean;
  in_roster: boolean;
  owned_by: string | null;
  vision: boolean | null;
  vision_status: string | null;
  max_output_tokens: number | null;
  max_output_tokens_source: string | null;
  benchmarked: CatalogBenchmarked;
}

export interface CatalogProvider {
  id: string;
  name: string;
  description: string;
  website: string;
  api_url: string;
  model_types: string;
  access: string;
  status: string;
  model_count: number;
  benchmarked_count: number;
}

export interface Catalog {
  generated_at: string;
  providers: CatalogProvider[];
  models: CatalogModel[];
}

export const PROVIDER_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];

export function providerColor(providers: string[], name: string): string {
  const idx = providers.indexOf(name);
  return PROVIDER_PALETTE[((idx % PROVIDER_PALETTE.length) + PROVIDER_PALETTE.length) % PROVIDER_PALETTE.length];
}

export function slugifyModel(model: string): string {
  return (model || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
}

export function modelAnchor(service: string, model: string): string {
  const raw = model.startsWith(service + ' ') ? model.slice(service.length + 1) : model;
  return `${service.toLowerCase()}--${slugifyModel(raw)}`;
}

export function providerAnchor(id: string): string {
  return `provider-${id.toLowerCase()}`;
}
