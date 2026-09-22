/**
 * Génère database/devis.db (SQLite) à partir du schéma + seed.
 * Usage : node database/build.mjs
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(root, "devis.sqlite.sql"), "utf8");
const seed = readFileSync(join(root, "seed.sql"), "utf8");
const out = join(root, "devis.db");

mkdirSync(root, { recursive: true });

const db = new DatabaseSync(out);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(schema);
db.exec(seed);

const counts = Object.fromEntries(
  [
    "dv_artisans",
    "dv_leads",
    "dv_lead_travaux",
    "dv_photos",
    "dv_ai_estimates",
    "dv_ai_prestations",
    "dv_ai_flags",
    "dv_lead_events",
  ].map((table) => [
    table,
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
  ])
);

db.close();
console.log("OK", out);
console.log(counts);
