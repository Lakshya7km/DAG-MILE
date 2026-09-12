import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import userRouter from "./routes/user.routes.js";

const app = express();

const port = process.env.PORT || 3000;
const publicDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public"
);

app.use(express.json());
app.use(express.static(publicDirectory));
app.use((req, res, next) => {
  console.log(
    `Method ${req.method} received with body ${JSON.stringify(req.body)}`
  );
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "OK",
  });
});

app.get("/hello/:name", (req, res) => {
  const { name } = req.params;

  res.status(200).json({
    message: `Hello ${name}`,
  });
});

app.get("/search", (req, res) => {
  const { name } = req.query;
  res.status(200).json({
    message: `Searching for ${name}`,
  });
});

app.use("/", userRouter);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
