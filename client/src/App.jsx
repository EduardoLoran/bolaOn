import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "bolaon-token";
const LOGO_SRC = "/bolaon-logo.png";
const TOAST_EVENT = "bolaon-toast";

const defaultBonus = {
  champion: "",
  runnerUp: "",
  topScorer: "",
  surpriseTeam: "",
  lock: {
    locked: false,
    locksAt: null,
    firstMatchAt: null
  }
};

const defaultScoreboard = {
  dates: [],
  rows: []
};

const rules = [
  { title: "Fase de grupos", items: ["Placar exato: 5 pontos", "Vencedor + gols do vencedor corretos: 3 pontos", "Apenas vencedor ou empate: 2 pontos"] },
  { title: "Mata-mata", items: ["16-avos, oitavas, quartas, semifinal, 3º lugar e final seguem a regra de mata-mata", "Placar exato: 6 pontos", "Classificado correto: +2 pontos", "Vencedor + gols do vencedor corretos: 4 pontos", "Apenas vencedor ou empate: 2 pontos"] },
  { title: "Bonus", items: ["Campeao: 15 pontos", "Vice-campeao: 10 pontos", "Artilheiro: 8 pontos", "Terceiro lugar: 5 pontos", "Pode ser alterado ate 5 minutos antes do primeiro jogo da Copa"] },
  { title: "Prazo", items: ["Palpites podem ser alterados ate 5 minutos antes do inicio de cada partida."] },
  { title: "Desempate", items: ["Maior numero de placares exatos", "Maior numero de acertos no mata-mata", "Acerto do campeao"] }
];

const teamFlagCodes = {
  "africa do sul": "za",
  alemanha: "de",
  argentina: "ar",
  argelia: "dz",
  "arabia saudita": "sa",
  armenia: "am",
  austria: "at",
  australia: "au",
  belgica: "be",
  bolivia: "bo",
  brasil: "br",
  bulgaria: "bg",
  "bosnia e herzegovina": "ba",
  "cabo verde": "cv",
  camaroes: "cm",
  canada: "ca",
  catar: "qa",
  chile: "cl",
  china: "cn",
  colombia: "co",
  "coreia do sul": "kr",
  "coreia do norte": "kp",
  "costa rica": "cr",
  "costa do marfim": "ci",
  croacia: "hr",
  cuba: "cu",
  curacao: "cw",
  egito: "eg",
  "el salvador": "sv",
  equador: "ec",
  escocia: "gb-sct",
  eslovaquia: "sk",
  eslovenia: "si",
  espanha: "es",
  "estados unidos": "us",
  finlandia: "fi",
  franca: "fr",
  gabao: "ga",
  gana: "gh",
  grecia: "gr",
  guatemala: "gt",
  haiti: "ht",
  honduras: "hn",
  hungria: "hu",
  inglaterra: "gb-eng",
  ira: "ir",
  iraque: "iq",
  irlanda: "ie",
  islandia: "is",
  israel: "il",
  italia: "it",
  japao: "jp",
  jordania: "jo",
  libano: "lb",
  luxemburgo: "lu",
  mali: "ml",
  marrocos: "ma",
  mexico: "mx",
  nicaragua: "ni",
  nigeria: "ng",
  noruega: "no",
  "nova zelandia": "nz",
  "paises baixos": "nl",
  panama: "pa",
  paraguai: "py",
  peru: "pe",
  polonia: "pl",
  portugal: "pt",
  "rd congo": "cd",
  "republica dominicana": "do",
  "republica tcheca": "cz",
  romenia: "ro",
  russia: "ru",
  senegal: "sn",
  servia: "rs",
  suecia: "se",
  suica: "ch",
  tunisia: "tn",
  turquia: "tr",
  ucrania: "ua",
  uruguai: "uy",
  venezuela: "ve",
  vietna: "vn",
  gales: "gb-wls",
  uzbequistao: "uz"
};

const podiumIcon = {
  1: "🏆",
  2: "🥈",
  3: "🥉"
};

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);
  let response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("A requisicao demorou demais. Verifique se o servidor esta rodando e tente novamente.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Erro inesperado." }));
    const requestError = new Error(error.message || "Erro inesperado.");
    requestError.status = response.status;
    throw requestError;
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const requestError = new Error("Resposta inesperada do servidor. Reinicie o servidor para carregar as rotas novas.");
    requestError.status = response.status;
    throw requestError;
  }

  return response.json();
}

function emitToast(type, message) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { type, message } }));
}

function Logo({ className = "" }) {
  const [failed, setFailed] = useState(false);

  if (!failed) {
    return <img className={className} src={LOGO_SRC} alt="bolaOn" onError={() => setFailed(true)} />;
  }

  return (
    <div className={`brand-fallback ${className}`}>
      <strong>bola<span>On</span></strong>
      <small>Seu bolao. Online.</small>
    </div>
  );
}

function parseDateValue(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`);
  }

  return new Date(value);
}

function formatDate(value) {
  if (!value || Number.isNaN(parseDateValue(value).getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(parseDateValue(value));
}

function formatShortDate(value) {
  if (!value || Number.isNaN(parseDateValue(value).getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(parseDateValue(value));
}

function formatTime(value) {
  if (!value || Number.isNaN(parseDateValue(value).getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(parseDateValue(value));
}

function getDateKey(value) {
  if (!value || Number.isNaN(parseDateValue(value).getTime())) return "Sem data";

  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(parseDateValue(value));
}

function getTodayDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(new Date());
}

function getDateKeyFromDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}

function getYesterdayDateKey() {
  const todayAtNoon = new Date(`${getTodayDateKey()}T12:00:00-03:00`);
  todayAtNoon.setUTCDate(todayAtNoon.getUTCDate() - 1);
  return getDateKeyFromDate(todayAtNoon);
}

function getPreferredDateKey(dates) {
  if (!dates.length) return "";

  const today = getTodayDateKey();
  if (dates.includes(today)) return today;

  return dates.find((date) => date >= today) || dates[dates.length - 1] || "";
}

function getDashboardDateKey(dates) {
  if (!dates.length) return "";

  const yesterday = getYesterdayDateKey();
  if (dates.includes(yesterday)) return yesterday;

  const pastDate = dates.filter((date) => date !== "Sem data" && date <= yesterday).at(-1);
  return pastDate || getPreferredDateKey(dates);
}

const defaultKnockoutKickoffs = {
  ROUND_OF_32: "2026-06-28T18:00:00Z",
  ROUND_OF_16: "2026-07-04T18:00:00Z",
  QUARTER: "2026-07-09T18:00:00Z",
  SEMI: "2026-07-14T19:00:00Z",
  THIRD_PLACE: "2026-07-18T19:00:00Z",
  FINAL: "2026-07-19T19:00:00Z"
};

function getDefaultKnockoutForm(stage = "ROUND_OF_32") {
  const kickoffAt = defaultKnockoutKickoffs[stage] || defaultKnockoutKickoffs.ROUND_OF_32;

  return {
    stage,
    homeTeam: "",
    awayTeam: "",
    kickoffDate: getDateKey(kickoffAt),
    kickoffTime: formatTime(kickoffAt)
  };
}

function buildKickoffAt(kickoffDate, kickoffTime) {
  if (!kickoffDate || !kickoffTime) return null;

  const date = new Date(`${kickoffDate}T${kickoffTime}:00-03:00`);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function hasScoreValue(value) {
  return value !== "" && value !== null && value !== undefined;
}

function getAllowedQualifiedTeams(match, homeScore, awayScore) {
  if (match.stage === "GROUP") return [];

  const teams = [match.home_team, match.away_team];
  if (!hasScoreValue(homeScore) || !hasScoreValue(awayScore)) return teams;

  const numericHome = Number(homeScore);
  const numericAway = Number(awayScore);
  if (Number.isNaN(numericHome) || Number.isNaN(numericAway)) return teams;

  if (numericHome > numericAway) return [match.home_team];
  if (numericAway > numericHome) return [match.away_team];

  return teams;
}

function getQualifiedSelectionError(match, homeScore, awayScore, qualifiedTeam) {
  if (match.stage === "GROUP") return "";

  if (!qualifiedTeam) {
    return "Selecione quem avancou no mata-mata.";
  }

  const allowedTeams = getAllowedQualifiedTeams(match, homeScore, awayScore);
  if (!allowedTeams.includes(qualifiedTeam)) {
    return `Pelo placar informado, o classificado precisa ser ${allowedTeams[0]}.`;
  }

  return "";
}

function coerceQualifiedTeam(match, homeScore, awayScore, qualifiedTeam) {
  if (match.stage === "GROUP" || !qualifiedTeam) return qualifiedTeam || "";

  const allowedTeams = getAllowedQualifiedTeams(match, homeScore, awayScore);
  return allowedTeams.includes(qualifiedTeam) ? qualifiedTeam : "";
}

function renderQualifiedTeamOptions(allowedTeams) {
  return allowedTeams.map((team) => (
    <option key={team} value={team}>{team}</option>
  ));
}

function getMatchGroup(match) {
  const groupMatch = match.round_name?.match(/Grupo\s+(.+)/i);
  return groupMatch ? groupMatch[1] : knockoutStageLabel(match.stage);
}

function getMatchGroupLabel(group, isKnockout = false) {
  return isKnockout || isKnockoutStageLabel(group) ? group : `Grupo ${group}`;
}

function getStageOrder(stageLabel) {
  const order = {
    "16-avos": 1,
    Oitavas: 2,
    Quartas: 3,
    Semifinal: 4,
    "3º lugar": 5,
    Final: 6
  };

  return order[stageLabel] || 99;
}

function isKnockoutStageLabel(stageLabel) {
  return getStageOrder(stageLabel) !== 99;
}

function sortMatchGroups(matches, groups) {
  const hasGroupStage = matches.some((match) => match.stage === "GROUP");

  return [...groups].sort((a, b) => {
    const aIsKnockout = isKnockoutStageLabel(a);
    const bIsKnockout = isKnockoutStageLabel(b);

    if (!hasGroupStage || aIsKnockout || bIsKnockout) {
      if (aIsKnockout !== bIsKnockout) return aIsKnockout ? 1 : -1;
      return getStageOrder(a) - getStageOrder(b);
    }

    return a.localeCompare(b);
  });
}

function getSavedCount(matches, mode) {
  return matches.filter((match) => (
    mode === "prediction" || mode === "publicPrediction"
      ? match.prediction
      : match.home_score != null && match.away_score != null
  )).length;
}

function getMatchContextLabel(match) {
  const group = getMatchGroup(match);
  return getMatchGroupLabel(group, match.stage !== "GROUP");
}

function sortMatchesByKickoff(matches) {
  return [...matches].sort((a, b) => {
    const aTime = parseDateValue(a.kickoff_at).getTime();
    const bTime = parseDateValue(b.kickoff_at).getTime();
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return a.id - b.id;
    if (aTime !== bTime) return aTime - bTime;
    return a.id - b.id;
  });
}

function getPredictedQualifier(match) {
  if (!match.prediction) return "";

  if (match.prediction.qualified_team) return match.prediction.qualified_team;

  const homeScore = Number(match.prediction.home_score);
  const awayScore = Number(match.prediction.away_score);

  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return "";
  if (homeScore > awayScore) return match.home_team;
  if (awayScore > homeScore) return match.away_team;

  return "";
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function flagCodeFor(name) {
  return teamFlagCodes[normalizeName(name)] || "";
}

function loadCanvasImage(src, crossOrigin = false) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    const image = new Image();
    if (crossOrigin) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawImageCover(ctx, image, x, y, width, height) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let sourceX = 0;
  let sourceY = 0;

  if (imageRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function safeFileName(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "figurinha";
}

function FlagImage({ name }) {
  const code = flagCodeFor(name);

  if (!code) {
    return <span className="flag fallback">?</span>;
  }

  return (
    <img
      className="flag"
      src={`https://flagcdn.com/w40/${code}.png`}
      srcSet={`https://flagcdn.com/w80/${code}.png 2x`}
      alt={`Bandeira ${name}`}
      loading="lazy"
    />
  );
}

function TeamName({ name }) {
  return (
    <span className="team-name">
      <FlagImage name={name} />
      <span>{name}</span>
    </span>
  );
}

function EyeIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {!open && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 7.5 10 12.5l5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavIcon({ type }) {
  const icons = {
    dashboard: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="2" />
        <rect x="13" y="4" width="7" height="7" rx="2" />
        <rect x="4" y="13" width="7" height="7" rx="2" />
        <path d="M14 16h5M16.5 13.5v5" />
      </>
    ),
    matches: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m12 4 2.5 4.4 4.9 1M12 4 9.5 8.4l-4.9 1M4.5 9.5 8 13l-1 5M19.5 9.5 16 13l1 5M8 13h8" />
      </>
    ),
    groups: (
      <>
        <circle cx="8" cy="8" r="3" />
        <circle cx="16" cy="8" r="3" />
        <circle cx="12" cy="16" r="3" />
        <path d="M10.4 9.7 11.5 14M13.6 9.7 12.5 14" />
      </>
    ),
    bonus: (
      <path d="m12 3 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.4 6.7 19.1l1-5.8-4.2-4.1 5.9-.9L12 3Z" />
    ),
    scores: (
      <>
        <rect x="5" y="5" width="14" height="14" rx="3" />
        <path d="M8.5 9h7M8.5 12h7M8.5 15h4" />
      </>
    ),
    rules: (
      <>
        <path d="M7 4h7l3 3v13H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M14 4v4h4M8.5 11h7M8.5 14h7M8.5 17h4" />
      </>
    ),
    results: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="3" />
        <path d="M8 10h3M13 10h3M8 14h8" />
      </>
    ),
    knockout: (
      <>
        <path d="M6 20V4M7 5h10l-2 4 2 4H7" />
        <path d="M10 16h8" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M4 19a5 5 0 0 1 10 0" />
        <path d="M15 8.5a2.5 2.5 0 0 1 0 5M17 19a4 4 0 0 0-3-3.8" />
      </>
    ),
    history: (
      <>
        <path d="M5 12a7 7 0 1 0 2-4.9" />
        <path d="M5 5v4h4M12 8v4l3 2" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {icons[type] || icons.dashboard}
    </svg>
  );
}

