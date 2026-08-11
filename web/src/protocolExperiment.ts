export const protocolExperiment = {
  "experiment": "stateweave-protocol-sft-v1",
  "model": "Qwen/Qwen2.5-1.5B-Instruct",
  "trainExamples": 480,
  "evalExamples": 200,
  "training": {
    "epochs": 2,
    "loraRank": 16,
    "learningRate": 0.0002,
    "gpu": "Modal L4",
    "trainLoss": 0.6463042770822843,
    "seed": 42,
    "meteredCostUsd": 0.31611802,
    "trainRuntimeSeconds": 209.0405,
    "modalTrainRun": "ap-U2rk2b8m2E0j1vuJEbmQNX",
    "modalEvalRun": "ap-23WkeNLkjAwgFaPyhKDr6l",
    "trainSha256": "8ade615411a09a75c09d94039473cb8af1a2aa13040a3dd56db31b2f899af32d",
    "evalSha256": "619f1bb4264e40db77efea242feae006b6bd1936b01f21c36809174cb9869cd1"
  },
  "base": {
    "n": 200,
    "valid_first_pct": 36.5,
    "valid_with_retry_pct": 68.5,
    "state_valid_pct": 68.5,
    "exact_first_pct": 0.0,
    "exact_with_retry_pct": 0.0,
    "mean_attempts": 2.07,
    "tool_n": 158,
    "tool_valid_first_pct": 19.62,
    "tool_valid_with_retry_pct": 60.13,
    "tool_exact_first_pct": 0.0,
    "tool_exact_with_retry_pct": 0.0,
    "final_n": 42,
    "final_valid_first_pct": 100.0,
    "final_valid_with_retry_pct": 100.0,
    "final_answer_anchor_pct": 76.19,
    "standard_exact_with_retry_pct": 0.0,
    "adversarial_valid_first_pct": 37.5,
    "adversarial_exact_with_retry_pct": 0.0
  },
  "tuned": {
    "n": 200,
    "valid_first_pct": 98.0,
    "valid_with_retry_pct": 100.0,
    "state_valid_pct": 100.0,
    "exact_first_pct": 65.5,
    "exact_with_retry_pct": 65.5,
    "mean_attempts": 1.02,
    "tool_n": 158,
    "tool_valid_first_pct": 100.0,
    "tool_valid_with_retry_pct": 100.0,
    "tool_exact_first_pct": 82.91,
    "tool_exact_with_retry_pct": 82.91,
    "final_n": 42,
    "final_valid_first_pct": 90.48,
    "final_valid_with_retry_pct": 100.0,
    "final_answer_anchor_pct": 59.52,
    "standard_exact_with_retry_pct": 72.5,
    "adversarial_valid_first_pct": 100.0,
    "adversarial_exact_with_retry_pct": 37.5
  },
  "samples": [
    {
      "id": "eval-0000",
      "expectedKind": "tool",
      "expectedTool": "read_file",
      "base": "read_file(file_path: \"app/views/atlas-0.html\")",
      "tuned": "TOOL_CALL {\"name\":\"read_file\",\"args\":{\"path\":\"app/views/atlas-0.html\"},\"state\":[]}",
      "baseExact": false,
      "tunedExact": true
    },
    {
      "id": "eval-0001",
      "expectedKind": "tool",
      "expectedTool": "write_file",
      "base": "FINAL: write_file({name: \"docs/changelog-0.md\", contents: \"# Changelog\\n\\n## Entry 0\\n\\n* Preserve the atlas migration note.*})",
      "tuned": "TOOL_CALL {\"name\":\"write_file\",\"args\":{\"path\":\"docs/changelog-0.md\",\"content\":\"Entry 0: preserve the atlas migration note.\"},\"state\":[]}",
      "baseExact": false,
      "tunedExact": true
    },
    {
      "id": "eval-0002",
      "expectedKind": "tool",
      "expectedTool": "edit_file",
      "base": "FINAL: export const profile = 'new-atlas';",
      "tuned": "TOOL_CALL {\"name\":\"edit_file\",\"args\":{\"path\":\"lib/config-0.js\",\"oldText\":\"export const profile = 'old-atlas';\",\"newText\":\"export const profile = 'new-atlas';\"},\"state\":[]}",
      "baseExact": false,
      "tunedExact": true
    },
    {
      "id": "eval-0003",
      "expectedKind": "tool",
      "expectedTool": "bash_command",
      "base": "FINAL: [\"artifacts/atlas/0\"]",
      "tuned": "TOOL_CALL {\"name\":\"bash_command\",\"args\":{\"command\":\"find artifacts/atlas/0 -maxdepth 1 -type f\"},\"state\":[]}",
      "baseExact": false,
      "tunedExact": true
    },
    {
      "id": "eval-0004",
      "expectedKind": "final",
      "expectedTool": null,
      "base": "FINAL: atlas-0",
      "tuned": "TOOL_CALL {\"name\":\"read_file\",\"args\":{\"path\":\"atlas-0\"},\"state\":[]}",
      "baseExact": false,
      "tunedExact": false
    },
    {
      "id": "eval-0005",
      "expectedKind": "tool",
      "expectedTool": "read_file",
      "base": "read_file(file_path: \"app/views/birch-1.html\")",
      "tuned": "TOOL_CALL {\"name\":\"read_file\",\"args\":{\"path\":\"app/views/birch-1.html\"},\"state\":[]}",
      "baseExact": false,
      "tunedExact": true
    }
  ],
  "runtimeProbe": {
    "status": "passed",
    "finalAnswer": "The exact document title is Simple Calculator.",
    "steps": 2,
    "protocolErrors": 0,
    "nodeKinds": {
      "system": 1,
      "user_input": 1,
      "tool_call": 1,
      "tool_result": 1,
      "resource": 1,
      "assistant_output": 1
    },
    "stateRoundTripBytes": 5136
  },
  "metricNotes": {
    "valid": "Protocol envelope parses and state entries are structurally valid.",
    "tool_exact": "Tool name and arguments exactly match the held-out deterministic action.",
    "final_answer_anchor": "Final answer contains the held-out identifier; exact prose wording is intentionally not required.",
    "adversarial": "The 40 adversarial held-out cases are included in the aggregate, not a separate training objective.",
    "semantic_dot": "Not measured; this experiment does not establish D.O.T. behavior."
  }
} as const;
