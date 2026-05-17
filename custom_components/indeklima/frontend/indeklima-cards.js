// Indeklima – Custom Lovelace Cards
// Version: 2.5.0
// Cards:
//   custom:indeklima-room-card   – single room card (mobile/tablet)
//   custom:indeklima-hub-card    – house overview, original mobile design (vertical)
//   custom:indeklima-tablet-card – house overview, landscape/tablet 3-column
// Last Updated: March 2026

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const INDEKLIMA_DOMAIN = "indeklima";

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function fmtNum(val, unit, decimals = 0) {
  if (val == null) return "\u2013";
  const n = parseFloat(val);
  if (isNaN(n)) return "\u2013";
  return n.toFixed(decimals) + "\u00a0" + unit;
}

function statusColor(status) {
  if (status === "critical") return "#ef4444";
  if (status === "warning")  return "#f59e0b";
  return "#10b981";
}

function statusLabel(status) {
  if (status === "critical") return "Kritisk";
  if (status === "warning")  return "Advarsel";
  return "God";
}

function trendIcon(trend) {
  if (trend === "rising")  return "\u2197";
  if (trend === "falling") return "\u2198";
  return "\u2192";
}

function trendColor(trend) {
  if (trend === "rising")  return "#ef4444";
  if (trend === "falling") return "#10b981";
  return "#94a3b8";
}

function trendLabel(trend) {
  if (trend === "rising")  return "Stigende";
  if (trend === "falling") return "Faldende";
  return "Stabil";
}

function circLabel(c) {
  if (c === "good")     return "God luftcirkulation";
  if (c === "moderate") return "Moderat";
  return "D\u00e5rlig cirkulation";
}

function circColor(c) {
  if (c === "good")     return "#10b981";
  if (c === "moderate") return "#f59e0b";
  return "#ef4444";
}

function ventLabel(v) {
  if (v === "yes")      return "Luft ud nu!";
  if (v === "optional") return "Valgfrit";
  return "Vent";
}

function ventColor(v) {
  if (v === "yes")      return "#10b981";
  if (v === "optional") return "#f59e0b";
  return "#64748b";
}

function moldLabel(m) {
  if (m === "critical") return "Kritisk skimmelrisiko";
  if (m === "high")     return "H\u00f8j skimmelrisiko";
  if (m === "moderate") return "Moderat skimmelrisiko";
  return "Lav skimmelrisiko";
}

function moldColor(m) {
  if (m === "critical") return "#ef4444";
  if (m === "high")     return "#f97316";
  if (m === "moderate") return "#f59e0b";
  return "#10b981";
}

function moldIcon(m) {
  if (m === "critical" || m === "high" || m === "moderate") return "\uD83E\uDDA0";
  return "\u2705";
}

function baseCSS() {
  return `
    --bg:   var(--card-background-color, #1a2535);
    --bg2:  var(--secondary-background-color, #243044);
    --text: var(--primary-text-color, #e2e8f0);
    --sub:  var(--secondary-text-color, #94a3b8);
    --div:  var(--divider-color, rgba(148,163,184,0.12));
  `;
}

function severityRingHTML(severity, color, size) {
  const s  = size || 90;
  const r  = Math.round(s * 0.4);
  const cx = Math.round(s / 2);
  const circ = 2 * Math.PI * r;
  const fill = (Math.min(100, severity) / 100) * circ;
  const gap  = circ - fill;
  const valSize = s >= 90 ? 22 : 18;
  return `
    <div class="ring-wrap">
      <svg class="ring-svg" viewBox="0 0 ${s} ${s}" style="width:${s}px;height:${s}px;display:block;">
        <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--div)" stroke-width="8"/>
        <circle cx="${cx}" cy="${cx}" r="${r}" fill="none"
          stroke="${color}" stroke-width="8" stroke-linecap="round"
          stroke-dasharray="${fill} ${gap}" stroke-dashoffset="0"
          transform="rotate(-90 ${cx} ${cx})"/>
      </svg>
      <div class="ring-center">
        <div class="ring-val" style="color:${color};font-size:${valSize}px">${Math.round(severity)}</div>
        <div class="ring-unit">/ 100</div>
      </div>
    </div>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// indeklima-room-card
// Config: room (required), title (optional), show_pressure (optional)
// ─────────────────────────────────────────────────────────────────────────────

class IndeklimaRoomCard extends HTMLElement {
  static getStubConfig() { return { room: "Stue" }; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null; this._data = null;
    this._config = {}; this._interval = null; this._errCount = 0;
  }

  setConfig(config) {
    if (!config.room) throw new Error("indeklima-room-card: 'room' is required");
    this._config = config;
    this._render();
  }

  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._load(); }

  connectedCallback() {
    this._interval = setInterval(() => {
      if (this._errCount > 5) { clearInterval(this._interval); return; }
      if (document.visibilityState === "visible") this._load();
    }, 30000);
  }
  disconnectedCallback() { clearInterval(this._interval); }

  async _load() {
    if (!this._hass) return;
    try {
      this._data = await this._hass.callWS({
        type: `${INDEKLIMA_DOMAIN}/get_room_data`,
        room_name: this._config.room,
      });
      this._errCount = 0;
    } catch (e) { this._errCount++; }
    this._render();
  }

  _render() {
    const r     = this._data;
    const title = this._config.title ?? this._config.room;
    const status = r?.status || "good";
    const color  = statusColor(status);
    const sev    = Math.round(r?.severity || 0);
    const showP  = this._config.show_pressure ?? false;

    const metric = (icon, val, lbl) =>
      `<div class="metric"><div class="m-icon">${icon}</div><div class="m-val">${val}</div><div class="m-lbl">${lbl}</div></div>`;

    const metrics = r ? [
      r.temperature_sensors_count > 0 ? metric("&#127777;&#65039;", fmtNum(r.temperature,"\u00b0C",1), "Temp") : "",
      r.humidity_sensors_count    > 0 ? metric("&#128167;", fmtNum(r.humidity,"%"), "Fugt") : "",
      r.co2_sensors_count         > 0 ? metric("&#127787;&#65039;", fmtNum(r.co2,"ppm"), "CO\u2082") : "",
      (showP && r.pressure_sensors_count > 0) ? metric("&#129517;", fmtNum(r.pressure,"hPa"), "Tryk") : "",
    ].filter(Boolean).join("") : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; ${baseCSS()} font-family: var(--paper-font-body1_-_font-family, sans-serif); }
        .card {
          background: var(--bg); border-radius: 18px; padding: 14px 16px;
          color: var(--text); box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,.15));
          border-left: 5px solid ${color};
          background-image: linear-gradient(135deg, ${color}12 0%, transparent 50%);
        }
        .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .room-name { font-size:16px; font-weight:700; }
        .status-pill {
          font-size:10px; font-weight:700; padding:3px 9px; border-radius:20px;
          background:${color}22; color:${color}; text-transform:uppercase; letter-spacing:.5px;
          ${status !== "good" ? "animation:blink 2s infinite;" : ""}
        }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.55} }
        .metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:10px; }
        .metric { background:var(--bg2); border-radius:10px; padding:9px 6px; text-align:center; }
        .m-icon { font-size:16px; margin-bottom:3px; }
        .m-val  { font-size:14px; font-weight:700; line-height:1.1; }
        .m-lbl  { font-size:9px; color:var(--sub); margin-top:2px; text-transform:uppercase; }
        .sev-row { display:flex; align-items:center; gap:8px; font-size:11px; color:var(--sub); }
        .sev-bar { flex:1; height:4px; background:var(--div); border-radius:2px; overflow:hidden; }
        .sev-fill { height:100%; background:${color}; border-radius:2px; width:${sev}%; transition:width .6s; }
        .sev-val { font-weight:700; color:${color}; font-size:12px; min-width:36px; text-align:right; }
        .footer { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
        .chip { font-size:10px; background:var(--bg2); padding:3px 7px; border-radius:6px; color:var(--sub); }
        .chip.open { color:#0ea5e9; }
        .chip.mold-moderate { color:#f59e0b; background:#f59e0b1a; }
        .chip.mold-high     { color:#f97316; background:#f973161a; }
        .chip.mold-critical { color:#ef4444; background:#ef44441a; animation:blink 2s infinite; }
        .loading { color:var(--sub); font-size:12px; padding:8px 0; }
      </style>
      <ha-card>
        <div class="card">
          <div class="header">
            <div class="room-name">${esc(title)}</div>
            <div class="status-pill">${r ? statusLabel(status) : "..."}</div>
          </div>
          ${!r ? '<div class="loading">Henter data...</div>' : `
            <div class="metrics">${metrics}</div>
            <div class="sev-row">
              <span>Alvorlighed</span>
              <div class="sev-bar"><div class="sev-fill"></div></div>
              <span class="sev-val">${sev}/100</span>
            </div>
            <div class="footer">
              ${r.outdoor_windows_open > 0 ? `<span class="chip open">\uD83E\uDE9F ${r.outdoor_windows_open} vindue${r.outdoor_windows_open>1?"r":""}</span>` : ""}
              ${r.internal_doors_open  > 0 ? `<span class="chip open">\uD83D\uDEAA ${r.internal_doors_open} d\u00f8r${r.internal_doors_open>1?"e":""}</span>` : ""}
              ${r.air_circulation_bonus    ? `<span class="chip open">\uD83D\uDCA8 Bonus aktiv</span>` : ""}
              ${r.mold_risk && r.mold_risk !== "low" ? `<span class="chip mold-${r.mold_risk}">${moldIcon(r.mold_risk)} ${moldLabel(r.mold_risk)}</span>` : ""}
            </div>`}
        </div>
      </ha-card>`;
  }

  getCardSize() { return 3; }
}

