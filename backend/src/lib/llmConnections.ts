import dns from "dns/promises";
import net from "net";
import { createServerSupabase } from "./supabase";
import { decryptSecret, encryptSecret } from "./encryption";
import type { LlmProviderType, UserApiKeys } from "./llm";

type Db = ReturnType<typeof createServerSupabase>;

export type ModelSelection = { connectionId: string; modelId: string };
export type ModelPreferences = { main: ModelSelection | null; tabular: ModelSelection | null };
export type LlmConnection = {
    id: string;
    name: string;
    providerType: LlmProviderType;
    baseUrl: string;
    enabled: boolean;
    hasApiKey: boolean;
    httpReferer: string | null;
    appTitle: string | null;
    modelAllowlist: string[];
    createdAt: string;
    updatedAt: string;
};

type ConnectionRow = {
    id: string;
    user_id: string;
    name: string;
    provider_type: LlmProviderType;
    base_url: string;
    encrypted_key: string;
    iv: string;
    auth_tag: string;
    enabled: boolean;
    http_referer: string | null;
    app_title: string | null;
    model_allowlist: string[] | null;
    created_at: string;
    updated_at: string;
};

function serialize(row: ConnectionRow): LlmConnection {
    return {
        id: row.id,
        name: row.name,
        providerType: row.provider_type,
        baseUrl: row.base_url,
        enabled: row.enabled,
        hasApiKey: !!decryptSecret(row),
        httpReferer: row.http_referer,
        appTitle: row.app_title,
        modelAllowlist: Array.isArray(row.model_allowlist) ? row.model_allowlist : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function validateProviderType(value: unknown): LlmProviderType {
    if (value === "openai-compatible") return value;
    throw new Error("Only OpenAI-compatible endpoints are currently supported");
}

function isPrivateIp(address: string): boolean {
    if (address === "169.254.169.254") return true;
    if (net.isIP(address) === 4) {
        const [a, b] = address.split(".").map(Number);
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
    }
    if (net.isIP(address) === 6) {
        const normalized = address.toLowerCase();
        return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
    }
    return false;
}

async function validateEndpointUrl(value: unknown): Promise<URL> {
    if (typeof value !== "string" || !value.trim()) throw new Error("Base URL is required");
    const url = new URL(value.trim());
    const allowInsecure = process.env.ALLOW_INSECURE_LLM_ENDPOINTS === "true";
    if (url.protocol !== "https:" && !allowInsecure) {
        throw new Error("Endpoint URL must use HTTPS");
    }
    const host = url.hostname.toLowerCase();
    if (["localhost", "0", "metadata.google.internal"].includes(host) && !allowInsecure) {
        throw new Error("Local endpoint URLs are not allowed");
    }
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || (records.some((record) => isPrivateIp(record.address)) && !allowInsecure)) {
        throw new Error("Endpoint URL resolves to a private or local address");
    }
    return url;
}

async function validateBaseUrl(value: unknown): Promise<string> {
    const url = await validateEndpointUrl(value);
    return url.toString().replace(/\/+$/, "");
}

function normalizeList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v).trim()).filter(Boolean);
}

export async function listConnections(userId: string, db: Db = createServerSupabase()): Promise<LlmConnection[]> {
    const { data, error } = await db.from("llm_connections").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as ConnectionRow[]).map(serialize);
}

export async function saveConnection(userId: string, body: Record<string, unknown>, db: Db = createServerSupabase()): Promise<LlmConnection> {
    const id = typeof body.id === "string" && body.id ? body.id : undefined;
    const existing = id ? await getConnectionRow(userId, id, db) : null;
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const encrypted = apiKey ? encryptSecret(apiKey) : existing ? {
        encrypted_key: existing.encrypted_key,
        iv: existing.iv,
        auth_tag: existing.auth_tag,
    } : encryptSecret("");
    const payload = {
        user_id: userId,
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled connection",
        provider_type: validateProviderType(body.providerType),
        base_url: await validateBaseUrl(body.baseUrl),
        enabled: body.enabled !== false,
        http_referer: typeof body.httpReferer === "string" && body.httpReferer.trim() ? body.httpReferer.trim() : null,
        app_title: typeof body.appTitle === "string" && body.appTitle.trim() ? body.appTitle.trim() : null,
        model_allowlist: normalizeList(body.modelAllowlist),
        updated_at: new Date().toISOString(),
        ...encrypted,
    };

    const query = id
        ? db.from("llm_connections").update(payload).eq("id", id).eq("user_id", userId).select("*").single()
        : db.from("llm_connections").insert(payload).select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return serialize(data as ConnectionRow);
}

export async function deleteConnection(userId: string, id: string, db: Db = createServerSupabase()): Promise<void> {
    const { error } = await db.from("llm_connections").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
}

async function getConnectionRow(userId: string, id: string, db: Db): Promise<ConnectionRow | null> {
    const { data, error } = await db.from("llm_connections").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data as ConnectionRow | null;
}

