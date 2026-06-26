function normalizeOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return "HOME";
  if (awayScore > homeScore) return "AWAY";
  return "DRAW";
}

export function isMatchLocked(kickoffAt) {
  const lockAt = new Date(new Date(kickoffAt).getTime() - 5 * 60 * 1000);
  return new Date() >= lockAt;
}

function hasWinnerGoalsCorrect(match, prediction, actualOutcome) {
  if (actualOutcome === "HOME") {
    return Number(prediction.home_score) === Number(match.home_score);
  }

  if (actualOutcome === "AWAY") {
    return Number(prediction.away_score) === Number(match.away_score);
  }

  return false;
}

export function calculateMatchPoints(match, prediction) {
  if (!prediction) return 0;
  if (match.home_score == null || match.away_score == null) return 0;

  const exactScore =
    Number(prediction.home_score) === Number(match.home_score) &&
    Number(prediction.away_score) === Number(match.away_score);

  const predictedOutcome = normalizeOutcome(
    Number(prediction.home_score),
    Number(prediction.away_score)
  );
  const actualOutcome = normalizeOutcome(
    Number(match.home_score),
    Number(match.away_score)
  );
  const sameOutcome = predictedOutcome === actualOutcome;

  if (match.stage === "GROUP") {
    if (exactScore) return 5;
    if (sameOutcome && hasWinnerGoalsCorrect(match, prediction, actualOutcome)) return 3;
    if (sameOutcome) return 2;
    return 0;
  }

  const qualifiedCorrect =
    prediction.qualified_team &&
    match.qualified_team &&
    prediction.qualified_team === match.qualified_team;

  let points = 0;

  if (exactScore) {
    points += 6;
  } else if (sameOutcome && hasWinnerGoalsCorrect(match, prediction, actualOutcome)) {
    points += 4;
  } else if (sameOutcome) {
    points += 2;
  }

  if (qualifiedCorrect) {
    points += 2;
  }

  return points;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function calculateBonusPoints(result, prediction) {
  if (!result || !prediction) return 0;

  let points = 0;

  if (normalizeText(result.champion) && normalizeText(result.champion) === normalizeText(prediction.champion)) {
    points += 15;
  }

  if (normalizeText(result.runner_up) && normalizeText(result.runner_up) === normalizeText(prediction.runner_up)) {
    points += 10;
  }

  if (normalizeText(result.top_scorer) && normalizeText(result.top_scorer) === normalizeText(prediction.top_scorer)) {
    points += 8;
  }

  if (normalizeText(result.surprise_team) && normalizeText(result.surprise_team) === normalizeText(prediction.surprise_team)) {
    points += 5;
  }

  return points;
}

export function summarizePrediction(match, prediction) {
  const points = calculateMatchPoints(match, prediction);

  return {
    ...prediction,
    points,
    locked: isMatchLocked(match.kickoff_at)
  };
}
