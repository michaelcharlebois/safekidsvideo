/** Run the content pipeline by hand:  npm run pipeline -- [--max 20] */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { runPipeline } from "@/lib/pipeline";

const i = process.argv.indexOf("--max");
runPipeline({ maxReviews: i > 0 ? Number(process.argv[i + 1]) : 20, log: (s) => console.log(s) })
  .then((r) => console.log(r))
  .catch((e) => { console.error(e); process.exit(1); });
