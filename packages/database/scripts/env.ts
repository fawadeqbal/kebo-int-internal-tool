import { config } from "dotenv";

// packages/database/.env if there is one, else the repo root's .env (variables already set win).
config({ path: [".env", "../../.env"], quiet: true });
