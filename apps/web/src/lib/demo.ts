/** A demo install (DEMO_MODE=1): shows a banner in the app and one-click sign-ins on the login page. Read at request time, so it needs no rebuild. */
export const demoMode = () => ["1", "true", "yes"].includes((process.env.DEMO_MODE ?? "").toLowerCase());