function RankBadge({ position, fallback = position }) {
  const rank = Number(position);
  const icons = {
    1: (
      <>
        <path d="M8 4h8v3.5a4 4 0 0 1-8 0V4Z" />
        <path d="M8 6H5.5a2.5 2.5 0 0 0 2.5 4M16 6h2.5a2.5 2.5 0 0 1-2.5 4M12 11.5V15M9 19h6M10 15h4v4h-4z" />
      </>
    ),
    2: (
      <>
        <circle cx="12" cy="10" r="4" />
        <path d="M9 14.5 7.5 20l4.5-2 4.5 2-1.5-5.5M9.5 4 12 7l2.5-3" />
      </>
    ),
    3: (
      <>
        <path d="M12 4 14 8l4.4.6-3.2 3.1.8 4.4L12 14l-4 2.1.8-4.4-3.2-3.1L10 8l2-4Z" />
        <path d="M9 20h6" />
      </>
    )
  };

  return (
    <span className={`podium-icon position-${rank || "default"}`}>
      {icons[rank] ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">{icons[rank]}</svg>
      ) : (
        fallback || "#"
      )}
    </span>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = mode === "login" ? { email: form.email, password: form.password } : form;
      const data = await request(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      localStorage.setItem(TOKEN_KEY, data.token);
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-toggle">
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            onClick={() => setMode("login")}
          >
            Entrar
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            onClick={() => setMode("register")}
          >
            Criar conta
          </button>
        </div>

        {mode === "register" && (
          <label>
            Nome
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Seu nome no bolao"
              required
            />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="voce@exemplo.com"
            required
          />
        </label>

        <label>
          Senha
          <div className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="Minimo de 6 caracteres"
              required
            />
            <button
              className="password-toggle"
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>
        </label>

        {error && <p className="error-text">{error}</p>}

        <button className="primary-button" type="submit">
          {mode === "login" ? "Entrar" : "Criar cadastro"}
        </button>
      </form>
    </div>
  );
}

function PasswordChangeForm({ forced = false, onSave, onCancel, onLogout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      await onSave(form);
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setSuccess("Senha alterada com sucesso.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <form className="password-change-form" onSubmit={handleSubmit}>
      <label>
        Senha atual
        <div className="password-field">
          <input
            type={visible.current ? "text" : "password"}
            value={form.currentPassword}
            onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
            required
          />
          <button className="password-toggle" type="button" onClick={() => setVisible({ ...visible, current: !visible.current })}>
            <EyeIcon open={visible.current} />
          </button>
        </div>
      </label>
      <label>
        Nova senha
        <div className="password-field">
          <input
            type={visible.next ? "text" : "password"}
            value={form.newPassword}
            minLength="6"
            onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
            required
          />
          <button className="password-toggle" type="button" onClick={() => setVisible({ ...visible, next: !visible.next })}>
            <EyeIcon open={visible.next} />
          </button>
        </div>
      </label>
      <label>
        Confirmar nova senha
        <div className="password-field">
          <input
            type={visible.confirm ? "text" : "password"}
            value={form.confirmPassword}
            minLength="6"
            onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
            required
          />
          <button className="password-toggle" type="button" onClick={() => setVisible({ ...visible, confirm: !visible.confirm })}>
            <EyeIcon open={visible.confirm} />
          </button>
        </div>
      </label>
      {error && <p className="error-text">{error}</p>}
      {success && !forced && <p className="success-text">{success}</p>}
      <div className="card-actions">
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Alterar senha"}
        </button>
        {!forced && <button className="ghost-button" type="button" onClick={onCancel}>Cancelar</button>}
        {forced && <button className="ghost-button" type="button" onClick={onLogout}>Sair</button>}
      </div>
    </form>
  );

  return content;
}

function PasswordChangeModal({ forced = false, onSave, onClose, onLogout }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card password-modal-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Seguranca</p>
            <h2>{forced ? "Altere sua senha" : "Alterar senha"}</h2>
            <p>{forced ? "Sua senha foi resetada pelo administrador. Defina uma nova senha para continuar." : "Informe sua senha atual e escolha uma nova senha de acesso."}</p>
          </div>
          {!forced && (
            <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar modal">
              ×
            </button>
          )}
        </div>
        <PasswordChangeForm forced={forced} onSave={onSave} onCancel={onClose} onLogout={onLogout} />
      </div>
    </div>
  );
}

function DashboardCards({ dashboard }) {
  return (
    <section className="stats-grid">
      <article className="stat-card stat-card-participants">
        <span className="stat-icon"><NavIcon type="users" /></span>
        <span className="stat-label">Participantes</span>
        <strong>{dashboard.summary.totalParticipants}</strong>
      </article>
      <article className="stat-card stat-card-matches">
        <span className="stat-icon"><NavIcon type="matches" /></span>
        <span className="stat-label">Jogos da fase</span>
        <strong>{dashboard.summary.totalMatches}</strong>
      </article>
      <article className="stat-card stat-card-finished">
        <span className="stat-icon"><NavIcon type="scores" /></span>
        <span className="stat-label">Jogos finalizados</span>
        <strong>{dashboard.summary.completedMatches}</strong>
      </article>
    </section>
  );
}

function DashboardGames({ matches }) {
  const pageSize = 8;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const completedCount = matches.filter((match) => match.home_score != null && match.away_score != null).length;
  const filteredMatches = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return sortMatchesByKickoff(matches)
      .filter((match) => {
        if (!normalizedSearch) return true;
        return `${match.home_team} ${match.away_team} ${match.round_name}`.toLowerCase().includes(normalizedSearch);
      });
  }, [matches, search]);
  const preferredPage = useMemo(() => {
    if (search.trim()) return 0;

    const dates = [...new Set(filteredMatches.map((match) => getDateKey(match.kickoff_at)).filter(Boolean))];
    const preferredDate = getDashboardDateKey(dates);
    const preferredIndex = filteredMatches.findIndex((match) => getDateKey(match.kickoff_at) === preferredDate);

    return preferredIndex >= 0 ? Math.floor(preferredIndex / pageSize) : 0;
  }, [filteredMatches, search]);
  const totalPages = Math.max(Math.ceil(filteredMatches.length / pageSize), 1);
  const safePage = Math.min(page, totalPages - 1);
  const visible = filteredMatches.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    setPage(preferredPage);
  }, [preferredPage]);

  return (
    <div className="panel stack">
      <div>
        <div className="panel-header">
          <h2>Jogos</h2>
          <span className="hint-text">{completedCount} / {matches.length} jogos</span>
        </div>
        <div className="games-toolbar">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar selecao ou grupo"
          />
          <div className="pager-actions">
            <button type="button" onClick={() => setPage((current) => Math.max(current - 1, 0))} disabled={safePage === 0}>
              Voltar
            </button>
            <span>{safePage + 1}/{totalPages}</span>
            <button type="button" onClick={() => setPage((current) => Math.min(current + 1, totalPages - 1))} disabled={safePage >= totalPages - 1}>
              Avancar
            </button>
          </div>
        </div>
        <div className="mini-list scroll-list">
          {visible.map((match) => (
            <DashboardGameItem match={match} key={match.id} />
          ))}
          {visible.length === 0 && (
            <div className="dashboard-game-item empty">
              <strong>Nenhum jogo encontrado</strong>
              <span>Tente pesquisar por outra selecao ou grupo.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardGameItem({ match }) {
  const hasResult = match.home_score != null && match.away_score != null;

  return (
    <article className={`dashboard-game-item ${hasResult ? "finished" : "scheduled"}`}>
      <div className="dashboard-game-main">
        <div className="dashboard-game-scoreline">
          <span className="dashboard-team home">
            <FlagImage name={match.home_team} />
            <strong>{match.home_team}</strong>
          </span>
          <span className="dashboard-score">
            {hasResult ? (
              <>
                <strong>{match.home_score}</strong>
                <span>x</span>
                <strong>{match.away_score}</strong>
              </>
            ) : (
              <span>x</span>
            )}
          </span>
          <span className="dashboard-team away">
            <FlagImage name={match.away_team} />
            <strong>{match.away_team}</strong>
          </span>
        </div>
        <div className="dashboard-game-meta">
          <span className="dashboard-game-stage">
            {match.stage === "GROUP" ? "Fase de grupos" : knockoutStageLabel(match.stage)}
            <small>{getMatchContextLabel(match)}</small>
          </span>
          <span className="dashboard-game-time">
            {formatShortDate(match.kickoff_at)}
            <small>{formatTime(match.kickoff_at)}</small>
          </span>
          <span className={`dashboard-game-status ${hasResult ? "finished" : "scheduled"}`}>
            {hasResult ? "Finalizado" : "Pendente"}
          </span>
        </div>
      </div>
    </article>
  );
}

function CompetitionStats({ matches }) {
  const stats = useMemo(() => buildCompetitionStats(matches), [matches]);

  return (
    <section className="panel competition-stats-panel">
      <div className="panel-header">
        <h2>Estatisticas da competicao</h2>
      </div>
      <div className="competition-stats-grid">
        <article className="competition-stat-card">
          <CompetitionStatIcon type="calendar" tone="neutral" />
          <span className="competition-stat-icon neutral">▦</span>
          <div>
            <span>Jogos ja realizados</span>
            <strong>{stats.completed} / {stats.total}</strong>
            <small>{stats.progress}% da fase concluida</small>
          </div>
          <div className="competition-progress"><i style={{ width: `${stats.progress}%` }} /></div>
        </article>
        <CompetitionTeamStat title="Selecao com mais gols" item={stats.mostGoals} suffix="gols" tone="gold" icon="trophy" />
        <CompetitionTeamStat title="Selecao com mais vitorias" item={stats.mostWins} suffix="vitorias" tone="green" icon="trophy" />
        <CompetitionTeamStat title="Selecao com menos gols" item={stats.leastGoals} suffix="gols" tone="neutral" icon="scoreboard" />
      </div>
    </section>
  );
}

function CompetitionTeamStat({ title, item, suffix, tone, icon }) {
  return (
    <article className="competition-stat-card team-stat">
      <CompetitionStatIcon type={icon} tone={tone} />
      <span className={`competition-stat-icon ${tone}`}>🏆</span>
      <div>
        <span>{title}</span>
        {item ? (
          <>
            <strong><FlagImage name={item.team} /> {item.team}</strong>
            <small>{item.value} {suffix}</small>
          </>
        ) : (
          <>
            <strong>-</strong>
            <small>Aguardando resultados</small>
          </>
        )}
      </div>
    </article>
  );
}

function CompetitionStatIcon({ type, tone }) {
  const iconMap = {
    calendar: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="6.5" width="14" height="13" rx="2" />
        <path d="M8 4.5v4M16 4.5v4M5 10h14" />
        <path d="M8.5 13h2M13.5 13h2M8.5 16h2M13.5 16h2" />
      </svg>
    ),
    trophy: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5h8v4.5a4 4 0 0 1-8 0V5Z" />
        <path d="M8 7H5.5a2.5 2.5 0 0 0 2.7 3.5M16 7h2.5a2.5 2.5 0 0 1-2.7 3.5" />
        <path d="M12 13.5V17M9 19h6M10 17h4" />
      </svg>
    ),
    scoreboard: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="6" width="14" height="12" rx="2" />
        <path d="M8 9.5h2M14 9.5h2M8 12h2M14 12h2M8 14.5h2M14 14.5h2" />
        <path d="M9 4.5v2M15 4.5v2" />
      </svg>
    )
  };

  return <span className={`competition-stat-svg-icon ${tone}`}>{iconMap[type] || iconMap.scoreboard}</span>;
}

function buildCompetitionStats(matches) {
  const completedMatches = matches.filter((match) => match.home_score != null && match.away_score != null);
  const total = matches.length;
  const teams = new Map();

  function ensureTeam(name) {
    if (!teams.has(name)) {
      teams.set(name, { team: name, goals: 0, wins: 0, played: 0 });
    }
    return teams.get(name);
  }

  for (const match of completedMatches) {
    const homeScore = Number(match.home_score);
    const awayScore = Number(match.away_score);
    const home = ensureTeam(match.home_team);
    const away = ensureTeam(match.away_team);

    home.goals += homeScore;
    away.goals += awayScore;
    home.played += 1;
    away.played += 1;

    if (homeScore > awayScore) home.wins += 1;
    if (awayScore > homeScore) away.wins += 1;
  }

  const teamRows = [...teams.values()];
  const byMax = (field) => teamRows
    .filter((team) => team.played > 0)
    .sort((a, b) => b[field] - a[field] || a.team.localeCompare(b.team))[0];
  const leastGoals = teamRows
    .filter((team) => team.played > 0)
    .sort((a, b) => a.goals - b.goals || a.team.localeCompare(b.team))[0];
  const mostGoals = byMax("goals");
  const mostWins = byMax("wins");

  return {
    total,
    completed: completedMatches.length,
    progress: total ? Math.round((completedMatches.length / total) * 100) : 0,
    mostGoals: mostGoals ? { team: mostGoals.team, value: mostGoals.goals } : null,
    mostWins: mostWins ? { team: mostWins.team, value: mostWins.wins } : null,
    leastGoals: leastGoals ? { team: leastGoals.team, value: leastGoals.goals } : null
  };
}

