export type TaskType = "feature" | "bug" | "chore";
export type TaskPriority = "high" | "medium" | "low";
export type TaskComplexity = "small" | "medium" | "large";

export type TaskItem = {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  acceptanceCriteria: string[];
  dependencies: string[];
  epicId: string;
  relatedComponent: string;
  estimatedComplexity: TaskComplexity;
  suggestedOrder: number;
};

export type TaskContent = {
  tasks: TaskItem[];
};

export type TaskVersion = {
  id: string;
  projectId: string;
  version: number;
  sourceEpicVersionId: string;
  content: TaskContent;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ItemDiffEntry = { id: string; title: string };
export type ItemDiff = { added: ItemDiffEntry[]; removed: ItemDiffEntry[]; changed: string[] };
export type TaskDiff = { tasks: ItemDiff };
