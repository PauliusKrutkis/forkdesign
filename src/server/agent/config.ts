import type { FixRuntimeConfig } from "./types.ts";

let runtimeConfig: FixRuntimeConfig = {};

export function configureFixRuntime(config: FixRuntimeConfig): void {
  runtimeConfig = { ...runtimeConfig, ...config };
}

export function getFixRuntimeConfig(): FixRuntimeConfig {
  return runtimeConfig;
}

export function resetFixRuntimeConfig(): void {
  runtimeConfig = {};
}