if (!customElements.get("indeklima-room-card")) {
  customElements.define("indeklima-room-card", IndeklimaRoomCard);
}


// ─────────────────────────────────────────────────────────────────────────────
// indeklima-hub-card  — original beautiful mobile design, vertical sections
// Config: title (optional), compact (optional, default false)
// ─────────────────────────────────────────────────────────────────────────────

class IndeklimaHubCard extends HTMLElement {
  static getStubConfig() { return { title: "Indeklima Overblik" }; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null; this._data = null;
    this._config = {}; this._interval = null; this._errCount = 0;
  }

  setConfig(config) { this._config = config ?? {}; this._render(); }
  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._load(); }

  connectedCallback() {
    this._interval = setInterval(() => {
      if (this._errCount > 5) { clearInterval(this._interval); return; }
      if (document.visibilityState === "visible") this._load();
    }, 30000);
  }
  disconnectedCallback() { clearInterval(this._interval); }

  async _load() {
    if (!this._hass) return;
    try {
      this._data = await this._hass.callWS({ type: `${INDEKLIMA_DOMAIN}/get_climate_data` });
      this._errCount = 0;
    } catch (e) { this._errCount++; }
    this._render();
  }

  _render() {
    const d       = this._data;
    const title   = this._config.title ?? "Indeklima Overblik";
    const compact = this._config.compact ?? false;
    const status  = d?.status || "good";
    const color   = statusColor(status);
    const sev     = d?.severity || 0;
    const rooms   = d?.rooms   || [];
    const avgs    = d?.averages || {};
    const trends  = d?.trends  || {};
    const vent    = d?.ventilation || {};
    const vColor  = ventColor(vent.status);

    const roomCards = rooms.map(r => {
      const rc = statusColor(r.status);
      const metrics = [
        r.temperature_sensors_count > 0 ? `<div class="rc-metric"><div class="rc-val">${fmtNum(r.temperature,"\u00b0C",1)}</div><div class="rc-lbl">Temp</div></div>` : "",
        r.humidity_sensors_count    > 0 ? `<div class="rc-metric"><div class="rc-val">${fmtNum(r.humidity,"%")}</div><div class="rc-lbl">Fugt</div></div>` : "",
        r.co2_sensors_count         > 0 ? `<div class="rc-metric"><div class="rc-val">${fmtNum(r.co2,"ppm")}</div><div class="rc-lbl">CO\u2082</div></div>` : "",
      ].filter(Boolean).join("");
      return `<div class="room-card" style="border-left-color:${rc};background-image:linear-gradient(90deg,${rc}0e 0%,transparent 35%);">
        <div class="rc-name">${esc(r.name)}</div>
        <div class="rc-metrics">${metrics}</div>
        <span class="rc-pill" style="background:${rc}22;color:${rc};${r.status!=="good"?"animation:blink 2s infinite;":""}">${statusLabel(r.status)}</span>
        ${r.mold_risk && r.mold_risk !== "low" ? `<span class="rc-mold" style="background:${moldColor(r.mold_risk)}1a;color:${moldColor(r.mold_risk)}">${moldIcon(r.mold_risk)}</span>` : ""}
      </div>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; ${baseCSS()} font-family:var(--paper-font-body1_-_font-family,sans-serif); }
        .card {
          background:var(--bg); border-radius:18px; padding:16px 18px;
          color:var(--text); box-shadow:var(--ha-card-box-shadow,0 2px 8px rgba(0,0,0,.15));
        }
        .card-title {
          font-size:12px; font-weight:700; text-transform:uppercase;
          letter-spacing:1px; color:var(--sub); margin-bottom:14px;
        }
        .divider { height:1px; background:var(--div); margin:12px 0; }
        .section-lbl {
          font-size:10px; font-weight:600; text-transform:uppercase;
          letter-spacing:1px; color:var(--sub); margin-bottom:8px;
        }
        .loading { color:var(--sub); font-size:13px; padding:8px 0; }

        .top-row { display:flex; align-items:center; gap:16px; }
        .ring-wrap { position:relative; flex-shrink:0; }
        .ring-center {
          position:absolute; inset:0;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
        }
        .ring-val  { font-weight:700; line-height:1; }
        .ring-unit { font-size:10px; color:var(--sub); }
        .top-info { flex:1; min-width:0; }
        .status-badge {
          display:inline-flex; align-items:center; gap:5px;
          padding:4px 10px; border-radius:20px;
          font-size:11px; font-weight:700; margin-bottom:8px;
        }
        .badge-dot { width:6px; height:6px; border-radius:50%; animation:bdot 2s infinite; }
        @keyframes bdot { 0%,100%{opacity:1}50%{opacity:.4} }
        .status-title { font-size:16px; font-weight:700; margin-bottom:2px; }
        .status-sub   { font-size:12px; color:var(--sub); }

        .avgs { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
        .avg-chip { background:var(--bg2); border-radius:8px; padding:7px 10px; text-align:center; flex:1; min-width:70px; }
        .avg-val { font-size:14px; font-weight:700; }
        .avg-lbl { font-size:9px; color:var(--sub); margin-top:2px; text-transform:uppercase; }

        /* ── Rooms ── */
        .rooms-list { display:flex; flex-direction:column; gap:6px; }
        .room-card {
          display:flex; align-items:center; gap:10px;
          background:var(--bg2); border-radius:12px; padding:10px 12px;
          border-left:3px solid transparent;
        }
        .rc-name  { font-size:13px; font-weight:700; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rc-pill  {
          font-size:9px; font-weight:700; padding:2px 7px; border-radius:20px;
          text-transform:uppercase; letter-spacing:.4px; flex-shrink:0;
        }
        .rc-mold  { font-size:14px; flex-shrink:0; }
        .rc-metrics { display:flex; gap:5px; flex-shrink:0; }
        .rc-metric  { text-align:center; min-width:38px; }
        .rc-val     { font-size:12px; font-weight:700; line-height:1.1; }
        .rc-lbl     { font-size:8px; color:var(--sub); margin-top:1px; text-transform:uppercase; }

        .vent-row {
          display:flex; align-items:center; gap:10px;
          background:var(--bg2); border-radius:12px; padding:12px;
          border-left:3px solid ${vColor};
        }
        .vent-icon  { font-size:22px; flex-shrink:0; }
        .vent-title { font-size:14px; font-weight:700; color:${vColor}; }
        .vent-sub   { font-size:11px; color:var(--sub); margin-top:2px; }

        .circ-row {
          display:flex; align-items:center; gap:10px;
          background:var(--bg2); border-radius:12px; padding:12px;
        }
        .circ-icon  { font-size:22px; flex-shrink:0; }
        .circ-title { font-size:13px; font-weight:600; }
        .circ-sub   { font-size:11px; color:var(--sub); margin-top:2px; }

        .trends-row { display:flex; gap:8px; }
        .trend-chip { flex:1; background:var(--bg2); border-radius:10px; padding:10px 8px; text-align:center; }
        .trend-header { font-size:9px; font-weight:700; color:var(--sub); text-transform:uppercase; letter-spacing:.8px; margin-bottom:6px; display:flex; align-items:center; justify-content:center; gap:4px; }
        .trend-arrow { font-size:22px; font-weight:900; line-height:1; margin-bottom:4px; }
        .trend-label { font-size:10px; font-weight:600; margin-top:2px; }
      </style>
      <ha-card>
        <div class="card">
          <div class="card-title">${esc(title)}</div>
          ${!d ? '<div class="loading">Henter data...</div>' : `
            <div class="top-row">
              ${severityRingHTML(sev, color, 90)}
              <div class="top-info">
                <div class="status-badge" style="background:${color}1a;color:${color};">
                  <span class="badge-dot" style="background:${color}"></span>
                  ${statusLabel(status)}
                </div>
                <div class="status-title">${d.room_count} rum overv\u00e5ges</div>
                <div class="status-sub">\uD83E\uDE9F ${d.open_windows_count} \u00e5bne vinduer</div>
              </div>
            </div>

            ${!compact ? `
              <div class="divider"></div>
              <div class="section-lbl">Gennemsnit</div>
              <div class="avgs">
                ${avgs.temperature != null ? `<div class="avg-chip"><div class="avg-val">${fmtNum(avgs.temperature,"\u00b0C",1)}</div><div class="avg-lbl">Temp</div></div>` : ""}
                ${avgs.humidity    != null ? `<div class="avg-chip"><div class="avg-val">${fmtNum(avgs.humidity,"%")}</div><div class="avg-lbl">Fugt</div></div>` : ""}
                ${avgs.co2         != null ? `<div class="avg-chip"><div class="avg-val">${fmtNum(avgs.co2,"ppm")}</div><div class="avg-lbl">CO\u2082</div></div>` : ""}
              </div>

              <div class="divider"></div>
              <div class="section-lbl">Tendenser (15 min)</div>
              <div class="trends-row">
                <div class="trend-chip">
                  <div class="trend-header">&#128167; Fugtighed</div>
                  <div class="trend-arrow" style="color:${trendColor(trends.humidity)}">${trendIcon(trends.humidity)}</div>
                  <div class="trend-label" style="color:${trendColor(trends.humidity)}">${trendLabel(trends.humidity)}</div>
                </div>
                <div class="trend-chip">
                  <div class="trend-header">&#127787;&#65039; CO\u2082</div>
                  <div class="trend-arrow" style="color:${trendColor(trends.co2)}">${trendIcon(trends.co2)}</div>
                  <div class="trend-label" style="color:${trendColor(trends.co2)}">${trendLabel(trends.co2)}</div>
                </div>
                <div class="trend-chip">
                  <div class="trend-header">&#128202; Score</div>
                  <div class="trend-arrow" style="color:${trendColor(trends.severity)}">${trendIcon(trends.severity)}</div>
                  <div class="trend-label" style="color:${trendColor(trends.severity)}">${trendLabel(trends.severity)}</div>
                </div>
              </div>` : ""}

            <div class="divider"></div>
            <div class="section-lbl">Udluftning</div>
            <div class="vent-row">
              <div class="vent-icon">${vent.status==="yes"?"&#127783;&#65039;":vent.status==="optional"?"&#129300;":"&#9203;"}</div>
              <div>
                <div class="vent-title">${ventLabel(vent.status)}</div>
                <div class="vent-sub">${(vent.reason||[]).join(", ")||"Ingen aktuelle problemer"}</div>
              </div>
            </div>

            ${!compact ? `
              <div class="divider"></div>
              <div class="section-lbl">Luftcirkulation</div>
              <div class="circ-row">
                <div class="circ-icon">${d.air_circulation==="good"?"&#128168;":d.air_circulation==="moderate"?"&#127744;":"&#128682;"}</div>
                <div>
                  <div class="circ-title" style="color:${circColor(d.air_circulation)}">${circLabel(d.air_circulation)}</div>
                  <div class="circ-sub">${(d.open_internal_doors||[]).length} indend\u00f8rs d\u00f8re \u00e5bne</div>
                </div>
              </div>` : ""}

            <div class="divider"></div>
            <div class="section-lbl">Rum</div>
            <div class="rooms-list">${roomCards}</div>
          `}
        </div>
      </ha-card>`;
  }

  getCardSize() { return this._config.compact ? 4 : 7; }
}

if (!customElements.get("indeklima-hub-card")) {
  customElements.define("indeklima-hub-card", IndeklimaHubCard);
}


// ─────────────────────────────────────────────────────────────────────────────
// indeklima-tablet-card — landscape 3-column design for tablet/desktop
// ─────────────────────────────────────────────────────────────────────────────

class IndeklimaTabletCard extends HTMLElement {
  static getStubConfig() { return { title: "Indeklima Overblik" }; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null; this._data = null;
    this._config = {}; this._interval = null; this._errCount = 0;
  }

  setConfig(config) { this._config = config ?? {}; this._render(); }
  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._load(); }

  connectedCallback() {
    this._interval = setInterval(() => {
      if (this._errCount > 5) { clearInterval(this._interval); return; }
      if (document.visibilityState === "visible") this._load();
    }, 30000);
  }
  disconnectedCallback() { clearInterval(this._interval); }

  async _load() {
    if (!this._hass) return;
    try {
      this._data = await this._hass.callWS({ type: `${INDEKLIMA_DOMAIN}/get_climate_data` });
      this._errCount = 0;
    } catch (e) { this._errCount++; }
    this._render();
  }

  _render() {
    const d      = this._data;
    const title  = this._config.title ?? "Indeklima Overblik";
    const status = d?.status || "good";
    const color  = statusColor(status);
    const sev    = d?.severity || 0;
    const rooms  = d?.rooms   || [];
    const avgs   = d?.averages || {};
    const trends = d?.trends  || {};
    const vent   = d?.ventilation || {};
    const vColor = ventColor(vent.status);

    // ── Col 1: Score + info ───────────────────────────────────────────────────
    const col1 = !d ? '<div class="loading">Henter...</div>' : `
      <div class="score-block">
        ${severityRingHTML(sev, color, 100)}
        <div class="score-meta">
          <div class="score-badge" style="background:${color}1a;color:${color};">
            <span class="bdot" style="background:${color}"></span>${statusLabel(status)}
          </div>
          <div class="score-sub">${d.room_count} rum</div>
          <div class="score-sub">\uD83E\uDE9F ${d.open_windows_count} \u00e5bne vinduer</div>
        </div>
      </div>

      <div class="sec-lbl mt10">Gennemsnit</div>
      <div class="avg-grid">
        ${avgs.temperature != null ? `<div class="avg-cell"><div class="av">${fmtNum(avgs.temperature,"\u00b0C",1)}</div><div class="al">Temp</div></div>` : ""}
        ${avgs.humidity    != null ? `<div class="avg-cell"><div class="av">${fmtNum(avgs.humidity,"%")}</div><div class="al">Fugt</div></div>` : ""}
        ${avgs.co2         != null ? `<div class="avg-cell"><div class="av">${fmtNum(avgs.co2,"ppm")}</div><div class="al">CO2</div></div>` : ""}
        ${avgs.pressure    != null ? `<div class="avg-cell"><div class="av">${fmtNum(avgs.pressure,"hPa")}</div><div class="al">Tryk</div></div>` : ""}
      </div>

      <div class="divider"></div>
      <div class="sec-lbl">Udluftning</div>
      <div class="vent-box" style="border-left-color:${vColor}">
        <span class="vent-ico">${vent.status==="yes"?"&#127783;&#65039;":vent.status==="optional"?"&#129300;":"&#9203;"}</span>
        <div>
          <div class="vent-ttl" style="color:${vColor}">${ventLabel(vent.status)}</div>
          <div class="vent-sub">${(vent.reason||[]).slice(0,2).join(", ")||"Indeklima er OK"}</div>
        </div>
      </div>

      <div class="divider"></div>
      <div class="sec-lbl">Luftcirkulation</div>
      <div class="circ-row">
        <span class="circ-ico">${d.air_circulation==="good"?"&#128168;":d.air_circulation==="moderate"?"&#127744;":"&#128682;"}</span>
        <span class="circ-lbl" style="color:${circColor(d.air_circulation)}">${circLabel(d.air_circulation)}</span>
      </div>
    `;

    // ── Col 2: Room rows ──────────────────────────────────────────────────────
    const roomRows = rooms.map(r => {
      const rc = statusColor(r.status);
      const sp = Math.min(100, r.severity || 0);
      return `
        <div class="room-row" style="border-left-color:${rc};background-image:linear-gradient(90deg,${rc}0d 0%,transparent 40%);">
          <div class="rr-left">
            <div class="rr-name">${esc(r.name)}</div>
            <span class="rr-pill" style="background:${rc}22;color:${rc};${r.status!=="good"?"animation:blink 2s infinite;":""}">${statusLabel(r.status)}</span>
            ${r.mold_risk && r.mold_risk !== "low" ? `<span class="rr-mold" style="font-size:11px;margin-left:4px;color:${moldColor(r.mold_risk)}">${moldIcon(r.mold_risk)} ${moldLabel(r.mold_risk)}</span>` : ""}
          </div>
          <div class="rr-metrics">
            ${r.temperature_sensors_count>0?`<div class="rrm"><div class="rrm-v">${fmtNum(r.temperature,"\u00b0C",1)}</div><div class="rrm-l">Temp</div></div>`:""}
            ${r.humidity_sensors_count>0?`<div class="rrm"><div class="rrm-v">${fmtNum(r.humidity,"%")}</div><div class="rrm-l">Fugt</div></div>`:""}
            ${r.co2_sensors_count>0?`<div class="rrm"><div class="rrm-v">${fmtNum(r.co2,"ppm")}</div><div class="rrm-l">CO2</div></div>`:""}
          </div>
          <div class="rr-sev">
            <div class="rr-sev-val" style="color:${rc}">${Math.round(sp)}</div>
            <div class="rr-bar-bg"><div class="rr-bar" style="width:${sp}%;background:${rc}"></div></div>
          </div>
        </div>`;
    }).join("");

    const col2 = `
      <div class="sec-lbl">${rooms.length} rum</div>
      <div class="rooms-list">${roomRows || '<div class="loading">Ingen rum konfigureret</div>'}</div>
    `;

    // ── Col 3: Trends + windows ───────────────────────────────────────────────
    const col3 = !d ? "" : `
      <div class="sec-lbl">Tendenser (15 min)</div>
      <div class="trends-col">
        ${[["&#128167;","Fugtighed",trends.humidity],["&#127787;&#65039;","CO\u2082",trends.co2],["&#128202;","Score",trends.severity]]
          .map(([ico, lbl, tr]) => `
            <div class="trend-row">
              <div class="trend-row-left">
                <span class="trend-ico">${ico}</span>
                <span class="trend-row-lbl">${lbl}</span>
              </div>
              <div class="trend-row-right">
                <span class="trend-row-arrow" style="color:${trendColor(tr)}">${trendIcon(tr)}</span>
                <span class="trend-row-txt" style="color:${trendColor(tr)}">${trendLabel(tr)}</span>
              </div>
            </div>`).join("")}
      </div>

      <div class="divider"></div>
      <div class="sec-lbl">Vinduer / d\u00f8re</div>
      ${d.open_windows && d.open_windows.length
        ? `<div class="win-list">${d.open_windows.map(w=>`<div class="win-chip">\uD83E\uDE9F ${esc(w)}</div>`).join("")}</div>`
        : `<div class="no-win">Ingen \u00e5bne vinduer</div>`}
    `;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; ${baseCSS()} font-family:var(--paper-font-body1_-_font-family,sans-serif); }
        .card {
          background:var(--bg); border-radius:18px; padding:14px 16px;
          color:var(--text); box-shadow:var(--ha-card-box-shadow,0 2px 8px rgba(0,0,0,.15));
        }
        .card-title {
          font-size:11px; font-weight:700; text-transform:uppercase;
          letter-spacing:1px; color:var(--sub); margin-bottom:12px;
        }
        .divider { height:1px; background:var(--div); margin:8px 0; }
        .sec-lbl {
          font-size:10px; font-weight:600; text-transform:uppercase;
          letter-spacing:1px; color:var(--sub); margin-bottom:6px;
        }
        .mt10 { margin-top:10px; }
        .loading { color:var(--sub); font-size:12px; }

        /* 3-column layout */
        .cols { display:grid; grid-template-columns:175px 1fr 150px; gap:0 14px; align-items:start; }
        .col { min-width:0; }
        .col-mid { border-left:1px solid var(--div); border-right:1px solid var(--div); padding:0 14px; }

        /* Col 1 */
        .score-block { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
        .ring-wrap { position:relative; flex-shrink:0; }
        .ring-center {
          position:absolute; inset:0;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
        }
        .ring-val  { font-weight:700; line-height:1; }
        .ring-unit { font-size:10px; color:var(--sub); }
        .score-badge {
          display:inline-flex; align-items:center; gap:4px;
          padding:3px 8px; border-radius:20px;
          font-size:11px; font-weight:700; margin-bottom:4px;
        }
        .bdot { width:5px; height:5px; border-radius:50%; animation:bdot 2s infinite; }
        @keyframes bdot { 0%,100%{opacity:1}50%{opacity:.4} }
        .score-sub { font-size:11px; color:var(--sub); }

        .avg-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px; }
        .avg-cell { background:var(--bg2); border-radius:8px; padding:5px 4px; text-align:center; }
        .av { font-size:12px; font-weight:700; }
        .al { font-size:8px; color:var(--sub); margin-top:1px; text-transform:uppercase; }

        .vent-box {
          display:flex; align-items:center; gap:8px;
          background:var(--bg2); border-radius:10px;
          padding:8px 10px; border-left:3px solid;
        }
        .vent-ico { font-size:18px; flex-shrink:0; }
        .vent-ttl { font-size:12px; font-weight:700; }
        .vent-sub { font-size:10px; color:var(--sub); margin-top:1px; }

        .circ-row { display:flex; align-items:center; gap:6px; }
        .circ-ico { font-size:16px; }
        .circ-lbl { font-size:12px; font-weight:600; }

        /* Col 2 */
        .rooms-list { display:flex; flex-direction:column; gap:10px; }
        .room-row {
          display:flex; align-items:center; gap:8px;
          background:var(--bg2); border-radius:12px;
          padding:13px 10px; border-left:4px solid transparent;
        }
        .rr-left { flex-shrink:0; min-width:120px; }
        .rr-name { font-size:13px; font-weight:700; margin-bottom:4px; }
        .rr-pill {
          font-size:9px; font-weight:700; padding:2px 7px; border-radius:20px;
          text-transform:uppercase; letter-spacing:.4px; display:inline-block;
        }
        .rr-mold { display:inline-block; margin-top:3px; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.55} }

        .rr-metrics { display:flex; gap:5px; flex:1; }
        .rrm { background:var(--bg); border-radius:8px; padding:8px 8px; text-align:center; flex:1; }
        .rrm-v { font-size:13px; font-weight:700; line-height:1.1; }
        .rrm-l { font-size:8px; color:var(--sub); margin-top:1px; text-transform:uppercase; }

        .rr-sev { flex-shrink:0; text-align:center; min-width:36px; }
        .rr-sev-val { font-size:13px; font-weight:700; line-height:1; }
        .rr-bar-bg { height:3px; background:var(--div); border-radius:2px; overflow:hidden; margin-top:4px; }
        .rr-bar    { height:100%; border-radius:2px; transition:width .6s; }

        /* Col 3 */
        .trends-col { display:flex; flex-direction:column; gap:5px; }
        .trend-row {
          display:flex; align-items:center; justify-content:space-between;
          background:var(--bg2); border-radius:10px; padding:8px 10px;
        }
        .trend-row-left  { display:flex; align-items:center; gap:6px; }
        .trend-row-right { display:flex; align-items:center; gap:5px; }
        .trend-ico       { font-size:14px; flex-shrink:0; }
        .trend-row-lbl   { font-size:10px; font-weight:600; color:var(--sub); text-transform:uppercase; letter-spacing:.5px; }
        .trend-row-arrow { font-size:18px; font-weight:900; line-height:1; }
        .trend-row-txt   { font-size:10px; font-weight:700; }

        .win-list { display:flex; flex-direction:column; gap:4px; }
        .win-chip {
          font-size:11px; background:var(--bg2);
          border-left:2px solid #0ea5e9;
          padding:5px 8px; border-radius:7px;
        }
        .no-win {
          font-size:11px; color:var(--sub);
          background:var(--bg2); border-radius:8px;
          padding:8px 10px; text-align:center;
        }
      </style>
      <ha-card>
        <div class="card">
          <div class="card-title">${esc(title)}</div>
          <div class="cols">
            <div class="col">${col1}</div>
            <div class="col col-mid">${col2}</div>
            <div class="col">${col3}</div>
          </div>
        </div>
      </ha-card>`;
  }

  getCardSize() { return 4; }
}

if (!customElements.get("indeklima-tablet-card")) {
  customElements.define("indeklima-tablet-card", IndeklimaTabletCard);
}


// ─────────────────────────────────────────────────────────────────────────────
// indeklima-room-detail-card  — rum-specifik detaljekort
// ─────────────────────────────────────────────────────────────────────────────

class IndeklimaRoomDetailCard extends HTMLElement {

  static getStubConfig() { return { room: "Stue" }; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass     = null;
    this._room     = null;
    this._climate  = null;
    this._config   = {};
    this._interval = null;
    this._errCount = 0;
  }

  setConfig(config) {
    if (!config.room) throw new Error("indeklima-room-detail-card: 'room' is required");
    this._config = config;
    this._render();
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._load();
  }

  connectedCallback() {
    this._interval = setInterval(() => {
      if (this._errCount > 5) { clearInterval(this._interval); return; }
      if (document.visibilityState === "visible") this._load();
    }, 30000);
  }
  disconnectedCallback() { clearInterval(this._interval); }

  async _load() {
    if (!this._hass) return;
    try {
      const [room, climate] = await Promise.all([
        this._hass.callWS({
          type: `${INDEKLIMA_DOMAIN}/get_room_data`,
          room_name: this._config.room,
        }),
        this._hass.callWS({ type: `${INDEKLIMA_DOMAIN}/get_climate_data` }),
      ]);
      this._room    = room;
      this._climate = climate;
      this._errCount = 0;
    } catch (e) {
      this._errCount++;
      this._loadError = e?.message || String(e);
    }
    this._render();
  }

  _render() {
    const r       = this._room;
    const cl      = this._climate;
    const title   = this._config.title ?? this._config.room;
    const compact = this._config.compact ?? false;

    const status  = r?.status || "good";
    const color   = statusColor(status);
    const sev     = r?.severity || 0;

    const trends  = cl?.trends  || {};
    const vent    = cl?.ventilation || {};
    const vColor  = ventColor(vent.status);

    // Mold
    const mold      = r?.mold_risk || "low";
    const mColor    = moldColor(mold);

    // ── Metrics grid ──────────────────────────────────────────────────────────
    const metricCell = (icon, val, lbl, highlight) => `
      <div class="metric-cell" style="${highlight ? `border-bottom: 2px solid ${highlight};` : ""}">
        <div class="mc-icon">${icon}</div>
        <div class="mc-val">${val}</div>
        <div class="mc-lbl">${lbl}</div>
      </div>`;

    const metrics = r ? [
      r.temperature_sensors_count > 0
        ? metricCell("\uD83C\uDF21\uFE0F", fmtNum(r.temperature, "\u00b0C", 1), "Temperatur", "#0ea5e9") : "",
      r.humidity_sensors_count > 0
        ? metricCell("\uD83D\uDCA7", fmtNum(r.humidity, "%"), "Fugtighed", color) : "",
      r.co2_sensors_count > 0
        ? metricCell("\uD83C\uDF2B\uFE0F", fmtNum(r.co2, "ppm"), "CO\u2082", color) : "",
      r.pressure_sensors_count > 0
        ? metricCell("\uD83E\uDDED", fmtNum(r.pressure, "hPa"), "Lufttryk", "#8b5cf6") : "",
    ].filter(Boolean).join("") : "";

    // ── Severity bar ──────────────────────────────────────────────────────────
    const sevPct = Math.min(100, sev);
    const sevSegments = [
      { w: 30, color: "#10b981" },
      { w: 30, color: "#f59e0b" },
      { w: 40, color: "#ef4444" },
    ].map(s => `<div style="flex:${s.w};background:${s.color};height:100%;"></div>`).join("");

    // ── Windows / doors ───────────────────────────────────────────────────────
    const winCount  = r?.outdoor_windows_open || 0;
    const doorCount = r?.internal_doors_open  || 0;
    const bonusActive = r?.air_circulation_bonus ?? false;

    const statusChips = [
      winCount  > 0 ? `<span class="chip chip-blue">\uD83E\uDE9F ${winCount} vindue${winCount > 1 ? "r" : ""} \u00e5bent</span>` : "",
      doorCount > 0 ? `<span class="chip chip-blue">\uD83D\uDEAA ${doorCount} d\u00f8r${doorCount > 1 ? "e" : ""} \u00e5ben</span>` : "",
      bonusActive    ? `<span class="chip chip-green">\uD83D\uDCA8 Cirkulations-bonus aktiv</span>` : "",
      winCount === 0 && doorCount === 0
        ? `<span class="chip chip-sub">Ingen \u00e5bne vinduer eller d\u00f8re</span>` : "",
    ].filter(Boolean).join("");

    // ── Mold description ──────────────────────────────────────────────────────
    const moldDesc =
      mold === "critical" ? "Fugtniveau er kritisk \u2014 skimmel vokser aktivt. Udluft straks og unders\u00f8g kolde flader."
      : mold === "high"   ? "H\u00f8j risiko for skimmelvækst. Reducer fugtighed hurtigst muligt."
      : mold === "moderate" ? "Moderat risiko. Hold \u00f8je med fugtighed og s\u00f8rg for udluftning."
      : "Fugtindhold er p\u00e5 et sikkert niveau.";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; ${baseCSS()} font-family:var(--paper-font-body1_-_font-family,sans-serif); }

        .card {
          background:var(--bg); border-radius:18px; padding:16px 18px;
          color:var(--text); box-shadow:var(--ha-card-box-shadow,0 2px 8px rgba(0,0,0,.15));
          border-top: 3px solid ${color};
          background-image: linear-gradient(180deg, ${color}0d 0%, transparent 60px);
        }

        /* ── Header ── */
        .header { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
        .ring-wrap { position:relative; flex-shrink:0; }
        .ring-center {
          position:absolute; inset:0;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
        }
        .ring-val  { font-weight:700; line-height:1; }
        .ring-unit { font-size:10px; color:var(--sub); }

        .header-info { flex:1; min-width:0; }
        .room-title { font-size:20px; font-weight:800; margin-bottom:5px; line-height:1.1; }
        .status-badge {
          display:inline-flex; align-items:center; gap:5px;
          padding:4px 12px; border-radius:20px;
          font-size:12px; font-weight:700;
          background:${color}1a; color:${color};
          ${status !== "good" ? "animation:bdot-pulse 2s infinite;" : ""}
        }
        .bdot { width:7px; height:7px; border-radius:50%; background:${color}; animation:bdot 2s infinite; }
        @keyframes bdot { 0%,100%{opacity:1}50%{opacity:.4} }
        @keyframes bdot-pulse { 0%,100%{box-shadow:0 0 0 0 ${color}40}50%{box-shadow:0 0 0 6px ${color}00} }

        /* ── Severity bar ── */
        .sev-wrap { margin-bottom:14px; }
        .sev-label-row {
          display:flex; justify-content:space-between; align-items:center;
          margin-bottom:5px; font-size:11px; color:var(--sub);
        }
        .sev-score { font-size:13px; font-weight:700; color:${color}; }
        .sev-track {
          height:6px; border-radius:3px; background:var(--div);
          overflow:visible; position:relative;
        }
        .sev-rainbow {
          position:absolute; inset:0; border-radius:3px;
          display:flex; overflow:hidden; opacity:0.3;
        }
        .sev-fill {
          position:absolute; top:0; left:0; height:100%;
          width:${sevPct}%; background:${color};
          border-radius:3px; transition:width .6s;
          box-shadow:0 0 6px ${color}80;
        }
        .sev-marker {
          position:absolute; top:-3px;
          width:12px; height:12px; border-radius:50%;
          background:${color}; border:2px solid var(--bg);
          left:calc(${sevPct}% - 6px);
          transition:left .6s;
          box-shadow:0 0 4px ${color};
        }

        /* ── Section ── */
        .divider { height:1px; background:var(--div); margin:12px 0; }
        .section-lbl {
          font-size:10px; font-weight:600; text-transform:uppercase;
          letter-spacing:1px; color:var(--sub); margin-bottom:8px;
        }

        /* ── Metrics ── */
        .metrics-grid {
          display:grid;
          grid-template-columns:repeat(4, 1fr);
          gap:8px;
        }
        .metric-cell {
          background:var(--bg2); border-radius:12px;
          padding:10px 6px; text-align:center;
          transition:transform .15s;
        }
        .metric-cell:hover { transform:translateY(-2px); }
        .mc-icon { font-size:18px; margin-bottom:4px; }
        .mc-val  { font-size:15px; font-weight:800; line-height:1.1; }
        .mc-lbl  { font-size:8px; color:var(--sub); margin-top:3px; text-transform:uppercase; letter-spacing:.5px; }

        /* ── Trends ── */
        .trends-row { display:flex; gap:8px; }
        .trend-chip {
          flex:1; background:var(--bg2); border-radius:10px;
          padding:10px 8px; text-align:center;
        }
        .trend-header { font-size:9px; font-weight:700; color:var(--sub); text-transform:uppercase; letter-spacing:.8px; margin-bottom:6px; display:flex; align-items:center; justify-content:center; gap:4px; }
        .trend-arrow  { font-size:24px; font-weight:900; line-height:1; margin-bottom:4px; }
        .trend-label  { font-size:10px; font-weight:700; margin-top:2px; }

        /* ── Ventilation ── */
        .vent-row {
          display:flex; align-items:center; gap:10px;
          background:var(--bg2); border-radius:12px; padding:12px;
          border-left:3px solid ${vColor};
        }
        .vent-icon  { font-size:22px; flex-shrink:0; }
        .vent-title { font-size:14px; font-weight:700; color:${vColor}; }
        .vent-sub   { font-size:11px; color:var(--sub); margin-top:2px; }

        /* ── Mold risk ── */
        .mold-row {
          display:flex; align-items:flex-start; gap:12px;
          background:var(--bg2); border-radius:12px; padding:14px;
          border-left:4px solid ${mColor};
          background-image: linear-gradient(90deg, ${mColor}0a 0%, transparent 40%);
        }
        .mold-icon    { font-size:28px; flex-shrink:0; margin-top:1px; }
        .mold-body    { flex:1; min-width:0; }
        .mold-title   { font-size:14px; font-weight:700; color:${mColor}; margin-bottom:4px; }
        .mold-sub     { font-size:12px; color:var(--sub); line-height:1.5; }
        .mold-reading { font-size:11px; color:var(--sub); margin-top:6px; opacity:.7; }

        /* ── Chips ── */
        .chips-row { display:flex; flex-wrap:wrap; gap:6px; }
        .chip {
          font-size:11px; font-weight:500;
          padding:5px 10px; border-radius:20px;
          display:inline-flex; align-items:center; gap:5px;
        }
        .chip-blue  { background:#0ea5e91a; color:#0ea5e9; }
        .chip-green { background:#10b9811a; color:#10b981; }
        .chip-sub   { background:var(--bg2); color:var(--sub); }

        .loading { color:var(--sub); font-size:13px; padding:16px 0; text-align:center; }
        .load-error { padding:16px 0; text-align:center; }
        .err-icon  { font-size:28px; margin-bottom:8px; }
        .err-title { font-size:14px; font-weight:700; color:#ef4444; margin-bottom:4px; }
        .err-sub   { font-size:12px; color:var(--sub); margin-bottom:6px; line-height:1.5; }
        .err-sub code { background:var(--bg2); padding:2px 6px; border-radius:4px; color:var(--text); font-size:11px; }
        .err-detail { font-size:10px; color:var(--sub); opacity:.6; }
      </style>
      <ha-card>
        <div class="card">

          ${this._loadError && !r ? `
            <div class="load-error">
              <div class="err-icon">\u26A0\uFE0F</div>
              <div class="err-title">Kunne ikke hente rum-data</div>
              <div class="err-sub">Tjek at rum-navnet matcher pr\u00e6cist:<br><code>${esc(this._config.room)}</code></div>
              <div class="err-detail">${esc(this._loadError)}</div>
            </div>
          ` : !r ? '<div class="loading">Henter data\u2026</div>' : `

            <!-- Header: ring + title + status -->
            <div class="header">
              ${severityRingHTML(sev, color, 88)}
              <div class="header-info">
                <div class="room-title">${esc(title)}</div>
                <div class="status-badge">
                  <span class="bdot"></span>
                  ${statusLabel(status)}
                </div>
              </div>
            </div>

            <!-- Severity bar -->
            <div class="sev-wrap">
              <div class="sev-label-row">
                <span>Alvorligheds-score</span>
                <span class="sev-score">${Math.round(sev)} / 100</span>
              </div>
              <div class="sev-track">
                <div class="sev-rainbow">${sevSegments}</div>
                <div class="sev-fill"></div>
                <div class="sev-marker"></div>
              </div>
            </div>

            <!-- Metrics -->
            <div class="section-lbl">M\u00e5linger</div>
            <div class="metrics-grid">${metrics || '<span style="color:var(--sub);font-size:12px;">Ingen sensorer konfigureret</span>'}</div>

            ${!compact ? `
              <!-- Trends -->
              <div class="divider"></div>
              <div class="section-lbl">Tendenser (15 min)</div>
              <div class="trends-row">
                <div class="trend-chip">
                  <div class="trend-header">\uD83D\uDCA7 Fugtighed</div>
                  <div class="trend-arrow" style="color:${trendColor(trends.humidity)}">${trendIcon(trends.humidity)}</div>
                  <div class="trend-label" style="color:${trendColor(trends.humidity)}">${trendLabel(trends.humidity)}</div>
                </div>
                <div class="trend-chip">
                  <div class="trend-header">\uD83C\uDF2B\uFE0F CO\u2082</div>
                  <div class="trend-arrow" style="color:${trendColor(trends.co2)}">${trendIcon(trends.co2)}</div>
                  <div class="trend-label" style="color:${trendColor(trends.co2)}">${trendLabel(trends.co2)}</div>
                </div>
                <div class="trend-chip">
                  <div class="trend-header">\uD83D\uDCCA Score</div>
                  <div class="trend-arrow" style="color:${trendColor(trends.severity)}">${trendIcon(trends.severity)}</div>
                  <div class="trend-label" style="color:${trendColor(trends.severity)}">${trendLabel(trends.severity)}</div>
                </div>
              </div>` : ""}

            <!-- Ventilation -->
            <div class="divider"></div>
            <div class="section-lbl">Udluftning</div>
            <div class="vent-row">
              <div class="vent-icon">${vent.status === "yes" ? "\uD83C\uDF2C\uFE0F" : vent.status === "optional" ? "\uD83E\uDD14" : "\u23F3"}</div>
              <div>
                <div class="vent-title">${ventLabel(vent.status)}</div>
                <div class="vent-sub">${(vent.reason || []).join(", ") || "Indeklima er OK"}</div>
              </div>
            </div>

            <!-- Mold risk -->
            <div class="divider"></div>
            <div class="section-lbl">Skimmelrisiko</div>
            <div class="mold-row">
              <div class="mold-icon">${moldIcon(mold)}</div>
              <div class="mold-body">
                <div class="mold-title">${moldLabel(mold)}</div>
                <div class="mold-sub">${moldDesc}</div>
                ${r.mold_humidity != null ? `<div class="mold-reading">Fugtsensor: ${r.mold_humidity.toFixed(1)}\u00a0%</div>` : ""}
              </div>
            </div>

            ${!compact ? `
              <!-- Windows / doors -->
              <div class="divider"></div>
              <div class="section-lbl">Vinduer og d\u00f8re</div>
              <div class="chips-row">${statusChips}</div>` : ""}

          `}
        </div>
      </ha-card>`;
  }

  getCardSize() { return this._config.compact ? 4 : 8; }
}

