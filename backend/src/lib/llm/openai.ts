import type {
    LlmMessage,
    NormalizedToolCall,
    NormalizedToolResult,
    OpenAICompatibleConfig,
    OpenAIToolSchema,
    StreamChatParams,
    StreamChatResult,
} from "./types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_OUTPUT_TOKENS = 16384;

type ResponseInputItem =
    | { role: "user" | "assistant"; content: string }
    | { type: "function_call_output"; call_id: string; output: string };

type ResponseFunctionTool = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
};

type ResponseFunctionCallItem = {
    type: "function_call";
    call_id?: string;
    name?: string;
    arguments?: string;
};

type ResponseStreamEvent = {
    type?: string;
    delta?: string;
    response?: { id?: string; output_text?: string };
    item?: ResponseFunctionCallItem;
};

type ChatMessage =
    | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

type ChatTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
};

type ChatToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};

type ChatStreamChoiceDelta = {
    content?: string | null;
    tool_calls?: {
        index: number;
        id?: string;
        type?: "function";
        function?: {
            name?: string;
            arguments?: string;
        };
    }[];
};

type ChatStreamEvent = {
    choices?: { delta?: ChatStreamChoiceDelta; finish_reason?: string | null }[];
};

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

function openAIBaseUrl(override?: string | null): string {
    return trimTrailingSlash(
        override?.trim() || process.env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
    );
}

function responsesUrl(baseUrl?: string | null): string {
    return `${openAIBaseUrl(baseUrl)}/responses`;
}

function chatCompletionsUrl(baseUrl?: string | null): string {
    return `${openAIBaseUrl(baseUrl)}/chat/completions`;
}

function useChatCompletions(baseUrl?: string | null): boolean {
    const explicit = process.env.OPENAI_USE_CHAT_COMPLETIONS?.trim().toLowerCase();
    if (explicit) return ["1", "true", "yes", "on"].includes(explicit);
    return openAIBaseUrl(baseUrl) !== DEFAULT_OPENAI_BASE_URL;
}

function apiKey(override?: string | null): string {
    const key = override?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
    if (!key) {
        throw new Error(
            "OpenAI API key is not configured. Set OPENAI_API_KEY or add a user OpenAI key.",
        );
    }
    return key;
}

function resolveOpenAIModel(model: string, modelMap?: string | null): string {
    const raw = modelMap?.trim() || process.env.OPENAI_MODEL_MAP?.trim();
    if (!raw) return model;

    try {
        const parsed = JSON.parse(raw) as Record<string, string>;
        return parsed[model]?.trim() || model;
    } catch {
        throw new Error("OPENAI_MODEL_MAP must be valid JSON, e.g. {\"gpt-5.5\":\"openai/gpt-4o\"}");
    }
}

function extraHeaders(config?: { httpReferer?: string | null; appTitle?: string | null }): Record<string, string> {
    const headers: Record<string, string> = {};
    const referer = config?.httpReferer?.trim() || process.env.OPENAI_HTTP_REFERER?.trim();
    const title = config?.appTitle?.trim() || process.env.OPENAI_APP_TITLE?.trim();
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-Title"] = title;
    return headers;
}

function toResponseTools(tools: OpenAIToolSchema[]): ResponseFunctionTool[] {
    return tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
}

function toChatTools(tools: OpenAIToolSchema[]): ChatTool[] {
    return tools.map((tool) => ({
        type: "function",
        function: tool.function,
    }));
}

function toResponseInput(messages: LlmMessage[]): ResponseInputItem[] {
    return messages.map((message) => ({
        role: message.role,
        content: message.content,
    }));
}

function toChatMessages(messages: LlmMessage[], systemPrompt?: string): ChatMessage[] {
    return [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...messages.map((message) => ({
            role: message.role,
            content: message.content,
        })),
    ];
}

function extractSseJson(buffer: string): { events: unknown[]; rest: string } {
    const events: unknown[] = [];
    const chunks = buffer.split(/\n\n/);
    const rest = chunks.pop() ?? "";

    for (const chunk of chunks) {
        const dataLines = chunk
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

        for (const data of dataLines) {
            if (!data || data === "[DONE]") continue;
            try {
                events.push(JSON.parse(data));
            } catch {
                // Incomplete events stay buffered until the next read.
            }
        }
    }

    return { events, rest };
}

function parseFunctionCall(item: ResponseFunctionCallItem): NormalizedToolCall {
    let input: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(item.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
        }
    } catch {
        input = {};
    }

    return {
        id: item.call_id ?? item.name ?? "function_call",
        name: item.name ?? "",
        input,
    };
}

