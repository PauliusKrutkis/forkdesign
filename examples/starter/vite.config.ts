import { forkDesign } from "@pako_krc/forkdesign/plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [forkDesign(), react()],
});
