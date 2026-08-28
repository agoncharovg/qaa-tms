type NotebookNoteIdentity = {
  bookmark: string | null;
  noteName: string | null;
  token: string | null;
};

const notebookNoteDrafts = new Map<string, string>();
const NOTE_DRAFT_KEY_SEPARATOR = "\u0000";

function buildNotebookNoteDraftKey({
  bookmark,
  noteName,
  token,
}: NotebookNoteIdentity): string | null {
  if (!token || !bookmark || !noteName) {
    return null;
  }

  return [token, bookmark, noteName].join(NOTE_DRAFT_KEY_SEPARATOR);
}

export function getNotebookNoteDraft(identity: NotebookNoteIdentity): string | undefined {
  const key = buildNotebookNoteDraftKey(identity);
  return key ? notebookNoteDrafts.get(key) : undefined;
}

export function setNotebookNoteDraft(identity: NotebookNoteIdentity, text: string): void {
  const key = buildNotebookNoteDraftKey(identity);
  if (!key) {
    return;
  }

  notebookNoteDrafts.set(key, text);
}

export function clearNotebookNoteDraft(identity: NotebookNoteIdentity): void {
  const key = buildNotebookNoteDraftKey(identity);
  if (!key) {
    return;
  }

  notebookNoteDrafts.delete(key);
}

export function clearNotebookNoteDraftsForBookmark(token: string | null, bookmark: string): void {
  if (!token) {
    return;
  }

  const prefix = [token, bookmark].join(NOTE_DRAFT_KEY_SEPARATOR) + NOTE_DRAFT_KEY_SEPARATOR;
  for (const key of notebookNoteDrafts.keys()) {
    if (key.startsWith(prefix)) {
      notebookNoteDrafts.delete(key);
    }
  }
}

export function renameNotebookNoteDraftBookmark(
  token: string | null,
  sourceBookmark: string,
  targetBookmark: string
): void {
  if (!token || sourceBookmark === targetBookmark) {
    return;
  }

  const prefix = [token, sourceBookmark].join(NOTE_DRAFT_KEY_SEPARATOR) + NOTE_DRAFT_KEY_SEPARATOR;
  for (const [key, value] of notebookNoteDrafts.entries()) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    const noteName = key.slice(prefix.length);
    notebookNoteDrafts.delete(key);
    notebookNoteDrafts.set(
      [token, targetBookmark, noteName].join(NOTE_DRAFT_KEY_SEPARATOR),
      value
    );
  }
}

export function clearNotebookNoteDrafts(): void {
  notebookNoteDrafts.clear();
}