function parseChatToolCall(call: ChatToolCall): NormalizedToolCall {
    let input: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
        }
    } catch {
        input = {};
    }

    return {
        id: call.id,
        name: call.function.name,
        input,
    };
}

async function checkedFetch(url: string, init: RequestInit, providerName: string): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        const err = new Error(
            `${providerName} request failed (${response.status}): ${text || response.statusText}`,
        );
        (err as { status?: number }).status = response.status;
        throw err;
    }
    return response;
}

async function createResponse(params: {
    model: string;
    input: ResponseInputItem[];
    instructions?: string;
    tools?: ResponseFunctionTool[];
    stream?: boolean;
    maxTokens?: number;
    previousResponseId?: string;
    reasoningSummary?: boolean;
    apiKey: string;
    baseUrl?: string | null;
    modelMap?: string | null;
    httpReferer?: string | null;
    appTitle?: string | null;
}): Promise<Response> {
    return checkedFetch(
        responsesUrl(params.baseUrl),
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${params.apiKey}`,
                "Content-Type": "application/json",
                ...extraHeaders(params),
            },
            body: JSON.stringify({
                model: resolveOpenAIModel(params.model, params.modelMap),
                instructions: params.instructions || undefined,
                input: params.input,
                tools: params.tools?.length ? params.tools : undefined,
                stream: params.stream,
                max_output_tokens: params.maxTokens ?? MAX_OUTPUT_TOKENS,
                previous_response_id: params.previousResponseId,
                reasoning: params.reasoningSummary
                    ? { summary: "auto" }
                    : undefined,
            }),
        },
        "OpenAI",
    );
}

async function createChatCompletion(params: {
    model: string;
    messages: ChatMessage[];
    tools?: ChatTool[];
    stream?: boolean;
    maxTokens?: number;
    apiKey: string;
    baseUrl?: string | null;
    modelMap?: string | null;
    httpReferer?: string | null;
    appTitle?: string | null;
}): Promise<Response> {
    return checkedFetch(
        chatCompletionsUrl(params.baseUrl),
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${params.apiKey}`,
                "Content-Type": "application/json",
                ...extraHeaders(params),
            },
            body: JSON.stringify({
                model: resolveOpenAIModel(params.model, params.modelMap),
                messages: params.messages,
                tools: params.tools?.length ? params.tools : undefined,
                tool_choice: params.tools?.length ? "auto" : undefined,
                stream: params.stream,
                max_tokens: params.maxTokens ?? MAX_OUTPUT_TOKENS,
            }),
        },
        "OpenAI-compatible",
    );
}

async function streamOpenAIResponses(params: StreamChatParams, key: string): Promise<StreamChatResult> {
    const openaiConfig = params.apiKeys?.openaiConfig;
    const {
        model,
        systemPrompt,
        tools = [],
        callbacks = {},
        runTools,
        enableThinking,
    } = params;
    const maxIter = params.maxIterations ?? 10;
    const responseTools = toResponseTools(tools);
    let input = toResponseInput(params.messages);
    let previousResponseId: string | undefined;
    let fullText = "";
    const hasTools = responseTools.length > 0;

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await createResponse({
            model,
            instructions: iter === 0 ? systemPrompt : undefined,
            input,
            tools: responseTools,
            stream: true,
            previousResponseId,
            reasoningSummary: !!enableThinking,
            apiKey: key,
            ...openaiConfig,
        });
        if (!response.body) throw new Error("OpenAI response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const toolCalls: NormalizedToolCall[] = [];
        const startedToolCallIds = new Set<string>();
        let buffer = "";
        let pendingText = "";
        let sawReasoning = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const extracted = extractSseJson(buffer);
            buffer = extracted.rest;

            for (const event of extracted.events as ResponseStreamEvent[]) {
                if (event.response?.id) previousResponseId = event.response.id;

                if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
                    sawReasoning = true;
                    callbacks.onReasoningDelta?.(event.delta);
                }

                if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
                    if (hasTools) pendingText += event.delta;
                    else {
                        fullText += event.delta;
                        callbacks.onContentDelta?.(event.delta);
                    }
                }

                if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
                    const call = parseFunctionCall(event.item);
                    startedToolCallIds.add(call.id);
                    callbacks.onToolCallStart?.(call);
                }

                if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
                    const call = parseFunctionCall(event.item);
                    if (!startedToolCallIds.has(call.id)) callbacks.onToolCallStart?.(call);
                    toolCalls.push(call);
                }
            }
        }

        if (sawReasoning) callbacks.onReasoningBlockEnd?.();

        if (!toolCalls.length || !runTools) {
            if (pendingText) {
                fullText += pendingText;
                callbacks.onContentDelta?.(pendingText);
            }
            break;
        }

        const results = await runTools(toolCalls);
        input = results.map((result) => ({
            type: "function_call_output",
            call_id: result.tool_use_id,
            output: result.content,
        }));
    }

    return { fullText };
}

