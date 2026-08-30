import type {
  RequestsEnvironmentVariable,
  RequestsHeaderField,
  RequestsItemInput,
  RequestsMethod,
  RequestsQueryParam,
  RequestsRequestBody,
} from "@/api/types";

const IAM_BASE_URL = "{{iamBase}}";
const VERIFY_URL = "{{verifyBase}}/auth/verify";
const JSON_METHODS = new Set<RequestsMethod>(["POST", "PUT", "PATCH"]);

export interface RequestsSeedRequest extends Omit<RequestsItemInput, "folder"> {
  name: string;
}

export interface RequestsSeedFolder {
  name: string;
  requests: RequestsSeedRequest[];
}

export interface RequestsSeedEnvironment {
  name: string;
  variables: RequestsEnvironmentVariable[];
}

function buildHeader(name: string, value: string): RequestsHeaderField {
  return { enabled: true, name, value };
}

function buildBody(method: RequestsMethod, content?: string): RequestsRequestBody {
  if (!JSON_METHODS.has(method)) {
    return { content: "", mode: "none" };
  }
  return { content: content ?? "{}", mode: "json" };
}

function buildUrl(path: string): string {
  return path.startsWith("http://") || path.startsWith("https://") ? path : `${IAM_BASE_URL}${path}`;
}

function buildRequest(
  name: string,
  method: RequestsMethod,
  path: string,
  options: { bodyContent?: string; headers?: RequestsHeaderField[]; queryParams?: RequestsQueryParam[] } = {}
): RequestsSeedRequest {
  const headers = [buildHeader("Accept", "application/json")];
  if (JSON_METHODS.has(method)) {
    headers.push(buildHeader("Content-Type", "application/json"));
  }
  if (options.headers) {
    headers.push(...options.headers);
  }

  return {
    body: buildBody(method, options.bodyContent),
    credentialId: null,
    headers,
    method,
    name,
    queryParams: options.queryParams ?? [],
    url: buildUrl(path),
  };
}

function buildFolder(name: string, requests: RequestsSeedRequest[]): RequestsSeedFolder {
  return { name, requests };
}

function buildEnvironment(
  name: string,
  iamBase: string,
  verifyBase: string
): RequestsSeedEnvironment {
  return {
    name,
    variables: [
      { enabled: true, key: "iamBase", value: iamBase },
      { enabled: true, key: "verifyBase", value: verifyBase },
    ],
  };
}

