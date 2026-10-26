/**
 * Turn an off-site copy back into a normal backup file:
 *   BACKUP_ENCRYPTION_KEY=... node dist/scripts/decrypt-backup.js db-2026-10-24_0200.sql.gz.enc db.sql.gz
 * (inside the app container: docker compose exec -e BACKUP_ENCRYPTION_KEY worker node dist/scripts/decrypt-backup.js …)
 * Then restore as in docker/backup.sh.
 */
import { decryptFile } from "../src/lib/backup/crypto";

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("Usage: node dist/scripts/decrypt-backup.js <file.enc> <output file>");
  process.exit(1);
}
decryptFile(src, dest, process.env.BACKUP_ENCRYPTION_KEY ?? "")
  .then(() => console.log(`[decrypt] wrote ${dest}`))
  .catch((e) => {
    console.error("[decrypt] failed:", e.message, "(wrong BACKUP_ENCRYPTION_KEY, or the file was changed)");
    process.exit(1);
  });
