export interface TenantGuardrailConfig {
  allowKeywords?: string[];
  denyKeywords?: string[];
  contextLimit?: number | null;
}

export interface GuardrailDecision {
  blocked: boolean;
  reason?: "deny" | "allow";
  message?: string;
}

const defaultDenyList = ["password", "credit card", "social security number", "ssn", "api key"];

function normalizeKeywords(list?: string[]) {
  return (list ?? [])
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function questionContains(question: string, keywords: string[]) {
  if (!keywords.length) return false;
  const lower = question.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

export function evaluateGuardrails(question: string, config?: TenantGuardrailConfig): GuardrailDecision {
  const denyKeywords = [...defaultDenyList, ...normalizeKeywords(config?.denyKeywords)];
  if (questionContains(question, denyKeywords)) {
    return {
      blocked: true,
      reason: "deny",
      message: "I’m sorry, but I can’t help with that request. Please reach out to a trusted administrator.",
    };
  }

  const allowKeywords = normalizeKeywords(config?.allowKeywords);
  if (allowKeywords.length && !questionContains(question, allowKeywords)) {
    return {
      blocked: true,
      reason: "allow",
      message: "This assistant only responds to approved topics. Please include one of the allowed keywords.",
    };
  }

  return { blocked: false };
}
