export type WorkspaceGrade = {
  caseId: string;
  grade: {
    taskOutcome: boolean;
    workspaceCorrect: boolean;
    answerCorrect: boolean | null;
    fileScope: boolean;
    readOnlyUnchanged: boolean;
    artifactSafety: boolean;
  };
  failures: string[];
};

export function getWorkspaceEditingCases(): {
  schemaVersion: number;
  source: Record<string, unknown>;
  commonInstructions: string;
  cases: WorkspaceEditingCase[];
};

export type WorkspaceEditingCase = {
  id: string;
  title: string;
  editable: string[];
  initialFiles: Record<string, string>;
  turns: string[];
  expectedFiles: Record<string, string>;
  expectedFinalAnswer?: unknown;
};

export function gradeWorkspaceEditingCase(args: {
  caseId: string;
  workspaceDir: string;
  finalAnswer?: string;
}): Promise<WorkspaceGrade>;

export function parseJsonNoDuplicateKeys(text: string): unknown;
