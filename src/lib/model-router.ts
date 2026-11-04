/**
 * External model router — selects provider/model BEFORE calling Cline.
 * Per-task routing only (not an in-session model switch).
 *
 * MVP default: route ALL tasks to Gemini (Cline provider id `gemini`).
 * OpenAI uses Cline id `openai-native` (not bare `openai`) — kept for later.
 */

export type TaskComplexity = "fast" | "smart";

export type LlmProviderId = "openai" | "gemini" | "anthropic";

export interface RoutedModel {
  providerId: LlmProviderId;
  /** Cline / OpenAI-compatible provider id expected by ClineCore */
  clineProviderId: string;
  modelId: string;
  tier: TaskComplexity;
  reason: string;
}

export interface RouteTaskInput {
  prompt: string;
  preferredProvider?: LlmProviderId;
  /** Force a tier; otherwise inferred from prompt heuristics */
  forceTier?: TaskComplexity;
}

/** MVP: force Gemini for reliability until openai-native enablement is wired. */
const MVP_FORCE_GEMINI = true;

const FAST_MODELS: Record<LlmProviderId, { clineProviderId: string; modelId: string }> = {
  // Cline expects `openai-native`, not `openai`
  openai: { clineProviderId: "openai-native", modelId: "gpt-4o-mini" },
  gemini: { clineProviderId: "gemini", modelId: "gemini-3.8-flash" },
  anthropic: { clineProviderId: "anthropic", modelId: "claude-3-5-haiku-latest" },
};

const SMART_MODELS: Record<LlmProviderId, { clineProviderId: string; modelId: string }> = {
  openai: { clineProviderId: "openai-native", modelId: "gpt-4o" },
  gemini: { clineProviderId: "gemini", modelId: "gemini-3.8-pro" },
  anthropic: { clineProviderId: "anthropic", modelId: "claude-3-5-sonnet-latest" },
};

/** Ordered fallbacks if the primary Gemini model is unavailable. */
export const GEMINI_FAST_FALLBACKS = [
  "gemini-3.8-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
] as const;

export const GEMINI_SMART_FALLBACKS = [
  "gemini-3.8-pro",
  "gemini-3.1-pro-preview",
  "gemini-2.0-flash-exp",
  "gemini-1.5-pro",
] as const;

const SMART_HINTS =
  /\b(architect|refactor|migrate|debug|security|design|complex|multi[- ]?file|implement|rewrite|analyze|root cause)\b/i;

const FAST_HINTS =
  /\b(rename|typo|format|list|summarize|explain briefly|quick|simple|one[- ]liner|find file)\b/i;

export function inferTaskComplexity(prompt: string): TaskComplexity {
  if (SMART_HINTS.test(prompt) || prompt.length > 800) return "smart";
  if (FAST_HINTS.test(prompt) || prompt.length < 120) return "fast";
  return "smart";
}

/**
 * Map Vigil provider preference → Cline built-in provider id.
 */
export function toClineProviderId(provider: LlmProviderId): string {
  switch (provider) {
    case "openai":
      return "openai-native";
    case "gemini":
      return "gemini";
    case "anthropic":
      return "anthropic";
    default:
      return "gemini";
  }
}

export function routeTask(input: RouteTaskInput): RoutedModel {
  const tier = input.forceTier ?? inferTaskComplexity(input.prompt);

  // MVP: always Gemini (3.8 flash / pro by tier)
  const provider: LlmProviderId = MVP_FORCE_GEMINI
    ? "gemini"
    : (input.preferredProvider ?? "gemini");

  const pick = (tier === "fast" ? FAST_MODELS : SMART_MODELS)[provider];

  return {
    providerId: provider,
    clineProviderId: pick.clineProviderId,
    modelId: pick.modelId,
    tier,
    reason: MVP_FORCE_GEMINI
      ? tier === "fast"
        ? "MVP: Gemini 3.8 Flash for lightweight tasks"
        : "MVP: Gemini 3.8 Pro for complex coding tasks"
      : tier === "fast"
        ? "Cheap/fast model for lightweight tasks"
        : "Higher-capability model for complex coding tasks",
  };
}

export function listRoutableModels(): RoutedModel[] {
  const providers: LlmProviderId[] = ["openai", "gemini", "anthropic"];
  return providers.flatMap((providerId) => [
    {
      providerId,
      ...FAST_MODELS[providerId],
      tier: "fast" as const,
      reason: "fast tier",
    },
    {
      providerId,
      ...SMART_MODELS[providerId],
      tier: "smart" as const,
      reason: "smart tier",
    },
  ]);
}
