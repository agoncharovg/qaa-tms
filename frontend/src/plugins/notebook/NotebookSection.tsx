import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { NotebookBrowsePanel } from "@/plugins/notebook/NotebookBrowsePanel";
import { NotebookSearchPanel } from "@/plugins/notebook/NotebookSearchPanel";

interface NotebookSectionProps {
  mode: Extract<
    ViewKeyType,
    typeof ViewKey.NOTEBOOK_BROWSE
      | typeof ViewKey.NOTEBOOK_SEARCH
  >;
}

export function NotebookSection({ mode }: NotebookSectionProps) {
  if (mode === ViewKey.NOTEBOOK_SEARCH) {
    return <NotebookSearchPanel />;
  }

  return <NotebookBrowsePanel />;
}