export async function getModelsForConnection(userId: string, id: string, db: Db = createServerSupabase()) {
    const row = await getConnectionRow(userId, id, db);
    if (!row) throw new Error("Connection not found");
    const apiKey = decryptSecret(row) ?? "";
    const fetched = await fetchModels(row, apiKey);
    const allow = new Set(row.model_allowlist ?? []);
    const models = allow.size ? fetched.filter((m) => allow.has(m.id)) : fetched;
    return models.map((m) => ({ ...m, connectionId: row.id, connectionName: row.name, providerType: row.provider_type }));
}

export async function listAvailableModels(userId: string, db: Db = createServerSupabase()) {
    const { data, error } = await db.from("llm_connections").select("*").eq("user_id", userId).eq("enabled", true);
    if (error) throw error;
    const all = [] as Awaited<ReturnType<typeof getModelsForConnection>>;
    for (const row of (data ?? []) as ConnectionRow[]) {
        try {
            all.push(...await getModelsForConnection(userId, row.id, db));
        } catch {
            for (const id of row.model_allowlist ?? []) all.push({ id, label: id, connectionId: row.id, connectionName: row.name, providerType: row.provider_type });
        }
    }
    return all;
}

async function fetchModels(row: ConnectionRow, apiKey: string): Promise<{ id: string; label: string }[]> {
    if (!apiKey && !row.model_allowlist?.length) throw new Error("API key is required");
    const baseUrl = await validateEndpointUrl(row.base_url);
    const url = `${baseUrl.toString().replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {};
    if (row.provider_type === "openai-compatible") {
        headers.Authorization = `Bearer ${apiKey}`;
        if (row.http_referer) headers["HTTP-Referer"] = row.http_referer;
        if (row.app_title) headers["X-Title"] = row.app_title;
    } else if (row.provider_type === "anthropic-compatible") {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
    } else {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) throw new Error(`Model fetch failed (${res.status})`);
        const text = await res.text();
        if (text.length > 2_000_000) throw new Error("Model response is too large");
        const json = JSON.parse(text) as { data?: { id?: string; name?: string; display_name?: string }[] };
        return (json.data ?? [])
            .map((m) => ({ id: String(m.id ?? "").trim(), label: String(m.display_name ?? m.name ?? m.id ?? "").trim() }))
            .filter((m) => m.id);
    } finally {
        clearTimeout(timeout);
    }
}

export async function getModelPreferences(userId: string, db: Db = createServerSupabase()): Promise<ModelPreferences> {
    const { data, error } = await db.from("user_model_preferences").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    const row = data as { main_connection_id: string | null; main_model_id: string | null; tabular_connection_id: string | null; tabular_model_id: string | null } | null;
    return {
        main: row?.main_connection_id && row.main_model_id ? { connectionId: row.main_connection_id, modelId: row.main_model_id } : null,
        tabular: row?.tabular_connection_id && row.tabular_model_id ? { connectionId: row.tabular_connection_id, modelId: row.tabular_model_id } : null,
    };
}

export async function saveModelPreferences(userId: string, prefs: ModelPreferences, db: Db = createServerSupabase()): Promise<ModelPreferences> {
    const payload = {
        user_id: userId,
        main_connection_id: prefs.main?.connectionId ?? null,
        main_model_id: prefs.main?.modelId ?? null,
        tabular_connection_id: prefs.tabular?.connectionId ?? null,
        tabular_model_id: prefs.tabular?.modelId ?? null,
        updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("user_model_preferences").upsert(payload, { onConflict: "user_id" });
    if (error) throw error;
    return getModelPreferences(userId, db);
}

export async function resolveSelection(userId: string, role: "main" | "tabular", override: string | null | undefined, db: Db = createServerSupabase()): Promise<{ model: string; apiKeys: UserApiKeys }> {
    let selection: ModelSelection | null = null;
    if (override?.includes("::")) {
        const [connectionId, ...rest] = override.split("::");
        selection = { connectionId, modelId: rest.join("::") };
    } else {
        selection = (await getModelPreferences(userId, db))[role];
    }
    if (!selection) throw new Error(`No ${role} model selected`);
    const row = await getConnectionRow(userId, selection.connectionId, db);
    if (!row || !row.enabled) throw new Error("Selected model connection is unavailable");
    const key = decryptSecret(row);
    if (!key) throw new Error("Selected model connection is missing an API key");
    return {
        model: selection.modelId,
        apiKeys: {
            openai: row.provider_type === "openai-compatible" ? key : null,
            claude: row.provider_type === "anthropic-compatible" ? key : null,
            gemini: row.provider_type === "google-compatible" ? key : null,
            providerType: row.provider_type,
            openaiConfig: row.provider_type === "openai-compatible" ? {
                baseUrl: row.base_url,
                httpReferer: row.http_referer,
                appTitle: row.app_title,
            } : undefined,
        },
    };
}
