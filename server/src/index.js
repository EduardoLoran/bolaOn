import cors from "cors";
import express from "express";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import {
  comparePassword,
  hashPassword,
  requireAdmin,
  requireAuth,
  signToken
} from "./auth.js";
import { calculateBonusPoints, calculateMatchPoints, isMatchLocked } from "./scoring.js";

const app = express();
const PORT = process.env.PORT || 3333;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, "..", "..", "client", "dist");

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(clientDistPath));

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
}

function getUserById(id) {
  return db
    .prepare(
      `
      SELECT
        id,
        name,
        email,
        is_admin,
        is_active AS isActive,
        COALESCE(display_name, name) AS displayName,
        COALESCE(country, 'Brasil') AS country,
        COALESCE(profile_phrase, 'Rumo ao hexa!') AS profilePhrase,
        COALESCE(avatar_url, '') AS avatarUrl,
        must_change_password AS mustChangePassword,
        created_at
      FROM users
      WHERE id = ?
    `
    )
    .get(id);
}

function formatMatchForUser(match, userId) {
  const prediction = db
    .prepare(
      `
      SELECT id, home_score, away_score, qualified_team, updated_at
      FROM predictions
      WHERE match_id = ? AND user_id = ?
    `
    )
    .get(match.id, userId);

  const points = prediction ? calculateMatchPoints(match, prediction) : 0;

  return {
    ...match,
    prediction,
    locked: isMatchLocked(match.kickoff_at),
    points
  };
}

function visibleMatchesWhereClause() {
  return getPhase2Enabled() ? "1 = 1" : "stage = 'GROUP'";
}

function getRanking() {
  const users = db
    .prepare(
      `
      SELECT
        id,
        name,
        COALESCE(display_name, name) AS displayName,
        COALESCE(country, 'Brasil') AS country,
        COALESCE(profile_phrase, 'Rumo ao hexa!') AS profilePhrase,
        COALESCE(avatar_url, '') AS avatarUrl
      FROM users
      WHERE is_admin = 0 AND is_active = 1
      ORDER BY name
    `
    )
    .all();
  const matches = db
    .prepare(
      `
      SELECT id, stage, kickoff_at, home_score, away_score, qualified_team
      FROM matches
      WHERE (${visibleMatchesWhereClause()}) AND home_score IS NOT NULL AND away_score IS NOT NULL
    `
    )
    .all();

  const predictionStmt = db.prepare(
    `
      SELECT match_id, home_score, away_score, qualified_team
      FROM predictions
      WHERE user_id = ?
    `
  );
  const bonusResult = db
    .prepare(
      `
      SELECT champion, runner_up, top_scorer, surprise_team
      FROM bonus_results
      WHERE id = 1
    `
    )
    .get();
  const bonusPredictionStmt = db.prepare(
    `
      SELECT champion, runner_up, top_scorer, surprise_team
      FROM bonus_predictions
      WHERE user_id = ?
    `
  );

  return users
    .map((user) => {
      const predictions = predictionStmt.all(user.id);
      const bonusPrediction = bonusPredictionStmt.get(user.id);
      let totalPoints = 0;
      let exactScores = 0;

      for (const match of matches) {
        const prediction = predictions.find((item) => item.match_id === match.id);
        const points = calculateMatchPoints(match, prediction);
        totalPoints += points;

        if (
          prediction &&
          Number(prediction.home_score) === Number(match.home_score) &&
          Number(prediction.away_score) === Number(match.away_score)
        ) {
          exactScores += 1;
        }
      }

      const bonusPoints = calculateBonusPoints(bonusResult, bonusPrediction);
      totalPoints += bonusPoints;

      return {
        userId: user.id,
        name: user.name,
        displayName: user.displayName,
        country: user.country,
        profilePhrase: user.profilePhrase,
        avatarUrl: user.avatarUrl,
        totalPoints,
        bonusPoints,
        exactScores
      };
    })
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.exactScores !== a.exactScores) return b.exactScores - a.exactScores;
      return (a.displayName || a.name).localeCompare(b.displayName || b.name);
    })
    .map((item, index) => ({ ...item, position: index + 1 }));
}

function knockoutStageLabel(stage) {
  return (
    {
      ROUND_OF_32: "16-avos",
      ROUND_OF_16: "Oitavas",
      QUARTER: "Quartas",
      SEMI: "Semifinal",
      THIRD_PLACE: "3º lugar",
      FINAL: "Final"
    }[stage] || stage
  );
}

function getPhase2Enabled() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'phase2_enabled'").get();
  return row?.value === "1";
}

function getParticipantViewsEnabled() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'participant_views_enabled'").get();
  return row?.value === "1";
}

function getMaintenanceEnabled() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'maintenance_enabled'").get();
  return row?.value === "1";
}

function getDateKey(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Sem data";

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}

