import { env } from "../env.js";
import { AppError } from "./errors.js";
import { requirementsContentSchema, type RequirementsContent } from "../schemas/requirements.js";
import { prdContentSchema, type PrdContent } from "../schemas/prd.js";
import { architectureContentSchema, type ArchitectureContent } from "../schemas/architecture.js";
import { epicContentSchema, type EpicContent } from "../schemas/epics.js";
import { taskContentSchema, type TaskContent } from "../schemas/tasks.js";

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

type AiEpicItem = {
  id: string;
  title: string;
  description: string;
  objective: string;
  business_value: string;
  scope: string;
  acceptance_criteria: string[];
  dependencies: string[];
  related_components: string[];
};

type AiEpicContent = {
  epics: AiEpicItem[];
};

type AiTaskItem = {
  id: string;
  title: string;
  description: string;
  type: "feature" | "bug" | "chore";
  priority: "high" | "medium" | "low";
  acceptance_criteria: string[];
  dependencies: string[];
  epic_id: string;
  related_component: string;
  estimated_complexity: "small" | "medium" | "large";
  suggested_order: number;
};

type AiTaskContent = {
  tasks: AiTaskItem[];
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

// The reverse direction: epic generation needs to *send* the project's
// (camelCase) active architecture content to ai-service, which expects the
// same snake_case shape it itself returns.
function mapArchitectureContentToSnakeCase(content: ArchitectureContent): AiArchitectureContent {
  return {
    overview: content.overview,
    system_architecture: content.systemArchitecture,
    technology_stack: content.technologyStack,
    components: content.components,
    data_model: content.dataModel,
    api_design: content.apiDesign,
    data_flows: content.dataFlows,
    security: content.security,
    scalability: content.scalability,
    deployment: content.deployment,
    tradeoffs: content.tradeoffs,
    assumptions: content.assumptions,
    open_questions: content.openQuestions,
  };
}

function mapAiEpicContentToCamelCase(raw: AiEpicContent) {
  return {
    epics: raw.epics.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      objective: item.objective,
      businessValue: item.business_value,
      scope: item.scope,
      acceptanceCriteria: item.acceptance_criteria,
      dependencies: item.dependencies,
      relatedComponents: item.related_components,
    })),
  };
}

// The reverse direction: task generation needs to *send* the project's
// (camelCase) active epic content to ai-service, which expects the same
// snake_case shape it itself returns.
function mapEpicContentToSnakeCase(content: EpicContent): AiEpicContent {
  return {
    epics: content.epics.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      objective: item.objective,
      business_value: item.businessValue,
      scope: item.scope,
      acceptance_criteria: item.acceptanceCriteria,
      dependencies: item.dependencies,
      related_components: item.relatedComponents,
    })),
  };
}

function mapAiTaskContentToCamelCase(raw: AiTaskContent) {
  return {
    tasks: raw.tasks.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      type: item.type,
      priority: item.priority,
      acceptanceCriteria: item.acceptance_criteria,
      dependencies: item.dependencies,
      epicId: item.epic_id,
      relatedComponent: item.related_component,
      estimatedComplexity: item.estimated_complexity,
      suggestedOrder: item.suggested_order,
    })),
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

/**
 * Calls the ai-service's epic-generation endpoint with the project's active
 * architecture content and returns validated, camelCase EpicContent — or
 * throws an AppError. Same honesty guarantee as the other AI-service calls:
 * no fallback fabricates a result.
 */
export async function generateEpicsViaAiService(
  architecture: ArchitectureContent,
): Promise<EpicContent> {
  const body = await postToAiService("/epics/generate", {
    architecture: mapArchitectureContentToSnakeCase(architecture),
  });

  if (!body?.content) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "The AI service returned no content.");
  }

  const parsed = epicContentSchema.safeParse(
    mapAiEpicContentToCamelCase(body.content as AiEpicContent),
  );
  if (!parsed.success) {
    throw new AppError(
      502,
      "AI_RESPONSE_INVALID",
      "The AI service's response did not match the expected epic structure.",
    );
  }

  return parsed.data;
}

/**
 * Calls the ai-service's task-generation endpoint with the project's active
 * epic content and returns validated, camelCase TaskContent — or throws an
 * AppError. Same honesty guarantee as the other AI-service calls: no
 * fallback fabricates a result.
 */
export async function generateTasksViaAiService(epics: EpicContent): Promise<TaskContent> {
  const body = await postToAiService("/tasks/generate", {
    epics: mapEpicContentToSnakeCase(epics),
  });

  if (!body?.content) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "The AI service returned no content.");
  }

  const parsed = taskContentSchema.safeParse(
    mapAiTaskContentToCamelCase(body.content as AiTaskContent),
  );
  if (!parsed.success) {
    throw new AppError(
      502,
      "AI_RESPONSE_INVALID",
      "The AI service's response did not match the expected task structure.",
    );
  }

  return parsed.data;
}

export type ParsedFileSymbol = {
  name: string;
  type: string;
  startLine: number;
  endLine: number;
  parentIndex: number | null;
  signature: string | null;
};

export type ParsedFile = {
  language: string | null;
  status: "parsed" | "unsupported" | "parse_error";
  symbols: ParsedFileSymbol[];
  error: string | null;
};

type AiParsedFileSymbol = {
  name: string;
  type: string;
  start_line: number;
  end_line: number;
  parent_index: number | null;
  signature: string | null;
};

type AiParseFileResponse = {
  language: string | null;
  status: "parsed" | "unsupported" | "parse_error";
  symbols: AiParsedFileSymbol[];
  error: string | null;
};

