/** Run the content pipeline by hand:  npm run pipeline -- [--max 20] [--discover] */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { runDiscovery, runPipeline } from "@/lib/pipeline";

const i = process.argv.indexOf("--max");
const max = i > 0 ? Number(process.argv[i + 1]) : undefined;
const log = (s: string) => console.log(s);
(process.argv.includes("--discover")
  ? runDiscovery({ max: max ?? 25, budgetMs: 60 * 60 * 1000, log })
  : runPipeline({ maxReviews: max ?? 20, log }))
  .then((r) => console.log(r))
  .catch((e) => { console.error(e); process.exit(1); });