function normalizeKickoffAt(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function getTeamGroupName(teamName) {
  const row = db.prepare("SELECT group_name FROM teams WHERE name = ?").get(teamName);
  return row?.group_name || null;
}

function isSameGroupRoundOf32(stage, homeTeam, awayTeam) {
  if (stage !== "ROUND_OF_32") return false;

  const homeGroup = getTeamGroupName(homeTeam);
  const awayGroup = getTeamGroupName(awayTeam);
  return Boolean(homeGroup && awayGroup && homeGroup === awayGroup);
}

function getBonusLockInfo() {
  const firstMatch = db
    .prepare(
      `
      SELECT kickoff_at
      FROM matches
      ORDER BY kickoff_at
      LIMIT 1
    `
    )
    .get();

  if (!firstMatch) {
    return { locked: false, locksAt: null, firstMatchAt: null };
  }

  const firstMatchAt = new Date(firstMatch.kickoff_at);
  const locksAt = new Date(firstMatchAt.getTime() - 5 * 60 * 1000);

  return {
    locked: new Date() >= locksAt,
    locksAt: locksAt.toISOString(),
    firstMatchAt: firstMatchAt.toISOString()
  };
}

function writeAuditLog({ eventType, action, userId = null, matchId = null, previousData = null, nextData = null }) {
  db.prepare(
    `
    INSERT INTO audit_logs (event_type, action, user_id, match_id, previous_data, next_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    eventType,
    action,
    userId,
    matchId,
    previousData ? JSON.stringify(previousData) : null,
    nextData ? JSON.stringify(nextData) : null
  );
}

function generateTemporaryPassword() {
  return `BolaOn@${randomBytes(4).toString("hex")}`;
}

function parseAuditData(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Nome, email e senha sao obrigatorios." });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "A senha precisa ter ao menos 6 caracteres." });
  }

  if (getUserByEmail(email)) {
    return res.status(409).json({ message: "Ja existe um cadastro com esse email." });
  }

  const result = db
    .prepare(
      `
      INSERT INTO users (name, email, password_hash, is_admin)
      VALUES (?, ?, ?, ?)
    `
    )
    .run(name.trim(), email.toLowerCase(), hashPassword(password), 0);

  const user = getUserById(result.lastInsertRowid);
  const token = signToken(user);

  return res.status(201).json({ token, user });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user = getUserByEmail(email || "");

  if (!user || !comparePassword(password || "", user.password_hash)) {
    return res.status(401).json({ message: "Email ou senha invalidos." });
  }

  if (Number(user.is_active) !== 1) {
    return res.status(403).json({ message: "Usuario inativo. Procure o administrador." });
  }

  const safeUser = getUserById(user.id);
  const token = signToken(safeUser);

  return res.json({ token, user: safeUser });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = getUserById(req.user.sub);
  return res.json(user);
});

app.put("/api/me/profile", requireAuth, (req, res) => {
  const { displayName, country, profilePhrase, avatarUrl } = req.body;
  const safeDisplayName = String(displayName || "").trim().slice(0, 20);
  const safeCountry = String(country || "Brasil").trim().slice(0, 40);
  const safePhrase = String(profilePhrase || "").trim().slice(0, 30);
  const safeAvatar = String(avatarUrl || "").trim();

  if (!safeDisplayName) {
    return res.status(400).json({ message: "Informe o nome de exibicao." });
  }

  if (safeAvatar && !safeAvatar.startsWith("data:image/")) {
    return res.status(400).json({ message: "Avatar invalido." });
  }

  db.prepare(
    `
    UPDATE users
    SET display_name = ?, country = ?, profile_phrase = ?, avatar_url = ?
    WHERE id = ?
  `
  ).run(safeDisplayName, safeCountry, safePhrase, safeAvatar || null, req.user.sub);

  return res.json(getUserById(req.user.sub));
});

app.put("/api/me/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);

  if (!user) {
    return res.status(404).json({ message: "Usuario nao encontrado." });
  }

  if (!comparePassword(currentPassword || "", user.password_hash)) {
    return res.status(400).json({ message: "Senha atual invalida." });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "A nova senha precisa ter ao menos 6 caracteres." });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "A confirmacao da senha nao confere." });
  }

  if (comparePassword(newPassword, user.password_hash)) {
    return res.status(400).json({ message: "A nova senha precisa ser diferente da senha atual." });
  }

  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hashPassword(newPassword), req.user.sub);

  writeAuditLog({
    eventType: "USER",
    action: "PASSWORD_CHANGE",
    userId: req.user.sub,
    previousData: {
      targetUserId: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: Boolean(user.must_change_password)
    },
    nextData: {
      targetUserId: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: false
    }
  });

  return res.json(getUserById(req.user.sub));
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const ranking = getRanking();
  const matches = db
    .prepare(
      `
      SELECT *
      FROM matches
      WHERE ${visibleMatchesWhereClause()}
      ORDER BY kickoff_at
    `
    )
    .all();

  const enriched = matches.map((match) => formatMatchForUser(match, req.user.sub));
  const completedMatches = enriched.filter((match) => match.home_score != null && match.away_score != null);
  const pendingMatches = enriched.filter((match) => match.home_score == null || match.away_score == null);
  const userRow = ranking.find((row) => row.userId === req.user.sub) || null;

  return res.json({
    summary: {
      totalParticipants: db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 0 AND is_active = 1").get().count,
      totalMatches: matches.length,
      completedMatches: completedMatches.length,
      pendingMatches: pendingMatches.length
    },
    ranking,
    myStanding: userRow,
    settings: {
      participantViewsEnabled: getParticipantViewsEnabled(),
      maintenanceEnabled: getMaintenanceEnabled()
    },
    nextMatches: pendingMatches.slice(0, 5),
    recentMatches: completedMatches.slice(-5).reverse()
  });
});

app.get("/api/ranking", requireAuth, (_req, res) => {
  return res.json(getRanking());
});

app.get("/api/participants/:id/public", requireAuth, (req, res) => {
  const isAdmin = Boolean(req.user.isAdmin);

  if (!getParticipantViewsEnabled() && !isAdmin) {
    return res.status(403).json({ message: "Visualizacao dos participantes desativada pelo administrador." });
  }

  const participant = db
    .prepare(
      `
      SELECT
        id,
        name,
        COALESCE(display_name, name) AS displayName,
        COALESCE(country, 'Brasil') AS country,
        COALESCE(profile_phrase, 'Rumo ao hexa!') AS profilePhrase,
        COALESCE(avatar_url, '') AS avatarUrl
      FROM users
      WHERE id = ? AND is_admin = 0 AND is_active = 1
    `
    )
    .get(req.params.id);

  if (!participant) {
    return res.status(404).json({ message: "Participante nao encontrado." });
  }

  const matches = db
    .prepare(
      `
      SELECT
        matches.id,
        matches.stage,
        matches.round_name,
        matches.home_team,
        matches.away_team,
        matches.kickoff_at,
        matches.home_score,
        matches.away_score,
        matches.qualified_team,
        predictions.home_score AS prediction_home_score,
        predictions.away_score AS prediction_away_score,
        predictions.qualified_team AS prediction_qualified_team,
        predictions.updated_at AS prediction_updated_at
      FROM matches
      LEFT JOIN predictions ON predictions.match_id = matches.id AND predictions.user_id = ?
      WHERE ${visibleMatchesWhereClause()}
      ORDER BY matches.kickoff_at, matches.id
    `
    )
    .all(participant.id);

  const predictions = matches.map((match) => {
    const hasPrediction = match.prediction_home_score != null && match.prediction_away_score != null;
    const prediction = hasPrediction ? {
      home_score: match.prediction_home_score,
      away_score: match.prediction_away_score,
      qualified_team: match.prediction_qualified_team
    } : null;

    return {
      id: match.id,
      stage: match.stage,
      round_name: match.round_name,
      home_team: match.home_team,
      away_team: match.away_team,
      kickoff_at: match.kickoff_at,
      home_score: match.home_score,
      away_score: match.away_score,
      qualified_team: match.qualified_team,
      prediction,
      updatedAt: match.prediction_updated_at,
      points: calculateMatchPoints(
        {
          stage: match.stage,
          home_score: match.home_score,
          away_score: match.away_score,
          qualified_team: match.qualified_team
        },
        prediction
      )
    };
  });

  const bonusPrediction = db
    .prepare(
      `
      SELECT
        COALESCE(champion, '') AS champion,
        COALESCE(runner_up, '') AS runnerUp,
        COALESCE(top_scorer, '') AS topScorer,
        COALESCE(surprise_team, '') AS surpriseTeam
      FROM bonus_predictions
      WHERE user_id = ?
    `
    )
    .get(participant.id) || {
    champion: "",
    runnerUp: "",
    topScorer: "",
    surpriseTeam: ""
  };

  return res.json({
    participant,
    predictions,
    bonusPrediction
  });
});

app.get("/api/teams", requireAuth, (_req, res) => {
  const teams = db
    .prepare(
      `
      SELECT id, name, group_name
      FROM teams
      WHERE is_active = 1
      ORDER BY name
    `
    )
    .all();

  return res.json(teams);
});

app.get("/api/matches", requireAuth, (req, res) => {
  const matches = db
    .prepare(
      `
      SELECT *
      FROM matches
      WHERE ${visibleMatchesWhereClause()}
      ORDER BY kickoff_at
    `
    )
    .all()
    .map((match) => formatMatchForUser(match, req.user.sub));

  return res.json(matches);
});

app.get("/api/scoreboard", requireAuth, (_req, res) => {
  const matches = db
    .prepare(
      `
      SELECT id, stage, round_name, home_team, away_team, kickoff_at, home_score, away_score, qualified_team
      FROM matches
      WHERE ${visibleMatchesWhereClause()}
      ORDER BY kickoff_at, id
    `
    )
    .all();

  const rows = db
    .prepare(
      `
      SELECT
        matches.id AS matchId,
        matches.stage,
        matches.round_name AS roundName,
        matches.home_team AS homeTeam,
        matches.away_team AS awayTeam,
        matches.kickoff_at AS kickoffAt,
        matches.home_score AS homeScore,
        matches.away_score AS awayScore,
        matches.qualified_team AS qualifiedTeam,
        users.id AS userId,
        COALESCE(users.display_name, users.name) AS participantName,
        predictions.home_score AS predictionHomeScore,
        predictions.away_score AS predictionAwayScore,
        predictions.qualified_team AS predictionQualifiedTeam
      FROM predictions
      INNER JOIN matches ON matches.id = predictions.match_id
      INNER JOIN users ON users.id = predictions.user_id
      WHERE (${visibleMatchesWhereClause()})
        AND users.is_admin = 0
        AND users.is_active = 1
      ORDER BY matches.kickoff_at, matches.id, participantName
    `
    )
    .all()
    .map((row) => {
      const match = {
        stage: row.stage,
        home_score: row.homeScore,
        away_score: row.awayScore,
        qualified_team: row.qualifiedTeam
      };
      const prediction = {
        home_score: row.predictionHomeScore,
        away_score: row.predictionAwayScore,
        qualified_team: row.predictionQualifiedTeam
      };

      return {
        ...row,
        dateKey: getDateKey(row.kickoffAt),
        points: calculateMatchPoints(match, prediction)
      };
    });

  return res.json({
    dates: [...new Set(matches.map((match) => getDateKey(match.kickoff_at)))],
    rows
  });
});

app.post("/api/predictions", requireAuth, (req, res) => {
  const { matchId, homeScore, awayScore, qualifiedTeam } = req.body;
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);

  if (!match) {
    return res.status(404).json({ message: "Jogo nao encontrado." });
  }

  if (match.stage !== "GROUP" && !getPhase2Enabled()) {
    return res.status(400).json({ message: "O mata-mata ainda nao esta liberado." });
  }

  if (isMatchLocked(match.kickoff_at)) {
    return res.status(400).json({ message: "Palpite bloqueado para esta partida." });
  }

  if (homeScore == null || awayScore == null) {
    return res.status(400).json({ message: "Informe os dois placares." });
  }

  const numericHome = Number(homeScore);
  const numericAway = Number(awayScore);

  if (Number.isNaN(numericHome) || Number.isNaN(numericAway) || numericHome < 0 || numericAway < 0) {
    return res.status(400).json({ message: "Placar invalido." });
  }

  if (match.stage !== "GROUP" && !qualifiedTeam) {
    return res.status(400).json({ message: "Informe a selecao classificada." });
  }

  const previousPrediction = db
    .prepare(
      `
      SELECT home_score AS homeScore, away_score AS awayScore, qualified_team AS qualifiedTeam
      FROM predictions
      WHERE user_id = ? AND match_id = ?
    `
    )
    .get(req.user.sub, matchId);
  const nextPrediction = {
    homeScore: numericHome,
    awayScore: numericAway,
    qualifiedTeam: match.stage === "GROUP" ? null : qualifiedTeam,
    match: `${match.home_team} x ${match.away_team}`,
    stage: match.stage,
    roundName: match.round_name
  };

  db.prepare(
    `
    INSERT INTO predictions (user_id, match_id, home_score, away_score, qualified_team, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, match_id)
    DO UPDATE SET
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      qualified_team = excluded.qualified_team,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(req.user.sub, matchId, numericHome, numericAway, match.stage === "GROUP" ? null : qualifiedTeam);

  writeAuditLog({
    eventType: "MATCH_PREDICTION",
    action: previousPrediction ? "UPDATE" : "CREATE",
    userId: req.user.sub,
    matchId,
    previousData: previousPrediction,
    nextData: nextPrediction
  });

  return res.json(formatMatchForUser(match, req.user.sub));
});

app.post("/api/bonus-predictions", requireAuth, (req, res) => {
  const { champion, runnerUp, topScorer, surpriseTeam } = req.body;
  const lockInfo = getBonusLockInfo();

  if (lockInfo.locked) {
    return res.status(400).json({ message: "Palpites bonus bloqueados. O prazo era 5 minutos antes do primeiro jogo da Copa." });
  }

  const previousBonus = db
    .prepare(
      `
      SELECT champion, runner_up AS runnerUp, top_scorer AS topScorer, surprise_team AS surpriseTeam
      FROM bonus_predictions
      WHERE user_id = ?
    `
    )
    .get(req.user.sub);
  const nextBonus = {
    champion: champion || null,
    runnerUp: runnerUp || null,
    topScorer: topScorer || null,
    surpriseTeam: surpriseTeam || null
  };

  db.prepare(
    `
    INSERT INTO bonus_predictions (user_id, champion, runner_up, top_scorer, surprise_team, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id)
    DO UPDATE SET
      champion = excluded.champion,
      runner_up = excluded.runner_up,
      top_scorer = excluded.top_scorer,
      surprise_team = excluded.surprise_team,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(req.user.sub, champion || null, runnerUp || null, topScorer || null, surpriseTeam || null);

  writeAuditLog({
    eventType: "BONUS_PREDICTION",
    action: previousBonus ? "UPDATE" : "CREATE",
    userId: req.user.sub,
    previousData: previousBonus,
    nextData: nextBonus
  });

  return res.json({ ok: true });
});

app.get("/api/bonus-predictions", requireAuth, (req, res) => {
  const row = db
    .prepare(
      `
      SELECT
        COALESCE(champion, '') AS champion,
        COALESCE(runner_up, '') AS runnerUp,
        COALESCE(top_scorer, '') AS topScorer,
        COALESCE(surprise_team, '') AS surpriseTeam
      FROM bonus_predictions
      WHERE user_id = ?
    `
    )
    .get(req.user.sub);

  const emptyBonus = {
    champion: "",
    runnerUp: "",
    topScorer: "",
    surpriseTeam: ""
  };

  return res.json({
    ...(row || emptyBonus),
    lock: getBonusLockInfo()
  });
});

app.get("/api/admin/bonus-results", requireAuth, requireAdmin, (_req, res) => {
  const row = db
    .prepare(
      `
      SELECT
        COALESCE(champion, '') AS champion,
        COALESCE(runner_up, '') AS runnerUp,
        COALESCE(top_scorer, '') AS topScorer,
        COALESCE(surprise_team, '') AS surpriseTeam
      FROM bonus_results
      WHERE id = 1
    `
    )
    .get();

  return res.json(
    row || {
      champion: "",
      runnerUp: "",
      topScorer: "",
      surpriseTeam: ""
    }
  );
});

app.put("/api/admin/bonus-results", requireAuth, requireAdmin, (req, res) => {
  const { champion, runnerUp, topScorer, surpriseTeam } = req.body;
  const previousBonusResult = db
    .prepare(
      `
      SELECT champion, runner_up AS runnerUp, top_scorer AS topScorer, surprise_team AS surpriseTeam
      FROM bonus_results
      WHERE id = 1
    `
    )
    .get();
  const nextBonusResult = {
    champion: champion || null,
    runnerUp: runnerUp || null,
    topScorer: topScorer || null,
    surpriseTeam: surpriseTeam || null
  };

  db.prepare(
    `
    INSERT INTO bonus_results (id, champion, runner_up, top_scorer, surprise_team, updated_at)
    VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id)
    DO UPDATE SET
      champion = excluded.champion,
      runner_up = excluded.runner_up,
      top_scorer = excluded.top_scorer,
      surprise_team = excluded.surprise_team,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(champion || null, runnerUp || null, topScorer || null, surpriseTeam || null);

  writeAuditLog({
    eventType: "BONUS_RESULT",
    action: previousBonusResult?.champion || previousBonusResult?.runnerUp || previousBonusResult?.topScorer || previousBonusResult?.surpriseTeam ? "UPDATE" : "CREATE",
    userId: req.user.sub,
    previousData: previousBonusResult,
    nextData: nextBonusResult
  });

  return res.json(
    db
      .prepare(
        `
        SELECT
          COALESCE(champion, '') AS champion,
          COALESCE(runner_up, '') AS runnerUp,
          COALESCE(top_scorer, '') AS topScorer,
          COALESCE(surprise_team, '') AS surpriseTeam
        FROM bonus_results
        WHERE id = 1
      `
      )
      .get()
  );
});

app.delete("/api/admin/bonus-results", requireAuth, requireAdmin, (req, res) => {
  const previousBonusResult = db
    .prepare(
      `
      SELECT champion, runner_up AS runnerUp, top_scorer AS topScorer, surprise_team AS surpriseTeam
      FROM bonus_results
      WHERE id = 1
    `
    )
    .get();

  db.prepare(
    `
    UPDATE bonus_results
    SET champion = NULL, runner_up = NULL, top_scorer = NULL, surprise_team = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `
  ).run();

  writeAuditLog({
    eventType: "BONUS_RESULT",
    action: "RESET",
    userId: req.user.sub,
    previousData: previousBonusResult,
    nextData: {
      champion: null,
      runnerUp: null,
      topScorer: null,
      surpriseTeam: null
    }
  });

  return res.json({ ok: true });
});

app.get("/api/admin/audit-logs", requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const rows = db
    .prepare(
      `
      SELECT
        audit_logs.id,
        audit_logs.event_type AS eventType,
        audit_logs.action,
        audit_logs.user_id AS userId,
        users.name AS userName,
        audit_logs.match_id AS matchId,
        matches.round_name AS roundName,
        matches.home_team AS homeTeam,
        matches.away_team AS awayTeam,
        matches.stage,
        audit_logs.previous_data AS previousData,
        audit_logs.next_data AS nextData,
        audit_logs.created_at AS createdAt
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.user_id
      LEFT JOIN matches ON matches.id = audit_logs.match_id
      ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
      LIMIT ?
    `
    )
    .all(limit);

  return res.json(
    rows.map((row) => ({
      ...row,
      previousData: parseAuditData(row.previousData),
      nextData: parseAuditData(row.nextData)
    }))
  );
});

