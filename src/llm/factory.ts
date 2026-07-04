import { AnthropicModel, anthropicConfigFromEnv } from "./anthropicModel.js";
import { MockModel, type Model } from "./model.js";

export type ModelProvider = "mock" | "anthropic" | "real";

export function createModelFromEnv(env: NodeJS.ProcessEnv = process.env): Model {
  const provider = providerFromEnv(env);
  if (provider === "anthropic" || provider === "real") return new AnthropicModel(anthropicConfigFromEnv(env));
  return new MockModel();
}

function providerFromEnv(env: NodeJS.ProcessEnv): ModelProvider {
  const provider = (env.STATEWEAVE_MODEL_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : "mock")).toLowerCase();
  if (provider === "mock" || provider === "anthropic" || provider === "real") return provider;
  throw new Error(`Unsupported STATEWEAVE_MODEL_PROVIDER: ${provider}`);
}
