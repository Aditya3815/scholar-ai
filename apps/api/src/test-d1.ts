import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A D1 stand-in for unit tests: a real SQLite database in memory (D1 is SQLite) with every migration applied, behind the part of the D1 interface the code uses
 * (prepare, bind, all, first, run, batch). Queries and the schema are therefore tested as they are, not through a mock that says what we hope. Tests only; never imported by the Worker.
 */
export function testD1(): { db: D1Database; sql: DatabaseSync } {
  const sql = new DatabaseSync(":memory:");
  const dir = fileURLToPath(new URL("../migrations", import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) sql.exec(readFileSync(join(dir, f), "utf8"));

  const statement = (text: string, args: unknown[] = []) => {
    const run = () => sql.prepare(text);
    const self = {
      bind: (...a: unknown[]) => statement(text, a),
      all: async () => ({ results: run().all(...(args as never[])), success: true, meta: { changes: 0 } }),
      first: async () => run().get(...(args as never[])) ?? null,
      run: async () => ({ success: true, meta: { changes: Number(run().run(...(args as never[])).changes) } }),
      // batch() runs the statement itself
      exec: () => ({ changes: Number(run().run(...(args as never[])).changes) }),
    };
    return self;
  };
  const db = {
    prepare: (text: string) => statement(text),
    batch: async (list: ReturnType<typeof statement>[]) => {
      sql.exec("BEGIN");
      try {
        const out = list.map((s) => ({ success: true, results: [], meta: s.exec() }));
        sql.exec("COMMIT");
        return out;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db: db as unknown as D1Database, sql };
}
