import type { AgentRuntimeConfig } from "./types.ts";

let runtimeConfig: AgentRuntimeConfig = {};

export function configureAgentRuntime(config: AgentRuntimeConfig): void {
  runtimeConfig = { ...runtimeConfig, ...config };
}

export function getAgentRuntimeConfig(): AgentRuntimeConfig {
  return runtimeConfig;
}

export function resetAgentRuntimeConfig(): void {
  runtimeConfig = {};
}
