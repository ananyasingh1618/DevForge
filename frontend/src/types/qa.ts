export type QaSource = {
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  score: number;
  cited: boolean;
};

export type QaResult = {
  questionId: string;
  question: string;
  answer: string;
  insufficientEvidence: boolean;
  sources: QaSource[];
  branch: string;
  commit: string;
  createdAt: string;
};
