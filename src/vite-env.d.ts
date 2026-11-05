/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_PAYPAL_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.sql?raw' {
  const content: string
  export default content
}

