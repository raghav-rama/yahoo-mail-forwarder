export type SafetyInput = {
  fromAddress?: string;
  selfAddress: string;
  headers: Map<string, string>;
  bodyText?: string;
};

export type SafetySignals = {
  isFromSelf: boolean;
  isAutomated: boolean;
  isListMail: boolean;
  isNoReplySender: boolean;
  riskFlags: string[];
  requiresHumanReview: boolean;
};

const NO_REPLY_PATTERN = /(^|[._+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster)([._+-]|@|$)/i;

export function detectSafetySignals(input: SafetyInput): SafetySignals {
  const fromAddress = input.fromAddress?.toLowerCase() ?? "";
  const selfAddress = input.selfAddress.toLowerCase();
  const body = input.bodyText?.toLowerCase() ?? "";
  const headers = lowerCaseHeaders(input.headers);

  const isFromSelf = fromAddress === selfAddress;
  const isAutomated =
    hasMeaningfulHeader(headers, "auto-submitted") ||
    hasMeaningfulHeader(headers, "x-auto-response-suppress") ||
    ["bulk", "list", "junk"].includes(headers.get("precedence") ?? "");
  const isListMail = hasMeaningfulHeader(headers, "list-id") || hasMeaningfulHeader(headers, "list-unsubscribe");
  const isNoReplySender = NO_REPLY_PATTERN.test(fromAddress);
  const riskFlags = detectRiskFlags(body);

  return {
    isFromSelf,
    isAutomated,
    isListMail,
    isNoReplySender,
    riskFlags,
    requiresHumanReview: riskFlags.length > 0
  };
}

export function shouldNeverReply(signals: SafetySignals): boolean {
  return signals.isFromSelf || signals.isAutomated || signals.isListMail || signals.isNoReplySender;
}

function detectRiskFlags(body: string): string[] {
  const flags = new Set<string>();

  if (/\b(password|passcode|otp|2fa|verification code|api key|secret key|credential)\b/i.test(body)) {
    flags.add("credential_request");
  }

  if (/\b(wire transfer|bank account|routing number|invoice|payment|crypto|wallet|tax|ssn|social security)\b/i.test(body)) {
    flags.add("financial_request");
  }

  if (/\b(contract|lawsuit|legal notice|subpoena|attorney|compliance)\b/i.test(body)) {
    flags.add("legal_request");
  }

  if (/\b(click this link|reset your password|verify your account|urgent action required)\b/i.test(body)) {
    flags.add("security_risk");
  }

  return [...flags];
}

function lowerCaseHeaders(headers: Map<string, string>): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [key, value] of headers.entries()) {
    normalized.set(key.toLowerCase(), value.toLowerCase());
  }
  return normalized;
}

function hasMeaningfulHeader(headers: Map<string, string>, key: string): boolean {
  const value = headers.get(key);
  return Boolean(value && value !== "no");
}
