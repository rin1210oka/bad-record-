declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ACCESS_PEPPER?: string;
    ACCESS_SETUP_OWNER_EMAIL?: string;
  }
}