function RankingTable({ ranking, participantViewsEnabled, teams }) {
  const [modal, setModal] = useState(null);
  const [loadingParticipantId, setLoadingParticipantId] = useState(null);
  const [loadingType, setLoadingType] = useState("");

  async function openParticipantModal(row, type) {
    setLoadingParticipantId(row.userId);
    setLoadingType(type);
    try {
      const data = await request(`/participants/${row.userId}/public`);
      setModal({ type, ...data });
    } catch (err) {
      if (err.status === 403) {
        setModal({ type: "predictions-disabled" });
        return;
      }

      emitToast("error", err.message || "Nao foi possivel abrir os dados do participante.");
    } finally {
      setLoadingParticipantId(null);
      setLoadingType("");
    }
  }

  return (
    <div className="panel ranking-panel">
      <div className="panel-header">
        <h2>Ranking</h2>
      </div>
      <div className="ranking-table-wrap">
        <table className="table ranking-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Participante</th>
              <th>Pontos</th>
              <th>Bonus</th>
              <th>Placares exatos</th>
              <th>Figurinha</th>
              <th>Palpites</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((row) => (
              <tr key={row.userId}>
                <td>
                  <RankBadge position={row.position} />
                </td>
                <td>{row.displayName || row.name}</td>
                <td>{row.totalPoints}</td>
                <td>{row.bonusPoints || 0}</td>
                <td>{row.exactScores}</td>
                <td>
                  <button className="secondary-button compact-button" type="button" onClick={() => openParticipantModal(row, "sticker")} disabled={loadingParticipantId === row.userId}>
                    {loadingParticipantId === row.userId && loadingType === "sticker" ? "Abrindo..." : "Ver figurinha"}
                  </button>
                </td>
                <td>
                  <button className="secondary-button compact-button" type="button" onClick={() => openParticipantModal(row, "predictions")} disabled={loadingParticipantId === row.userId}>
                    {loadingParticipantId === row.userId && loadingType === "predictions" ? "Abrindo..." : "Ver palpites"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === "sticker" && (
        <ParticipantStickerModal participant={modal.participant} onClose={() => setModal(null)} />
      )}
      {loadingParticipantId && !modal && (
        <ParticipantLoadingModal label={loadingType === "sticker" ? "Carregando figurinha" : "Carregando palpites"} />
      )}
      {modal?.type === "predictions-disabled" && (
        <PredictionDisabledModal onClose={() => setModal(null)} />
      )}
      {modal?.type === "predictions" && (
        <ParticipantPredictionsModal
          participant={modal.participant}
          predictions={modal.predictions}
          bonusPrediction={modal.bonusPrediction}
          bonusPredictionHidden={modal.bonusPredictionHidden}
          teams={teams}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function PredictionDisabledModal({ onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card prediction-disabled-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Palpite desativado</p>
            <h2>Visualizacao bloqueada</h2>
            <p>Os palpites dos outros participantes estao desativados neste momento.</p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar modal">×</button>
        </div>
        <div className="prediction-disabled-body">
          <span className="prediction-disabled-icon"><NavIcon type="rules" /></span>
          <strong>Voce ainda pode acompanhar o ranking e editar os seus proprios palpites.</strong>
          <small>Quando a visualizacao for liberada pela organizacao, esse acesso volta a funcionar automaticamente.</small>
        </div>
      </div>
    </div>
  );
}

function ParticipantStickerModal({ participant, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card participant-modal-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Figurinha</p>
            <h2>{participant.displayName || participant.name}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar modal">×</button>
        </div>
        <div className="sticker-card public-sticker-card">
          <div className="sticker-year">
            <strong>20</strong>
            <strong>26</strong>
            <small>WORLD CUP</small>
            <em>2026</em>
          </div>
          <div className="sticker-photo">
            {participant.avatarUrl ? <img src={participant.avatarUrl} alt={`Avatar de ${participant.displayName || participant.name}`} /> : <span>{(participant.displayName || participant.name).slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className="sticker-footer">
            <FlagImage name={participant.country} />
            <div>
              <strong>{participant.displayName || participant.name}</strong>
              <small>{participant.profilePhrase || "Rumo ao hexa!"}</small>
            </div>
            <span className="sticker-ball">⚽</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParticipantLoadingModal({ label }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card participant-loading-card">
        <Logo />
        <strong>{label}...</strong>
        <span>Buscando informacoes do participante.</span>
      </div>
    </div>
  );
}

function ParticipantPredictionsModal({ participant, predictions, bonusPrediction, bonusPredictionHidden, teams, onClose }) {
  const normalizedPredictions = useMemo(() => predictions.map(normalizePublicPredictionMatch), [predictions]);
  const filledCount = normalizedPredictions.filter((match) => match.prediction).length;
  const hiddenCount = normalizedPredictions.filter((match) => match.predictionHidden).length;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div className="participant-fullscreen-modal" role="dialog" aria-modal="true">
      <div className="participant-fullscreen-shell">
        <div className="participant-fullscreen-header">
          <div>
            <p className="eyebrow">Palpites</p>
            <h2>{participant.displayName || participant.name}</h2>
            <p>{filledCount}/{normalizedPredictions.length} palpites visiveis{hiddenCount ? ` | ${hiddenCount} liberam no inicio do jogo` : ""}.</p>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar modal">×</button>
        </div>

        <div className="participant-fullscreen-body">
          <div className="bonus-public-box">
            <strong>Bonus</strong>
            {bonusPredictionHidden ? (
              <span className="prediction-hidden-note">Liberado apos o inicio da competicao.</span>
            ) : (
              <>
                <span>Campeao: {bonusPrediction.champion || "-"}</span>
                <span>Vice: {bonusPrediction.runnerUp || "-"}</span>
                <span>Artilheiro: {bonusPrediction.topScorer || "-"}</span>
                <span>Terceiro lugar: {bonusPrediction.surpriseTeam || "-"}</span>
              </>
            )}
          </div>

          <div className="participant-predictions-wrap">
            {normalizedPredictions.length > 0 ? (
              <MatchesAccordion matches={normalizedPredictions} teams={teams} mode="publicPrediction" />
            ) : (
              <div className="empty-modal-state">Nenhum palpite preenchido.</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function normalizePublicPredictionMatch(match) {
  const prediction = match.prediction || (
    match.predictionHomeScore != null && match.predictionAwayScore != null
      ? {
          home_score: match.predictionHomeScore,
          away_score: match.predictionAwayScore,
          qualified_team: match.predictionQualifiedTeam || ""
        }
      : null
  );

  return {
    ...match,
    round_name: match.round_name || match.roundName || "",
    home_team: match.home_team || match.homeTeam || "",
    away_team: match.away_team || match.awayTeam || "",
    kickoff_at: match.kickoff_at || match.kickoffAt || "",
    home_score: match.home_score ?? match.officialHomeScore ?? null,
    away_score: match.away_score ?? match.officialAwayScore ?? null,
    qualified_team: match.qualified_team ?? match.officialQualifiedTeam ?? null,
    prediction,
    predictionHidden: Boolean(match.predictionHidden),
    predictionAvailableAt: match.predictionAvailableAt || "",
    points: match.points || 0
  };
}

function buildGroupStandings(teams, matches) {
  const standings = {};

  for (const team of teams) {
    const group = team.group_name || "-";
    if (!standings[group]) standings[group] = [];
    standings[group].push({
      name: team.name,
      p: 0,
      j: 0,
      v: 0,
      e: 0,
      d: 0,
      gp: 0,
      gc: 0,
      sg: 0,
      pct: 0
    });
  }

  const byTeam = Object.values(standings)
    .flat()
    .reduce((acc, row) => {
      acc[row.name] = row;
      return acc;
    }, {});

  for (const match of matches) {
    if (match.stage !== "GROUP" || match.home_score == null || match.away_score == null) continue;

    const home = byTeam[match.home_team];
    const away = byTeam[match.away_team];
    if (!home || !away) continue;

    const homeScore = Number(match.home_score);
    const awayScore = Number(match.away_score);

    home.j += 1;
    away.j += 1;
    home.gp += homeScore;
    home.gc += awayScore;
    away.gp += awayScore;
    away.gc += homeScore;

    if (homeScore > awayScore) {
      home.v += 1;
      away.d += 1;
      home.p += 3;
    } else if (awayScore > homeScore) {
      away.v += 1;
      home.d += 1;
      away.p += 3;
    } else {
      home.e += 1;
      away.e += 1;
      home.p += 1;
      away.p += 1;
    }

    home.sg = home.gp - home.gc;
    away.sg = away.gp - away.gc;
    home.pct = home.j ? Math.round((home.p / (home.j * 3)) * 100) : 0;
    away.pct = away.j ? Math.round((away.p / (away.j * 3)) * 100) : 0;
  }

  for (const group of Object.keys(standings)) {
    standings[group].sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      if (b.sg !== a.sg) return b.sg - a.sg;
      if (b.gp !== a.gp) return b.gp - a.gp;
      return a.name.localeCompare(b.name);
    });
  }

  return standings;
}

function buildPredictionStandings(teams, matches) {
  const standings = {};

  for (const team of teams) {
    const group = team.group_name || "-";
    if (!standings[group]) standings[group] = [];
    standings[group].push({
      name: team.name,
      group,
      p: 0,
      j: 0,
      gp: 0,
      gc: 0,
      sg: 0
    });
  }

  const byTeam = Object.values(standings)
    .flat()
    .reduce((acc, row) => {
      acc[row.name] = row;
      return acc;
    }, {});

  for (const match of matches) {
    if (match.stage !== "GROUP" || !match.prediction) continue;

    const home = byTeam[match.home_team];
    const away = byTeam[match.away_team];
    if (!home || !away) continue;

    const homeScore = Number(match.prediction.home_score);
    const awayScore = Number(match.prediction.away_score);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;

    home.j += 1;
    away.j += 1;
    home.gp += homeScore;
    home.gc += awayScore;
    away.gp += awayScore;
    away.gc += homeScore;

    if (homeScore > awayScore) {
      home.p += 3;
    } else if (awayScore > homeScore) {
      away.p += 3;
    } else {
      home.p += 1;
      away.p += 1;
    }

    home.sg = home.gp - home.gc;
    away.sg = away.gp - away.gc;
  }

  for (const group of Object.keys(standings)) {
    standings[group].sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      if (b.sg !== a.sg) return b.sg - a.sg;
      if (b.gp !== a.gp) return b.gp - a.gp;
      return a.name.localeCompare(b.name);
    });
  }

  return standings;
}

function buildBestThirds(predictionStandings) {
  return Object.values(predictionStandings)
    .map((rows) => rows[2])
    .filter(Boolean)
    .sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      if (b.sg !== a.sg) return b.sg - a.sg;
      if (b.gp !== a.gp) return b.gp - a.gp;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8)
    .map((team) => `${team.group}:${team.name}`);
}

const bracketSideStages = [
  { key: "ROUND_OF_32", label: "16-avos", className: "round-32" },
  { key: "ROUND_OF_16", label: "Oitavas", className: "round-16" },
  { key: "QUARTER", label: "Quartas", className: "quarter" },
  { key: "SEMI", label: "Semi", className: "semi" }
];

function getMatchCode(match, index = 0) {
  const source = match.round_name || "";
  const matchNumber = source.match(/Jogo\s+(\d+)/i);
  return matchNumber ? `J${matchNumber[1]}` : `J${index + 1}`;
}

function splitBracketMatches(matches) {
  const middle = Math.ceil(matches.length / 2);
  return {
    left: matches.slice(0, middle),
    right: matches.slice(middle)
  };
}

function getBracketMatchData(match, mode) {
  const usePrediction = mode === "prediction" || mode === "publicPrediction";
  const source = usePrediction ? match.prediction : match;
  const homeScore = source?.home_score ?? null;
  const awayScore = source?.away_score ?? null;
  const hasScore = homeScore != null && awayScore != null;
  const qualifier = usePrediction ? getPredictedQualifier(match) : match.qualified_team;
  const protectedPrediction = Boolean(match.predictionHidden);

  return {
    homeScore,
    awayScore,
    hasScore,
    qualifier,
    protectedPrediction,
    status: protectedPrediction
      ? "Protegido"
      : hasScore
        ? usePrediction ? "Palpite" : "Full time"
        : "A definir"
  };
}

function KnockoutBracketView({ matches, activeStage, onStageSelect, mode, onSave }) {
  const sortedMatches = useMemo(() => sortMatchesByKickoff(matches), [matches]);
  const grouped = useMemo(() => {
    return sortedMatches.reduce((acc, match) => {
      if (!acc[match.stage]) acc[match.stage] = [];
      acc[match.stage].push(match);
      return acc;
    }, {});
  }, [sortedMatches]);
  const visibleStages = bracketSideStages.filter((stage) => grouped[stage.key]?.length);
  const finalMatch = grouped.FINAL?.[0];
  const thirdPlaceMatch = grouped.THIRD_PLACE?.[0];
  const completed = sortedMatches.filter((match) => getBracketMatchData(match, mode).qualifier).length;
  const saveHandler = mode === "result" ? onSave?.onSave : onSave;
  const resetHandler = mode === "result" ? onSave?.onReset : undefined;

  if (!sortedMatches.length) return null;

  const sideData = visibleStages.map((stage) => ({
    ...stage,
    ...splitBracketMatches(grouped[stage.key] || [])
  }));
  const sideColumnCount = Math.max(sideData.length, 1);
  const sideColumnWidth = sideColumnCount >= 4 ? 150 : sideColumnCount === 3 ? 164 : sideColumnCount === 2 ? 178 : 190;
  const centerColumnWidth = sideColumnCount >= 4 ? 170 : sideColumnCount === 3 ? 180 : sideColumnCount === 2 ? 190 : 200;
  const columnGap = sideColumnCount >= 4 ? 10 : 12;
  const sideColumns = Array(sideColumnCount).fill(`${sideColumnWidth}px`).join(" ");
  const gridTemplateColumns = `${sideColumns} ${centerColumnWidth}px ${sideColumns}`;
  const minCanvasWidth = (sideColumnCount * 2 * sideColumnWidth) + centerColumnWidth + ((sideColumnCount * 2) * columnGap) + 36;

  return (
    <section className="wc-bracket-panel">
      <div className="wc-bracket-heading">
        <div>
          <span className="eyebrow">Chaveamento</span>
          <h2>Mata-mata</h2>
          <p>Preencha direto na chave, das pontas ate as decisoes.</p>
        </div>
        <strong>{completed}/{sortedMatches.length} definidos</strong>
      </div>

      <div className="wc-bracket-scroll">
        <div
          className={`wc-bracket-canvas stages-${sideColumnCount}`}
          style={{
            gridTemplateColumns,
            columnGap: `${columnGap}px`,
            minWidth: `${minCanvasWidth}px`
          }}
        >
          {sideData.map((stage) => (
            <BracketColumn
              key={`left-${stage.key}`}
              side="left"
              stage={stage}
              matches={stage.left}
              mode={mode}
              activeStage={activeStage}
              onStageSelect={onStageSelect}
              onSave={saveHandler}
              onReset={resetHandler}
            />
          ))}

          <div className="wc-bracket-center">
            <span className="wc-center-title">Final</span>
            {finalMatch ? (
              <BracketMatchCard
                match={finalMatch}
                mode={mode}
                featured
                onSelect={() => onStageSelect(knockoutStageLabel("FINAL"))}
                onSave={saveHandler}
                onReset={resetHandler}
              />
            ) : (
              <BracketPlaceholder label="Final" />
            )}
            <div className="wc-center-cross">
              <div />
              <span>Campeao</span>
              <div />
            </div>
            <span className="wc-center-title secondary">Disputa de 3o lugar</span>
            {thirdPlaceMatch ? (
              <BracketMatchCard
                match={thirdPlaceMatch}
                mode={mode}
                onSelect={() => onStageSelect(knockoutStageLabel("THIRD_PLACE"))}
                onSave={saveHandler}
                onReset={resetHandler}
              />
            ) : (
              <BracketPlaceholder label="3o lugar" />
            )}
          </div>

          {[...sideData].reverse().map((stage) => (
            <BracketColumn
              key={`right-${stage.key}`}
              side="right"
              stage={stage}
              matches={stage.right}
              mode={mode}
              activeStage={activeStage}
              onStageSelect={onStageSelect}
              onSave={saveHandler}
              onReset={resetHandler}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function BracketColumn({ side, stage, matches, mode, activeStage, onStageSelect, onSave, onReset }) {
  const stageLabel = knockoutStageLabel(stage.key);

  return (
    <div className={`wc-bracket-column ${side} ${stage.className}`}>
      <button
        type="button"
        className={`wc-stage-label ${activeStage === stageLabel ? "active" : ""}`}
        onClick={() => onStageSelect(stageLabel)}
      >
        {stage.label}
      </button>
      <div className="wc-bracket-list">
        {matches.map((match, index) => (
          <BracketMatchCard
            key={match.id}
            match={match}
            index={index}
            mode={mode}
            onSelect={() => onStageSelect(stageLabel)}
            onSave={onSave}
            onReset={onReset}
          />
        ))}
      </div>
    </div>
  );
}

function BracketMatchCard({ match, index = 0, mode, featured = false, onSelect, onSave, onReset }) {
  const data = getBracketMatchData(match, mode);
  const homeAdvances = data.qualifier && data.qualifier === match.home_team;
  const awayAdvances = data.qualifier && data.qualifier === match.away_team;
  const qualifierLabel = mode === "result" ? "Classificado" : "Avanca";
  const statusClass = data.protectedPrediction ? "protected" : data.hasScore ? "done" : "pending";

  return (
    <article className={`wc-match ${featured ? "featured" : ""} ${match.locked ? "locked" : ""}`}>
      <div className="wc-match-top">
        <button type="button" className="wc-match-stage-button" onClick={onSelect}>
          {getMatchCode(match, index)}
        </button>
        <small className={`wc-match-status ${statusClass}`}>{data.status}</small>
      </div>
      <div className="wc-match-teams">
        <BracketTeamLine name={match.home_team} score={data.homeScore} advances={homeAdvances} />
        <BracketTeamLine name={match.away_team} score={data.awayScore} advances={awayAdvances} />
      </div>
      <div className="wc-match-footer">
        <span>{formatShortDate(match.kickoff_at)} | {formatTime(match.kickoff_at)}</span>
        <strong>{data.qualifier ? `${qualifierLabel}: ${data.qualifier}` : data.protectedPrediction ? "Palpite protegido" : "Classificado: -"}</strong>
      </div>
      <BracketMatchControls match={match} mode={mode} onSave={onSave} onReset={onReset} />
    </article>
  );
}

function BracketTeamLine({ name, score, advances }) {
  return (
    <div className={`wc-team ${advances ? "winner" : ""}`}>
      <TeamName name={name} />
      <strong>{score != null ? score : "-"}</strong>
    </div>
  );
}

function BracketMatchControls({ match, mode, onSave, onReset }) {
  if (mode === "prediction") {
    return <PredictionControls match={match} onSave={onSave} variant="bracket" />;
  }

  if (mode === "publicPrediction") {
    return <PublicPredictionSummary match={match} variant="bracket" />;
  }

  return <ResultControls match={match} onSave={onSave} onReset={onReset} variant="bracket" />;
}

function BracketPlaceholder({ label }) {
  return (
    <div className="wc-match placeholder">
      <span className="wc-match-top">
        <small>A definir</small>
        <b>{label}</b>
      </span>
      <span className="wc-team empty"><span>Vencedor 1</span><strong>-</strong></span>
      <span className="wc-team empty"><span>Vencedor 2</span><strong>-</strong></span>
    </div>
  );
}

function buildOfficialQualifiers(standings) {
  const bestThirdKeys = Object.values(standings)
    .map((rows) => rows[2])
    .filter(Boolean)
    .sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      if (b.sg !== a.sg) return b.sg - a.sg;
      if (b.gp !== a.gp) return b.gp - a.gp;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8)
    .map((team) => `${team.group}:${team.name}`);

  return new Set(bestThirdKeys);
}

function GroupsView({ teams, matches }) {
  const standings = useMemo(() => buildGroupStandings(teams, matches), [teams, matches]);
  const bestThirdKeys = useMemo(() => buildOfficialQualifiers(standings), [standings]);

  return (
    <section className="groups-layout">
      {Object.entries(standings).sort(([a], [b]) => a.localeCompare(b)).map(([group, rows]) => {
        const hasOfficialGames = rows.some((row) => row.j > 0);

        return (
          <div className="panel group-panel" key={group}>
            <div className="group-panel-header">
              <div>
                <h2>Grupo {group}</h2>
                <p>Classificacao baseada nos resultados oficiais salvos.</p>
              </div>
              <span>{rows.filter((row, index) => index < 2 || bestThirdKeys.has(`${group}:${row.name}`)).length}/4 avancando</span>
            </div>

            <div className="qualified-strip">
              {rows.map((row, index) => {
                const bestThird = bestThirdKeys.has(`${group}:${row.name}`);
                const status = index < 2 ? "Passa direto" : bestThird ? "Melhor terceiro" : "Fora";

                return (
                  <article className={`qualified-mini-card ${index < 2 || bestThird ? "advance" : "out"}`} key={row.name}>
                    <span className="group-position">{index + 1}</span>
                    <TeamName name={row.name} />
                    <small>{hasOfficialGames ? status : "Aguardando resultados"}</small>
                  </article>
                );
              })}
            </div>

            <div className="group-table-wrap">
              <table className="group-table">
                <thead>
                  <tr>
                    <th>Classificacao</th>
                    <th>Status</th>
                    <th>P</th>
                    <th>J</th>
                    <th>V</th>
                    <th>E</th>
                    <th>D</th>
                    <th>GP</th>
                    <th>GC</th>
                    <th>SG</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const bestThird = bestThirdKeys.has(`${group}:${row.name}`);
                    const status = index < 2 ? "Passa direto" : bestThird ? "Melhor terceiro" : "Fora";

                    return (
                      <tr className={index < 2 || bestThird ? "group-row-advance" : ""} key={row.name}>
                        <td>
                          <span className="group-position">{index + 1}</span>
                          <TeamName name={row.name} />
                        </td>
                        <td>
                          <span className={`group-status-badge ${index < 2 ? "direct" : bestThird ? "third" : "out"}`}>
                            {hasOfficialGames ? status : "Aguardando"}
                          </span>
                        </td>
                        <td>{row.p}</td>
                        <td>{row.j}</td>
                        <td>{row.v}</td>
                        <td>{row.e}</td>
                        <td>{row.d}</td>
                        <td>{row.gp}</td>
                        <td>{row.gc}</td>
                        <td>{row.sg}</td>
                        <td>{row.pct}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function RulesView() {
  return (
    <section className="rules-layout">
      {rules.map((rule) => (
        <article className="panel rule-panel" key={rule.title}>
          <h2>{rule.title}</h2>
          <ul>
            {rule.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function MatchCard({ match, onSave }) {
  const [homeScore, setHomeScore] = useState(match.prediction?.home_score ?? "");
  const [awayScore, setAwayScore] = useState(match.prediction?.away_score ?? "");
  const [qualifiedTeam, setQualifiedTeam] = useState(match.prediction?.qualified_team ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHomeScore(match.prediction?.home_score ?? "");
    setAwayScore(match.prediction?.away_score ?? "");
    setQualifiedTeam(match.prediction?.qualified_team ?? "");
  }, [match.prediction?.home_score, match.prediction?.away_score, match.prediction?.qualified_team]);

  const allowedQualifiedTeams = getAllowedQualifiedTeams(match, homeScore, awayScore);
  const allowedQualifiedTeamKey = allowedQualifiedTeams.join("|");
  const qualifiedTeamValue = coerceQualifiedTeam(match, homeScore, awayScore, qualifiedTeam);

  useEffect(() => {
    if (match.stage !== "GROUP" && qualifiedTeam !== qualifiedTeamValue) {
      setQualifiedTeam("");
    }
  }, [allowedQualifiedTeamKey, match.stage, qualifiedTeam, qualifiedTeamValue]);

  function handleHomeScoreChange(value) {
    setHomeScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, value, awayScore, current));
  }

  function handleAwayScoreChange(value) {
    setAwayScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, homeScore, value, current));
  }

  function handleQualifiedTeamChange(value) {
    setQualifiedTeam(coerceQualifiedTeam(match, homeScore, awayScore, value));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (match.locked) {
      emitToast("error", "Prazo encerrado: este palpite fechou 5 minutos antes do jogo.");
      return;
    }

    const qualifiedError = getQualifiedSelectionError(match, homeScore, awayScore, qualifiedTeamValue);
    if (qualifiedError) {
      emitToast("error", qualifiedError);
      return;
    }

    setSaving(true);

    try {
      await onSave({
        matchId: match.id,
        homeScore,
        awayScore,
        qualifiedTeam: qualifiedTeamValue
      });
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="match-card">
      <div className="match-header">
        <div>
          <p className="match-stage">{match.stage === "GROUP" ? "Fase de grupos" : knockoutStageLabel(match.stage)}</p>
          <h3>{match.round_name}</h3>
          <p className="match-date">{formatDate(match.kickoff_at)}</p>
        </div>
        <span className={`tag ${match.locked ? "locked" : "open"}`}>
          {match.locked ? "Fechado" : "Aberto"}
        </span>
      </div>

      <div className="teams-row">
        <strong>{match.home_team}</strong>
        <span>x</span>
        <strong>{match.away_team}</strong>
      </div>

      {(match.home_score != null || match.away_score != null) && (
        <div className="result-box">
          <span>
            Resultado: {match.home_score} x {match.away_score}
          </span>
          {match.qualified_team && <span>Classificado: {match.qualified_team}</span>}
          <span>Seus pontos: {match.points}</span>
        </div>
      )}

      <form className={`prediction-form ${match.locked ? "locked-fields" : ""}`} onSubmit={handleSubmit}>
        <div className="score-inputs">
          <input
            type="number"
            min="0"
            value={homeScore}
            onChange={(event) => handleHomeScoreChange(event.target.value)}
            disabled={match.locked}
            placeholder="Casa"
          />
          <input
            type="number"
            min="0"
            value={awayScore}
            onChange={(event) => handleAwayScoreChange(event.target.value)}
            disabled={match.locked}
            placeholder="Fora"
          />
        </div>

        {match.stage !== "GROUP" && (
          <label>
            Classificado
            <select value={qualifiedTeamValue} onChange={(event) => handleQualifiedTeamChange(event.target.value)} disabled={match.locked}>
              <option value="">Selecione quem avancou</option>
              {renderQualifiedTeamOptions(allowedQualifiedTeams)}
            </select>
          </label>
        )}

        <button className="secondary-button" type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar palpite"}
        </button>
      </form>
    </article>
  );
}

function MatchesAccordion({ matches, teams, onSave, mode = "prediction" }) {
  const [viewMode, setViewMode] = useState("groups");
  const groupMatches = matches.filter((match) => match.stage === "GROUP");
  const finalMatches = matches.filter((match) => match.stage !== "GROUP");
  const canSwitchView = mode === "prediction" || mode === "publicPrediction" || mode === "result";

  return (
    <section className="matches-accordion">
      {canSwitchView && (
        <div className="view-mode-bar">
          <div>
            <strong>Ver jogos por</strong>
            <span>{viewMode === "groups" ? "Analise por grupo e classificacao." : "Preencha rodada por rodada pela data."}</span>
          </div>
          <div className="segmented-control">
            <button type="button" className={viewMode === "groups" ? "active" : ""} onClick={() => setViewMode("groups")}>Grupos</button>
            <button type="button" className={viewMode === "dates" ? "active" : ""} onClick={() => setViewMode("dates")}>Datas</button>
          </div>
        </div>
      )}

      {viewMode === "dates" && canSwitchView ? (
        <MatchesByDatePanel matches={matches} teams={teams} onSave={onSave} mode={mode} />
      ) : (
        <>
          {groupMatches.length > 0 && <MatchesByGroupPanel title="Fase de grupos" matches={groupMatches} teams={teams} onSave={onSave} mode={mode} />}
          {finalMatches.length > 0 && <MatchesByGroupPanel title="Mata-mata" matches={finalMatches} teams={teams} onSave={onSave} mode={mode} />}
        </>
      )}
    </section>
  );
}

function MatchesByDatePanel({ matches, onSave, mode }) {
  const sortedMatches = useMemo(() => sortMatchesByKickoff(matches), [matches]);
  const dates = useMemo(() => [...new Set(sortedMatches.map((match) => getDateKey(match.kickoff_at)))], [sortedMatches]);
  const preferredDate = useMemo(() => getPreferredDateKey(dates), [dates]);
  const [activeDate, setActiveDate] = useState(preferredDate);

  useEffect(() => {
    if (!dates.includes(activeDate)) setActiveDate(preferredDate);
  }, [activeDate, dates, preferredDate]);

  const visibleMatches = sortedMatches.filter((match) => getDateKey(match.kickoff_at) === activeDate);
  const savedCount = getSavedCount(visibleMatches, mode);
  const progress = visibleMatches.length ? Math.round((savedCount / visibleMatches.length) * 100) : 0;
  const groupedMatches = visibleMatches.reduce((acc, match) => {
    const label = getMatchContextLabel(match);
    if (!acc[label]) acc[label] = [];
    acc[label].push(match);
    return acc;
  }, {});

  return (
    <div className="match-board panel date-board">
      <div className="board-header">
        <div>
          <h2>{activeDate ? formatShortDate(`${activeDate}T12:00:00Z`) : "Datas"}</h2>
          <span>{savedCount}/{visibleMatches.length} preenchidos nessa data</span>
        </div>
        <div className="board-progress">
          <span>Progresso da data</span>
          <div><i style={{ width: `${progress}%` }} /></div>
          <strong>{progress}%</strong>
        </div>
      </div>

      <div className="date-tabs date-tabs-primary">
        {dates.map((date) => (
          <button key={date} type="button" className={date === activeDate ? "active" : ""} onClick={() => setActiveDate(date)}>
            {formatShortDate(`${date}T12:00:00Z`)}
          </button>
        ))}
      </div>

      <div className="date-groups-list">
        {Object.entries(groupedMatches).map(([label, groupItems]) => (
          <section className="date-group-card" key={label}>
            <div className="date-group-header">
              <strong>{label}</strong>
              <span>{getSavedCount(groupItems, mode)}/{groupItems.length} preenchidos</span>
            </div>
            <div className="match-table-wrap">
              <table className="match-table date-match-table">
                <thead>
                  <tr>
                    <th>Horario</th>
                    <th>Jogo</th>
                    <th>{mode === "result" ? "Resultado" : mode === "prediction" || mode === "publicPrediction" ? "Palpite / Resultado" : "Palpite"}</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {groupItems.map((match) => (
                    mode === "prediction" ? (
                      <PredictionTableRow key={match.id} match={match} onSave={onSave} compactDate />
                    ) : mode === "publicPrediction" ? (
                      <PublicPredictionTableRow key={match.id} match={match} compactDate />
                    ) : (
                      <ResultTableRow key={match.id} match={match} onSave={onSave.onSave} onReset={onSave.onReset} compactDate />
                    )
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MatchesByGroupPanel({ title, matches, teams = [], onSave, mode }) {
  const groups = useMemo(() => {
    const values = [...new Set(matches.map((match) => getMatchGroup(match)))];
    return sortMatchGroups(matches, values);
  }, [matches]);
  const isKnockoutPanel = matches.every((match) => match.stage !== "GROUP");
  const [activeGroup, setActiveGroup] = useState(groups[0] || "");
  const groupMatches = matches.filter((match) => getMatchGroup(match) === activeGroup);
  const dates = useMemo(() => ["ALL", ...new Set(groupMatches.map((match) => getDateKey(match.kickoff_at)))], [groupMatches]);
  const [activeDate, setActiveDate] = useState("ALL");
  const [knockoutViewMode, setKnockoutViewMode] = useState("bracket");

  useEffect(() => {
    if (!groups.includes(activeGroup)) setActiveGroup(groups[0] || "");
  }, [activeGroup, groups]);

  useEffect(() => {
    if (!dates.includes(activeDate)) setActiveDate("ALL");
  }, [activeDate, dates]);

  const visibleMatches = activeDate === "ALL" ? groupMatches : groupMatches.filter((match) => getDateKey(match.kickoff_at) === activeDate);
  const savedCount = getSavedCount(groupMatches, mode);
  const progress = groupMatches.length ? Math.round((savedCount / groupMatches.length) * 100) : 0;
  const showGroupTabs = groups.length > 1 && !isKnockoutPanel;
  const isKnockoutBracketView = isKnockoutPanel && knockoutViewMode === "bracket";
  const predictionStandings = useMemo(() => buildPredictionStandings(teams, matches), [teams, matches]);
  const bestThirdKeys = useMemo(() => buildBestThirds(predictionStandings), [predictionStandings]);
  const groupProjection = !isKnockoutPanel
    ? (predictionStandings[activeGroup] || []).map((team, index) => {
      const isDirectQualified = index < 2;
      const isBestThird = index === 2 && bestThirdKeys.includes(`${team.group}:${team.name}`);
      return {
        ...team,
        advances: isDirectQualified || isBestThird,
        qualificationLabel: isDirectQualified ? "Passa" : isBestThird ? "3º geral" : "Fica fora"
      };
    })
    : [];
  const hasProjectedGroup = !isKnockoutPanel && groupMatches.some((match) => match.prediction);
  return (
    <div className="match-board panel">
      <label className="group-select">
        {isKnockoutPanel ? "Etapa" : "Grupo"}
        <select value={activeGroup} onChange={(event) => setActiveGroup(event.target.value)}>
          {groups.map((group) => (
            <option key={group} value={group}>
              {getMatchGroupLabel(group, isKnockoutPanel)}
            </option>
          ))}
        </select>
      </label>
      {showGroupTabs && (
        <div className="board-tabs">
          {groups.map((group) => (
            <button key={group} type="button" className={group === activeGroup ? "active" : ""} onClick={() => setActiveGroup(group)}>
              {getMatchGroupLabel(group, isKnockoutPanel)}
            </button>
          ))}
        </div>
      )}
      <div className="board-header">
        <div>
          <h2>{getMatchGroupLabel(activeGroup, isKnockoutPanel)}</h2>
          <span>{savedCount}/{groupMatches.length} preenchidos</span>
        </div>
        <div className="board-progress">
          <span>{isKnockoutPanel ? "Progresso da etapa" : "Progresso por grupo"}</span>
          <div><i style={{ width: `${progress}%` }} /></div>
          <strong>{progress}%</strong>
        </div>
      </div>
      {(mode === "prediction" || mode === "publicPrediction") && !isKnockoutPanel && (
        <div className="group-projection">
          <div className="group-projection-header">
            <div>
              <strong>Projecao do grupo pelo seu palpite</strong>
              <span>{hasProjectedGroup ? "Ordem calculada pelos placares que voce salvou." : "Salve seus palpites para simular a classificacao."}</span>
            </div>
            <small>2 passam + 8 melhores terceiros | SG: saldo de gols | GP: gols pro</small>
          </div>
          <div className="group-projection-grid">
            {groupProjection.map((team, index) => (
              <div className={`projection-card ${team.advances ? "qualified" : "eliminated"}`} key={team.name}>
                <span className="projection-position">{index + 1}º</span>
                <TeamName name={team.name} />
                <strong>{team.qualificationLabel}</strong>
                <small>{team.p} pts | SG {team.sg} | GP {team.gp}</small>
              </div>
            ))}
          </div>
        </div>
      )}
      {isKnockoutPanel && (
        <div className="knockout-view-switch">
          <div>
            <strong>{isKnockoutBracketView ? "Chaveamento visual" : "Tabela do mata-mata"}</strong>
            <span>{isKnockoutBracketView ? "Edite palpites e resultados dentro dos jogos." : "Modo classico com filtros por etapa e data."}</span>
          </div>
          <button
            type="button"
            onClick={() => setKnockoutViewMode((current) => current === "bracket" ? "table" : "bracket")}
          >
            {isKnockoutBracketView ? "Trocar para tabela" : "Trocar para chaveamento visual"}
          </button>
        </div>
      )}
      {isKnockoutBracketView ? (
        <KnockoutBracketView matches={matches} activeStage={activeGroup} onStageSelect={setActiveGroup} mode={mode} onSave={onSave} />
      ) : (
        <>
          {isKnockoutPanel && (
            <div className="knockout-detail-header">
              <div>
                <strong>Detalhes da etapa selecionada</strong>
                <span>{activeGroup} | {visibleMatches.length} confronto(s)</span>
              </div>
              <small>A tabela continua disponivel como fallback operacional.</small>
            </div>
          )}
          <div className="date-tabs">
            {dates.map((date) => (
              <button key={date} type="button" className={date === activeDate ? "active" : ""} onClick={() => setActiveDate(date)}>
                {date === "ALL" ? "Todas as datas" : formatShortDate(`${date}T12:00:00Z`)}
              </button>
            ))}
          </div>
          <div className="match-table-wrap">
            <table className="match-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Jogo</th>
                  <th>{mode === "result" ? "Resultado" : mode === "prediction" || mode === "publicPrediction" ? "Palpite / Resultado" : "Palpite"}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleMatches.map((match) => (
                  mode === "prediction" ? (
                    <PredictionTableRow key={match.id} match={match} onSave={onSave} />
                  ) : mode === "publicPrediction" ? (
                    <PublicPredictionTableRow key={match.id} match={match} />
                  ) : (
                    <ResultTableRow key={match.id} match={match} onSave={onSave.onSave} onReset={onSave.onReset} />
                  )
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function PredictionControls({ match, onSave, variant = "table" }) {
  const [homeScore, setHomeScore] = useState(match.prediction?.home_score ?? "");
  const [awayScore, setAwayScore] = useState(match.prediction?.away_score ?? "");
  const [qualifiedTeam, setQualifiedTeam] = useState(match.prediction?.qualified_team ?? "");
  const [saving, setSaving] = useState(false);
  const isBracket = variant === "bracket";

  useEffect(() => {
    setHomeScore(match.prediction?.home_score ?? "");
    setAwayScore(match.prediction?.away_score ?? "");
    setQualifiedTeam(match.prediction?.qualified_team ?? "");
  }, [match.prediction?.home_score, match.prediction?.away_score, match.prediction?.qualified_team]);

  const allowedQualifiedTeams = getAllowedQualifiedTeams(match, homeScore, awayScore);
  const allowedQualifiedTeamKey = allowedQualifiedTeams.join("|");
  const qualifiedTeamValue = coerceQualifiedTeam(match, homeScore, awayScore, qualifiedTeam);

  useEffect(() => {
    if (match.stage !== "GROUP" && qualifiedTeam !== qualifiedTeamValue) {
      setQualifiedTeam("");
    }
  }, [allowedQualifiedTeamKey, match.stage, qualifiedTeam, qualifiedTeamValue]);

  function handleHomeScoreChange(value) {
    setHomeScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, value, awayScore, current));
  }

  function handleAwayScoreChange(value) {
    setAwayScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, homeScore, value, current));
  }

  function handleQualifiedTeamChange(value) {
    setQualifiedTeam(coerceQualifiedTeam(match, homeScore, awayScore, value));
  }

  async function save() {
    if (match.locked) {
      emitToast("error", "Prazo encerrado: este palpite fechou 5 minutos antes do jogo.");
      return;
    }

    const qualifiedError = getQualifiedSelectionError(match, homeScore, awayScore, qualifiedTeamValue);
    if (qualifiedError) {
      emitToast("error", qualifiedError);
      return;
    }

    setSaving(true);
    try {
      await onSave?.({ matchId: match.id, homeScore, awayScore, qualifiedTeam: qualifiedTeamValue });
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`prediction-result-cell ${isBracket ? "bracket-control-block" : ""}`}>
      <div className={`inline-score ${isBracket ? "bracket-score-editor" : ""} ${match.locked ? "locked-fields" : ""}`}>
        <input
          type="number"
          min="0"
          value={homeScore}
          disabled={match.locked}
          onChange={(event) => handleHomeScoreChange(event.target.value)}
          placeholder="Casa"
          aria-label={`Palpite ${match.home_team}`}
        />
        <span>x</span>
        <input
          type="number"
          min="0"
          value={awayScore}
          disabled={match.locked}
          onChange={(event) => handleAwayScoreChange(event.target.value)}
          placeholder="Fora"
          aria-label={`Palpite ${match.away_team}`}
        />
        {match.stage !== "GROUP" && (
          <select value={qualifiedTeamValue} disabled={match.locked} onChange={(event) => handleQualifiedTeamChange(event.target.value)}>
            <option value="">Classificado</option>
            {renderQualifiedTeamOptions(allowedQualifiedTeams)}
          </select>
        )}
        <button type="button" onClick={save} disabled={saving || (isBracket && match.locked)}>{saving ? "Salvando..." : "Salvar"}</button>
      </div>
      <OfficialResultSummary match={match} variant={variant} />
    </div>
  );
}

function OfficialResultSummary({ match, variant = "table" }) {
  const hasResult = match.home_score != null && match.away_score != null;

  return (
    <div className={`public-official-result compact-result ${variant === "bracket" ? "bracket-summary" : ""} ${hasResult ? "" : "pending"}`}>
      <span>Resultado</span>
      <strong>{hasResult ? `${match.home_score} x ${match.away_score}` : "-"}</strong>
      {match.stage !== "GROUP" && <small>Classificado: {match.qualified_team || "-"}</small>}
    </div>
  );
}

function PublicPredictionSummary({ match, variant = "table" }) {
  const hasPrediction = Boolean(match.prediction);
  const predictionHidden = Boolean(match.predictionHidden);

  return (
    <div className={`public-prediction-result-cell ${variant === "bracket" ? "bracket-control-block" : ""}`}>
      {hasPrediction ? (
        <div className={`public-inline-prediction ${variant === "bracket" ? "bracket-summary" : ""}`}>
          <span>Palpite</span>
          <strong>{match.prediction.home_score} x {match.prediction.away_score}</strong>
          {match.stage !== "GROUP" && <small>Classificado: {match.prediction.qualified_team || "-"}</small>}
          <small>{match.points || 0} pts</small>
        </div>
      ) : predictionHidden ? (
        <div className={`public-inline-prediction prediction-hidden-box ${variant === "bracket" ? "bracket-summary" : ""}`}>
          <span>Palpite protegido</span>
          <strong>Liberado no inicio do jogo</strong>
          <small>{match.predictionAvailableAt ? formatDate(match.predictionAvailableAt) : "Aguardando inicio"}</small>
        </div>
      ) : (
        <span className="status-dot pending">Sem palpite</span>
      )}
      <OfficialResultSummary match={match} variant={variant} />
    </div>
  );
}

function ResultControls({ match, onSave, onReset, variant = "table" }) {
  const [homeScore, setHomeScore] = useState(match.home_score ?? "");
  const [awayScore, setAwayScore] = useState(match.away_score ?? "");
  const [qualifiedTeam, setQualifiedTeam] = useState(match.qualified_team ?? "");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const isKnockout = match.stage !== "GROUP";
  const hasResult = match.home_score != null || match.away_score != null || match.qualified_team;
  const isBracket = variant === "bracket";

  useEffect(() => {
    setHomeScore(match.home_score ?? "");
    setAwayScore(match.away_score ?? "");
    setQualifiedTeam(match.qualified_team ?? "");
  }, [match.home_score, match.away_score, match.qualified_team]);

  const allowedQualifiedTeams = getAllowedQualifiedTeams(match, homeScore, awayScore);
  const allowedQualifiedTeamKey = allowedQualifiedTeams.join("|");
  const qualifiedTeamValue = coerceQualifiedTeam(match, homeScore, awayScore, qualifiedTeam);

  useEffect(() => {
    if (isKnockout && qualifiedTeam !== qualifiedTeamValue) {
      setQualifiedTeam("");
    }
  }, [allowedQualifiedTeamKey, isKnockout, qualifiedTeam, qualifiedTeamValue]);

  function handleHomeScoreChange(value) {
    setHomeScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, value, awayScore, current));
  }

  function handleAwayScoreChange(value) {
    setAwayScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, homeScore, value, current));
  }

  function handleQualifiedTeamChange(value) {
    setQualifiedTeam(coerceQualifiedTeam(match, homeScore, awayScore, value));
  }

  async function save() {
    const qualifiedError = getQualifiedSelectionError(match, homeScore, awayScore, qualifiedTeamValue);
    if (qualifiedError) {
      emitToast("error", qualifiedError);
      return;
    }

    setSaving(true);
    try {
      await onSave?.(match.id, { homeScore, awayScore, qualifiedTeam: isKnockout ? qualifiedTeamValue : "", status: "FINISHED" });
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setResetting(true);
    try {
      await onReset?.(match.id);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className={`inline-score ${isBracket ? "bracket-score-editor result-score-editor" : ""}`}>
      <input
        type="number"
        min="0"
        value={homeScore}
        onChange={(event) => handleHomeScoreChange(event.target.value)}
        placeholder="Casa"
        aria-label={`Resultado ${match.home_team}`}
      />
      <span>x</span>
      <input
        type="number"
        min="0"
        value={awayScore}
        onChange={(event) => handleAwayScoreChange(event.target.value)}
        placeholder="Fora"
        aria-label={`Resultado ${match.away_team}`}
      />
      {isKnockout && (
        <select value={qualifiedTeamValue} onChange={(event) => handleQualifiedTeamChange(event.target.value)}>
          <option value="">Classificado</option>
          {renderQualifiedTeamOptions(allowedQualifiedTeams)}
        </select>
      )}
      <button type="button" onClick={save} disabled={saving || !onSave}>{saving ? "..." : "Salvar"}</button>
      <button className="mini-danger" type="button" onClick={reset} disabled={!hasResult || resetting || !onReset}>{resetting ? "..." : "Zerar"}</button>
    </div>
  );
}

function PredictionTableRow({ match, onSave, compactDate = false }) {
  return (
    <tr className={match.locked ? "locked-row" : ""}>
      <td>{compactDate ? formatTime(match.kickoff_at) : formatShortDate(match.kickoff_at)}{!compactDate && <small>{formatTime(match.kickoff_at)}</small>}</td>
      <td><TeamName name={match.home_team} /> <span className="versus">x</span> <TeamName name={match.away_team} /></td>
      <td><PredictionControls match={match} onSave={onSave} /></td>
      <td><span className={`status-dot ${match.locked ? "locked" : match.prediction ? "done" : "pending"}`}>{match.locked ? "Fechado" : match.prediction ? "OK" : "Pendente"}</span></td>
    </tr>
  );
}

function PublicPredictionTableRow({ match, compactDate = false }) {
  const hasPrediction = Boolean(match.prediction);
  const predictionHidden = Boolean(match.predictionHidden);

  return (
    <tr>
      <td>{compactDate ? formatTime(match.kickoff_at) : formatShortDate(match.kickoff_at)}{!compactDate && <small>{formatTime(match.kickoff_at)}</small>}</td>
      <td><TeamName name={match.home_team} /> <span className="versus">x</span> <TeamName name={match.away_team} /></td>
      <td><PublicPredictionSummary match={match} /></td>
      <td><span className={`status-dot ${hasPrediction ? "done" : predictionHidden ? "locked" : "pending"}`}>{hasPrediction ? "Preenchido" : predictionHidden ? "Protegido" : "Pendente"}</span></td>
    </tr>
  );
}

function ResultTableRow({ match, onSave, onReset, compactDate = false }) {
  const hasResult = match.home_score != null || match.away_score != null || match.qualified_team;

  return (
    <tr>
      <td>{compactDate ? formatTime(match.kickoff_at) : formatShortDate(match.kickoff_at)}{!compactDate && <small>{formatTime(match.kickoff_at)}</small>}</td>
      <td><TeamName name={match.home_team} /> <span className="versus">x</span> <TeamName name={match.away_team} /></td>
      <td><ResultControls match={match} onSave={onSave} onReset={onReset} /></td>
      <td><span className={`status-dot ${hasResult ? "done" : "pending"}`}>{hasResult ? "Lancado" : "Pendente"}</span></td>
    </tr>
  );
}

function ScoreValue({ home, away, qualifiedTeam, emptyLabel = "-" }) {
  const hasScore = home != null && away != null;

  return (
    <div className={`score-value ${hasScore ? "" : "empty"}`}>
      <strong>{hasScore ? `${home} x ${away}` : emptyLabel}</strong>
      {qualifiedTeam && <small>Classificado: {qualifiedTeam}</small>}
    </div>
  );
}

function ScoresView({ scoreboard }) {
  const [search, setSearch] = useState("");
  const [participantFilter, setParticipantFilter] = useState("ALL");
  const dates = useMemo(() => {
    const sourceDates = scoreboard.dates?.length
      ? scoreboard.dates
      : [...new Set((scoreboard.rows || []).map((row) => row.dateKey).filter(Boolean))];

    return [...sourceDates].sort();
  }, [scoreboard]);
  const preferredDate = useMemo(() => getPreferredDateKey(dates), [dates]);
  const [activeDate, setActiveDate] = useState(preferredDate);

  useEffect(() => {
    if (!dates.includes(activeDate)) setActiveDate(preferredDate);
  }, [activeDate, dates, preferredDate]);

  const dateRows = useMemo(() => {
    return (scoreboard.rows || [])
      .filter((row) => row.dateKey === activeDate)
      .sort((a, b) => {
        const timeA = parseDateValue(a.kickoffAt).getTime();
        const timeB = parseDateValue(b.kickoffAt).getTime();
        if (timeA !== timeB) return timeA - timeB;
        if (a.matchId !== b.matchId) return a.matchId - b.matchId;
        return a.participantName.localeCompare(b.participantName);
      });
  }, [activeDate, scoreboard.rows]);

  const participants = useMemo(() => {
    return [...new Set(dateRows.map((row) => row.participantName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [dateRows]);

  useEffect(() => {
    if (participantFilter !== "ALL" && !participants.includes(participantFilter)) {
      setParticipantFilter("ALL");
    }
  }, [participantFilter, participants]);

  const rows = useMemo(() => {
    const normalizedSearch = normalizeName(search);

    return dateRows.filter((row) => {
      const participantMatches = participantFilter === "ALL" || row.participantName === participantFilter;
      const searchable = normalizeName([
        row.participantName,
        row.homeTeam,
        row.awayTeam,
        row.roundName,
        `${row.predictionHomeScore} x ${row.predictionAwayScore}`,
        `${row.homeScore} x ${row.awayScore}`,
        `${row.points || 0} pts`
      ].filter(Boolean).join(" "));

      return participantMatches && (!normalizedSearch || searchable.includes(normalizedSearch));
    });
  }, [dateRows, participantFilter, search]);

  const totalPoints = rows.reduce((sum, row) => sum + Number(row.points || 0), 0);
  const completedRows = rows.filter((row) => row.homeScore != null && row.awayScore != null).length;

  return (
    <section className="panel score-panel">
      <div className="score-panel-header">
        <div>
          <h2>Pontuacao por data</h2>
          <p>Confira como cada palpite pontuou em cada jogo.</p>
        </div>
        <div className="score-panel-summary">
          <span>{rows.length} palpites</span>
          <strong>{totalPoints} pts</strong>
          <small>{completedRows} com resultado lancado</small>
        </div>
      </div>

      <div className="date-tabs date-tabs-primary">
        {dates.map((date) => (
          <button key={date} type="button" className={date === activeDate ? "active" : ""} onClick={() => setActiveDate(date)}>
            {formatShortDate(`${date}T12:00:00Z`)}
          </button>
        ))}
      </div>

      <div className="score-filters">
        <label>
          Buscar
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Participante, selecao, jogo ou pontuacao"
          />
        </label>
        <label>
          Participante
          <select value={participantFilter} onChange={(event) => setParticipantFilter(event.target.value)}>
            <option value="ALL">Todos os participantes</option>
            {participants.map((participant) => (
              <option key={participant} value={participant}>{participant}</option>
            ))}
          </select>
        </label>
        <div className="score-filter-count">
          <span>{rows.length} de {dateRows.length}</span>
          <small>registros exibidos</small>
        </div>
      </div>

      <div className="score-table-wrap">
        <table className="score-table">
          <thead>
            <tr>
              <th>Participante</th>
              <th>Jogo</th>
              <th>Horario</th>
              <th>Palpite</th>
              <th>Resultado do jogo</th>
              <th>Pontuacao</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={`${row.matchId}-${row.userId}`}>
                  <td>
                    <div className="score-participant">
                      <span>{row.participantName.slice(0, 1).toUpperCase()}</span>
                      <strong>{row.participantName}</strong>
                    </div>
                  </td>
                  <td>
                    <TeamName name={row.homeTeam} />
                    <span className="versus">x</span>
                    <TeamName name={row.awayTeam} />
                    <small>{row.roundName}</small>
                  </td>
                  <td>{formatTime(row.kickoffAt)}</td>
                  <td>
                    <ScoreValue
                      home={row.predictionHomeScore}
                      away={row.predictionAwayScore}
                      qualifiedTeam={row.predictionQualifiedTeam}
                      emptyLabel="Sem palpite"
                    />
                  </td>
                  <td>
                    <ScoreValue
                      home={row.homeScore}
                      away={row.awayScore}
                      qualifiedTeam={row.qualifiedTeam}
                      emptyLabel="Aguardando"
                    />
                  </td>
                  <td>
                    <span className={`score-points ${Number(row.points || 0) > 0 ? "positive" : ""}`}>
                      {row.points || 0} pts
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6">Nenhum palpite encontrado para esta data.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamPicker({ label, value, onChange, teams, disabled = false }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  const filteredTeams = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return teams.slice(0, 8);
    }

    return teams
      .filter((team) => team.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [query, teams]);

  function handleSelect(teamName) {
    setQuery(teamName);
    onChange(teamName);
    setOpen(false);
  }

  return (
    <label className="picker-field">
      <span>{label}</span>
      <div className={`team-picker ${open ? "open" : ""}`}>
        <div className="team-picker-input">
          <input
            value={query}
            disabled={disabled}
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              onChange(nextValue);
              setOpen(true);
            }}
            onFocus={() => {
              if (!disabled) setOpen(true);
            }}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 120);
            }}
            placeholder="Pesquise uma selecao"
          />
          <button
            type="button"
            className="team-picker-toggle"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!disabled) setOpen((current) => !current);
            }}
            aria-label="Abrir lista de selecoes"
          >
            <ChevronIcon />
          </button>
        </div>

        {open && (
          <div className="team-picker-menu">
            {filteredTeams.length > 0 ? (
              filteredTeams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className="team-picker-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(team.name)}
                >
                  <strong><TeamName name={team.name} /></strong>
                  <span>{team.group_name ? `Grupo ${team.group_name}` : "Selecao cadastrada"}</span>
                </button>
              ))
            ) : (
              <div className="team-picker-empty">Nenhuma selecao encontrada.</div>
            )}
          </div>
        )}
      </div>
    </label>
  );
}

function BonusForm({ value, onChange, onSave, saving, teams }) {
  const locked = Boolean(value.lock?.locked);

  async function handleSaveBonusClick() {
    if (locked) {
      emitToast("error", "Prazo encerrado: bonus fechou 5 minutos antes do primeiro jogo da Copa.");
      return;
    }

    try {
      await onSave();
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Palpites bonus</h2>
      </div>
      <p className="hint-text">
        {locked
          ? "Palpites bonus bloqueados. O prazo era 5 minutos antes do primeiro jogo da Copa."
          : value.lock?.locksAt
            ? `Voce pode alterar ate ${formatDate(value.lock.locksAt)}.`
            : "Voce pode alterar ate 5 minutos antes do primeiro jogo da Copa."}
      </p>
      <div className={`bonus-grid ${locked ? "locked-fields" : ""}`}>
        <TeamPicker
          label="Campeao"
          value={value.champion}
          onChange={(champion) => onChange({ ...value, champion })}
          teams={teams}
          disabled={locked}
        />
        <TeamPicker
          label="Vice-campeao"
          value={value.runnerUp}
          onChange={(runnerUp) => onChange({ ...value, runnerUp })}
          teams={teams}
          disabled={locked}
        />
        <label>
          Artilheiro
          <input
            value={value.topScorer}
            onChange={(event) => onChange({ ...value, topScorer: event.target.value })}
            placeholder="Nome do jogador"
            disabled={locked}
          />
        </label>
        <TeamPicker
          label="Terceiro lugar"
          value={value.surpriseTeam}
          onChange={(surpriseTeam) => onChange({ ...value, surpriseTeam })}
          teams={teams}
          disabled={locked}
        />
      </div>
      <button className="secondary-button" onClick={handleSaveBonusClick} disabled={saving}>
        {saving ? "Salvando..." : "Salvar bonus"}
      </button>
    </div>
  );
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

function KnockoutMatchEditor({ match, teams, onSave, onDelete }) {
  const [stage, setStage] = useState(match.stage);
  const [homeTeam, setHomeTeam] = useState(match.home_team);
  const [awayTeam, setAwayTeam] = useState(match.away_team);
  const [kickoffDate, setKickoffDate] = useState(getDateKey(match.kickoff_at));
  const [kickoffTime, setKickoffTime] = useState(formatTime(match.kickoff_at));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setStage(match.stage);
    setHomeTeam(match.home_team);
    setAwayTeam(match.away_team);
    setKickoffDate(getDateKey(match.kickoff_at));
    setKickoffTime(formatTime(match.kickoff_at));
  }, [match.stage, match.home_team, match.away_team, match.kickoff_at]);

  async function handleSave() {
    const kickoffAt = buildKickoffAt(kickoffDate, kickoffTime);
    if (!kickoffAt) {
      emitToast("error", "Informe data e hora validas para o confronto.");
      return;
    }

    setSaving(true);
    try {
      await onSave(match.id, { stage, homeTeam, awayTeam, kickoffAt });
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Excluir o confronto ${match.home_team} x ${match.away_team}?`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      await onDelete(match.id);
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mini-item">
      <div className="panel-header">
        <div>
          <h3>{match.round_name}</h3>
          <small className="hint-text">{formatDate(match.kickoff_at)}</small>
        </div>
        <span className="match-stage">{knockoutStageLabel(match.stage)}</span>
      </div>

      <div className="admin-match-form">
        <label>
          Fase
          <select value={stage} onChange={(event) => setStage(event.target.value)}>
            <option value="ROUND_OF_32">16-avos</option>
            <option value="ROUND_OF_16">Oitavas</option>
            <option value="QUARTER">Quartas</option>
            <option value="SEMI">Semifinal</option>
            <option value="THIRD_PLACE">3º lugar</option>
            <option value="FINAL">Final</option>
          </select>
        </label>
        <div className="admin-datetime-row">
          <label>
            Data
            <input type="date" value={kickoffDate} onChange={(event) => setKickoffDate(event.target.value)} />
          </label>
          <label>
            Hora de Brasilia
            <input type="time" value={kickoffTime} onChange={(event) => setKickoffTime(event.target.value)} />
          </label>
        </div>
        <div className="admin-team-row">
          <TeamPicker label="Selecao 1" value={homeTeam} onChange={setHomeTeam} teams={teams} />
          <TeamPicker label="Selecao 2" value={awayTeam} onChange={setAwayTeam} teams={teams} />
        </div>
      </div>

      <div className="card-actions">
        <button className="secondary-button" onClick={handleSave} disabled={saving || deleting}>
          {saving ? "Salvando..." : "Salvar confronto"}
        </button>
        <button className="danger-button" onClick={handleDelete} disabled={saving || deleting}>
          {deleting ? "Excluindo..." : "Excluir"}
        </button>
      </div>
    </div>
  );
}

function ResultEditor({ match, onSave, onReset }) {
  const [homeScore, setHomeScore] = useState(match.home_score ?? "");
  const [awayScore, setAwayScore] = useState(match.away_score ?? "");
  const [qualifiedTeam, setQualifiedTeam] = useState(match.qualified_team ?? "");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const isKnockout = match.stage !== "GROUP";
  const hasResult = match.home_score != null || match.away_score != null || match.qualified_team;

  useEffect(() => {
    setHomeScore(match.home_score ?? "");
    setAwayScore(match.away_score ?? "");
    setQualifiedTeam(match.qualified_team ?? "");
  }, [match.home_score, match.away_score, match.qualified_team]);

  const allowedQualifiedTeams = getAllowedQualifiedTeams(match, homeScore, awayScore);
  const allowedQualifiedTeamKey = allowedQualifiedTeams.join("|");
  const qualifiedTeamValue = coerceQualifiedTeam(match, homeScore, awayScore, qualifiedTeam);

  useEffect(() => {
    if (isKnockout && qualifiedTeam !== qualifiedTeamValue) {
      setQualifiedTeam("");
    }
  }, [allowedQualifiedTeamKey, isKnockout, qualifiedTeam, qualifiedTeamValue]);

  function handleHomeScoreChange(value) {
    setHomeScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, value, awayScore, current));
  }

  function handleAwayScoreChange(value) {
    setAwayScore(value);
    setQualifiedTeam((current) => coerceQualifiedTeam(match, homeScore, value, current));
  }

  function handleQualifiedTeamChange(value) {
    setQualifiedTeam(coerceQualifiedTeam(match, homeScore, awayScore, value));
  }

  async function handleSave() {
    const qualifiedError = getQualifiedSelectionError(match, homeScore, awayScore, qualifiedTeamValue);
    if (qualifiedError) {
      emitToast("error", qualifiedError);
      return;
    }

    setSaving(true);
    try {
      await onSave(match.id, {
        homeScore,
        awayScore,
        qualifiedTeam: isKnockout ? qualifiedTeamValue : "",
        status: "FINISHED"
      });
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    const confirmed = window.confirm(`Zerar o resultado de ${match.home_team} x ${match.away_team}?`);
    if (!confirmed) return;

    setResetting(true);
    try {
      await onReset(match.id);
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="result-editor">
      <div className="result-editor-heading">
        <span>{match.round_name}</span>
        <strong>
          {match.home_team} x {match.away_team}
        </strong>
      </div>

      <div className="result-editor-form">
        <label>
          {match.home_team}
          <input
            type="number"
            min="0"
            value={homeScore}
            onChange={(event) => handleHomeScoreChange(event.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          {match.away_team}
          <input
            type="number"
            min="0"
            value={awayScore}
            onChange={(event) => handleAwayScoreChange(event.target.value)}
            placeholder="0"
          />
        </label>
        {isKnockout && (
          <label>
            Quem avancou
            <select value={qualifiedTeamValue} onChange={(event) => handleQualifiedTeamChange(event.target.value)}>
              <option value="">Selecione</option>
              {renderQualifiedTeamOptions(allowedQualifiedTeams)}
            </select>
          </label>
        )}
      </div>

      <div className="card-actions">
        <button className="secondary-button" onClick={handleSave} disabled={saving || resetting}>
          {saving ? "Salvando..." : "Salvar resultado"}
        </button>
        <button className="danger-button" onClick={handleReset} disabled={!hasResult || saving || resetting}>
          {resetting ? "Zerando..." : "Zerar resultado"}
        </button>
      </div>
    </div>
  );
}

function AdminBonusResults({ value, onChange, onSave, onReset, saving, resetting, teams }) {
  async function handleSave() {
    try {
      await onSave();
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    }
  }

  async function handleReset() {
    try {
      await onReset();
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    }
  }

  return (
    <div className="panel admin-panel">
      <div className="admin-panel-header">
        <div>
          <h2>Resultado oficial dos bonus</h2>
          <p>Cadastre os resultados oficiais para somar os pontos extras no ranking.</p>
        </div>
      </div>

      <div className="bonus-grid">
        <TeamPicker
          label="Campeao"
          value={value.champion}
          onChange={(champion) => onChange({ ...value, champion })}
          teams={teams}
        />
        <TeamPicker
          label="Vice-campeao"
          value={value.runnerUp}
          onChange={(runnerUp) => onChange({ ...value, runnerUp })}
          teams={teams}
        />
        <label>
          Artilheiro
          <input
            value={value.topScorer}
            onChange={(event) => onChange({ ...value, topScorer: event.target.value })}
            placeholder="Nome oficial do jogador"
          />
        </label>
        <TeamPicker
          label="Terceiro lugar"
          value={value.surpriseTeam}
          onChange={(surpriseTeam) => onChange({ ...value, surpriseTeam })}
          teams={teams}
        />
      </div>

      <div className="card-actions">
        <button className="secondary-button" onClick={handleSave} disabled={saving || resetting}>
          {saving ? "Salvando..." : "Salvar bonus oficial"}
        </button>
        <button className="danger-button" onClick={handleReset} disabled={saving || resetting}>
          {resetting ? "Zerando..." : "Zerar bonus"}
        </button>
      </div>
    </div>
  );
}

function formatAuditPayload(data) {
  if (!data) return "-";

  const settingLabels = {
    phase2Enabled: {
      label: "Mata-mata",
      value: (enabled) => enabled ? "ativado" : "desativado"
    },
    participantViewsEnabled: {
      label: "Visualizacao de palpites",
      value: (enabled) => enabled ? "liberada antes dos jogos" : "somente apos inicio do jogo"
    },
    maintenanceEnabled: {
      label: "Manutencao",
      value: (enabled) => enabled ? "ativa" : "desativada"
    }
  };

  const parts = [];
  for (const [key, config] of Object.entries(settingLabels)) {
    if (data[key] != null) parts.push(`${config.label}: ${config.value(Boolean(data[key]))}`);
  }
  if (data.match) parts.push(data.match);
  if (data.roundName) parts.push(data.roundName);
  if (data.homeScore != null || data.awayScore != null) parts.push(`${data.homeScore ?? "-"} x ${data.awayScore ?? "-"}`);
  if (data.qualifiedTeam) parts.push(`Classificado: ${data.qualifiedTeam}`);
  if (data.status) parts.push(`Status: ${data.status}`);
  if (data.targetUserId) parts.push(`Usuario ID: ${data.targetUserId}`);
  if (data.name) parts.push(`Nome: ${data.name}`);
  if (data.email) parts.push(`Email: ${data.email}`);
  if (data.isActive != null) parts.push(`Ativo: ${data.isActive ? "sim" : "nao"}`);
  if (data.passwordReset) parts.push("Senha resetada");
  if (data.mustChangePassword != null) parts.push(`Troca obrigatoria: ${data.mustChangePassword ? "sim" : "nao"}`);
  if (data.deleted) parts.push("Usuario excluido");
  if (data.champion) parts.push(`Campeao: ${data.champion}`);
  if (data.runnerUp) parts.push(`Vice: ${data.runnerUp}`);
  if (data.topScorer) parts.push(`Artilheiro: ${data.topScorer}`);
  if (data.surpriseTeam) parts.push(`Terceiro lugar: ${data.surpriseTeam}`);

  return parts.length > 0 ? parts.join(" | ") : "-";
}

function auditTypeLabel(eventType) {
  return (
    {
      MATCH_PREDICTION: "Palpite de jogo",
      BONUS_PREDICTION: "Palpite bonus",
      MATCH_RESULT: "Resultado do jogo",
      KNOCKOUT_MATCH: "Confronto do mata-mata",
      BONUS_RESULT: "Resultado bonus",
      USER: "Usuario",
      SETTING: "Configuracao"
    }[eventType] || eventType
  );
}

function auditActionLabel(action) {
  return (
    {
      CREATE: "Criado",
      UPDATE: "Editado",
      RESET: "Zerado",
      PASSWORD_RESET: "Senha resetada",
      PASSWORD_CHANGE: "Senha alterada",
      DEACTIVATE: "Inativado",
      DELETE: "Excluido"
    }[action] || action
  );
}

function AuditHistory({ logs }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const filteredLogs = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return logs.filter((log) => {
      const typeMatches = typeFilter === "ALL" || log.eventType === typeFilter;
      const actionMatches = actionFilter === "ALL" || log.action === actionFilter;
      const searchable = [
        log.userName,
        log.homeTeam,
        log.awayTeam,
        log.roundName,
        log.eventType,
        log.action,
        formatAuditPayload(log.previousData),
        formatAuditPayload(log.nextData)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return typeMatches && actionMatches && (!normalizedSearch || searchable.includes(normalizedSearch));
    });
  }, [logs, search, typeFilter, actionFilter]);

  return (
    <div className="panel admin-panel">
      <div className="admin-panel-header">
        <div>
          <h2>Historico de movimentos</h2>
          <p>Registros de criacao e edicao de palpites de jogos e bonus.</p>
        </div>
      </div>

      <div className="audit-filters">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por usuario, jogo, selecao ou palpite"
        />
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="ALL">Todos os tipos</option>
          <option value="MATCH_PREDICTION">Palpite de jogo</option>
          <option value="BONUS_PREDICTION">Palpite bonus</option>
          <option value="MATCH_RESULT">Resultado do jogo</option>
          <option value="KNOCKOUT_MATCH">Confronto do mata-mata</option>
          <option value="BONUS_RESULT">Resultado bonus</option>
          <option value="SETTING">Configuracao</option>
        </select>
        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
          <option value="ALL">Todas as acoes</option>
          <option value="CREATE">Criado</option>
          <option value="UPDATE">Editado</option>
          <option value="RESET">Zerado</option>
          <option value="DELETE">Excluido</option>
        </select>
      </div>

      <div className="audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Usuario</th>
              <th>Tipo</th>
              <th>Acao</th>
              <th>Jogo</th>
              <th>Antes</th>
              <th>Depois</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>{log.userName || "Usuario removido"}</td>
                  <td>{auditTypeLabel(log.eventType)}</td>
                  <td>{auditActionLabel(log.action)}</td>
                  <td>{log.homeTeam ? `${log.homeTeam} x ${log.awayTeam}` : "-"}</td>
                  <td>{formatAuditPayload(log.previousData)}</td>
                  <td>{formatAuditPayload(log.nextData)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7">Nenhum historico encontrado para os filtros atuais.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminUsers({
  users,
  onResetPassword,
  onDeleteUser,
  resettingUserId,
  deletingUserId,
  temporaryPassword,
  participantViewsEnabled,
  onToggleParticipantViews,
  maintenanceEnabled,
  onToggleMaintenance
}) {
  return (
    <div className="panel admin-panel">
      <div className="admin-panel-header">
        <div>
          <h2>Usuarios</h2>
          <p>Gerencie participantes, resete senhas e acompanhe as alteracoes no historico.</p>
        </div>
        <div className="admin-toggle-group">
          <button
            className={`phase-toggle ${maintenanceEnabled ? "enabled danger-toggle" : ""}`}
            onClick={onToggleMaintenance}
            type="button"
          >
            <span className="phase-toggle-track">
              <span className="phase-toggle-thumb" />
            </span>
            <span>{maintenanceEnabled ? "Manutencao ativa" : "Manutencao desativada"}</span>
          </button>
          <button
            className={`phase-toggle ${participantViewsEnabled ? "enabled" : ""}`}
            onClick={onToggleParticipantViews}
            type="button"
          >
            <span className="phase-toggle-track">
              <span className="phase-toggle-thumb" />
            </span>
            <span>{participantViewsEnabled ? "Liberado antes dos jogos" : "Somente apos inicio"}</span>
          </button>
        </div>
      </div>

      {temporaryPassword && (
        <div className="temporary-password-box">
          <span>Senha temporaria gerada</span>
          <strong>{temporaryPassword}</strong>
          <small>Informe essa senha ao usuario e peca para ele alterar depois, se necessario.</small>
        </div>
      )}

      <div className="table-wrap">
        <table className="table audit-table users-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Perfil</th>
              <th>Status</th>
              <th>Senha</th>
              <th>Palpites</th>
              <th>Bonus</th>
              <th>Cadastro</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {users.length > 0 ? (
              users.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.displayName || item.name}</strong>
                    <small>{item.name}</small>
                  </td>
                  <td>{item.email}</td>
                  <td>{item.isAdmin ? "Administrador" : "Participante"}</td>
                  <td>{item.isActive ? "Ativo" : "Inativo"}</td>
                  <td>{item.mustChangePassword ? "Pendente" : "Ok"}</td>
                  <td>{item.predictionsCount || 0}</td>
                  <td>{item.bonusPredictionsCount || 0}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button className="secondary-button compact-button" type="button" onClick={() => onResetPassword(item)} disabled={resettingUserId === item.id || deletingUserId === item.id}>
                        {resettingUserId === item.id ? "Resetando..." : "Resetar senha"}
                      </button>
                      <button className="danger-button compact-button" type="button" onClick={() => onDeleteUser(item)} disabled={item.isAdmin || !item.isActive || resettingUserId === item.id || deletingUserId === item.id}>
                        {deletingUserId === item.id ? "Inativando..." : "Inativar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="9">Nenhum usuario encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfileView({ user, ranking, onSave, onChangePassword }) {
  const [profile, setProfile] = useState({
    displayName: user.displayName || user.name,
    country: user.country || "Brasil",
    profilePhrase: user.profilePhrase || "Rumo ao hexa!",
    avatarUrl: user.avatarUrl || ""
  });
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  useEffect(() => {
    setProfile({
      displayName: user.displayName || user.name,
      country: user.country || "Brasil",
      profilePhrase: user.profilePhrase || "Rumo ao hexa!",
      avatarUrl: user.avatarUrl || ""
    });
  }, [user]);

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setProfile((current) => ({ ...current, avatarUrl: String(reader.result || "") }));
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(profile);
    } catch {
      // O toast de erro ja e emitido pelo fluxo principal de salvamento.
    } finally {
      setSaving(false);
    }
  }

  async function downloadSticker() {
    setDownloading(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1160;
      const ctx = canvas.getContext("2d");
      const displayName = (profile.displayName || user.name || "Participante").toUpperCase();
      const phrase = (profile.profilePhrase || "Rumo ao hexa!").toUpperCase();
      const flagCode = flagCodeFor(profile.country);
      const [avatarImage, flagImage] = await Promise.all([
        loadCanvasImage(profile.avatarUrl),
        flagCode ? loadCanvasImage(`https://flagcdn.com/w80/${flagCode}.png`, true) : Promise.resolve(null)
      ]);

      ctx.fillStyle = "#071a33";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawRoundedRect(ctx, 74, 36, 752, 1088, 62);
      ctx.fillStyle = "#fff7e8";
      ctx.fill();

      drawRoundedRect(ctx, 94, 56, 712, 1048, 46);
      ctx.fillStyle = "#142449";
      ctx.fill();

      drawRoundedRect(ctx, 112, 74, 676, 1012, 36);
      ctx.strokeStyle = "#7f1d1d";
      ctx.lineWidth = 10;
      ctx.stroke();

      ctx.save();
      drawRoundedRect(ctx, 122, 84, 656, 810, 26);
      ctx.clip();
      if (avatarImage) {
        drawImageCover(ctx, avatarImage, 122, 84, 656, 810);
      } else {
        const gradient = ctx.createLinearGradient(122, 84, 778, 894);
        gradient.addColorStop(0, "#2563eb");
        gradient.addColorStop(1, "#0f172a");
        ctx.fillStyle = gradient;
        ctx.fillRect(122, 84, 656, 810);
        ctx.fillStyle = "#fff";
        ctx.font = "900 220px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayName.slice(0, 1), 450, 480);
      }
      ctx.restore();

      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 16;
      ctx.font = "900 58px Arial";
      ctx.fillText("20", 144, 142);
      ctx.fillText("26", 144, 188);
      ctx.shadowBlur = 0;
      ctx.font = "900 19px Arial";
      ctx.fillText("WORLD CUP", 144, 222);
      ctx.font = "900 40px Arial";
      ctx.fillText("2026", 144, 262);

      drawRoundedRect(ctx, 136, 888, 628, 124, 28);
      ctx.fillStyle = "#fff8eb";
      ctx.fill();

      if (flagImage) {
        ctx.save();
        drawRoundedRect(ctx, 164, 918, 70, 64, 16);
        ctx.clip();
        ctx.drawImage(flagImage, 164, 918, 70, 64);
        ctx.restore();
      } else {
        drawRoundedRect(ctx, 164, 918, 70, 64, 16);
        ctx.fillStyle = "#16a34a";
        ctx.fill();
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.moveTo(199, 927);
        ctx.lineTo(225, 950);
        ctx.lineTo(199, 973);
        ctx.lineTo(173, 950);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = "#111827";
      ctx.font = "900 34px Arial";
      ctx.fillText(displayName.slice(0, 18), 260, 946);
      ctx.font = "700 24px Arial";
      ctx.fillText(phrase.slice(0, 28), 260, 980);

      ctx.beginPath();
      ctx.arc(698, 950, 62, 0, Math.PI * 2);
      ctx.fillStyle = "#7f1d1d";
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#fff8eb";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "52px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⚽", 698, 952);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `figurinha-${safeFileName(displayName)}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="profile-layout">
      <div className="panel profile-form">
        <h2>Seu perfil</h2>
        <p className="hint-text">Essas informacoes aparecem na sua figurinha.</p>
        <div className="avatar-picker">
          <div className="avatar-preview">
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="Avatar" /> : <span>{profile.displayName.slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className="profile-action-row">
            <label className="upload-button">
              Escolher foto
              <input type="file" accept="image/*" onChange={handleFile} />
            </label>
            <button className="tiny-password-button" type="button" onClick={() => setPasswordModalOpen(true)}>
              <span>🔒</span>
              Alterar senha
            </button>
          </div>
        </div>
        <label>
          Nome de exibicao
          <input maxLength="20" value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} />
        </label>
        <label>
          Pais
          <input
            maxLength="40"
            placeholder="Ex: Brasil"
            value={profile.country}
            onChange={(event) => setProfile({ ...profile, country: event.target.value })}
          />
        </label>
        <label>
          Frase
          <input maxLength="30" value={profile.profilePhrase} onChange={(event) => setProfile({ ...profile, profilePhrase: event.target.value })} />
        </label>
        <button className="primary-button" type="button" onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {passwordModalOpen && (
        <PasswordChangeModal
          onSave={async (payload) => {
            await onChangePassword(payload);
            setPasswordModalOpen(false);
          }}
          onClose={() => setPasswordModalOpen(false)}
        />
      )}

      <div className="panel sticker-panel">
        <h2>Sua figurinha</h2>
        <p className="hint-text">Veja como ficou sua figurinha personalizada!</p>
        <div className="sticker-card">
          <div className="sticker-year">
            <strong><span>20</span><span>26</span></strong>
            <em>WORLD CUP</em>
            <small>2026</small>
          </div>
          <div className="sticker-photo">
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="Avatar da figurinha" /> : <span>{profile.displayName.slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className="sticker-footer">
            <FlagImage name={profile.country} />
            <div>
              <strong>{profile.displayName || user.name}</strong>
              <small>{profile.profilePhrase || "Rumo ao hexa!"}</small>
            </div>
            <span className="sticker-ball">⚽</span>
          </div>
        </div>
        <div className="sticker-actions">
          <button className="secondary-button download-sticker-button" type="button" onClick={downloadSticker} disabled={downloading}>
          <span>↓</span>
          {downloading ? "Gerando..." : "Baixar figurinha"}
          </button>
        </div>
        <div className="sticker-tip">
          <strong>ⓘ</strong>
          <span>Dica: baixe sua figurinha e compartilhe com seus amigos no bolao!</span>
        </div>
      </div>
    </section>
  );
}

const navItems = [
  { key: "dashboard", label: "Visao geral", shortLabel: "Inicio", icon: "dashboard" },
  { key: "matches", label: "Jogos e palpites", shortLabel: "Jogos", icon: "matches" },
  { key: "groups", label: "Grupos", shortLabel: "Grupo", icon: "groups" },
  { key: "bonus", label: "Bonus", shortLabel: "Bonus", icon: "bonus" },
  { key: "scores", label: "Pontuacao", shortLabel: "Pts", icon: "scores" },
  { key: "rules", label: "Regras", shortLabel: "Regras", icon: "rules" }
];

const adminNavItems = [
  { key: "admin-results", label: "Resultados", shortLabel: "Result.", icon: "results" },
  { key: "admin-phase2", label: "Cadastro Mata-mata", shortLabel: "Mata", icon: "knockout" },
  { key: "admin-bonus", label: "Bonus", shortLabel: "Bonus", icon: "bonus" },
  { key: "admin-users", label: "Usuarios", shortLabel: "Users", icon: "users" },
  { key: "admin-history", label: "Historico", shortLabel: "Hist.", icon: "history" }
];

const pageInfo = {
  dashboard: { title: "Visao geral", subtitle: "Acompanhe ranking, proximos jogos e seu desempenho." },
  matches: { title: "Jogos e palpites", subtitle: "Faca seus palpites da fase de grupos e do mata-mata." },
  groups: { title: "Grupos", subtitle: "Veja a classificacao por grupo." },
  bonus: { title: "Bonus", subtitle: "Palpites extras da Copa." },
  scores: { title: "Pontuacao", subtitle: "Veja a pontuacao dos palpites por data." },
  rules: { title: "Regras", subtitle: "Regulamento e pontuacao do bolao." },
  profile: { title: "Perfil", subtitle: "Personalize seu perfil e gere sua figurinha da Copa." },
  admin: { title: "Painel administrativo", subtitle: "Gerencie resultados, mata-mata, bonus e historico." },
  "admin-results": { title: "Resultados", subtitle: "Informe os placares oficiais dos jogos." },
  "admin-phase2": { title: "Cadastro Mata-mata", subtitle: "Defina os confrontos da 2 fase e demais etapas eliminatorias." },
  "admin-bonus": { title: "Bonus oficial", subtitle: "Cadastre os resultados oficiais dos bonus." },
  "admin-users": { title: "Usuarios", subtitle: "Controle participantes, senhas e acessos." },
  "admin-history": { title: "Historico", subtitle: "Audite movimentos de usuarios e administradores." }
};

function ProgressSummary({ matches }) {
  const total = matches.length || 72;
  const filled = matches.filter((match) => match.prediction).length;
  const locked = matches.filter((match) => match.locked && !match.prediction).length;
  const pending = matches.filter((match) => !match.prediction && !match.locked).length;
  const percent = total ? Math.round((filled / total) * 100) : 0;
  const hasKnockout = matches.some((match) => match.stage !== "GROUP");
  const groupTotal = matches.filter((match) => match.stage === "GROUP").length;
  const knockoutTotal = matches.filter((match) => match.stage !== "GROUP").length;

  return (
    <div className="sidebar-progress">
      <strong>Resumo dos palpites</strong>
      <div className="progress-ring" style={{ "--progress": `${percent}%` }}>
        <div>
          <span>{percent}%</span>
          <small>Concluido</small>
        </div>
      </div>
      <p>{filled} / {total} jogos</p>
      <div className="progress-lines">
        <span className="filled"><i>✓</i> Preenchidos <strong>{filled}</strong></span>
        <span className="pending"><i>◷</i> Pendentes <strong>{pending}</strong></span>
        <span className="locked"><i>▣</i> Encerrados <strong>{locked}</strong></span>
      </div>
      <div className="progress-footer">
        <span>{total} jogos no total</span>
        <small>{hasKnockout ? `${groupTotal} grupos + ${knockoutTotal} mata-mata` : "Fase de grupos"}</small>
      </div>
    </div>
  );
}

function Sidebar({ activeTab, onTabChange, matches, isAdmin }) {
  const items = isAdmin ? adminNavItems : navItems;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Logo />
      </div>
      <nav className="side-nav">
        {items.map((item) => (
          <button key={item.key} className={activeTab === item.key ? "active" : ""} type="button" onClick={() => onTabChange(item.key)}>
            <span className="nav-icon"><NavIcon type={item.icon} /></span>
            <span className="nav-label nav-label-full">{item.label}</span>
            <span className="nav-label nav-label-short">{item.shortLabel || item.label}</span>
          </button>
        ))}
      </nav>
      {!isAdmin && <ProgressSummary matches={matches} />}
    </aside>
  );
}

function TopPosition({ standing }) {
  const position = standing?.position;

  return (
    <div className={`top-position position-${position || "default"}`}>
      <RankBadge position={position} fallback="#" />
      <strong>{position ? `${position}º` : "-"}</strong>
      <small>Sua posicao</small>
    </div>
  );
}

function MaintenanceScreen({ user, onLogout }) {
  return (
    <div className="maintenance-screen">
      <div className="maintenance-card">
        <Logo />
        <p className="eyebrow">Manutencao em andamento</p>
        <h1>Estamos ajustando o bolaOn</h1>
        <p>
          O sistema foi pausado temporariamente para uma atualizacao. Seus palpites e dados continuam salvos.
          Tente novamente em alguns minutos.
        </p>
        <div className="maintenance-user">
          <span>{user.displayName || user.name}</span>
          <small>Participante conectado</small>
        </div>
        <button className="secondary-button" type="button" onClick={onLogout}>Sair</button>
      </div>
    </div>
  );
}

function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    function handleToast(event) {
      const id = Date.now() + Math.random();
      const toast = {
        id,
        type: event.detail?.type || "info",
        message: event.detail?.message || ""
      };

      setToasts((current) => [...current, toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
      }, 4200);
    }

    window.addEventListener(TOAST_EVENT, handleToast);
    return () => window.removeEventListener(TOAST_EVENT, handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.type}`} key={toast.id}>
          <strong>{toast.type === "success" ? "Tudo certo" : toast.type === "error" ? "Atencao" : "Aviso"}</strong>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

function AdminKnockoutTab({
  section,
  teams,
  form,
  onFormChange,
  onCreateMatch,
  savingMatch,
  matches,
  onUpdateMatch,
  onDeleteMatch,
  resultMatches,
  onSaveResult,
  onResetResult,
  adminBonus,
  onAdminBonusChange,
  onSaveAdminBonus,
  onResetAdminBonus,
  savingAdminBonus,
  resettingAdminBonus,
  adminUsers,
  onResetUserPassword,
  onDeleteUser,
  resettingUserId,
  deletingUserId,
  temporaryPassword,
  auditLogs,
  phase2Enabled,
  onTogglePhase2,
  participantViewsEnabled,
  onToggleParticipantViews,
  maintenanceEnabled,
  onToggleMaintenance
}) {
  return (
    <section className="admin-layout">
      {section === "phase2" && (
        <>
      <div className="panel admin-panel admin-create-panel">
        <div className="admin-panel-header">
          <div>
            <h2>Novo confronto do mata-mata</h2>
            <p>Cadastre 16-avos, oitavas, quartas, semifinal, 3º lugar e final quando os classificados estiverem definidos.</p>
          </div>
          <button
            className={`phase-toggle ${phase2Enabled ? "enabled" : ""}`}
            onClick={onTogglePhase2}
            type="button"
          >
            <span className="phase-toggle-track">
              <span className="phase-toggle-thumb" />
            </span>
            <span>{phase2Enabled ? "Mata-mata ativado" : "Mata-mata desativado"}</span>
          </button>
        </div>

        <div className="admin-form-card">
          <div className="admin-match-form">
            <label>
              Fase
              <select
                value={form.stage}
                onChange={(event) => onFormChange({
                  ...form,
                  ...getDefaultKnockoutForm(event.target.value),
                  homeTeam: form.homeTeam,
                  awayTeam: form.awayTeam
                })}
              >
                <option value="ROUND_OF_32">16-avos</option>
                <option value="ROUND_OF_16">Oitavas</option>
                <option value="QUARTER">Quartas</option>
                <option value="SEMI">Semifinal</option>
                <option value="THIRD_PLACE">3º lugar</option>
                <option value="FINAL">Final</option>
              </select>
            </label>
            <div className="admin-datetime-row">
              <label>
                Data
                <input
                  type="date"
                  value={form.kickoffDate}
                  onChange={(event) => onFormChange({ ...form, kickoffDate: event.target.value })}
                />
              </label>
              <label>
                Hora de Brasilia
                <input
                  type="time"
                  value={form.kickoffTime}
                  onChange={(event) => onFormChange({ ...form, kickoffTime: event.target.value })}
                />
              </label>
            </div>
            <div className="admin-team-row">
              <TeamPicker
                label="Selecao 1"
                value={form.homeTeam}
                onChange={(homeTeam) => onFormChange({ ...form, homeTeam })}
                teams={teams}
              />
              <TeamPicker
                label="Selecao 2"
                value={form.awayTeam}
                onChange={(awayTeam) => onFormChange({ ...form, awayTeam })}
                teams={teams}
              />
            </div>
          </div>
          <button className="secondary-button" onClick={onCreateMatch} disabled={savingMatch}>
            {savingMatch ? "Salvando..." : "Criar confronto"}
          </button>
        </div>
      </div>

      <div className="panel admin-panel admin-list-panel">
        <div className="admin-panel-header">
          <div>
            <h2>Confrontos cadastrados</h2>
            <p>Confira e ajuste os duelos antes de ativar o mata-mata.</p>
          </div>
        </div>
        <div className="mini-list">
          {matches.length > 0 ? (
            matches.map((match) => (
              <KnockoutMatchEditor
                key={match.id}
                match={match}
                teams={teams}
                onSave={onUpdateMatch}
                onDelete={onDeleteMatch}
              />
            ))
          ) : (
            <div className="mini-item">
              <strong>Nenhum confronto cadastrado</strong>
              <span>Crie os jogos do mata-mata usando o formulario acima.</span>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {section === "results" && (
      <div className="panel admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>Lancar resultados</h2>
            <p>Informe o placar oficial e, no mata-mata, quem avancou.</p>
          </div>
        </div>
        <MatchesAccordion
          matches={resultMatches}
          teams={teams}
          mode="result"
          onSave={{ onSave: onSaveResult, onReset: onResetResult }}
        />
      </div>
      )}

      {section === "bonus" && (
        <AdminBonusResults
          value={adminBonus}
          onChange={onAdminBonusChange}
          onSave={onSaveAdminBonus}
          onReset={onResetAdminBonus}
          saving={savingAdminBonus}
          resetting={resettingAdminBonus}
          teams={teams}
        />
      )}

      {section === "users" && (
        <AdminUsers
          users={adminUsers}
          onResetPassword={onResetUserPassword}
          onDeleteUser={onDeleteUser}
          resettingUserId={resettingUserId}
          deletingUserId={deletingUserId}
          temporaryPassword={temporaryPassword}
          participantViewsEnabled={participantViewsEnabled}
          onToggleParticipantViews={onToggleParticipantViews}
          maintenanceEnabled={maintenanceEnabled}
          onToggleMaintenance={onToggleMaintenance}
        />
      )}

      {section === "history" && <AuditHistory logs={auditLogs} />}
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [bonus, setBonus] = useState(defaultBonus);
  const [scoreboard, setScoreboard] = useState(defaultScoreboard);
  const [tab, setTab] = useState("dashboard");
  const [adminTab, setAdminTab] = useState("admin-results");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingBonus, setSavingBonus] = useState(false);
  const [knockoutMatches, setKnockoutMatches] = useState([]);
  const [adminMatches, setAdminMatches] = useState([]);
  const [adminBonus, setAdminBonus] = useState(defaultBonus);
  const [adminUsers, setAdminUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [phase2Enabled, setPhase2Enabled] = useState(false);
  const [participantViewsEnabled, setParticipantViewsEnabled] = useState(false);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [knockoutForm, setKnockoutForm] = useState(() => getDefaultKnockoutForm());
  const [savingKnockoutMatch, setSavingKnockoutMatch] = useState(false);
  const [savingAdminBonus, setSavingAdminBonus] = useState(false);
  const [resettingAdminBonus, setResettingAdminBonus] = useState(false);
  const [resettingUserId, setResettingUserId] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);

  async function loadApp() {
    try {
      setLoading(true);
      const me = await request("/me");
      setUser(me);

      if (Boolean(me.mustChangePassword)) {
        setDashboard(null);
        setMatches([]);
        setTeams([]);
        setBonus(defaultBonus);
        setScoreboard(defaultScoreboard);
        setKnockoutMatches([]);
        setAdminMatches([]);
        setPhase2Enabled(false);
        setAdminBonus(defaultBonus);
        setAdminUsers([]);
        setAuditLogs([]);
        setError("");
        setParticipantViewsEnabled(false);
        setMaintenanceEnabled(false);
        return;
      }

      const [dashboardData, matchData, bonusData, teamData, scoreboardData] = await Promise.all([
        request("/dashboard"),
        request("/matches"),
        request("/bonus-predictions"),
        request("/teams"),
        Boolean(me.is_admin) ? Promise.resolve(defaultScoreboard) : request("/scoreboard")
      ]);

      setDashboard(dashboardData);
      setMatches(matchData);
      setBonus(bonusData);
      setTeams(teamData);
      setScoreboard(scoreboardData);
      setParticipantViewsEnabled(Boolean(dashboardData.settings?.participantViewsEnabled));
      setMaintenanceEnabled(Boolean(dashboardData.settings?.maintenanceEnabled));

      if (Boolean(me.is_admin)) {
        const [adminKnockoutMatches, allAdminMatches, phase2Settings, adminBonusData, adminUserData, auditLogData, maintenanceSettings] = await Promise.all([
          request("/admin/knockout-matches"),
          request("/admin/matches"),
          request("/admin/phase2-settings"),
          request("/admin/bonus-results"),
          request("/admin/users"),
          request("/admin/audit-logs"),
          request("/admin/maintenance-settings")
        ]);
        const participantViewsSettings = await request("/admin/participant-views-settings").catch(() => ({
          enabled: Boolean(dashboardData.settings?.participantViewsEnabled)
        }));
        setKnockoutMatches(adminKnockoutMatches);
        setAdminMatches(allAdminMatches);
        setPhase2Enabled(Boolean(phase2Settings.enabled));
        setParticipantViewsEnabled(Boolean(participantViewsSettings.enabled));
        setMaintenanceEnabled(Boolean(maintenanceSettings.enabled));
        setAdminBonus(adminBonusData);
        setAdminUsers(adminUserData);
        setAuditLogs(auditLogData);
      } else {
        setKnockoutMatches([]);
        setAdminMatches([]);
        setPhase2Enabled(false);
        setAdminBonus(defaultBonus);
        setAdminUsers([]);
        setAuditLogs([]);
        setScoreboard(scoreboardData);
        setParticipantViewsEnabled(Boolean(dashboardData.settings?.participantViewsEnabled));
        setMaintenanceEnabled(Boolean(dashboardData.settings?.maintenanceEnabled));
      }

      setError("");
    } catch (err) {
      if (err.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        setDashboard(null);
        setMatches([]);
        setTeams([]);
        setKnockoutMatches([]);
        setAdminMatches([]);
        setAdminBonus(defaultBonus);
        setAdminUsers([]);
        setAuditLogs([]);
        setPhase2Enabled(false);
        setBonus(defaultBonus);
        setScoreboard(defaultScoreboard);
        setParticipantViewsEnabled(false);
        setMaintenanceEnabled(false);
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAuthSuccess(authUser) {
    if (authUser) {
      setUser(authUser);
      setLoading(false);
    }

    if (authUser?.mustChangePassword) {
      setDashboard(null);
      setMatches([]);
      setTeams([]);
      setBonus(defaultBonus);
      setScoreboard(defaultScoreboard);
      setKnockoutMatches([]);
      setAdminMatches([]);
      setPhase2Enabled(false);
      setAdminBonus(defaultBonus);
      setAdminUsers([]);
      setAuditLogs([]);
      setParticipantViewsEnabled(false);
      setMaintenanceEnabled(false);
      setError("");
      return;
    }

    await loadApp();
  }

  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY)) {
      loadApp();
    } else {
      setLoading(false);
    }
  }, []);

  async function handlePredictionSave(payload) {
    try {
      await request("/predictions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      emitToast("success", "Palpite salvo com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel salvar o palpite.");
      throw err;
    }
  }

  async function handleSaveBonus() {
    setSavingBonus(true);
    try {
      await request("/bonus-predictions", {
        method: "POST",
        body: JSON.stringify(bonus)
      });
      emitToast("success", "Bonus salvo com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel salvar o bonus.");
      throw err;
    } finally {
      setSavingBonus(false);
    }
  }

  async function handleCreateKnockoutMatch() {
    const kickoffAt = buildKickoffAt(knockoutForm.kickoffDate, knockoutForm.kickoffTime);
    if (!kickoffAt) {
      emitToast("error", "Informe data e hora validas para o confronto.");
      return;
    }

    setSavingKnockoutMatch(true);
    try {
      await request("/admin/knockout-matches", {
        method: "POST",
        body: JSON.stringify({ ...knockoutForm, kickoffAt })
      });
      setKnockoutForm(getDefaultKnockoutForm());
      emitToast("success", "Confronto cadastrado com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel cadastrar o confronto.");
      throw err;
    } finally {
      setSavingKnockoutMatch(false);
    }
  }

  async function handleUpdateKnockoutMatch(matchId, payload) {
    try {
      await request(`/admin/knockout-matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      emitToast("success", "Confronto atualizado com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel atualizar o confronto.");
      throw err;
    }
  }

  async function handleDeleteKnockoutMatch(matchId) {
    try {
      await request(`/admin/knockout-matches/${matchId}`, {
        method: "DELETE"
      });
      emitToast("success", "Confronto excluido com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel excluir o confronto.");
      throw err;
    }
  }

  async function handleSaveResult(matchId, payload) {
    try {
      await request(`/admin/matches/${matchId}/result`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      emitToast("success", "Resultado salvo com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel salvar o resultado.");
      throw err;
    }
  }

  async function handleResetResult(matchId) {
    try {
      await request(`/admin/matches/${matchId}/result`, {
        method: "DELETE"
      });
      emitToast("success", "Resultado zerado com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel zerar o resultado.");
      throw err;
    }
  }

  async function handleSaveAdminBonus() {
    setSavingAdminBonus(true);
    try {
      await request("/admin/bonus-results", {
        method: "PUT",
        body: JSON.stringify(adminBonus)
      });
      emitToast("success", "Bonus oficial salvo com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel salvar o bonus oficial.");
      throw err;
    } finally {
      setSavingAdminBonus(false);
    }
  }

  async function handleResetAdminBonus() {
    const confirmed = window.confirm("Zerar todos os resultados oficiais de bonus?");
    if (!confirmed) return;

    setResettingAdminBonus(true);
    try {
      await request("/admin/bonus-results", {
        method: "DELETE"
      });
      setAdminBonus(defaultBonus);
      emitToast("success", "Bonus oficial zerado com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel zerar o bonus oficial.");
      throw err;
    } finally {
      setResettingAdminBonus(false);
    }
  }

  async function handleResetUserPassword(targetUser) {
    const confirmed = window.confirm(`Resetar a senha de ${targetUser.displayName || targetUser.name}?`);
    if (!confirmed) return;

    setResettingUserId(targetUser.id);
    try {
      const result = await request(`/admin/users/${targetUser.id}/reset-password`, {
        method: "POST"
      });
      setTemporaryPassword(result.temporaryPassword);
      await loadApp();
    } finally {
      setResettingUserId(null);
    }
  }

  async function handleDeleteUser(targetUser) {
    const confirmed = window.confirm(`Inativar o usuario ${targetUser.displayName || targetUser.name}? Os palpites, bonus e historico serao preservados.`);
    if (!confirmed) return;

    setDeletingUserId(targetUser.id);
    try {
      await request(`/admin/users/${targetUser.id}`, {
        method: "DELETE"
      });
      setTemporaryPassword("");
      emitToast("success", "Usuario inativado com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel inativar o usuario.");
      throw err;
    } finally {
      setDeletingUserId(null);
    }
  }

  async function handleSaveProfile(profile) {
    try {
      const updatedUser = await request("/me/profile", {
        method: "PUT",
        body: JSON.stringify(profile)
      });
      setUser(updatedUser);
      emitToast("success", "Perfil salvo com sucesso.");
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel salvar o perfil.");
      throw err;
    }
  }

  async function handleChangePassword(payload) {
    try {
      const updatedUser = await request("/me/password", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setUser(updatedUser);
      emitToast("success", "Senha alterada com sucesso.");
      await loadApp();
    } catch (err) {
      emitToast("error", err.message || "Nao foi possivel alterar a senha.");
      throw err;
    }
  }

  async function handleTogglePhase2() {
    const nextValue = !phase2Enabled;
    await request("/admin/phase2-settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: nextValue })
    });
    setPhase2Enabled(nextValue);
  }

  async function handleToggleParticipantViews() {
    const nextValue = !participantViewsEnabled;
    await request("/admin/participant-views-settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: nextValue })
    });
    setParticipantViewsEnabled(nextValue);
    await loadApp();
  }

  async function handleToggleMaintenance() {
    const nextValue = !maintenanceEnabled;
    await request("/admin/maintenance-settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: nextValue })
    });
    setMaintenanceEnabled(nextValue);
    await loadApp();
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setDashboard(null);
    setMatches([]);
    setTeams([]);
    setKnockoutMatches([]);
    setAdminMatches([]);
    setAdminBonus(defaultBonus);
    setAdminUsers([]);
    setAuditLogs([]);
    setPhase2Enabled(false);
    setParticipantViewsEnabled(false);
    setMaintenanceEnabled(false);
    setTemporaryPassword("");
    setBonus(defaultBonus);
  }

  if (!user && !localStorage.getItem(TOKEN_KEY)) {
    return <AuthScreen onAuth={handleAuthSuccess} />;
  }

  if (!user) {
    return <AuthScreen onAuth={handleAuthSuccess} />;
  }

  const isAdmin = Boolean(user.is_admin);

  if (Boolean(user.mustChangePassword)) {
    return <PasswordChangeModal forced onSave={handleChangePassword} onLogout={handleLogout} />;
  }

  if (loading && !dashboard) {
    return (
      <div className="loading-screen">
        <Logo />
        <span>Carregando bolaOn...</span>
      </div>
    );
  }

  if (!isAdmin && maintenanceEnabled) {
    return <MaintenanceScreen user={user} onLogout={handleLogout} />;
  }

  const activeTab = isAdmin ? adminTab : tab;
  const currentPage = pageInfo[activeTab] || pageInfo.dashboard;
  const adminSection = {
    "admin-results": "results",
    "admin-phase2": "phase2",
    "admin-bonus": "bonus",
    "admin-users": "users",
    "admin-history": "history"
  }[adminTab] || "results";

  return (
    <div className="app-frame">
      <ToastContainer />
      <Sidebar activeTab={activeTab} onTabChange={isAdmin ? setAdminTab : setTab} matches={matches} isAdmin={isAdmin} />
      <main className="app-main">
        <header className="topbar">
          <div>
            <h1>{currentPage.title}</h1>
            <p>{currentPage.subtitle}</p>
          </div>
          <div className="topbar-actions">
            {!isAdmin && <TopPosition standing={dashboard?.myStanding} />}
            <button
              className="user-chip profile-chip"
              type="button"
              onClick={() => {
                if (!isAdmin) setTab("profile");
              }}
            >
              <span className="profile-chip-text">
                <strong>{user.displayName || user.name}</strong>
                {Boolean(user.is_admin) ? <small>Administrador</small> : <small>Participante</small>}
              </span>
              <span className="profile-chip-avatar">
                {user.avatarUrl ? <img src={user.avatarUrl} alt="Avatar" /> : (user.displayName || user.name).slice(0, 1).toUpperCase()}
              </span>
            </button>
            <button className="ghost-button" onClick={handleLogout}>Sair</button>
          </div>
        </header>

        {error && <p className="error-text">{error}</p>}

        {activeTab === "dashboard" && dashboard && (
          <>
            <DashboardCards dashboard={dashboard} />
            <section className="dashboard-layout">
              <RankingTable ranking={dashboard.ranking} participantViewsEnabled={participantViewsEnabled} teams={teams} />
              <DashboardGames matches={matches} />
            </section>
            <CompetitionStats matches={matches} />
          </>
        )}

        {activeTab === "matches" && <MatchesAccordion matches={matches} teams={teams} onSave={handlePredictionSave} />}
        {activeTab === "bonus" && <BonusForm value={bonus} onChange={setBonus} onSave={handleSaveBonus} saving={savingBonus} teams={teams} />}
        {activeTab === "groups" && <GroupsView teams={teams} matches={matches} />}
        {activeTab === "scores" && <ScoresView scoreboard={scoreboard} />}
        {activeTab === "rules" && <RulesView />}
        {activeTab === "profile" && <ProfileView user={user} ranking={dashboard?.ranking || []} onSave={handleSaveProfile} onChangePassword={handleChangePassword} />}
        {isAdmin && (
          <AdminKnockoutTab
            section={adminSection}
            teams={teams}
            form={knockoutForm}
            onFormChange={setKnockoutForm}
            onCreateMatch={handleCreateKnockoutMatch}
            savingMatch={savingKnockoutMatch}
            matches={knockoutMatches}
            onUpdateMatch={handleUpdateKnockoutMatch}
            onDeleteMatch={handleDeleteKnockoutMatch}
            resultMatches={adminMatches}
            onSaveResult={handleSaveResult}
            onResetResult={handleResetResult}
            adminBonus={adminBonus}
            onAdminBonusChange={setAdminBonus}
            onSaveAdminBonus={handleSaveAdminBonus}
            onResetAdminBonus={handleResetAdminBonus}
            savingAdminBonus={savingAdminBonus}
            resettingAdminBonus={resettingAdminBonus}
            adminUsers={adminUsers}
            onResetUserPassword={handleResetUserPassword}
            onDeleteUser={handleDeleteUser}
            resettingUserId={resettingUserId}
            deletingUserId={deletingUserId}
            temporaryPassword={temporaryPassword}
            auditLogs={auditLogs}
            phase2Enabled={phase2Enabled}
            onTogglePhase2={handleTogglePhase2}
            participantViewsEnabled={participantViewsEnabled}
            onToggleParticipantViews={handleToggleParticipantViews}
            maintenanceEnabled={maintenanceEnabled}
            onToggleMaintenance={handleToggleMaintenance}
          />
        )}
      </main>
    </div>
  );
}
