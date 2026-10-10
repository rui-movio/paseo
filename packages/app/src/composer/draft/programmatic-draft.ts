import { useDraftStore } from "@/stores/draft-store";

const editors = new Map<string, (text: string) => void>();

/** Mounted composers flush pending keystrokes before inserting reviewed context. */
export function registerDraftAppender(
  draftKey: string,
  append: (text: string) => void,
): () => void {
  editors.set(draftKey, append);
  return () => {
    if (editors.get(draftKey) === append) editors.delete(draftKey);
  };
}

export function appendedDraftText(current: string, text: string): string {
  return current + (current.trim() ? "\n\n" : "") + text + "\n\n";
}

export async function appendToDraft(draftKey: string, text: string): Promise<void> {
  await useDraftStore.getState().hydrateDraftInput({ draftKey });
  const editor = editors.get(draftKey);
  if (editor) {
    editor(text);
    return;
  }
  const store = useDraftStore.getState();
  const draft = store.getDraftInput(draftKey) ?? { text: "", attachments: [] };
  store.saveDraftInput({
    draftKey,
    draft: { ...draft, text: appendedDraftText(draft.text, text) },
  });
}
