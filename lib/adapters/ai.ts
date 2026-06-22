// AI adapter — abstraction for future use.
// MVP scoring is DETERMINISTIC. Use AI only when explicitly enabled.

export type AIProvider = "groq" | "openai" | "none";

export function getAIProvider(): AIProvider {
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

/** Summarize a daily itinerary into one short Arabic paragraph.
 *  No-op in MVP (returns null). Implement when AI is desired. */
export async function summarizeDay(_input: {
  day_date: string;
  items: Array<{ name: string; slot: string; category: string }>;
}): Promise<string | null> {
  return null;
}
