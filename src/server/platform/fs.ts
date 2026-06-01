import { existsSync, statSync } from "node:fs";

export function isExistingFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile();
}
