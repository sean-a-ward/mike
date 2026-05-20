"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { UserProfileProvider } from "@/contexts/UserProfileContext";
import { LlmConnectionsProvider } from "@/contexts/LlmConnectionsContext";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <UserProfileProvider>
                <LlmConnectionsProvider>{children}</LlmConnectionsProvider>
            </UserProfileProvider>
        </AuthProvider>
    );
}
