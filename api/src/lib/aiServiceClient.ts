import { env } from "../env.js";
import { AppError } from "./errors.js";
import { requirementsContentSchema, type RequirementsContent } from "../schemas/requirements.js";

type AiErrorBody = { error?: { code?: string; message?: string } };

type AiRequirementItem = {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  source: "stated" | "inferred";
  acceptance_criteria: string[];
};

type AiRequirementsContent = {
  project_summary: string;
  users: string[];
  functional_requirements: AiRequirementItem[];
  non_functional_requirements: AiRequirementItem[];
  constraints: string[];
  assumptions: string[];
  open_questions: string[];
};

function mapItem(item: AiRequirementItem) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    priority: item.priority,
    source: item.source,
    acceptanceCriteria: item.acceptance_criteria,
  };
}

// ai-service is Python and returns snake_case (its Pydantic models' native
// field names); the Node/frontend side uses camelCase throughout. This is
// the one place that boundary is crossed.
function mapAiContentToCamelCase(raw: AiRequirementsContent) {
  return {
    projectSummary: raw.project_summary,
    users: raw.users,
    functionalRequirements: raw.functional_requirements.map(mapItem),
    nonFunctionalRequirements: raw.non_functional_requirements.map(mapItem),
    constraints: raw.constraints,
    assumptions: raw.assumptions,
    openQuestions: raw.open_questions,
  };
}

/**
 * Calls the ai-service's requirements-analysis endpoint and returns
 * validated, camelCase RequirementsContent — or throws an AppError. Nothing
 * is ever fabricated here: a provider-not-configured response, a network
 * failure, or a response that doesn't match the expected schema all become
 * distinct, honest errors, never a fallback "success".
 */
export async function analyzeRequirementsViaAiService(idea: string): Promise<RequirementsContent> {
  let res: Response;
  try {
    res = await fetch(`${env.AI_SERVICE_URL}/requirements/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError(
      502,
      "AI_SERVICE_UNREACHABLE",
      "Could not reach the AI service. Confirm it is running and AI_SERVICE_URL is correct.",
    );
  }

  const body = (await res.json().catch(() => null)) as (AiErrorBody & { content?: unknown }) | null;

  if (!res.ok) {
    if (res.status === 503 && body?.error?.code === "PROVIDER_NOT_CONFIGURED") {
      throw new AppError(
        503,
        "AI_PROVIDER_UNAVAILABLE",
        body.error.message ?? "The AI provider is not configured.",
      );
    }
    throw new AppError(
      502,
      "AI_SERVICE_ERROR",
      body?.error?.message ?? `The AI service returned an unexpected ${res.status} response.`,
    );
  }

  if (!body?.content) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "The AI service returned no content.");
  }

  const parsed = requirementsContentSchema.safeParse(
    mapAiContentToCamelCase(body.content as AiRequirementsContent),
  );
  if (!parsed.success) {
    throw new AppError(
      502,
      "AI_RESPONSE_INVALID",
      "The AI service's response did not match the expected requirements structure.",
    );
  }

  return parsed.data;
}
