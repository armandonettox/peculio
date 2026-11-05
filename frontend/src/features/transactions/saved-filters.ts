import type { TransactionFilters } from "@/api/transactions";
import type { KindFilter } from "./filters";

const STORAGE_KEY = "peculio:saved-filters";

export type SavedFilter = {
  id: string;
  name: string;
  filters: TransactionFilters;
  kind: KindFilter | null;
  createdAt: string;
};

export function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedFilter[];
  } catch {
    return [];
  }
}

export function saveFilter(name: string, filters: TransactionFilters, kind: KindFilter | null): SavedFilter {
  const saved = loadSavedFilters();
  const entry: SavedFilter = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    filters,
    kind,
    createdAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved, entry]));
  } catch {
    // localStorage cheio ou bloqueado
  }
  return entry;
}

export function deleteSavedFilter(id: string): void {
  const saved = loadSavedFilters().filter((f) => f.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // ignore
  }
}
