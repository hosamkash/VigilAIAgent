export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  /** USD */
  cost: number;
  provider?: string;
  model?: string;
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.0000";
  if (amount > 0 && amount < 0.0001) return "<$0.0001";
  return `$${amount.toFixed(4)}`;
}

export function formatUsageLine(usage: UsageSnapshot): string {
  return `Cost: ${formatUsd(usage.cost)} | Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out`;
}

/** Rough local estimate when sidecar does not return usage yet. */
export function estimateUsage(
  prompt: string,
  response: string,
  provider = "gemini",
): UsageSnapshot {
  const inputTokens = Math.max(1, Math.ceil(prompt.length / 4));
  const outputTokens = Math.max(1, Math.ceil(response.length / 4));
  const rates: Record<string, { in: number; out: number }> = {
    gemini: { in: 0.075 / 1_000_000, out: 0.3 / 1_000_000 },
    openai: { in: 0.15 / 1_000_000, out: 0.6 / 1_000_000 },
    anthropic: { in: 0.8 / 1_000_000, out: 4 / 1_000_000 },
  };
  const rate = rates[provider] ?? rates.gemini!;
  return {
    inputTokens,
    outputTokens,
    cost: inputTokens * rate.in + outputTokens * rate.out,
    provider,
  };
}

export function sumUsage(items: UsageSnapshot[]): UsageSnapshot {
  return items.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cost: acc.cost + u.cost,
      provider: acc.provider,
    }),
    { inputTokens: 0, outputTokens: 0, cost: 0 },
  );
}
