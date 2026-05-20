import { createServerSupabase } from "./supabase";
import type { UserApiKeys } from "./llm";
import { resolveSelection } from "./llmConnections";
import { getUserApiKeys as getStoredUserApiKeys } from "./userApiKeys";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    api_keys: UserApiKeys;
};

export async function getUserModelSettings(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const tabular = await resolveSelection(userId, "tabular", undefined, client);
    return {
        title_model: tabular.model,
        tabular_model: tabular.model,
        api_keys: tabular.apiKeys,
    };
}

export async function getUserApiKeys(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    return getStoredUserApiKeys(userId, client);
}
