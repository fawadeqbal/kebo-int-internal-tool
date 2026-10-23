/**
 * Background worker (runs in its own container).
 * Runs the reminder job at start-up and then every REMINDER_INTERVAL_MINUTES (default 60).
 */
import { runReminders } from "@/modules/notifications/reminders";

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

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    console.log("[worker] stopping");
    process.exit(0);
  });