if (!customElements.get("indeklima-room-detail-card")) {
  customElements.define("indeklima-room-detail-card", IndeklimaRoomDetailCard);
}




window.customCards = window.customCards || [];

if (!window.customCards.find(c => c.type === "indeklima-room-card")) {
  window.customCards.push({
    type:        "indeklima-room-card",
    name:        "Indeklima - Rum",
    description: "Live indeklimavisning for et rum - temperatur, fugt, CO2 og alvorlighed",
    preview:     true,
    documentationURL: "https://github.com/kingpainter/indeklima",
  });
}

if (!window.customCards.find(c => c.type === "indeklima-hub-card")) {
  window.customCards.push({
    type:        "indeklima-hub-card",
    name:        "Indeklima - Hus overblik (mobil)",
    description: "Komplet hus-overblik optimeret til mobil og portrait",
    preview:     true,
    documentationURL: "https://github.com/kingpainter/indeklima",
  });
}

if (!window.customCards.find(c => c.type === "indeklima-tablet-card")) {
  window.customCards.push({
    type:        "indeklima-tablet-card",
    name:        "Indeklima - Hus overblik (tablet/landscape)",
    description: "3-kolonne landscape-layout til tablet og desktop",
    preview:     true,
    documentationURL: "https://github.com/kingpainter/indeklima",
  });
}

if (!window.customCards.find(c => c.type === "indeklima-room-detail-card")) {
  window.customCards.push({
    type:        "indeklima-room-detail-card",
    name:        "Indeklima - Rum detaljer",
    description: "Detaljekort for \u00e9t rum: score, m\u00e5linger, tendenser, udluftning, skimmelrisiko og vinduer",
    preview:     true,
    documentationURL: "https://github.com/kingpainter/indeklima",
  });
}
