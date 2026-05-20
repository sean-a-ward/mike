"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLlmConnections } from "@/contexts/LlmConnectionsContext";
import type { LlmConnection, LlmProviderType, ModelSelection } from "@/app/lib/mikeApi";

const EMPTY_FORM = {
    name: "",
    providerType: "openai-compatible" as LlmProviderType,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    httpReferer: "https://mike.runarr.com",
    appTitle: "Mike",
    modelAllowlist: "",
};

export default function ModelsAndApiKeysPage() {
    const { connections, models, preferences, saveConnection, deleteConnection, setPreference, loading } = useLlmConnections();
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        const ok = await saveConnection({
            name: form.name || "OpenRouter",
            providerType: form.providerType,
            baseUrl: form.baseUrl,
            apiKey: form.apiKey || null,
            httpReferer: form.httpReferer || null,
            appTitle: form.appTitle || null,
            enabled: true,
            modelAllowlist: form.modelAllowlist.split(",").map((s) => s.trim()).filter(Boolean),
        });
        setSaving(false);
        if (ok) setForm(EMPTY_FORM);
        else alert("Failed to save connection.");
    };

    return (
        <div className="space-y-8">
            <section className="pb-2">
                <h2 className="text-2xl font-medium font-serif mb-4">Model preferences</h2>
                <div className="space-y-4 max-w-md">
                    <PreferenceSelect label="Main model" helper="Used for chat and document edits." value={preferences.main} onChange={(s) => setPreference("main", s)} />
                    <PreferenceSelect label="Tabular review model" helper="Used for tabular review extraction and chat." value={preferences.tabular} onChange={(s) => setPreference("tabular", s)} />
                </div>
            </section>

            <section id="connections" className="py-2">
                <div className="mb-4">
                    <h2 className="text-2xl font-medium font-serif">Connections</h2>
                    <p className="text-sm text-gray-500 mt-1 max-w-xl">
                        Add OpenAI- or Anthropic-compatible endpoints. Mike pulls available models from each endpoint.
                    </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 max-w-xl mb-4">
                    <h3 className="text-sm font-medium text-gray-900 mb-3">Add connection</h3>
                    <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenRouter" />
                            <select className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm" value={form.providerType} onChange={(e) => setForm({ ...form, providerType: e.target.value as LlmProviderType })}>
                                <option value="openai-compatible">OpenAI-compatible</option>
                            </select>
                        </div>
                        <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1" />
                        <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="API key" />
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Input value={form.httpReferer} onChange={(e) => setForm({ ...form, httpReferer: e.target.value })} placeholder="HTTP referer" />
                            <Input value={form.appTitle} onChange={(e) => setForm({ ...form, appTitle: e.target.value })} placeholder="App title" />
                        </div>
                        <Input value={form.modelAllowlist} onChange={(e) => setForm({ ...form, modelAllowlist: e.target.value })} placeholder="Optional model IDs, comma-separated" />
                        <Button onClick={submit} disabled={saving || !form.baseUrl} className="bg-black text-white hover:bg-gray-900">
                            <Plus className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Add connection"}
                        </Button>
                    </div>
                </div>

                <div className="space-y-3 max-w-xl">
                    {loading && <p className="text-sm text-gray-500">Loading connections...</p>}
                    {!loading && !connections.length && <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-500">No connections yet. Add one to load models.</div>}
                    {connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} modelCount={models.filter((m) => m.connectionId === connection.id).length} onDelete={() => deleteConnection(connection.id)} />)}
                </div>
            </section>
        </div>
    );
}

function PreferenceSelect({ label, helper, value, onChange }: { label: string; helper: string; value: ModelSelection | null; onChange: (selection: ModelSelection) => Promise<boolean> }) {
    const { models } = useLlmConnections();
    const selected = value ? models.find((m) => m.connectionId === value.connectionId && m.id === value.modelId) : null;
    const grouped = models.reduce<Record<string, typeof models>>((acc, model) => {
        (acc[model.connectionName] ??= []).push(model);
        return acc;
    }, {});
    return (
        <div>
            <label className="text-sm text-gray-600 block mb-1">{label}</label>
            <p className="text-xs text-gray-400 mb-2">{helper}</p>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm flex items-center justify-between gap-2 hover:bg-gray-50">
                        <span className="truncate text-gray-900">{selected ? `${selected.connectionName} · ${selected.id}` : "No model selected"}</span>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72 z-50" align="start">
                    {!models.length && <DropdownMenuItem disabled>Add a connection first</DropdownMenuItem>}
                    {Object.entries(grouped).map(([connectionName, items]) => (
                        <div key={connectionName}>
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">{connectionName}</DropdownMenuLabel>
                            {items.map((m) => (
                                <DropdownMenuItem key={`${m.connectionId}::${m.id}`} onSelect={() => onChange({ connectionId: m.connectionId, modelId: m.id })}>
                                    <span className="flex-1 truncate">{m.id}</span>
                                    {selected?.connectionId === m.connectionId && selected.id === m.id && <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />}
                                </DropdownMenuItem>
                            ))}
                        </div>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

function ConnectionCard({ connection, modelCount, onDelete }: { connection: LlmConnection; modelCount: number; onDelete: () => Promise<boolean> }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 flex items-center gap-3">
            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">{connection.providerType.replace("-compatible", "")}</span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900">{connection.name}</div>
                <div className="truncate text-xs text-gray-500">{connection.baseUrl}</div>
                <div className="text-[11px] text-gray-400">{modelCount ? `${modelCount} models` : "Models not loaded"} · {connection.hasApiKey ? "key saved" : "no key"}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={onDelete} title="Delete connection"><Trash2 className="h-4 w-4" /></Button>
        </div>
    );
}
