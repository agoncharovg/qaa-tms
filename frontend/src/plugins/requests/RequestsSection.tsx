import { ViewKey, type ViewKey as ViewKeyType } from "@/constants";
import { CredentialsPanel } from "@/plugins/requests/CredentialsPanel";
import { EnvironmentsPanel } from "@/plugins/requests/EnvironmentsPanel";
import { RequestsBuilderPanel } from "@/plugins/requests/RequestsBuilderPanel";
import { RequestsHistoryPanel } from "@/plugins/requests/RequestsHistoryPanel";

interface RequestsSectionProps {
  mode: Extract<
    ViewKeyType,
    | typeof ViewKey.REQUESTS_BUILDER
    | typeof ViewKey.REQUESTS_CREDENTIALS
    | typeof ViewKey.REQUESTS_ENVIRONMENTS
    | typeof ViewKey.REQUESTS_HISTORY
  >;
}

export function RequestsSection({ mode }: RequestsSectionProps) {
  if (mode === ViewKey.REQUESTS_CREDENTIALS) {
    return <CredentialsPanel />;
  }

  if (mode === ViewKey.REQUESTS_HISTORY) {
    return <RequestsHistoryPanel />;
  }

  if (mode === ViewKey.REQUESTS_ENVIRONMENTS) {
    return <EnvironmentsPanel />;
  }

  return <RequestsBuilderPanel />;
}