async function streamOpenAIChatCompletions(params: StreamChatParams, key: string): Promise<StreamChatResult> {
    const openaiConfig = params.apiKeys?.openaiConfig;
    const { model, systemPrompt, tools = [], callbacks = {}, runTools } = params;
    const maxIter = params.maxIterations ?? 10;
    const chatTools = toChatTools(tools);
    const messages = toChatMessages(params.messages, systemPrompt);
    let fullText = "";
    const hasTools = chatTools.length > 0;

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await createChatCompletion({
            model,
            messages,
            tools: chatTools,
            stream: true,
            apiKey: key,
            ...openaiConfig,
        });
        if (!response.body) throw new Error("OpenAI-compatible response had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const toolCallParts = new Map<number, ChatToolCall>();
        const startedToolCallIds = new Set<string>();
        let buffer = "";
        let pendingText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const extracted = extractSseJson(buffer);
            buffer = extracted.rest;

            for (const event of extracted.events as ChatStreamEvent[]) {
                const delta = event.choices?.[0]?.delta;
                if (!delta) continue;

                if (typeof delta.content === "string") {
                    if (hasTools) pendingText += delta.content;
                    else {
                        fullText += delta.content;
                        callbacks.onContentDelta?.(delta.content);
                    }
                }

                for (const chunk of delta.tool_calls ?? []) {
                    const existing = toolCallParts.get(chunk.index) ?? {
                        id: chunk.id ?? `tool_call_${chunk.index}`,
                        type: "function",
                        function: { name: "", arguments: "" },
                    };
                    if (chunk.id) existing.id = chunk.id;
                    if (chunk.function?.name) existing.function.name += chunk.function.name;
                    if (chunk.function?.arguments) existing.function.arguments += chunk.function.arguments;
                    toolCallParts.set(chunk.index, existing);

                    if (!startedToolCallIds.has(existing.id) && existing.function.name) {
                        startedToolCallIds.add(existing.id);
                        callbacks.onToolCallStart?.(parseChatToolCall(existing));
                    }
                }
            }
        }

        const chatToolCalls = [...toolCallParts.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, call]) => call)
            .filter((call) => call.function.name);
        const toolCalls = chatToolCalls.map(parseChatToolCall);

        if (!toolCalls.length || !runTools) {
            if (pendingText) {
                fullText += pendingText;
                callbacks.onContentDelta?.(pendingText);
            }
            break;
        }

        messages.push({
            role: "assistant",
            content: pendingText || null,
            tool_calls: chatToolCalls,
        });
        const results = await runTools(toolCalls);
        for (const result of results) {
            messages.push({
                role: "tool",
                tool_call_id: result.tool_use_id,
                content: result.content,
            });
        }
    }

    return { fullText };
}

export async function streamOpenAI(params: StreamChatParams): Promise<StreamChatResult> {
    const key = apiKey(params.apiKeys?.openai);
    if (useChatCompletions(params.apiKeys?.openaiConfig?.baseUrl)) return streamOpenAIChatCompletions(params, key);
    return streamOpenAIResponses(params, key);
}

export async function completeOpenAIText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { openai?: string | null; openaiConfig?: OpenAICompatibleConfig };
}): Promise<string> {
    const key = apiKey(params.apiKeys?.openai);
    const openaiConfig = params.apiKeys?.openaiConfig;

    if (useChatCompletions(openaiConfig?.baseUrl)) {
        const response = await createChatCompletion({
            model: params.model,
            messages: toChatMessages([{ role: "user", content: params.user }], params.systemPrompt),
            maxTokens: params.maxTokens ?? 512,
            apiKey: key,
            ...openaiConfig,
        });
        const json = (await response.json()) as {
            choices?: { message?: { content?: string | null } }[];
        };
        return json.choices?.[0]?.message?.content ?? "";
    }

    const response = await createResponse({
        model: params.model,
        instructions: params.systemPrompt,
        input: [{ role: "user", content: params.user }],
        maxTokens: params.maxTokens ?? 512,
        apiKey: key,
        ...openaiConfig,
    });
    const json = (await response.json()) as {
        output_text?: string;
        output?: {
            content?: { type?: string; text?: string }[];
        }[];
    };

    if (typeof json.output_text === "string") return json.output_text;

    return (
        json.output
            ?.flatMap((item) => item.content ?? [])
            .filter((content) => content.type === "output_text")
            .map((content) => content.text ?? "")
            .join("") ?? ""
    );
}

export type { NormalizedToolResult };
