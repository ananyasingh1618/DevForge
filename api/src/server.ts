import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`DevForge API listening on port ${env.PORT} (${env.NODE_ENV})`);
});
