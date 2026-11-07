// Tipos mínimos para `import { serve } from "bun"` en server.ts.
// (Se declaran aquí para no tocar package.json ni bun.lock; si algún día instalas @types/bun, borra este archivo.)
declare module "bun" {
  export const env: Record<string, string | undefined>;
  export function serve(options: {
    port?: number | string;
    fetch(req: Request): Response | Promise<Response>;
  }): { port: number; stop(): void };
}