/**
 * Calls ai-service's tree-sitter-backed parsing endpoint for one file's
 * source and returns validated, camelCase symbol data — or throws an
 * AppError. Deliberately does not reuse postToAiService: parsing is not an
 * LLM call, so it has no PROVIDER_NOT_CONFIGURED case, and an unreachable
 * parser gets its own distinct error code rather than being conflated with
 * an unreachable LLM provider.
 */
export async function parseFileViaAiService(path: string, content: string): Promise<ParsedFile> {
  let res: Response;
  try {
    res = await fetch(`${env.AI_SERVICE_URL}/parsing/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AppError(
      502,
      "PARSER_SERVICE_UNREACHABLE",
      "Could not reach the AI service's parser. Confirm it is running and AI_SERVICE_URL is correct.",
    );
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as AiErrorBody | null;
    throw new AppError(
      502,
      "PARSER_SERVICE_ERROR",
      errBody?.error?.message ?? `The AI service's parser returned an unexpected ${res.status} response.`,
    );
  }

  const body = (await res.json().catch(() => null)) as AiParseFileResponse | null;
  if (!body) {
    throw new AppError(502, "PARSER_SERVICE_ERROR", "The AI service's parser returned no content.");
  }

  return {
    language: body.language,
    status: body.status,
    error: body.error,
    symbols: body.symbols.map((s) => ({
      name: s.name,
      type: s.type,
      startLine: s.start_line,
      endLine: s.end_line,
      parentIndex: s.parent_index,
      signature: s.signature,
    })),
  };
}

export type EmbeddingBatch = {
  model: string;
  dimensions: number;
  embeddings: number[][];
};

/**
 * Calls ai-service's Voyage-backed embedding endpoint for a batch of texts
 * and returns the model identity, dimensions, and vectors in input order —
 * or throws an AppError. Deliberately its own function rather than reusing
 * postToAiService: `EMBEDDING_PROVIDER_UNAVAILABLE` is a distinct code from
 * every generate call's `AI_PROVIDER_UNAVAILABLE` (different real feature,
 * different configuration requirement — VOYAGE_API_KEY, not
 * ANTHROPIC_API_KEY), and the request/response shape (a text batch in,
 * vectors out) doesn't fit postToAiService's single-content-object
 * assumption.
 */
export async function generateEmbeddingsViaAiService(
  texts: string[],
  inputType: "document" | "query",
): Promise<EmbeddingBatch> {
  let res: Response;
  try {
    res = await fetch(`${env.AI_SERVICE_URL}/embeddings/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, input_type: inputType }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError(
      502,
      "EMBEDDING_SERVICE_UNREACHABLE",
      "Could not reach the AI service's embedding endpoint. Confirm it is running and AI_SERVICE_URL is correct.",
    );
  }

  const body = (await res.json().catch(() => null)) as
    | (AiErrorBody & { model?: string; dimensions?: number; embeddings?: number[][] })
    | null;

  if (!res.ok) {
    if (res.status === 503 && body?.error?.code === "PROVIDER_NOT_CONFIGURED") {
      throw new AppError(
        503,
        "EMBEDDING_PROVIDER_UNAVAILABLE",
        body.error.message ?? "The embedding provider is not configured.",
      );
    }
    throw new AppError(
      502,
      "EMBEDDING_SERVICE_ERROR",
      body?.error?.message ?? `The AI service's embedding endpoint returned an unexpected ${res.status} response.`,
    );
  }

  if (!body?.model || !body.dimensions || !body.embeddings) {
    throw new AppError(502, "EMBEDDING_SERVICE_ERROR", "The AI service returned no embeddings.");
  }

  return { model: body.model, dimensions: body.dimensions, embeddings: body.embeddings };
}

export type QaSourceForProvider = {
  sourceNumber: number;
  path: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  content: string;
};

export type QaAnswer = {
  answer: string;
  citedSourceNumbers: number[];
  insufficientEvidence: boolean;
};

/**
 * Calls ai-service's codebase-Q&A endpoint and returns validated, camelCase
 * answer content — or throws an AppError. Reuses postToAiService: this is a
 * genuine Anthropic/ANTHROPIC_API_KEY-gated LLM call, exactly like the five
 * generate calls above, so the same PROVIDER_NOT_CONFIGURED ->
 * AI_PROVIDER_UNAVAILABLE mapping applies unchanged — no new "not
 * configured" code is invented where an existing one already means the
 * same thing.
 */
export async function answerQuestionViaAiService(
  question: string,
  repository: string,
  branch: string,
  commit: string,
  sources: QaSourceForProvider[],
): Promise<QaAnswer> {
  const body = await postToAiService("/qa/answer", {
    question,
    repository,
    branch,
    commit,
    sources: sources.map((s) => ({
      source_number: s.sourceNumber,
      path: s.path,
      symbol_name: s.symbolName,
      start_line: s.startLine,
      end_line: s.endLine,
      content: s.content,
    })),
  });

  if (!body?.content) {
    throw new AppError(502, "AI_RESPONSE_INVALID", "The AI service returned no content.");
  }

  const content = body.content as {
    answer?: unknown;
    cited_source_numbers?: unknown;
    insufficient_evidence?: unknown;
  };

  if (
    typeof content.answer !== "string" ||
    content.answer.length === 0 ||
    !Array.isArray(content.cited_source_numbers) ||
    !content.cited_source_numbers.every((n) => typeof n === "number") ||
    typeof content.insufficient_evidence !== "boolean"
  ) {
    throw new AppError(
      502,
      "AI_RESPONSE_INVALID",
      "The AI service's response did not match the expected Q&A answer structure.",
    );
  }

  return {
    answer: content.answer,
    citedSourceNumbers: content.cited_source_numbers,
    insufficientEvidence: content.insufficient_evidence,
  };
}
