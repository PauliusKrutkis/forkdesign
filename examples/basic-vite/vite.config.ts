import react from "@vitejs/plugin-react";
import { designCrit } from "design-crit/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [designCrit(), react()],
});
