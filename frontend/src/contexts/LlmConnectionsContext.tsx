"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
    deleteLlmConnection,
    getLlmConnections,
    getLlmModels,
    getModelPreferences,
    saveLlmConnection,
    saveModelPreferences,
    type LlmConnection,
    type LlmModel,
    type ModelPreferences,
    type ModelSelection,
} from "@/app/lib/mikeApi";

type Context = {
    connections: LlmConnection[];
    models: LlmModel[];
    preferences: ModelPreferences;
    loading: boolean;
    reload: () => Promise<void>;
    saveConnection: (payload: Partial<LlmConnection> & { apiKey?: string | null }) => Promise<boolean>;
    deleteConnection: (id: string) => Promise<boolean>;
    setPreference: (role: "main" | "tabular", selection: ModelSelection | null) => Promise<boolean>;
};

const LlmConnectionsContext = createContext<Context | undefined>(undefined);
const EMPTY_PREFS: ModelPreferences = { main: null, tabular: null };

export function LlmConnectionsProvider({ children }: { children: React.ReactNode }) {
    const { isAuthenticated } = useAuth();
    const [connections, setConnections] = useState<LlmConnection[]>([]);
    const [models, setModels] = useState<LlmModel[]>([]);
    const [preferences, setPreferences] = useState<ModelPreferences>(EMPTY_PREFS);
    const [loading, setLoading] = useState(false);

    const reload = useCallback(async () => {
        if (!isAuthenticated) {
            setConnections([]);
            setModels([]);
            setPreferences(EMPTY_PREFS);
            return;
        }
        setLoading(true);
        try {
            const [nextConnections, nextModels, nextPreferences] = await Promise.all([
                getLlmConnections().catch(() => []),
                getLlmModels().catch(() => []),
                getModelPreferences().catch(() => EMPTY_PREFS),
            ]);
            setConnections(nextConnections);
            setModels(nextModels);
            setPreferences(nextPreferences);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated]);

    useEffect(() => { void reload(); }, [reload]);

    const saveConnection = useCallback(async (payload: Partial<LlmConnection> & { apiKey?: string | null }) => {
        try {
            await saveLlmConnection(payload);
            await reload();
            return true;
        } catch {
            return false;
        }
    }, [reload]);

    const removeConnection = useCallback(async (id: string) => {
        try {
            await deleteLlmConnection(id);
            await reload();
            return true;
        } catch {
            return false;
        }
    }, [reload]);

    const setPreference = useCallback(async (role: "main" | "tabular", selection: ModelSelection | null) => {
        try {
            const next = await saveModelPreferences({ ...preferences, [role]: selection });
            setPreferences(next);
            return true;
        } catch {
            return false;
        }
    }, [preferences]);

    return (
        <LlmConnectionsContext.Provider value={{ connections, models, preferences, loading, reload, saveConnection, deleteConnection: removeConnection, setPreference }}>
            {children}
        </LlmConnectionsContext.Provider>
    );
}

export function useLlmConnections() {
    const context = useContext(LlmConnectionsContext);
    if (!context) throw new Error("useLlmConnections must be used within LlmConnectionsProvider");
    return context;
}
