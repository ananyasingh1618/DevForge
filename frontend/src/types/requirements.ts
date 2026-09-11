export type RequirementPriority = "high" | "medium" | "low";
export type RequirementSource = "stated" | "inferred";

export type RequirementItem = {
  id: string;
  title: string;
  description: string;
  priority: RequirementPriority;
  source: RequirementSource;
  acceptanceCriteria: string[];
};

export type RequirementsContent = {
  projectSummary: string;
  users: string[];
  functionalRequirements: RequirementItem[];
  nonFunctionalRequirements: RequirementItem[];
  constraints: string[];
  assumptions: string[];
  openQuestions: string[];
};

export type RequirementsVersion = {
  id: string;
  projectId: string;
  version: number;
  ideaText: string;
  content: RequirementsContent;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RequirementsDiffEntry = { id: string; title: string };
export type ArrayFieldDiff = { added: string[]; removed: string[] };
export type RequirementItemDiff = {
  added: RequirementsDiffEntry[];
  removed: RequirementsDiffEntry[];
  changed: string[];
};

export type RequirementsDiff = {
  functionalRequirements: RequirementItemDiff;
  nonFunctionalRequirements: RequirementItemDiff;
  users: ArrayFieldDiff;
  constraints: ArrayFieldDiff;
  assumptions: ArrayFieldDiff;
  openQuestions: ArrayFieldDiff;
};
