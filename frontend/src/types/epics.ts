export type EpicItem = {
  id: string;
  title: string;
  description: string;
  objective: string;
  businessValue: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  relatedComponents: string[];
};

export type EpicContent = {
  epics: EpicItem[];
};

export type EpicVersion = {
  id: string;
  projectId: string;
  version: number;
  sourceArchitectureVersionId: string;
  content: EpicContent;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ItemDiffEntry = { id: string; title: string };
export type ItemDiff = { added: ItemDiffEntry[]; removed: ItemDiffEntry[]; changed: string[] };
export type EpicDiff = { epics: ItemDiff };
