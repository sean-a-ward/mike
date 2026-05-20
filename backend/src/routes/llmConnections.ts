import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
    deleteConnection,
    getModelPreferences,
    getModelsForConnection,
    listAvailableModels,
    listConnections,
    saveConnection,
    saveModelPreferences,
} from "../lib/llmConnections";

export const llmConnectionsRouter = Router();

llmConnectionsRouter.get("/connections", requireAuth, async (_req, res) => {
    try {
        res.json(await listConnections(res.locals.userId as string));
    } catch (err) {
        res.status(500).json({ detail: err instanceof Error ? err.message : "Failed to list connections" });
    }
});

llmConnectionsRouter.post("/connections", requireAuth, async (req, res) => {
    try {
        res.json(await saveConnection(res.locals.userId as string, req.body ?? {}));
    } catch (err) {
        res.status(400).json({ detail: err instanceof Error ? err.message : "Failed to save connection" });
    }
});

llmConnectionsRouter.patch("/connections/:id", requireAuth, async (req, res) => {
    try {
        res.json(await saveConnection(res.locals.userId as string, { ...(req.body ?? {}), id: req.params.id }));
    } catch (err) {
        res.status(400).json({ detail: err instanceof Error ? err.message : "Failed to save connection" });
    }
});

llmConnectionsRouter.delete("/connections/:id", requireAuth, async (req, res) => {
    try {
        await deleteConnection(res.locals.userId as string, req.params.id);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ detail: err instanceof Error ? err.message : "Failed to delete connection" });
    }
});

llmConnectionsRouter.get("/connections/:id/models", requireAuth, async (req, res) => {
    try {
        res.json(await getModelsForConnection(res.locals.userId as string, req.params.id));
    } catch (err) {
        res.status(400).json({ detail: err instanceof Error ? err.message : "Failed to fetch models" });
    }
});

llmConnectionsRouter.post("/connections/:id/test", requireAuth, async (req, res) => {
    try {
        const models = await getModelsForConnection(res.locals.userId as string, req.params.id);
        res.json({ ok: true, models, count: models.length });
    } catch (err) {
        res.status(400).json({ ok: false, detail: err instanceof Error ? err.message : "Failed to test connection" });
    }
});

llmConnectionsRouter.get("/models", requireAuth, async (_req, res) => {
    try {
        res.json(await listAvailableModels(res.locals.userId as string));
    } catch (err) {
        res.status(500).json({ detail: err instanceof Error ? err.message : "Failed to list models" });
    }
});

llmConnectionsRouter.get("/model-preferences", requireAuth, async (_req, res) => {
    try {
        res.json(await getModelPreferences(res.locals.userId as string));
    } catch (err) {
        res.status(500).json({ detail: err instanceof Error ? err.message : "Failed to load model preferences" });
    }
});

llmConnectionsRouter.put("/model-preferences", requireAuth, async (req, res) => {
    try {
        res.json(await saveModelPreferences(res.locals.userId as string, {
            main: req.body?.main ?? null,
            tabular: req.body?.tabular ?? null,
        }));
    } catch (err) {
        res.status(400).json({ detail: err instanceof Error ? err.message : "Failed to save model preferences" });
    }
});
