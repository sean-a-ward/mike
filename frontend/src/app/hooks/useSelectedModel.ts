"use client";

import { useCallback } from "react";
import { useLlmConnections } from "@/contexts/LlmConnectionsContext";

export function useSelectedModel(): [string | null, (id: string) => void] {
    const { preferences, setPreference } = useLlmConnections();
    const value = preferences.main ? `${preferences.main.connectionId}::${preferences.main.modelId}` : null;
    const setModel = useCallback((id: string) => {
        const [connectionId, ...rest] = id.split("::");
        void setPreference("main", { connectionId, modelId: rest.join("::") });
    }, [setPreference]);
    return [value, setModel];
}
