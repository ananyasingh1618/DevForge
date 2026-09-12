import { env } from "../env.js";
import { AppError } from "./errors.js";
import { requirementsContentSchema, type RequirementsContent } from "../schemas/requirements.js";
import { prdContentSchema, type PrdContent } from "../schemas/prd.js";
import { architectureContentSchema, type ArchitectureContent } from "../schemas/architecture.js";

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

type AiPrdContent = {
  overview: string;
  problem_statement: string;
  goals: string[];
  personas: string[];
  functional_requirements: string[];
  non_functional_requirements: string[];
  user_workflows: string[];
  edge_cases: string[];
  success_criteria: string[];
  constraints: string[];
  assumptions: string[];
  open_questions: string[];
};

type AiArchitectureContent = {
  overview: string;
  system_architecture: string;
  technology_stack: string[];
  components: string[];
  data_model: string[];
  api_design: string[];
  data_flows: string[];
  security: string[];
  scalability: string[];
  deployment: string[];
  tradeoffs: string[];
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
function mapAiRequirementsContentToCamelCase(raw: AiRequirementsContent) {
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

// The reverse direction: PRD generation needs to *send* the project's
// (camelCase) active requirements content to ai-service, which expects the
// same snake_case shape it itself returns.
function mapRequirementsContentToSnakeCase(content: RequirementsContent): AiRequirementsContent {
  return {
    project_summary: content.projectSummary,
    users: content.users,
    functional_requirements: content.functionalRequirements.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      priority: item.priority,
      source: item.source,
      acceptance_criteria: item.acceptanceCriteria,
    })),
    non_functional_requirements: content.nonFunctionalRequirements.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      priority: item.priority,
      source: item.source,
      acceptance_criteria: item.acceptanceCriteria,
    })),
    constraints: content.constraints,
    assumptions: content.assumptions,
    open_questions: content.openQuestions,
  };
}

function mapAiPrdContentToCamelCase(raw: AiPrdContent) {
  return {
    overview: raw.overview,
    problemStatement: raw.problem_statement,
    goals: raw.goals,
    personas: raw.personas,
    functionalRequirements: raw.functional_requirements,
    nonFunctionalRequirements: raw.non_functional_requirements,
    userWorkflows: raw.user_workflows,
    edgeCases: raw.edge_cases,
    successCriteria: raw.success_criteria,
    constraints: raw.constraints,
    assumptions: raw.assumptions,
    openQuestions: raw.open_questions,
  };
}

// The reverse direction: architecture generation needs to *send* the
// project's (camelCase) active PRD content to ai-service, which expects the
// same snake_case shape it itself returns.
function mapPrdContentToSnakeCase(content: PrdContent): AiPrdContent {
  return {
    overview: content.overview,
    problem_statement: content.problemStatement,
    goals: content.goals,
    personas: content.personas,
    functional_requirements: content.functionalRequirements,
    non_functional_requirements: content.nonFunctionalRequirements,
    user_workflows: content.userWorkflows,
    edge_cases: content.edgeCases,
    success_criteria: content.successCriteria,
    constraints: content.constraints,
    assumptions: content.assumptions,
    open_questions: content.openQuestions,
  };
}

function mapAiArchitectureContentToCamelCase(raw: AiArchitectureContent) {
  return {
    overview: raw.overview,
    systemArchitecture: raw.system_architecture,
    technologyStack: raw.technology_stack,
    components: raw.components,
    dataModel: raw.data_model,
    apiDesign: raw.api_design,
    dataFlows: raw.data_flows,
    security: raw.security,
    scalability: raw.scalability,
    deployment: raw.deployment,
    tradeoffs: raw.tradeoffs,
    assumptions: raw.assumptions,
    openQuestions: raw.open_questions,
  };
}

/** Shared request/error handling for both ai-service calls below — the only
 * difference between analyzing requirements and generating a PRD is the
 * path, the outbound body, and which error code maps to which Node code. */
async function postToAiService(
  path: string,
  body: unknown,
): Promise<(AiErrorBody & Record<string, unknown>) | null> {
  let res: Response;
  try {
    res = await fetch(`${env.AI_SERVICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError(
      502,
      "AI_SERVICE_UNREACHABLE",
      "Could not reach the AI service. Confirm it is running and AI_SERVICE_URL is correct.",
    );
  }

  const parsedBody = (await res.json().catch(() => null)) as
    | (AiErrorBody & Record<string, unknown>)
    | null;

  if (!res.ok) {
    if (res.status === 503 && parsedBody?.error?.code === "PROVIDER_NOT_CONFIGURED") {
      throw new AppError(
        503,
        "AI_PROVIDER_UNAVAILABLE",
        parsedBody.error.message ?? "The AI provider is not configured.",
      );
    }
    throw new AppError(
      502,
      "AI_SERVICE_ERROR",
      parsedBody?.error?.message ?? `The AI service returned an unexpected ${res.status} response.`,
    );
  }

  return parsedBody;
}

/**
 * Calls the ai-service's requirements-analysis endpoint and returns
 * validated, camelCase RequirementsContent — or throws an AppError. Nothing
 * is ever fabricated here: a provider-not-configured response, a network
 * failure, or a response that doesn't match the expected schema all become
 * distinct, honest errors, never a fallback "success".
 */
export async function analyzeRequirementsViaAiService(idea: string): Promise<RequirementsContent> {
  const body = await postToAiService("/requirements/analyze", { idea });

  if (!body?.content) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "The AI service returned no content.");
  }

  const parsed = requirementsContentSchema.safeParse(
    mapAiRequirementsContentToCamelCase(body.content as AiRequirementsContent),
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

/**
 * Calls the ai-service's PRD-generation endpoint with the project's active
 * requirements content and returns validated, camelCase PrdContent — or
 * throws an AppError. Same honesty guarantee as analyzeRequirementsViaAiService:
 * no fallback fabricates a result.
 */
export async function generatePrdViaAiService(requirements: RequirementsContent): Promise<PrdContent> {
  const body = await postToAiService("/prd/generate", {
    requirements: mapRequirementsContentToSnakeCase(requirements),
  });

  if (!body?.content) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "The AI service returned no content.");
  }

  const parsed = prdContentSchema.safeParse(mapAiPrdContentToCamelCase(body.content as AiPrdContent));
  if (!parsed.success) {
    throw new AppError(
      502,
      "AI_RESPONSE_INVALID",
      "The AI service's response did not match the expected PRD structure.",
    );
  }

  return parsed.data;
}

/**
 * Calls the ai-service's architecture-generation endpoint with the project's
 * active PRD content and returns validated, camelCase ArchitectureContent —
 * or throws an AppError. Same honesty guarantee as the other two AI-service
 * calls: no fallback fabricates a result.
 */
export async function generateArchitectureViaAiService(
  prd: PrdContent,
): Promise<ArchitectureContent> {
  const body = await postToAiService("/architecture/generate", {
    prd: mapPrdContentToSnakeCase(prd),
  });

  if (!body?.content) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "The AI service returned no content.");
  }

  const parsed = architectureContentSchema.safeParse(
    mapAiArchitectureContentToCamelCase(body.content as AiArchitectureContent),
  );
  if (!parsed.success) {
    throw new AppError(
      502,
      "AI_RESPONSE_INVALID",
      "The AI service's response did not match the expected architecture structure.",
    );
  }

  return parsed.data;
}
