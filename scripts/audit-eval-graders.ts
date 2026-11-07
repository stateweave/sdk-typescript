import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import type { AgentResult } from "../src/core/types.js";
import type { EvalTask } from "../src/evals/tasks.js";

export type Control = { id: string; expected: unknown; actual: unknown; passed: boolean };
export type GraderAudit = { sourceRoot: string; controls: Control[]; unavailable: string[]; passed: number; failed: number };

type Judge = (task: EvalTask, result: AgentResult) => { success: boolean };
type Vote = { vote?: string; reason?: string };
type WebGraders = {
  parseJudgeVote(raw: string): Vote;
  coerceJudgeVote(parsed: Vote, args: { gold: string; answerA: string; answerB: string }): Vote;
};

export function loadPureFunctions<T>(source: string, names: string[]): T {
  const file = ts.createSourceFile("grader.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = names.map((name) => {
    const matches = file.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (matches.length !== 1 || !matches[0].body) throw new Error(`Expected one function declaration for ${name}`);
    return matches[0].getText(file).replace(/^export\s+/, "");
  });
  const emitted = ts.transpileModule(declarations.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(`${emitted}\nglobalThis.graders = { ${names.join(", ")} };`).runInContext(context, { timeout: 1000 });
  return new Proxy({} as object, {
    get(_target, property) {
      if (!names.includes(String(property))) throw new Error(`Unknown grader function ${String(property)}`);
      return (...args: unknown[]) => {
        context.args = structuredClone(args);
        try {
          const value: unknown = new vm.Script(`graders[${JSON.stringify(String(property))}](...args)`).runInContext(context, { timeout: 1000 });
          if (value && typeof (value as { then?: unknown }).then === "function") throw new Error("Grader must be synchronous");
          return structuredClone(value);
        } finally {
          delete context.args;
        }
      };
    }
  }) as T;
}

function control(id: string, expected: unknown, run: () => unknown): Control {
  let actual: unknown;
  try {
    actual = run();
  } catch (error) {
    actual = { error: error instanceof Error ? error.message : String(error) };
  }
  return { id, expected, actual, passed: JSON.stringify(actual) === JSON.stringify(expected) };
}

export function auditToyJudge(judge: Judge): Control[] {
  const task = { id: "offline-control", objective: "Diagnose login failure", input: "Do not rewrite the auth system.", expectedFacts: ["refresh token", "session", "do not rewrite"] };
  const correct = "The refresh token is not updating the session. Do not rewrite the auth system.";
  const fixture = (finalAnswer: string, graphText = ""): AgentResult => ({
    finalAnswer,
    graph: { nodes: graphText ? [{ id: "fact", type: "fact", text: graphText, createdAt: "2026-01-01T00:00:00.000Z" }] : [], edges: [] },
    trace: []
  });
  return [
    control("toy.correct-final", true, () => judge(task, fixture(correct)).success),
    control("toy.empty-final", false, () => judge(task, fixture("")).success),
    control("toy.graph-only-facts", false, () => judge(task, fixture("", correct)).success),
    control("toy.wrong-final-with-graph-facts", false, () => judge(task, fixture("The issue is a stylesheet color.", correct)).success),
    control("toy.unrelated-final", false, () => judge(task, fixture("The issue is a stylesheet color.")).success),
    control("toy.forbidden-rewrite", false, () => judge(task, fixture("Refresh token session: rewrite the auth system.")).success)
  ];
}

export function auditWebGraders(graders: WebGraders): Control[] {
  const controls = ["A", "B", "BOTH", "NEITHER"].map((vote) => control(`web.label-${vote.toLowerCase()}`, vote.toLowerCase(), () => graders.parseJudgeVote(`WINNER: ${vote}\nREASON: offline control`).vote));
  for (const [id, text] of [["malformed", "not a verdict"], ["prefix-label", "WINNER: BANANA"]]) {
    controls.push(control(`web.${id}-unscored`, true, () => {
      try {
        return !["a", "b", "both", "neither"].includes(graders.parseJudgeVote(text).vote ?? "");
      } catch {
        return true;
      }
    }));
  }
  controls.push(control("web.identical-wrong-not-promoted", true, () => graders.coerceJudgeVote({ vote: "a", reason: "wrong answer" }, { gold: "azure", answerA: "scarlet", answerB: "scarlet" }).vote !== "both"));
  return controls;
}

export function auditSourceRoot(sourceRoot: string): GraderAudit {
  const root = path.resolve(sourceRoot);
  const judgePath = path.join(root, "src/evals/judge.ts");
  const { judge } = loadPureFunctions<{ judge: Judge }>(readFileSync(judgePath, "utf8"), ["judge"]);
  const controls = auditToyJudge(judge);
  const unavailable: string[] = [];
  const serverPath = path.join(root, "src/web/server.ts");
  if (existsSync(serverPath)) {
    const functions = loadPureFunctions<WebGraders>(readFileSync(serverPath, "utf8"), ["parseJudgeVote", "coerceJudgeVote", "equivalentAnswerText", "normalizeAnswerText"]);
    controls.push(...auditWebGraders(functions));
  } else {
    unavailable.push("Web graders: src/web/server.ts is absent from this source tree.");
  }
  const passed = controls.filter((item) => item.passed).length;
  return { sourceRoot: root, controls, unavailable, passed, failed: controls.length - passed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--source-root")) {
    console.error("Usage: tsx scripts/audit-eval-graders.ts [--source-root PATH]");
    process.exitCode = 2;
  } else {
    try {
      const audit = auditSourceRoot(args[1] ?? process.cwd());
      console.log(JSON.stringify(audit, null, 2));
      process.exitCode = audit.failed ? 1 : 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    }
  }
}
