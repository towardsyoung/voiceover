import { env } from "./env.js";
import { startServer } from "./server.js";

async function main() {
  const server = await startServer({ host: env.host, port: env.port });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
