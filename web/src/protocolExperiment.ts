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
  },
  "scaleUp": {
    "model": "Qwen/Qwen2.5-32B-Instruct",
    "gpu": "Modal L4 × 2",
    "trainRun": "ap-947ExBfKSrOastbKitcEVU",
    "evalRun": "ap-hbmgVrMF06RCzp1A5j4aCx",
    "volume": "dot-stateweave-protocol-32b-v1",
    "trainLoss": 0.9969303031762441,
    "trainRuntimeSeconds": 3794.9238,
    "evalRuntimeSeconds": 3409.51,
    "meteredCostUsd": 1.9137835,
    "maxLength": 1024,
    "batchSize": 2,
    "gradientAccumulation": 4,
    "base": {
      "valid_first_pct": 42.0,
      "valid_with_retry_pct": 56.5,
      "exact_with_retry_pct": 0.5,
      "tool_exact_with_retry_pct": 0.63,
      "final_answer_anchor_pct": 76.19,
      "adversarial_valid_first_pct": 100.0,
      "adversarial_exact_with_retry_pct": 0.0,
      "mean_attempts": 2.02
    },
    "tuned": {
      "valid_first_pct": 100.0,
      "valid_with_retry_pct": 100.0,
      "exact_with_retry_pct": 76.5,
      "tool_exact_with_retry_pct": 96.84,
      "final_answer_anchor_pct": 76.19,
      "adversarial_valid_first_pct": 100.0,
      "adversarial_exact_with_retry_pct": 62.5,
      "mean_attempts": 1.0
    },
    "comparison": {
      "valid_first_delta_pp": 2.0,
      "exact_delta_pp": 11.0,
      "tool_exact_delta_pp": 13.93,
      "final_anchor_delta_pp": 16.67,
      "adversarial_exact_delta_pp": 25.0,
      "mean_attempts_delta": -0.02
    },
    "note": "The same split was used, but this is directional rather than a perfectly controlled scaling sweep: the 32B run used two GPUs, a 1024-token training cap, and a different per-device batch configuration."
  }
} as const;
