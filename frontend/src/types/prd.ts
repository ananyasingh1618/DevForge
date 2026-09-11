export type PrdContent = {
  overview: string;
  problemStatement: string;
  goals: string[];
  personas: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  userWorkflows: string[];
  edgeCases: string[];
  successCriteria: string[];
  constraints: string[];
  assumptions: string[];
  openQuestions: string[];
};

export type PrdVersion = {
  id: string;
  projectId: string;
  version: number;
  sourceRequirementsVersionId: string;
  content: PrdContent;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ArrayFieldDiff = { added: string[]; removed: string[] };

export type PrdDiff = {
  overviewChanged: boolean;
  problemStatementChanged: boolean;
  goals: ArrayFieldDiff;
  personas: ArrayFieldDiff;
  functionalRequirements: ArrayFieldDiff;
  nonFunctionalRequirements: ArrayFieldDiff;
  userWorkflows: ArrayFieldDiff;
  edgeCases: ArrayFieldDiff;
  successCriteria: ArrayFieldDiff;
  constraints: ArrayFieldDiff;
  assumptions: ArrayFieldDiff;
  openQuestions: ArrayFieldDiff;
};
