// Entry point: npm start (or npm run dev to restart on file changes).
import { createApp } from "./app.js";
import { createPool, SalesRepository } from "./repository.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp(new SalesRepository(createPool()));

app.listen(port, () => {
  console.log(`Cafe Sales API (Node) listening on http://127.0.0.1:${port}`);
});
