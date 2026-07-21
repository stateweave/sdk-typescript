export const oneShotSdkBuildPrompt = `You are a senior JavaScript engineer working in a fresh project workspace. Complete this assignment autonomously in one uninterrupted run. Build the project, test it, fix problems you find, and leave a working implementation behind rather than stopping at a plan.

## Task

Build a reusable vanilla JavaScript SDK on top of the Desmos Graphing Calculator API, then use your SDK to build a complete interactive Stackelberg duopoly model with two charts.

The SDK must be genuinely reusable, not a script written only for this model. All direct Desmos interaction must live inside the SDK. The model should be assembled through the SDK's public API.

Use vanilla JavaScript, HTML, and CSS. You may choose an appropriate browser-compatible symbolic mathematics dependency. Design the SDK architecture and API yourself. It should make it practical to create multiple graphs, register and derive expressions, add editable math inputs and controls, show labels and draggable points, and keep related values synchronized.

A minimal Desmos orientation:

~~~js
const calculator = Desmos.GraphingCalculator(element, options);
calculator.setMathBounds({ left, right, bottom, top });
calculator.updateSettings({ showXAxis: true, showYAxis: true });
calculator.setExpression({ id: "demand", latex: "P(Q)=60-\\frac{Q}{2}" });
const helper = calculator.HelperExpression({ latex: "Q_s" });
helper.observe("numericValue", () => console.log(helper.numericValue));
~~~

## Economic model

Use editable default functions:

- Inverse demand: "P(Q)=60-\\frac{Q}{2}"
- Leader cost: "C_L(q_L)=\\frac{q_L^2}{10}"
- Follower cost: "C_F(q_F)=\\frac{q_F^2}{8}"

Derive the follower's best response and solve the leader's quantity choice by backward induction. Do not use hard-coded equilibrium values as the computational implementation. With the default functions, the model should produce:

- Leader quantity 45
- Follower quantity 30
- Total quantity 75
- Market price 22.5

The first chart should use total quantity and price axes. Show inverse demand, market marginal revenue, aggregate industry marginal cost, the Stackelberg outcome, and the price implied by an alternative leader/follower allocation. Include an optional cartel view with its point and revenue rectangle. The default cartel result is total quantity 54 and price 33.

The second chart should use leader quantity and follower quantity axes. Show the Stackelberg allocation and both firms' isoprofit curves through it. Add adjustable leader and follower quantities, a synchronized draggable point, corresponding alternative isoprofit curves, and an optional shaded region where both firms are better off than at the Stackelberg allocation.

Users must be able to edit demand and both cost functions and see the dependent results and charts update without reloading. Include clear controls for the alternative allocation and both optional views.

## Deliverable

Create a polished responsive single-page application, the reusable SDK source, a README explaining the SDK and model, and focused automated tests. Include clear commands to run, test, and build the project. Keep deployment-specific Desmos configuration outside committed secrets.

Before finishing, run the available tests and build checks, verify both charts and interactions, and check for uncaught browser errors when browser tooling is available. In your final response, briefly list what you built, important files, verification commands and results, and any genuine limitation. Do not paste the full source code.`;

export function oneShotPromptStats(): { characters: number; words: number } {
  return {
    characters: oneShotSdkBuildPrompt.length,
    words: oneShotSdkBuildPrompt.trim().split(/\s+/).length
  };
}

export const sdkBuildBenchmarkVersion = 1;
export const causalWeaveVariantVersion = "causal-weave-v1";
export type SdkBuildArm = "graph" | "transcript";
export type SdkBuildRunStatus = "ready" | "queued" | "preparing" | "running" | "completed" | "failed" | "stopping" | "stopped";
export type SdkBuildArmStatus = "waiting" | "preparing" | "running" | "completed" | "failed" | "stopped";
export type SdkBuildProgress = {
  iteration: number;
  phase: string;
  modelCalls: number;
  toolCalls: number;
  totalInputTokens?: number;
  outputTokens?: number;
  detail: string;
  updatedAt: string;
};
export type SdkBuildMetrics = {
  modelCalls: number;
  toolCalls: number;
  latestContextTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  durationMs: number;
};
export type SdkBuildAttempt = {
  attempt: number;
  maxIterations: number;
  status: SdkBuildArmStatus;
  artifactKey: string;
  completedAt?: string;
  error?: string;
};
export type SdkBuildArmState = {
  slot: 1 | 2 | 3;
  status: SdkBuildArmStatus;
  sandboxName?: string;
  startedAt?: string;
  completedAt?: string;
  progress?: SdkBuildProgress;
  finalAnswer?: string;
  error?: string;
  metrics?: SdkBuildMetrics;
  previewRoot?: string;
  artifactKey?: string;
  attempt?: number;
  maxIterations?: number;
  previousAttempts?: SdkBuildAttempt[];
};
export type SdkBuildJudgement = {
  scoreA: number;
  scoreB: number;
  notes: string;
  submittedAt: string;
};
export type SdkBuildBenchmarkState = {
  version: number;
  status: SdkBuildRunStatus;
  message: string;
  promptSha256: string;
  promptWords: number;
  workerHeartbeatAt: string;
  runId?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  executionOrder?: SdkBuildArm[];
  labels?: { a: SdkBuildArm; b: SdkBuildArm };
  arms: Record<SdkBuildArm, SdkBuildArmState>;
  retry?: { candidate: "a" | "b"; attempt: number; maxIterations: number; requestedAt: string; reason?: "failed-candidate" | "runtime-correction" };
  variantC?: SdkBuildArmState & { version: string; requestedAt: string };
  judgement?: SdkBuildJudgement;
};
