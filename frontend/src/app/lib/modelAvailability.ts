export type ModelProvider = "claude" | "gemini" | "openai";

export function isModelAvailable(..._args: unknown[]): boolean {
    return true;
}

export function getModelProvider(..._args: unknown[]): ModelProvider {
    return "openai";
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic";
    if (provider === "gemini") return "Google";
    return "OpenAI-compatible";
}

export function modelGroupToProvider(): ModelProvider {
    return "openai";
}
