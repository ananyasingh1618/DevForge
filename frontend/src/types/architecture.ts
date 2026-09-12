export type ArchitectureContent = {
  overview: string;
  systemArchitecture: string;
  technologyStack: string[];
  components: string[];
  dataModel: string[];
  apiDesign: string[];
  dataFlows: string[];
  security: string[];
  scalability: string[];
  deployment: string[];
  tradeoffs: string[];
  assumptions: string[];
  openQuestions: string[];
};

export type ArchitectureVersion = {
  id: string;
  projectId: string;
  version: number;
  sourcePrdVersionId: string;
  content: ArchitectureContent;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ArrayFieldDiff = { added: string[]; removed: string[] };

export type ArchitectureDiff = {
  overviewChanged: boolean;
  systemArchitectureChanged: boolean;
  technologyStack: ArrayFieldDiff;
  components: ArrayFieldDiff;
  dataModel: ArrayFieldDiff;
  apiDesign: ArrayFieldDiff;
  dataFlows: ArrayFieldDiff;
  security: ArrayFieldDiff;
  scalability: ArrayFieldDiff;
  deployment: ArrayFieldDiff;
  tradeoffs: ArrayFieldDiff;
  assumptions: ArrayFieldDiff;
  openQuestions: ArrayFieldDiff;
};
