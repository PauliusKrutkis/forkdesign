import react from "@vitejs/plugin-react";
import { forkDesign } from "forkdesign/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [forkDesign(), react()],
});
