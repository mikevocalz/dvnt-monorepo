declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PAYLOAD_SECRET: string
      DATABASE_URI: string
      FRONTEND_ORIGIN: string
      BLOG_ORIGIN: string
      PREVIEW_SECRET: string
      BAN_LIST_SALT: string
      NEXT_PUBLIC_SERVER_URL: string
      VERCEL_PROJECT_PRODUCTION_URL: string
    }
  }
}

export {}
