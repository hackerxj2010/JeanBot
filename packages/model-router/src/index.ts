import type { Capability, ModelSelection, RiskLevel } from "@jeanbot/types";

interface SelectionInput {
  risk: RiskLevel;
  capability: Capability;
  latencySensitive?: boolean;
}

const highReasoningCapabilities = new Set<Capability>([
  "planning",
  "orchestration",
  "software-development",
  "data-analysis",
  "research"
]);

const shouldPreferOllama = () => {
  return process.env.JEANBOT_MODEL_PROVIDER === "ollama";
};

export const applyProviderPreference = (selection: ModelSelection): ModelSelection => {
  if (!shouldPreferOllama()) {
    return selection;
  }

  const model = process.env.OLLAMA_MODEL ?? "glm-5:cloud";
  return {
    provider: "ollama",
    model,
    reason: `${selection.reason} JeanBot routed this task to Ollama because the environment prefers Ollama-backed execution.`
  };
};

export const selectModel = ({
  risk,
  capability,
  latencySensitive = false
}: SelectionInput): ModelSelection => {
  let selection: ModelSelection;
  if (risk === "critical") {
    selection = {
      provider: "anthropic",
      model: "claude-opus-4-6",
      reason: "Critical-risk tasks require the highest reasoning budget."
    };
    return applyProviderPreference(selection);
  }

  if (highReasoningCapabilities.has(capability)) {
    selection = {
      provider: "anthropic",
      model: latencySensitive ? "claude-haiku-4-5" : "claude-sonnet-4-6",
      reason: "High-complexity tasks benefit from Claude Sonnet's stronger planning and synthesis."
    };
    return applyProviderPreference(selection);
  }

  selection = {
    provider: "anthropic",
    model: latencySensitive ? "claude-haiku-4-5" : "claude-haiku-4-5",
    reason: "Default route optimized for balanced latency and cost with Claude Haiku."
  };
  return applyProviderPreference(selection);
};

export const selectEmbeddingModel = () => {
  return {
    provider: "openai",
    model: "text-embedding-3-small",
    reason: "Default embedding model for long-term memory and knowledge indexing."
  };
};
