import type { RequestsVariableRow } from "@/api/types";

type VariableDraftRowLike = RequestsVariableRow & { isNew?: boolean };

export function normalizeVariableRowValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.length > 0));
}

export function isVariableRowDirty(
  draft: VariableDraftRowLike,
  savedRow: RequestsVariableRow | undefined
): boolean {
  if (draft.isNew) {
    return draft.key.trim().length > 0;
  }
  if (!savedRow) {
    return true;
  }
  if (draft.key.trim() !== savedRow.key.trim()) {
    return true;
  }
  if (draft.enabled !== savedRow.enabled || draft.secret !== savedRow.secret) {
    return true;
  }

  const draftValues = normalizeVariableRowValues(draft.values);
  const savedValues = normalizeVariableRowValues(savedRow.values);
  const draftKeys = Object.keys(draftValues);
  const savedKeys = Object.keys(savedValues);
  if (draftKeys.length !== savedKeys.length) {
    return true;
  }

  return draftKeys.some((key) => draftValues[key] !== savedValues[key]);
}
