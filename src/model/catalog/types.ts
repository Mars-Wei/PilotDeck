import type { ModelProtocol } from "../protocol/canonical.js";
import type { ModelCapabilities } from "../protocol/capabilities.js";
import type { MultimodalConstraints } from "../protocol/multimodal.js";

export type CatalogModelEntry = {
  displayName: string;
  capabilities: ModelCapabilities;
  multimodal: MultimodalConstraints;
  aliases?: string[];
};

export type CatalogProviderEntry = {
  displayName: string;
  protocol: ModelProtocol;
  defaultUrl: string;
  apiKeyEnvVar?: string;
  /** When true, the provider may be used with an empty apiKey (e.g. local vLLM). */
  apiKeyOptional?: boolean;
  models: Record<string, CatalogModelEntry>;
};

export type ProviderCatalog = Record<string, CatalogProviderEntry>;
