import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Logger } from "pino";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import {
  getClaudeCustomModelThinkingOptions,
  getClaudeManifestModels,
  normalizeClaudeManifestModelId,
  normalizeClaudeRuntimeModelId as normalizeClaudeManifestRuntimeModelId,
} from "./model-manifest.js";

const CLAUDE_SETTINGS_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

export function getClaudeModels(claudeCodeVersion?: string): AgentModelDefinition[] {
  return getClaudeManifestModels(claudeCodeVersion);
}

export function resolveConfiguredClaudeModel(model: AgentModelDefinition): AgentModelDefinition {
  if (model.thinkingOptions !== undefined) return model;

  const manifestModelId = normalizeClaudeManifestModelId(model.id);
  const manifestModel = manifestModelId
    ? getClaudeModels().find((candidate) => candidate.id === manifestModelId)
    : undefined;
  if (manifestModel) {
    return manifestModel.thinkingOptions
      ? { ...model, thinkingOptions: manifestModel.thinkingOptions }
      : model;
  }
  return { ...model, thinkingOptions: getClaudeCustomModelThinkingOptions() };
}

export function findClaudeModel(
  modelId: string | null | undefined,
): AgentModelDefinition | undefined {
  const normalizedModelId = normalizeClaudeRuntimeModelId(modelId);
  if (!normalizedModelId) {
    return undefined;
  }
  return getClaudeModels().find((model) => model.id === normalizedModelId);
}

export async function getClaudeModelsWithSettings(
  logger: Logger,
  configDir: string,
  claudeCodeVersion?: string,
): Promise<AgentModelDefinition[]> {
  const hardcodedModels = getClaudeModels(claudeCodeVersion);
  const settings = await readClaudeSettingsModels(logger, configDir);
  if (settings.models.length === 0) {
    return hardcodedModels;
  }

  // Claude Code hides its built-in /model entries when modelPicker.replaceBuiltInOptions is set,
  // typically because the configured gateway cannot serve them. Keep the entries resolvable for
  // agents that already use them, but stop offering them or defaulting to them.
  const models: AgentModelDefinition[] = settings.replaceBuiltInOptions
    ? hardcodedModels.map(({ isDefault: _isDefault, ...model }) => ({
        ...model,
        isSelectable: false,
      }))
    : [...hardcodedModels];

  for (const model of settings.models) {
    const existingIndex = models.findIndex((candidate) => candidate.id === model.id);
    if (existingIndex !== -1) {
      const existing = models[existingIndex];
      if (existing?.isSelectable === false) {
        models[existingIndex] = { ...existing, ...model, isSelectable: true };
      }
      continue;
    }
    models.push(model);
  }

  if (settings.replaceBuiltInOptions) {
    const defaultModel =
      models.find((model) => model.id === settings.model && model.isSelectable !== false) ??
      models.find((model) => model.isSelectable !== false);
    if (defaultModel) {
      defaultModel.isDefault = true;
    }
  }

  return models;
}

interface ClaudeSettingsModels {
  models: AgentModelDefinition[];
  model?: string;
  replaceBuiltInOptions: boolean;
}

async function readClaudeSettingsModels(
  logger: Logger,
  configDir: string,
): Promise<ClaudeSettingsModels> {
  const settingsPath = path.join(configDir, "settings.json");
  const empty: ClaudeSettingsModels = { models: [], replaceBuiltInOptions: false };

  let parsed: unknown;
  try {
    const rawSettings = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(rawSettings);
  } catch (error) {
    logger.debug({ err: error, settingsPath }, "Failed to read Claude settings models");
    return empty;
  }

  if (!isRecord(parsed)) {
    logger.debug({ settingsPath }, "Claude settings.json is not an object");
    return empty;
  }

  const models: AgentModelDefinition[] = [];
  // Picker options come first so their labels win over the bare IDs below.
  const pickerOptionCount = addModelPickerModels(models, parsed.modelPicker);
  addSettingsModel(models, parsed.model, "model");
  const result: ClaudeSettingsModels = {
    models,
    replaceBuiltInOptions:
      pickerOptionCount > 0 &&
      isRecord(parsed.modelPicker) &&
      parsed.modelPicker.replaceBuiltInOptions === true,
  };
  if (typeof parsed.model === "string" && parsed.model.trim().length > 0) {
    result.model = parsed.model.trim();
  }

  const env = parsed.env;
  if (env === undefined) {
    return result;
  }
  if (!isRecord(env)) {
    logger.debug({ settingsPath }, "Claude settings.json env is not an object");
    return result;
  }

  for (const envKey of CLAUDE_SETTINGS_MODEL_ENV_KEYS) {
    addSettingsModel(models, env[envKey], `env.${envKey}`);
  }

  return result;
}

