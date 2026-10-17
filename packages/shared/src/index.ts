export type HealthResponse = {
  ok: boolean;
  service: string;
  time: string;
  db: "ok" | "error";
};

export type Theme = "light" | "dark" | "read";
