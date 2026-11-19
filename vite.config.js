import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps every path relative, so `npm run build` also works from any static host.
export default defineConfig({ plugins: [react()], base: "./" });