export const IAM_SEED: RequestsSeedFolder[] = [
  buildFolder("IAM · Auth", [
    buildRequest("Verify token", "GET", VERIFY_URL, {
      headers: [buildHeader("Authorization", "APIKey <token>")],
    }),
    buildRequest("JWT login", "POST", "/iam/auth/jwt/login", {
      bodyContent: JSON.stringify({ password: "", username: "" }, null, 2),
      headers: [buildHeader("Referer", "")],
    }),
    buildRequest("Refresh JWT", "POST", "/iam/auth/jwt/refresh"),
    buildRequest("Issue admin token", "GET", "/iam/auth/jwt/clients/{client_id}/admin_token", {
      queryParams: [{ enabled: true, name: "issue_by_current_user", value: "true" }],
    }),
    buildRequest("Get user token", "GET", "/iam/auth/jwt/users/{user_id}/token"),
    buildRequest("Forgot password", "POST", "/iam/auth/password/forgot"),
    buildRequest("Restore password", "POST", "/iam/auth/password/restore"),
  ]),
  buildFolder("IAM · Tokens", [
    buildRequest("List tokens", "GET", "/iam/tokens"),
    buildRequest("Create token", "POST", "/iam/tokens"),
    buildRequest("Delete token", "DELETE", "/iam/tokens/{token_id}"),
    buildRequest("List client tokens", "GET", "/iam/clients/{client_id}/tokens"),
    buildRequest("Create client token", "POST", "/iam/clients/{client_id}/tokens"),
    buildRequest("List v2 tokens", "GET", "/iam/v2/tokens"),
    buildRequest("Create v2 token", "POST", "/iam/v2/tokens"),
    buildRequest("List reseller tokens", "GET", "/iam/reseller/tokens"),
  ]),
  buildFolder("IAM · Clients", [
    buildRequest("List clients", "GET", "/iam/clients"),
    buildRequest("Create client", "POST", "/iam/clients"),
    buildRequest("Get client", "GET", "/iam/clients/{id}"),
    buildRequest("Update client", "PATCH", "/iam/clients/{id}"),
    buildRequest("Delete client", "DELETE", "/iam/clients/{id}"),
    buildRequest("Get current client", "GET", "/iam/clients/me"),
    buildRequest("Update current client", "PATCH", "/iam/clients/me"),
    buildRequest("List client services", "GET", "/iam/clients/{id}/services"),
    buildRequest("List client users", "GET", "/iam/clients/{id}/client_users"),
    buildRequest("List client projects", "GET", "/iam/clients/{id}/projects"),
    buildRequest("Invite client user", "POST", "/iam/clients/invite_user"),
  ]),
  buildFolder("IAM · Users", [
    buildRequest("List users", "GET", "/iam/users"),
    buildRequest("Create user", "POST", "/iam/users"),
    buildRequest("Get current user", "GET", "/iam/users/me"),
    buildRequest("Get user", "GET", "/iam/users/{id}"),
    buildRequest("Update user", "PATCH", "/iam/users/{id}"),
    buildRequest("Update user email", "PATCH", "/iam/users/{id}/email"),
  ]),
  buildFolder("IAM · Access control", [
    buildRequest("List admin policies", "GET", "/iam/access_control/admin/v1/policies"),
    buildRequest("Create admin policy", "POST", "/iam/access_control/admin/v1/policies"),
    buildRequest("List admin groups", "GET", "/iam/access_control/admin/v1/groups"),
    buildRequest("Create admin group", "POST", "/iam/access_control/admin/v1/groups"),
    buildRequest("Add user to group", "POST", "/iam/access_control/admin/v1/groups/add_user"),
    buildRequest("Remove user from group", "POST", "/iam/access_control/admin/v1/groups/remove_user"),
    buildRequest("List permission sets", "GET", "/iam/access_control/admin/v1/permission_sets"),
    buildRequest("List permissions", "GET", "/iam/access_control/admin/v1/permissions"),
    buildRequest("List v2 groups", "GET", "/iam/v2/groups"),
    buildRequest("List v2 policies", "GET", "/iam/v2/policies"),
    buildRequest("List v2 permission sets", "GET", "/iam/v2/permission_sets"),
  ]),
  buildFolder("IAM · Admin & reselling", [
    buildRequest("List resellers", "GET", "/iam/admin/resellers"),
    buildRequest("Create reseller", "POST", "/iam/admin/resellers"),
    buildRequest("List admins", "GET", "/iam/admin/admins"),
    buildRequest("List sellers", "GET", "/iam/admin/sellers"),
    buildRequest("Get identity provider", "GET", "/iam/reselling/identity_provider"),
    buildRequest("List authentication methods", "GET", "/iam/reselling/authentication_methods"),
  ]),
  buildFolder("IAM · Services & misc", [
    buildRequest("List thin services", "GET", "/iam/services/thin"),
    buildRequest("Get product availability", "GET", "/iam/products/availability/clients/{id}"),
    buildRequest("List restricted words", "GET", "/iam/restrictions/words"),
    buildRequest("List blacklisted domains", "GET", "/iam/emails_blacklist/domains"),
    buildRequest("Check email blacklist", "POST", "/iam/emails_blacklist/check_email"),
    buildRequest("List login activity", "GET", "/iam/activity_log/logins"),
    buildRequest("List request activity", "GET", "/iam/activity_log/requests"),
  ]),
];

export const IAM_ENVIRONMENT_SEED: RequestsSeedEnvironment[] = [
  buildEnvironment(
    "staging",
    "https://iam-api-qaa-iam.frn-stg.p.gc.onl",
    "https://iam-api-qaa-iam.frn-stg.p.gc.onl"
  ),
  buildEnvironment(
    "preprod",
    "https://api.preprod.world",
    "https://iam-auth-preprod.i.gc.onl"
  ),
  buildEnvironment(
    "prod",
    "https://api.gcore.com",
    "https://iam-auth-prod.i.gc.onl"
  ),
];
