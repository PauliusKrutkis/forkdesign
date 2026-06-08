import react from "@vitejs/plugin-react";
import { redline } from "redline/plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [redline(), react()],
});
