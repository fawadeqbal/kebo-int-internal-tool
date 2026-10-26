/**
 * Background worker (runs in its own container).
 * Runs the reminder job at start-up and then every REMINDER_INTERVAL_MINUTES (default 60).
 */
import { runReminders } from "@/modules/notifications/reminders";
import { offsiteConfig, syncOffsite } from "@/lib/backup/offsite";

const intervalMinutes = Number(process.env.REMINDER_INTERVAL_MINUTES ?? 60);
let running = false;

async function tick() {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    const result = await runReminders();
    console.log(`[worker] reminders: ${result.created} new (of ${result.checked} checked) in ${Date.now() - started}ms`);
  } catch (error) {
    console.error("[worker] reminder run failed", error);
  } finally {
    running = false;
  }
}

console.log(`[worker] started — reminder check every ${intervalMinutes} minutes`);
void tick();
const timer = setInterval(tick, intervalMinutes * 60_000);

// Off-site backup copy: checked every 30 minutes, so each night's backup leaves the server soon after it is made.
let offsiteTimer: NodeJS.Timeout | undefined;
try {
  const cfg = offsiteConfig();
  if (!cfg) console.log("[offsite] not set up (OFFSITE_S3_BUCKET is empty) — backups stay on this server only");
  else {
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        await syncOffsite(cfg);
      } catch (error) {
        console.error("[offsite] copy failed (will retry):", (error as Error).message);
      } finally {
        syncing = false;
      }
    };
    console.log(`[offsite] copying encrypted backups to bucket ${cfg.bucket}/${cfg.prefix}, kept ${cfg.retentionDays} days`);
    void sync();
    offsiteTimer = setInterval(sync, 30 * 60_000);
  }
} catch (error) {
  console.error("[offsite]", (error as Error).message);
}

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    if (offsiteTimer) clearInterval(offsiteTimer);
    console.log("[worker] stopping");
    process.exit(0);
  });
