import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";

const config = loadConfig();
if (config.secret.startsWith("dev-only")) {
  console.warn("WARNING: using the insecure development session secret. Set SESSION_SECRET.");
}
createApp(new Store(config.dbPath), config).listen(config.port, () => {
  console.log(`Expense API listening on http://localhost:${config.port}`);
});