app.get("/api/admin/users", requireAuth, requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        users.id,
        users.name,
        users.email,
        users.is_admin AS isAdmin,
        users.is_active AS isActive,
        COALESCE(users.display_name, users.name) AS displayName,
        COALESCE(users.country, 'Brasil') AS country,
        users.must_change_password AS mustChangePassword,
        users.created_at AS createdAt,
        COUNT(DISTINCT predictions.id) AS predictionsCount,
        COUNT(DISTINCT bonus_predictions.id) AS bonusPredictionsCount
      FROM users
      LEFT JOIN predictions ON predictions.user_id = users.id
      LEFT JOIN bonus_predictions ON bonus_predictions.user_id = users.id
      GROUP BY users.id
      ORDER BY users.is_admin DESC, users.is_active DESC, users.name
    `
    )
    .all();

  return res.json(rows);
});

app.post("/api/admin/users/:id/reset-password", requireAuth, requireAdmin, (req, res) => {
  const targetUser = getUserById(req.params.id);

  if (!targetUser) {
    return res.status(404).json({ message: "Usuario nao encontrado." });
  }

  const temporaryPassword = generateTemporaryPassword();
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hashPassword(temporaryPassword), targetUser.id);

  writeAuditLog({
    eventType: "USER",
    action: "PASSWORD_RESET",
    userId: req.user.sub,
    previousData: {
      targetUserId: targetUser.id,
      name: targetUser.name,
      email: targetUser.email
    },
    nextData: {
      targetUserId: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      passwordReset: true,
      mustChangePassword: true
    }
  });

  return res.json({ temporaryPassword });
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const targetUser = getUserById(req.params.id);

  if (!targetUser) {
    return res.status(404).json({ message: "Usuario nao encontrado." });
  }

  if (targetUser.is_admin) {
    return res.status(400).json({ message: "Nao e permitido excluir um administrador." });
  }

  const previousData = {
    targetUserId: targetUser.id,
    name: targetUser.name,
    email: targetUser.email,
    isActive: Boolean(targetUser.isActive)
  };

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(targetUser.id);
    writeAuditLog({
      eventType: "USER",
      action: "DEACTIVATE",
      userId: req.user.sub,
      previousData,
      nextData: {
        targetUserId: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        isActive: false
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return res.json({ ok: true });
});

app.get("/api/admin/knockout-matches", requireAuth, requireAdmin, (_req, res) => {
  const matches = db
    .prepare(
      `
      SELECT id, stage, round_name, home_team, away_team, kickoff_at, status
      FROM matches
      WHERE stage <> 'GROUP'
      ORDER BY
        CASE stage
          WHEN 'ROUND_OF_32' THEN 1
          WHEN 'ROUND_OF_16' THEN 2
          WHEN 'QUARTER' THEN 3
          WHEN 'SEMI' THEN 4
          WHEN 'THIRD_PLACE' THEN 5
          WHEN 'FINAL' THEN 6
          ELSE 7
        END,
        kickoff_at,
        id
    `
    )
    .all();

  return res.json(matches);
});

app.get("/api/admin/matches", requireAuth, requireAdmin, (_req, res) => {
  const matches = db
    .prepare(
      `
      SELECT id, stage, round_name, home_team, away_team, kickoff_at, status, home_score, away_score, qualified_team
      FROM matches
      ORDER BY
        CASE stage
          WHEN 'GROUP' THEN 1
          WHEN 'ROUND_OF_32' THEN 2
          WHEN 'ROUND_OF_16' THEN 3
          WHEN 'QUARTER' THEN 4
          WHEN 'SEMI' THEN 5
          WHEN 'THIRD_PLACE' THEN 6
          WHEN 'FINAL' THEN 7
          ELSE 8
        END,
        kickoff_at,
        id
    `
    )
    .all();

  return res.json(matches);
});

app.get("/api/admin/phase2-settings", requireAuth, requireAdmin, (_req, res) => {
  return res.json({ enabled: getPhase2Enabled() });
});

app.put("/api/admin/phase2-settings", requireAuth, requireAdmin, (req, res) => {
  const enabled = req.body.enabled ? "1" : "0";

  db.prepare(
    `
    UPDATE app_settings
    SET value = ?, updated_at = CURRENT_TIMESTAMP
    WHERE key = 'phase2_enabled'
  `
  ).run(enabled);

  return res.json({ enabled: enabled === "1" });
});

app.get("/api/admin/participant-views-settings", requireAuth, requireAdmin, (_req, res) => {
  return res.json({ enabled: getParticipantViewsEnabled() });
});

app.put("/api/admin/participant-views-settings", requireAuth, requireAdmin, (req, res) => {
  const enabled = req.body.enabled ? "1" : "0";
  const previousValue = getParticipantViewsEnabled();

  db.prepare(
    `
    UPDATE app_settings
    SET value = ?, updated_at = CURRENT_TIMESTAMP
    WHERE key = 'participant_views_enabled'
  `
  ).run(enabled);

  writeAuditLog({
    eventType: "SETTING",
    action: "UPDATE",
    userId: req.user.sub,
    previousData: {
      participantViewsEnabled: previousValue
    },
    nextData: {
      participantViewsEnabled: enabled === "1"
    }
  });

  return res.json({ enabled: enabled === "1" });
});

app.get("/api/admin/maintenance-settings", requireAuth, requireAdmin, (_req, res) => {
  return res.json({ enabled: getMaintenanceEnabled() });
});

app.put("/api/admin/maintenance-settings", requireAuth, requireAdmin, (req, res) => {
  const enabled = req.body.enabled ? "1" : "0";
  const previousValue = getMaintenanceEnabled();

  db.prepare(
    `
    UPDATE app_settings
    SET value = ?, updated_at = CURRENT_TIMESTAMP
    WHERE key = 'maintenance_enabled'
  `
  ).run(enabled);

  writeAuditLog({
    eventType: "SETTING",
    action: "UPDATE",
    userId: req.user.sub,
    previousData: {
      maintenanceEnabled: previousValue
    },
    nextData: {
      maintenanceEnabled: enabled === "1"
    }
  });

  return res.json({ enabled: enabled === "1" });
});

app.post("/api/admin/knockout-matches", requireAuth, requireAdmin, (req, res) => {
  const { stage, homeTeam, awayTeam, kickoffAt } = req.body;

  if (!stage || !homeTeam?.trim() || !awayTeam?.trim()) {
    return res.status(400).json({ message: "Informe fase, selecao da casa e selecao visitante." });
  }

  const normalizedKickoffAt = normalizeKickoffAt(kickoffAt);
  if (!normalizedKickoffAt) {
    return res.status(400).json({ message: "Informe uma data e hora validas para o confronto." });
  }

  if (homeTeam.trim() === awayTeam.trim()) {
    return res.status(400).json({ message: "Escolha duas selecoes diferentes." });
  }

  const validStage = ["ROUND_OF_32", "ROUND_OF_16", "QUARTER", "SEMI", "THIRD_PLACE", "FINAL"].includes(stage);
  if (!validStage) {
    return res.status(400).json({ message: "Fase de mata-mata invalida." });
  }

  if (isSameGroupRoundOf32(stage, homeTeam.trim(), awayTeam.trim())) {
    return res.status(400).json({ message: "No 16-avos, selecoes do mesmo grupo nao podem se enfrentar." });
  }

  const count = db.prepare("SELECT COUNT(*) AS count FROM matches WHERE stage = ?").get(stage).count;
  const roundName = `${knockoutStageLabel(stage)} - Jogo ${count + 1}`;

  const result = db
    .prepare(
      `
      INSERT INTO matches (stage, round_name, home_team, away_team, kickoff_at, status)
      VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
    `
    )
    .run(stage, roundName, homeTeam.trim(), awayTeam.trim(), normalizedKickoffAt);

  return res.status(201).json(
    db.prepare("SELECT id, stage, round_name, home_team, away_team, kickoff_at, status FROM matches WHERE id = ?").get(result.lastInsertRowid)
  );
});

app.put("/api/admin/knockout-matches/:id", requireAuth, requireAdmin, (req, res) => {
  const { homeTeam, awayTeam, stage, kickoffAt } = req.body;
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id);

  if (!match || match.stage === "GROUP") {
    return res.status(404).json({ message: "Confronto de mata-mata nao encontrado." });
  }

  if (!stage || !homeTeam?.trim() || !awayTeam?.trim()) {
    return res.status(400).json({ message: "Informe fase, selecao da casa e selecao visitante." });
  }

  const normalizedKickoffAt = normalizeKickoffAt(kickoffAt);
  if (!normalizedKickoffAt) {
    return res.status(400).json({ message: "Informe uma data e hora validas para o confronto." });
  }

  if (homeTeam.trim() === awayTeam.trim()) {
    return res.status(400).json({ message: "Escolha duas selecoes diferentes." });
  }

  const validStage = ["ROUND_OF_32", "ROUND_OF_16", "QUARTER", "SEMI", "THIRD_PLACE", "FINAL"].includes(stage);
  if (!validStage) {
    return res.status(400).json({ message: "Fase de mata-mata invalida." });
  }

  if (isSameGroupRoundOf32(stage, homeTeam.trim(), awayTeam.trim())) {
    return res.status(400).json({ message: "No 16-avos, selecoes do mesmo grupo nao podem se enfrentar." });
  }

  const roundName = stage === match.stage
    ? match.round_name
    : `${knockoutStageLabel(stage)} - Jogo ${db.prepare("SELECT COUNT(*) AS count FROM matches WHERE stage = ? AND id <> ?").get(stage, req.params.id).count + 1}`;

  db.prepare(
    `
    UPDATE matches
    SET stage = ?, round_name = ?, home_team = ?, away_team = ?, kickoff_at = ?
    WHERE id = ?
  `
  ).run(stage, roundName, homeTeam.trim(), awayTeam.trim(), normalizedKickoffAt, req.params.id);

  return res.json(
    db.prepare("SELECT id, stage, round_name, home_team, away_team, kickoff_at, status FROM matches WHERE id = ?").get(req.params.id)
  );
});

app.delete("/api/admin/knockout-matches/:id", requireAuth, requireAdmin, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id);

  if (!match || match.stage === "GROUP") {
    return res.status(404).json({ message: "Confronto de mata-mata nao encontrado." });
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM predictions WHERE match_id = ?").run(req.params.id);
    db.prepare("DELETE FROM matches WHERE id = ?").run(req.params.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return res.json({ ok: true });
});

app.put("/api/admin/matches/:id/result", requireAuth, requireAdmin, (req, res) => {
  const { homeScore, awayScore, qualifiedTeam, status } = req.body;
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id);

  if (!match) {
    return res.status(404).json({ message: "Jogo nao encontrado." });
  }

  if (homeScore == null || awayScore == null) {
    return res.status(400).json({ message: "Informe o placar das duas selecoes." });
  }

  if (match.stage !== "GROUP" && !qualifiedTeam) {
    return res.status(400).json({ message: "Informe quem avancou no mata-mata." });
  }

  const previousResult = {
    homeScore: match.home_score,
    awayScore: match.away_score,
    qualifiedTeam: match.qualified_team,
    status: match.status,
    match: `${match.home_team} x ${match.away_team}`,
    stage: match.stage,
    roundName: match.round_name
  };
  const nextResult = {
    homeScore: homeScore ?? null,
    awayScore: awayScore ?? null,
    qualifiedTeam: qualifiedTeam || null,
    status: status || "FINISHED",
    match: `${match.home_team} x ${match.away_team}`,
    stage: match.stage,
    roundName: match.round_name
  };

  db.prepare(
    `
    UPDATE matches
    SET home_score = ?, away_score = ?, qualified_team = ?, status = ?
    WHERE id = ?
  `
  ).run(
    homeScore ?? null,
    awayScore ?? null,
    qualifiedTeam || null,
    status || "FINISHED",
    req.params.id
  );

  writeAuditLog({
    eventType: "MATCH_RESULT",
    action: match.home_score == null && match.away_score == null ? "CREATE" : "UPDATE",
    userId: req.user.sub,
    matchId: req.params.id,
    previousData: previousResult,
    nextData: nextResult
  });

  return res.json(db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id));
});

app.delete("/api/admin/matches/:id/result", requireAuth, requireAdmin, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id);

  if (!match) {
    return res.status(404).json({ message: "Jogo nao encontrado." });
  }

  const previousResult = {
    homeScore: match.home_score,
    awayScore: match.away_score,
    qualifiedTeam: match.qualified_team,
    status: match.status,
    match: `${match.home_team} x ${match.away_team}`,
    stage: match.stage,
    roundName: match.round_name
  };

  db.prepare(
    `
    UPDATE matches
    SET home_score = NULL, away_score = NULL, qualified_team = NULL, status = 'SCHEDULED'
    WHERE id = ?
  `
  ).run(req.params.id);

  writeAuditLog({
    eventType: "MATCH_RESULT",
    action: "RESET",
    userId: req.user.sub,
    matchId: req.params.id,
    previousData: previousResult,
    nextData: {
      homeScore: null,
      awayScore: null,
      qualifiedTeam: null,
      status: "SCHEDULED",
      match: `${match.home_team} x ${match.away_team}`,
      stage: match.stage,
      roundName: match.round_name
    }
  });

  return res.json(db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`bolaOn rodando em http://localhost:${PORT}`);
});
