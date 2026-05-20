import crypto from "crypto";
import { createServerSupabase } from "./supabase";
import type { UserApiKeys } from "./llm";

type Db = ReturnType<typeof createServerSupabase>;
export type ApiKeyProvider = "claude" | "gemini" | "openai";
export type ApiKeySource = "user" | "env" | null;
export type OpenAIProviderConfig = {
    baseUrl: string | null;
    modelMap: string | null;
    httpReferer: string | null;
    appTitle: string | null;
};

export type ApiKeyStatus = Record<ApiKeyProvider, boolean> & {
    sources: Record<ApiKeyProvider, ApiKeySource>;
    openaiConfig: OpenAIProviderConfig;
};

type EncryptedKeyRow = {
    provider: ApiKeyProvider;
    encrypted_key: string;
    iv: string;
    auth_tag: string;
    openai_base_url?: string | null;
    openai_model_map?: string | null;
    openai_http_referer?: string | null;
    openai_app_title?: string | null;
};

const PROVIDERS: ApiKeyProvider[] = ["claude", "gemini", "openai"];

function envApiKey(provider: ApiKeyProvider): string | null {
    if (provider === "claude") {
        return (
            process.env.ANTHROPIC_API_KEY?.trim() ||
            process.env.CLAUDE_API_KEY?.trim() ||
            null
        );
    }
    if (provider === "openai") {
        return process.env.OPENAI_API_KEY?.trim() || null;
    }
    return process.env.GEMINI_API_KEY?.trim() || null;
}

export function hasEnvApiKey(provider: ApiKeyProvider): boolean {
    return !!envApiKey(provider);
}

function encryptionKey(): Buffer {
    const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error("USER_API_KEYS_ENCRYPTION_SECRET is not configured");
    }
    return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value: string): Omit<EncryptedKeyRow, "provider"> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    return {
        encrypted_key: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        auth_tag: cipher.getAuthTag().toString("base64"),
    };
}

function decrypt(row: EncryptedKeyRow): string | null {
    try {
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            encryptionKey(),
            Buffer.from(row.iv, "base64"),
        );
        decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(row.encrypted_key, "base64")),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    } catch (err) {
        console.error("[user-api-keys] failed to decrypt stored key", {
            provider: row.provider,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

function isProvider(value: string): value is ApiKeyProvider {
    return (PROVIDERS as string[]).includes(value);
}

export function normalizeApiKeyProvider(value: string): ApiKeyProvider | null {
    return isProvider(value) ? value : null;
}

function envOpenAIConfig(): OpenAIProviderConfig {
    return {
        baseUrl: process.env.OPENAI_BASE_URL?.trim() || null,
        modelMap: process.env.OPENAI_MODEL_MAP?.trim() || null,
        httpReferer: process.env.OPENAI_HTTP_REFERER?.trim() || null,
        appTitle: process.env.OPENAI_APP_TITLE?.trim() || null,
    };
}

function openAIConfigFromRow(row?: Partial<EncryptedKeyRow> | null): OpenAIProviderConfig {
    const envConfig = envOpenAIConfig();
    return {
        baseUrl: row?.openai_base_url?.trim() || envConfig.baseUrl,
        modelMap: row?.openai_model_map?.trim() || envConfig.modelMap,
        httpReferer: row?.openai_http_referer?.trim() || envConfig.httpReferer,
        appTitle: row?.openai_app_title?.trim() || envConfig.appTitle,
    };
}

export async function getUserApiKeyStatus(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<ApiKeyStatus> {
    const status: ApiKeyStatus = {
        claude: false,
        gemini: false,
        openai: false,
        sources: {
            claude: null,
            gemini: null,
            openai: null,
        },
        openaiConfig: envOpenAIConfig(),
    };

    for (const provider of PROVIDERS) {
        if (hasEnvApiKey(provider)) {
            status[provider] = true;
            status.sources[provider] = "env";
        }
    }

    const { data, error } = await db
        .from("user_api_keys")
        .select("provider, encrypted_key, iv, auth_tag, openai_base_url, openai_model_map, openai_http_referer, openai_app_title")
        .eq("user_id", userId);
    if (error) throw error;

    for (const row of (data ?? []) as Partial<EncryptedKeyRow>[]) {
        const provider = normalizeApiKeyProvider(String(row.provider));
        const decryptedKey = provider ? decrypt(row as EncryptedKeyRow) : null;
        if (provider && decryptedKey?.trim() && !status[provider]) {
            status[provider] = true;
            status.sources[provider] = "user";
        }
        if (provider === "openai") {
            status.openaiConfig = openAIConfigFromRow(row);
        }
    }

    return status;
}

export async function getUserApiKeys(
    userId: string,
    db: Db = createServerSupabase(),
): Promise<UserApiKeys> {
    const apiKeys: UserApiKeys = {
        claude: envApiKey("claude"),
        gemini: envApiKey("gemini"),
        openai: envApiKey("openai"),
    };

    const { data, error } = await db
        .from("user_api_keys")
        .select("provider, encrypted_key, iv, auth_tag, openai_base_url, openai_model_map, openai_http_referer, openai_app_title")
        .eq("user_id", userId);
    if (error) throw error;

    for (const row of (data ?? []) as EncryptedKeyRow[]) {
        const provider = normalizeApiKeyProvider(row.provider);
        if (!provider) continue;
        if (provider === "openai") {
            apiKeys.openaiConfig = openAIConfigFromRow(row);
        }
        if (apiKeys[provider]?.trim()) continue;
        apiKeys[provider] = decrypt(row);
    }

    apiKeys.openaiConfig ??= envOpenAIConfig();
    return apiKeys;
}

export async function saveUserApiKey(
    userId: string,
    provider: ApiKeyProvider,
    value: string | null,
    db: Db = createServerSupabase(),
): Promise<void> {
    const normalized = value?.trim() || null;
    if (!normalized) {
        const { error } = await db
            .from("user_api_keys")
            .delete()
            .eq("user_id", userId)
            .eq("provider", provider);
        if (error) throw error;
        return;
    }

    const { error } = await db.from("user_api_keys").upsert(
        {
            user_id: userId,
            provider,
            ...encrypt(normalized),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
    );
    if (error) throw error;
}

export async function saveOpenAIProviderConfig(
    userId: string,
    config: OpenAIProviderConfig,
    db: Db = createServerSupabase(),
): Promise<void> {
    const normalize = (value: string | null | undefined) => value?.trim() || null;
    const modelMap = normalize(config.modelMap);
    if (modelMap) JSON.parse(modelMap);

    const existing = await db
        .from("user_api_keys")
        .select("provider")
        .eq("user_id", userId)
        .eq("provider", "openai")
        .maybeSingle();
    if (existing.error) throw existing.error;

    const update = {
        openai_base_url: normalize(config.baseUrl),
        openai_model_map: modelMap,
        openai_http_referer: normalize(config.httpReferer),
        openai_app_title: normalize(config.appTitle),
        updated_at: new Date().toISOString(),
    };

    if (existing.data) {
        const { error } = await db
            .from("user_api_keys")
            .update(update)
            .eq("user_id", userId)
            .eq("provider", "openai");
        if (error) throw error;
        return;
    }

    const { error } = await db.from("user_api_keys").insert({
        user_id: userId,
        provider: "openai",
        ...encrypt(""),
        ...update,
    });
    if (error) throw error;
}
