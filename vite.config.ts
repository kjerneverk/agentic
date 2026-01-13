import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "agentic",
      fileName: () => "index.js",
      formats: ["es"],
    },
    rollupOptions: {
      external: ["zod", "execution"],
    },
    sourcemap: true,
    minify: false,
  },
  plugins: [dts({ rollupTypes: true })],
});
