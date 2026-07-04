export type EvalTask = {
  id: string;
  objective: string;
  input: string;
  expectedFacts: string[];
};

export const evalTasks: EvalTask[] = [
  {
    id: "login-refresh-bug",
    objective: "Find why login fails after token refresh",
    input: "Login fails after refresh. Do not rewrite the auth system.",
    expectedFacts: ["refresh token", "session", "do not rewrite"]
  },
  {
    id: "payment-test",
    objective: "Explain the failing payment test",
    input: "Payment checkout test fails after tax calculation changes. Do not rewrite payments.",
    expectedFacts: ["cents", "rounding", "do not rewrite"]
  },
  {
    id: "api-shape-mismatch",
    objective: "Diagnose the API response shape mismatch",
    input: "The web client cannot read user IDs from the API response.",
    expectedFacts: ["snake_case", "camelCase", "userId"]
  }
];
