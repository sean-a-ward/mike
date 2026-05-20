"use client";

import { useState } from "react";
import { ChevronDown, Check, AlertCircle } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLlmConnections } from "@/contexts/LlmConnectionsContext";

interface Props {
    value: string | null;
    onChange: (id: string) => void;
}

export function ModelToggle({ value, onChange }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const { models, loading } = useLlmConnections();
    const selected = models.find((m) => `${m.connectionId}::${m.id}` === value);
    const selectedLabel = selected ? `${selected.connectionName} · ${selected.id}` : "No models — open settings";
    const grouped = models.reduce<Record<string, typeof models>>((acc, model) => {
        (acc[model.connectionName] ??= []).push(model);
        return acc;
    }, {});
    const entries = Object.entries(grouped);

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded-lg px-2 h-8 text-sm transition-colors cursor-pointer text-gray-400 hover:bg-gray-100 hover:text-gray-700 ${isOpen ? "bg-gray-100 text-gray-700" : ""}`}
                    title={models.length ? "Choose model" : "Configure model connections"}
                >
                    {!models.length && !loading && <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />}
                    <span className="max-w-[180px] truncate">{loading ? "Loading models..." : selectedLabel}</span>
                    <ChevronDown className={`h-3 w-3 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72 z-50" side="top" align="start">
                {!entries.length && (
                    <DropdownMenuItem className="cursor-pointer" onSelect={() => { window.location.href = "/account/models"; }}>
                        Add a connection
                    </DropdownMenuItem>
                )}
                {entries.map(([connectionName, items], gi) => (
                    <div key={connectionName}>
                        {gi > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                            {connectionName}
                        </DropdownMenuLabel>
                        {[...items].sort((a, b) => a.id.localeCompare(b.id)).map((m) => {
                            const modelValue = `${m.connectionId}::${m.id}`;
                            return (
                                <DropdownMenuItem key={modelValue} className="cursor-pointer" onSelect={() => onChange(modelValue)}>
                                    <span className="flex-1 truncate">{m.id}</span>
                                    {modelValue === value && <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />}
                                </DropdownMenuItem>
                            );
                        })}
                    </div>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