/**
 * Read Claude Code's `modelPicker` setting: the custom /model entries a gateway or wrapper
 * (for example hg-connect) configures. Returns how many entries were added.
 */
function addModelPickerModels(models: AgentModelDefinition[], modelPicker: unknown): number {
  if (!isRecord(modelPicker) || !Array.isArray(modelPicker.options)) {
    return 0;
  }

  let added = 0;
  for (const option of modelPicker.options) {
    if (!isRecord(option)) continue;
    const id = readTrimmedString(option.model);
    if (!id || models.some((model) => model.id === id)) continue;

    const model: AgentModelDefinition = {
      provider: "claude",
      id,
      label: readTrimmedString(option.label) ?? id,
      description: readTrimmedString(option.description) ?? "From Claude settings.json modelPicker",
    };
    // behavesAs tells Claude Code which built-in model's capabilities to assume.
    const behavesAs = findClaudeModel(readTrimmedString(option.behavesAs));
    if (behavesAs?.thinkingOptions) {
      model.thinkingOptions = behavesAs.thinkingOptions;
      if (behavesAs.defaultThinkingOptionId !== undefined) {
        model.defaultThinkingOptionId = behavesAs.defaultThinkingOptionId;
      }
    }
    models.push(model);
    added += 1;
  }
  return added;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function addSettingsModel(
  models: AgentModelDefinition[],
  value: unknown,
  settingsKey: string,
): void {
  if (typeof value !== "string") {
    return;
  }

  const id = value.trim();
  if (id.length === 0 || models.some((model) => model.id === id)) {
    return;
  }

  models.push({
    provider: "claude",
    id,
    label: id,
    description: `From Claude settings.json ${settingsKey}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a runtime model string (from SDK init message) to a known model ID.
 * Handles the `[1m]` suffix that the SDK appends for 1M context sessions.
 */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  return normalizeClaudeManifestRuntimeModelId(value);
}

/**
 * Placeholder model values Claude Code writes on frames with no real inference behind them.
 * These are not models and must never be displayed.
 */
const CLAUDE_PLACEHOLDER_MODEL_IDS = new Set(["<synthetic>"]);

/**
 * Resolve a model id observed on a Claude assistant frame, for display.
 *
 * Prefers the manifest-normalized id so equivalent spellings collapse (a dated alias and a
 * gateway prefix are the same model), but falls back to the raw string when the manifest does
 * not know it. The fallback matters: Claude Code is an Anthropic-compatible client, so subagents
 * routinely report models that are not Anthropic's — Z.AI GLM ids via `ANTHROPIC_BASE_URL`
 * (docs/custom-providers.md) among them. Manifest-only resolution would blank the model for
 * exactly those users.
 *
 * A `[1m]` suffix is preserved where it names its own manifest entry. Models such as Fable 5
 * that only have a 1M entry normalize the retired suffixed spelling to the canonical ID.
 *
 * Returns null for placeholders and empty values, meaning "not observed".
 */
export function resolveObservedClaudeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || CLAUDE_PLACEHOLDER_MODEL_IDS.has(trimmed)) {
    return null;
  }
  return normalizeClaudeManifestRuntimeModelId(trimmed) ?? trimmed;
}
