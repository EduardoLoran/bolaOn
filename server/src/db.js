import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth.js";
import { knockoutSlots, seedMatches, seedTeams, teamNameTranslations } from "./seed.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "bolaon.sqlite");
const db = new DatabaseSync(dbPath);
const adminUser = {
  name: "Administrador",
  email: "admin@bolaon.local",
  password: "Admin@123"
};

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage TEXT NOT NULL,
    round_name TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    kickoff_at TEXT NOT NULL,
    venue TEXT,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    home_score INTEGER,
    away_score INTEGER,
    qualified_team TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    qualified_team TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, match_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS bonus_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    champion TEXT,
    runner_up TEXT,
    top_scorer TEXT,
    surprise_team TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bonus_results (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    champion TEXT,
    runner_up TEXT,
    top_scorer TEXT,
    surprise_team TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    action TEXT NOT NULL,
    user_id INTEGER,
    match_id INTEGER,
    previous_data TEXT,
    next_data TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    group_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS knockout_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_code TEXT NOT NULL UNIQUE,
    team_id INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const matchColumns = db.prepare("PRAGMA table_info(matches)").all().map((column) => column.name);
if (!matchColumns.includes("venue")) {
  db.exec("ALTER TABLE matches ADD COLUMN venue TEXT;");
}

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("display_name")) {
  db.exec("ALTER TABLE users ADD COLUMN display_name TEXT;");
}
if (!userColumns.includes("country")) {
  db.exec("ALTER TABLE users ADD COLUMN country TEXT;");
}
if (!userColumns.includes("profile_phrase")) {
  db.exec("ALTER TABLE users ADD COLUMN profile_phrase TEXT;");
}
if (!userColumns.includes("avatar_url")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT;");
}
if (!userColumns.includes("must_change_password")) {
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;");
}
if (!userColumns.includes("is_active")) {
  db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
}

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (userCount === 0) {
  db.prepare(
    `
    INSERT INTO users (name, email, password_hash, is_admin)
    VALUES (?, ?, ?, 1)
  `
  ).run(adminUser.name, adminUser.email, hashPassword(adminUser.password));
}

db.prepare(
  `
  INSERT INTO bonus_results (id)
  VALUES (1)
  ON CONFLICT(id) DO NOTHING
`
).run();

const upsertTeam = db.prepare(`
  INSERT INTO teams (name, group_name, is_active)
  VALUES (@name, @group_name, 1)
  ON CONFLICT(name)
  DO UPDATE SET group_name = excluded.group_name, is_active = 1
`);

db.exec("BEGIN");
try {
  db.prepare("UPDATE teams SET is_active = 0").run();
  for (const team of seedTeams) {
    upsertTeam.run(team);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const fixturesVersion = "world-cup-2026-group-stage-v2";
const fixtureSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("fixtures_version");

if (fixtureSetting?.value !== fixturesVersion) {
  const groupMatchIds = db.prepare("SELECT id FROM matches WHERE stage = 'GROUP'").all();
  const deletePredictions = db.prepare("DELETE FROM predictions WHERE match_id = ?");
  const insertMatch = db.prepare(`
    INSERT INTO matches (
      stage, round_name, home_team, away_team, kickoff_at, venue, status
    ) VALUES (
      @stage, @round_name, @home_team, @away_team, @kickoff_at, @venue, @status
    )
  `);

  db.exec("BEGIN");
  try {
    for (const match of groupMatchIds) {
      deletePredictions.run(match.id);
    }
    db.prepare("DELETE FROM matches WHERE stage = 'GROUP'").run();
    for (const match of seedMatches) {
      insertMatch.run(match);
    }
    db.prepare(
      `
      INSERT INTO app_settings (key, value)
      VALUES ('fixtures_version', ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `
    ).run(fixturesVersion);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const insertSlot = db.prepare(`
  INSERT OR IGNORE INTO knockout_slots (slot_code)
  VALUES (?)
`);

db.exec("BEGIN");
try {
  for (const slotCode of knockoutSlots) {
    insertSlot.run(slotCode);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const phase2Setting = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("phase2_enabled");
if (!phase2Setting) {
  db.prepare(
    `
    INSERT INTO app_settings (key, value)
    VALUES ('phase2_enabled', '0')
  `
  ).run();
}

const participantViewsSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("participant_views_enabled");
if (!participantViewsSetting) {
  db.prepare(
    `
    INSERT INTO app_settings (key, value)
    VALUES ('participant_views_enabled', '0')
  `
  ).run();
}

const maintenanceSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("maintenance_enabled");
if (!maintenanceSetting) {
  db.prepare(
    `
    INSERT INTO app_settings (key, value)
    VALUES ('maintenance_enabled', '0')
  `
  ).run();
}

const updateTeamName = db.prepare("UPDATE OR IGNORE teams SET name = ? WHERE name = ?");
const updateMatchHomeTeam = db.prepare("UPDATE matches SET home_team = ? WHERE home_team = ?");
const updateMatchAwayTeam = db.prepare("UPDATE matches SET away_team = ? WHERE away_team = ?");
const updateBonusChampion = db.prepare("UPDATE bonus_predictions SET champion = ? WHERE champion = ?");
const updateBonusRunnerUp = db.prepare("UPDATE bonus_predictions SET runner_up = ? WHERE runner_up = ?");
const updateBonusSurprise = db.prepare("UPDATE bonus_predictions SET surprise_team = ? WHERE surprise_team = ?");
const updateBonusResultChampion = db.prepare("UPDATE bonus_results SET champion = ? WHERE champion = ?");
const updateBonusResultRunnerUp = db.prepare("UPDATE bonus_results SET runner_up = ? WHERE runner_up = ?");
const updateBonusResultSurprise = db.prepare("UPDATE bonus_results SET surprise_team = ? WHERE surprise_team = ?");

for (const [englishName, portugueseName] of Object.entries(teamNameTranslations)) {
  updateTeamName.run(portugueseName, englishName);
  updateMatchHomeTeam.run(portugueseName, englishName);
  updateMatchAwayTeam.run(portugueseName, englishName);
  updateBonusChampion.run(portugueseName, englishName);
  updateBonusRunnerUp.run(portugueseName, englishName);
  updateBonusSurprise.run(portugueseName, englishName);
  updateBonusResultChampion.run(portugueseName, englishName);
  updateBonusResultRunnerUp.run(portugueseName, englishName);
  updateBonusResultSurprise.run(portugueseName, englishName);
}

db.exec("BEGIN");
try {
  db.prepare("UPDATE teams SET is_active = 0").run();
  for (const team of seedTeams) {
    const canonicalName = teamNameTranslations[team.name] ?? team.name;
    upsertTeam.run({ ...team, name: canonicalName });
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

export default db;
