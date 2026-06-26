// Indeklima Panel
// Version: 2.5.2
// Description: Sidebar panel for the Indeklima Home Assistant integration.
//              Shows live climate data for all rooms with severity indicators,
//              trends, ventilation recommendation and air circulation status.
//              Climate-themed design: deep teals, organic gradients, breath animations.
// Last Updated: March 2026
//
// Guard: checks customElements.get() before define() to survive hot-reload.

class IndeklimaPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass     = null;
    this._data     = null;
    this._tab      = "overview";   // overview | rooms | ventilation | mold
    this._errCount = 0;
    this._interval = null;
    this._selectedRoom = null;
    this._CACHE_KEY = "indeklima_panel_cache";
    this._resizeObserver = null;
    this._history  = {};
    this._roomFilter = "all";
    this._lastLoad  = null;
    this._ventExpanded = false;
  }

  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._load();
  }

  connectedCallback() {
    this._render();
    this._startResizeObserver();
    this._interval = setInterval(() => {
      if (this._errCount > 5) { clearInterval(this._interval); return; }
      if (document.visibilityState === "visible") this._load();
    }, 30000);
  }

  disconnectedCallback() {
    clearInterval(this._interval);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._applyHeight) {
      window.removeEventListener("resize", this._applyHeight);
    }
  }

  _startResizeObserver() {
    // JS-driven height -- reliable in HA Shadow DOM at all resolutions
    const applyHeight = () => {
      const host = this.shadowRoot.host || this;
      const rect = host.getBoundingClientRect();
      const available = rect.height || window.innerHeight;
      const scroll = this.shadowRoot.querySelector(".panel-scroll");
      const topbar = this.shadowRoot.querySelector(".panel-topbar");
      if (scroll && topbar) {
        const topbarH = topbar.getBoundingClientRect().height || 0;
        scroll.style.height = (available - topbarH) + "px";
      }
    };

    // Apply immediately and on resize
    applyHeight();
    this._resizeObserver = new ResizeObserver(applyHeight);
    this._resizeObserver.observe(document.documentElement);
    window.addEventListener("resize", applyHeight);
    this._applyHeight = applyHeight;  // store ref for cleanup
  }

  // ---- Data ------------------------------------------------------------------------------------------------------------------------------------

  async _load() {
    if (!this._hass) return;

    // If we have cached data, render it immediately while fetching fresh data
    if (this._data) {
      this._stale = true;
      this._render();
    }

    try {
      const fresh = await this._hass.callWS({ type: "indeklima/get_climate_data" });
      this._data     = fresh;
      this._stale    = false;
      this._errCount = 0;
      this._lastLoad  = new Date();
      // Persist to sessionStorage so next panel open is also instant
      try { sessionStorage.setItem(this._CACHE_KEY, JSON.stringify(fresh)); } catch (_) {}
      // Gem historik til sparklines (max 20 punkter per rum)
      const now = Date.now();
      (fresh.rooms || []).forEach(r => {
        if (!this._history[r.name]) this._history[r.name] = [];
        this._history[r.name].push({ ts: now, temp: r.temperature, humidity: r.humidity, co2: r.co2, severity: r.severity });
        if (this._history[r.name].length > 20) this._history[r.name] = this._history[r.name].slice(-20);
      });
    } catch (e) {
      this._stale = false;
      this._errCount++;
      console.error("Indeklima panel load error:", e);
    }
    this._render();
  }

  // ---- Helpers ------------------------------------------------------------------------------------------------------------------------------

  _statusColor(status) {
    if (status === "critical") return "#ef4444";
    if (status === "warning")  return "#f59e0b";
    return "#10b981";
  }

  _statusGradient(status) {
    if (status === "critical") return "linear-gradient(135deg, rgba(239,68,68,0.18) 0%, rgba(239,68,68,0.04) 100%)";
    if (status === "warning")  return "linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.04) 100%)";
    return "linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.03) 100%)";
  }

  _statusLabel(status) {
    if (status === "critical") return "Kritisk";
    if (status === "warning")  return "Advarsel";
    return "God";
  }

  _trendIcon(trend) {
    if (trend === "rising")  return "\u2197";
    if (trend === "falling") return "\u2198";
    return "\u2192";
  }

  _trendColor(trend) {
    if (trend === "rising")  return "#ef4444";
    if (trend === "falling") return "#10b981";
    return "#94a3b8";
  }

  _circIcon(circ) {
    if (circ === "good")     return "\uD83D\uDCA8";
    if (circ === "moderate") return "\uD83C\uDF24\uFE0F";
    return "\uD83E\uDE9F";
  }

  _circLabel(circ) {
    if (circ === "good")     return "God luftcirkulation";
    if (circ === "moderate") return "Moderat luftcirkulation";
    return "D\u00e5rlig luftcirkulation";
  }

  _circColor(circ) {
    if (circ === "good")     return "#10b981";
    if (circ === "moderate") return "#f59e0b";
    return "#ef4444";
  }

  _ventLabel(v) {
    if (v === "yes")      return "Luft ud nu!";
    if (v === "optional") return "Valgfrit";
    return "Vent med at lufte ud";
  }

  _ventIcon(v) {
    if (v === "yes")      return "\uD83D\uDCA8";
    if (v === "optional") return "\uD83E\uDD14";
    return "\u23F3";
  }

  _ventColor(v) {
    if (v === "yes")      return "#0ea5e9";
    if (v === "optional") return "#f59e0b";
    return "#10b981";
  }

  _moldLabel(m) {
    if (m === "critical") return "Kritisk skimmelrisiko";
    if (m === "high")     return "H\u00f8j skimmelrisiko";
    if (m === "moderate") return "Moderat skimmelrisiko";
    return "Lav skimmelrisiko";
  }

  _moldColor(m) {
    if (m === "critical") return "#ef4444";
    if (m === "high")     return "#f97316";
    if (m === "moderate") return "#f59e0b";
    return "#10b981";
  }

  _moldIcon(m) {
    if (m === "critical" || m === "high" || m === "moderate") return "\uD83E\uDDA0";
    return "\u2705";
  }

  _moldDesc(m) {
    if (m === "critical") return "Fugtniveau er kritisk \u2014 skimmel vokser aktivt. Udluft straks og unders\u00f8g kolde flader.";
    if (m === "high")     return "H\u00f8j risiko for skimmelv\u00e6kst. Reducer fugtighed hurtigst muligt.";
    if (m === "moderate") return "Moderat risiko. Hold \u00f8je med fugtighed og s\u00f8rg for udluftning.";
    return "Fugtindhold er p\u00e5 et sikkert niveau.";
  }

  _dehumLabel(v) {
    if (v === "yes")      return "T\u00e6nd affugter";
    if (v === "optional") return "Overv\u00e6j affugter";
    return null;
  }

  _dehumIcon(v) {
    if (v === "yes")      return "\uD83D\uDCA7";
    if (v === "optional") return "\uD83D\uDD35";
    return null;
  }

  _dehumColor(v) {
    if (v === "yes")      return "#f97316";
    if (v === "optional") return "#60a5fa";
    return "#64748b";
  }

  _fmt(val, unit, decimals = 0) {
    if (val == null || val === undefined) return "\u2013";
    const n = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(n)) return "\u2013";
    return n.toFixed(decimals) + "\u00a0" + unit;
  }

  _severityBarColor(score) {
    if (score >= 60) return "#ef4444";
    if (score >= 30) return "#f59e0b";
    return "#10b981";
  }

  // ---- CSS --------------------------------------------------------------------------------------------------------------------------------------

  _css() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

      :host {
        display: flex;
        flex-direction: column;
        --bg:        var(--primary-background-color,  #0f1923);
        --bg2:       var(--secondary-background-color, #1a2535);
        --bg3:       #243044;
        --text:      var(--primary-text-color,   #e2e8f0);
        --sub:       var(--secondary-text-color,  #94a3b8);
        --div:       var(--divider-color,         rgba(148,163,184,0.12));
        --green:     #10b981;
        --orange:    #f59e0b;
        --red:       #ef4444;
        --teal:      #0ea5e9;
        --teal-glow: rgba(14,165,233,0.15);
        --card-radius: 18px;
        font-family: 'DM Sans', var(--paper-font-body1_-_font-family, sans-serif);
        background: var(--bg);
        height: 100%;
        overflow: hidden;
        color: var(--text);
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      /* - Header: logo + title + refresh - */
      .header {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 12px;
      }
      /* - Top bar: header row - never scrolls - */
      .panel-topbar {
        flex-shrink: 0;
        padding: 16px 28px 12px;
        background: var(--bg);
        border-bottom: 1px solid var(--div);
      }

      /* - Scrollable content - takes all remaining height - */
      /* min-height:0 is CRITICAL: without it flex children won't shrink */
      .panel-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 20px 28px 48px;
      }
      .panel-scroll::-webkit-scrollbar { width: 5px; }
      .panel-scroll::-webkit-scrollbar-track { background: transparent; }
      .panel-scroll::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 3px; }

      /* Skeleton/error fallback */
      .panel-wrap {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 24px 28px 48px;
      }


      /* Scrollable content - takes all remaining height */
      .header-icon {
        width: 52px; height: 52px;
        border-radius: 16px;
        background: linear-gradient(135deg, #0ea5e9 0%, #10b981 100%);
        display: flex; align-items: center; justify-content: center;
        font-size: 26px;
        box-shadow: 0 0 24px rgba(14,165,233,0.35);
        flex-shrink: 0;
        overflow: hidden;
      }
      .header-icon img {
        width: 100%; height: 100%;
        object-fit: cover;
        border-radius: 16px;
      }
      .header-text h1 {
        font-size: 22px; font-weight: 700; letter-spacing: -0.3px;
        background: linear-gradient(90deg, #e2e8f0, #94a3b8);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      }
      .header-text .version {
        font-size: 11px; color: var(--sub); letter-spacing: 0.5px;
        font-family: 'DM Mono', monospace; margin-top: 2px;
      }
      .header-refresh {
        margin-left: auto;
        background: var(--bg2);
        border: 1px solid var(--div);
        color: var(--sub);
        padding: 8px 14px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 13px;
        font-family: 'DM Sans', sans-serif;
        transition: all .2s;
      }
      .header-refresh:hover { color: var(--teal); border-color: var(--teal); }
      :host(:fullscreen),
      :host(:-webkit-full-screen) {
        background: var(--bg);
        display: block;
        width: 100vw;
        height: 100vh;
        overflow: auto;
      }

      /* - Tabs: full-width tab bar below the header row - */
      .tabs {
        display: flex;
        gap: 2px;
      }
      .tab {
        flex: 1;
        padding: 9px 12px;
        border-radius: 10px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--sub);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        font-family: 'DM Sans', sans-serif;
        transition: all .2s;
        text-align: center;
        white-space: nowrap;
      }
      .tab.active {
        background: var(--bg2);
        border-color: var(--div);
        color: var(--text);
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      .tab:hover:not(.active) { color: var(--text); background: rgba(255,255,255,0.04); }

      /* - Score ring - */
      .score-section {
        display: flex;
        align-items: center;
        gap: 24px;
        background: var(--bg2);
        border: 1px solid var(--div);
        border-radius: var(--card-radius);
        padding: 24px;
        margin-bottom: 20px;
        position: relative;
        overflow: hidden;
      }
      .score-section::before {
        content: '';
        position: absolute; inset: 0;
        background: radial-gradient(ellipse at top left, rgba(14,165,233,0.08) 0%, transparent 60%);
        pointer-events: none;
      }
      .score-ring-wrap { position: relative; flex-shrink: 0; }
      .score-ring-svg { width: 120px; height: 120px; transform: rotate(-90deg); }
      .score-ring-bg  { fill: none; stroke: var(--div); stroke-width: 10; }
      .score-ring-fill {
        fill: none; stroke-width: 10;
        stroke-linecap: round;
        transition: stroke-dashoffset .8s cubic-bezier(.4,0,.2,1), stroke .4s;
      }
      .score-ring-center {
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
      }
      .score-value  { font-size: 28px; font-weight: 700; line-height: 1; }
      .score-unit   { font-size: 11px; color: var(--sub); margin-top: 2px; }
      .score-info { flex: 1; }
      .score-status-badge {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 12px;
        border-radius: 20px;
        font-size: 12px; font-weight: 600;
        margin-bottom: 10px;
      }
      .score-status-badge .dot {
        width: 7px; height: 7px; border-radius: 50%;
        animation: pulse-dot 2s infinite;
      }
      @keyframes pulse-dot {
        0%,100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.5; transform: scale(1.4); }
      }
      .score-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
      .score-sub   { font-size: 13px; color: var(--sub); }

      .score-meta-row {
        display: flex; gap: 12px; margin-top: 14px; flex-wrap: wrap;
      }
      .score-meta-chip {
        display: flex; align-items: center; gap: 6px;
        background: var(--bg3);
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
      }
      .score-meta-chip span { color: var(--sub); }
      .score-meta-chip strong { font-weight: 600; }

      /* - Quick stats row - */
      .quick-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-bottom: 20px;
      }
      @media (max-width: 600px) {
        .quick-stats { grid-template-columns: repeat(2, 1fr); }
      }
      .qs-card {
        background: var(--bg2);
        border: 1px solid var(--div);
        border-radius: 14px;
        padding: 14px 12px;
        text-align: center;
        position: relative;
        overflow: hidden;
        transition: transform .15s;
      }
      .qs-card:hover { transform: translateY(-2px); }
      .qs-card::after {
        content: '';
        position: absolute; bottom: 0; left: 0; right: 0;
        height: 2px;
        border-radius: 0 0 14px 14px;
      }
      .qs-icon { font-size: 20px; margin-bottom: 6px; }
      .qs-value {
        font-size: 18px; font-weight: 700;
        font-family: 'DM Mono', monospace;
        line-height: 1;
      }
      .qs-label { font-size: 10px; color: var(--sub); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
      .qs-trend { font-size: 13px; font-weight: 700; margin-left: 3px; }

      /* - Section header (legacy, kept for compatibility) - */
      .section-header {
        font-size: 11px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 1.2px;
        color: var(--sub);
        margin-bottom: 10px; margin-top: 4px;
      }

      /* - Section boxes: tydelige kasser med klare gr\u00e6nser - */
      .section-box {
        background: var(--bg2);
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 14px;
        overflow: hidden;
        margin-bottom: 12px;
      }
      .section-box-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-bottom: 1px solid rgba(148,163,184,0.12);
        background: rgba(0,0,0,0.18);
      }
      .section-box-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: var(--sub);
        flex: 1;
      }
      .section-box-badge {
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .section-box-body {
        padding: 14px 16px;
      }
      .section-box-body-flush {
        padding: 0;
      }

      /* - Room cards - */
      .rooms-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 12px;
      }
      .room-card {
        background: var(--bg2);
        border-radius: var(--card-radius);
        padding: 16px;
        cursor: pointer;
        transition: transform .15s, box-shadow .15s;
        position: relative;
        overflow: hidden;
        border-left: 4px solid transparent;
      }
      .room-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      }
      .room-card.selected {
        box-shadow: 0 0 0 2px var(--teal);
      }

      .room-card-header {
        display: flex; align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .room-name {
        font-size: 15px; font-weight: 600;
      }
      .room-status-pill {
        font-size: 10px; font-weight: 700;
        padding: 3px 9px; border-radius: 20px;
        text-transform: uppercase; letter-spacing: 0.5px;
      }

      .room-metrics {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .room-metric {
        background: var(--bg3);
        border-radius: 10px;
        padding: 8px 6px;
        text-align: center;
      }
      .room-metric-icon { font-size: 14px; margin-bottom: 2px; }
      .room-metric-val  {
        font-size: 14px; font-weight: 700;
        font-family: 'DM Mono', monospace;
        line-height: 1.1;
      }
      .room-metric-lbl  { font-size: 9px; color: var(--sub); margin-top: 2px; text-transform: uppercase; }

      .room-severity-bar {
        margin-top: 10px;
        height: 4px; background: var(--bg3);
        border-radius: 2px; overflow: hidden;
      }
      .room-severity-fill {
        height: 100%; border-radius: 2px;
        transition: width .6s cubic-bezier(.4,0,.2,1);
      }
      .room-windows {
        display: flex; gap: 6px; margin-top: 8px;
        flex-wrap: wrap;
      }
      .room-window-chip {
        font-size: 10px;
        background: var(--bg3);
        padding: 3px 7px; border-radius: 6px;
        color: var(--sub);
      }
      .room-window-chip.open { color: var(--teal); }

      /* - Pulse animation for warning/critical rooms - */
      .room-card.status-critical .room-status-pill,
      .room-card.status-warning .room-status-pill {
        animation: badge-pulse 2.5s infinite;
      }
      .room-card.status-critical .room-status-pill { animation-duration: 1.5s; }
      @keyframes badge-pulse {
        0%,100% { opacity: 1; }
        50%      { opacity: 0.6; }
      }

      /* - Ventilation card - */
      .vent-card {
        background: var(--bg2);
        border: 1px solid var(--div);
        border-radius: var(--card-radius);
        padding: 20px;
        margin-bottom: 16px;
        position: relative;
        overflow: hidden;
      }
      .vent-card-header {
        display: flex; align-items: center; gap: 12px;
        margin-bottom: 14px;
      }
      .vent-icon-big {
        width: 48px; height: 48px;
        border-radius: 14px;
        display: flex; align-items: center; justify-content: center;
        font-size: 24px;
        flex-shrink: 0;
      }
      .vent-title { font-size: 18px; font-weight: 700; }
      .vent-sub   { font-size: 13px; color: var(--sub); margin-top: 2px; }

      .vent-reasons {
        display: flex; flex-wrap: wrap; gap: 8px;
        margin-bottom: 14px;
      }
      .vent-reason-chip {
        background: var(--bg3);
        border-radius: 8px;
        padding: 5px 10px;
        font-size: 12px;
      }

      .vent-outdoor {
        display: flex; gap: 10px; flex-wrap: wrap;
      }
      .vent-outdoor-stat {
        background: var(--bg3); border-radius: 10px;
        padding: 10px 14px; text-align: center; flex: 1; min-width: 80px;
      }
      .vent-outdoor-stat .val { font-size: 18px; font-weight: 700; font-family: 'DM Mono', monospace; }
      .vent-outdoor-stat .lbl { font-size: 10px; color: var(--sub); margin-top: 3px; text-transform: uppercase; }

      /* - Circulation card - */
      .circ-card {
        background: var(--bg2);
        border: 1px solid var(--div);
        border-radius: var(--card-radius);
        padding: 20px;
        margin-bottom: 16px;
        display: flex; align-items: center; gap: 16px;
      }
      .circ-icon-wrap {
        width: 56px; height: 56px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 28px; flex-shrink: 0;
      }
      .circ-icon-wrap.good     { background: rgba(16,185,129,0.15); }
      .circ-icon-wrap.moderate { background: rgba(245,158,11,0.15); }
      .circ-icon-wrap.poor     { background: rgba(239,68,68,0.15); }
      .circ-info { flex: 1; }
      .circ-label  { font-size: 16px; font-weight: 700; }
      .circ-detail { font-size: 13px; color: var(--sub); margin-top: 4px; }
      .circ-doors-row {
        display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
      }
      .circ-door-chip {
        background: var(--bg3);
        border-radius: 6px; padding: 3px 8px;
        font-size: 11px; color: var(--teal);
      }

      /* - Trends section - */
      .trends-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-bottom: 20px;
      }
      @media (max-width: 500px) {
        .trends-row { grid-template-columns: 1fr; }
      }
      .trend-card {
        background: var(--bg2); border: 1px solid var(--div); border-radius: 14px;
        padding: 14px; text-align: center;
      }
      .trend-icon { font-size: 26px; margin-bottom: 6px; }
      .trend-val  { font-size: 15px; font-weight: 700; }
      .trend-lbl  { font-size: 10px; color: var(--sub); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

      /* - Windows section - */
      .windows-list {
        display: flex; flex-wrap: wrap; gap: 8px;
        margin-bottom: 20px;
      }
      .window-chip {
        display: flex; align-items: center; gap: 6px;
        background: var(--bg2); border-radius: 10px;
        padding: 8px 12px; font-size: 13px;
        border-left: 3px solid var(--teal);
      }
      .window-chip-icon { font-size: 16px; }
      .no-windows {
        background: var(--bg2); border: 1px solid var(--div); border-radius: 14px;
        padding: 16px; text-align: center;
        color: var(--sub); font-size: 13px;
      }

      /* - Room detail panel - */
      .room-detail {
        background: var(--bg2); border: 1px solid var(--div); border-radius: var(--card-radius);
        margin-top: 16px; overflow: hidden;
      }
      .room-detail-header {
        padding: 18px 20px;
        border-bottom: 1px solid var(--div);
        display: flex; align-items: center; justify-content: space-between;
      }
      .room-detail-name { font-size: 18px; font-weight: 700; }
      .room-detail-close {
        background: var(--bg3); border: none; color: var(--sub);
        width: 30px; height: 30px; border-radius: 8px;
        cursor: pointer; font-size: 16px; display: flex;
        align-items: center; justify-content: center;
        font-family: monospace;
      }
      .room-detail-close:hover { color: var(--text); }
      .room-detail-body { padding: 18px 20px; }
      .room-detail-metrics {
        display: grid; grid-template-columns: repeat(2, 1fr);
        gap: 10px; margin-bottom: 14px;
      }
      .rdm-card {
        background: var(--bg3); border-radius: 12px; padding: 14px;
      }
      .rdm-icon { font-size: 20px; margin-bottom: 6px; }
      .rdm-val  { font-size: 22px; font-weight: 700; font-family: 'DM Mono', monospace; line-height: 1; }
      .rdm-lbl  { font-size: 11px; color: var(--sub); margin-top: 4px; }
      .rdm-sensors { font-size: 10px; color: var(--sub); margin-top: 2px; }

      /* - Overview status grid - */
      .ov-status-grid {
        display:flex; align-items:stretch; margin-top:14px;
        background:var(--bg3); border-radius:14px; overflow:hidden;
      }
      .ov-cell {
        flex:1; display:flex; flex-direction:column; align-items:center;
        justify-content:center; padding:12px 6px; gap:3px;
        border-bottom:3px solid transparent; transition:background .15s;
      }
      .ov-cell[style*="cursor:pointer"]:hover { background:rgba(255,255,255,0.04); }
      .ov-div  { width:1px; background:var(--div); margin:8px 0; flex-shrink:0; }
      .ov-icon { font-size:22px; line-height:1; }
      .ov-val  { font-size:13px; font-weight:700; text-align:center; line-height:1.2; }
      .ov-lbl  { font-size:9px; color:var(--sub); text-transform:uppercase; letter-spacing:.6px; text-align:center; }
      .ov-expand-ico { font-size:8px; vertical-align:middle; opacity:.6; }
      .ov-vent-detail {
        margin-top:10px; padding:10px 12px;
        background:var(--bg3); border-radius:10px;
        border-left:3px solid var(--teal);
        animation:fadeIn .2s ease;
      }
      @keyframes fadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }

      /* - All-stable row - */
      .all-stable-row {
        display:flex; align-items:center; gap:10px; padding:12px 14px;
        border-radius:12px; background:rgba(16,185,129,0.08);
        border:1px solid rgba(16,185,129,0.2);
        font-size:13px; color:var(--green); font-weight:500;
      }
      .all-stable-dot {
        width:8px; height:8px; border-radius:50%; background:var(--green);
        animation:pulse-dot 2.5s infinite; flex-shrink:0;
      }

      /* - Filter bar - */
      .filter-bar { display:flex; gap:6px; margin-bottom:12px; }
      .filter-btn {
        flex:1; padding:7px 12px; border-radius:10px; border:1px solid var(--div);
        background:var(--bg3); color:var(--sub); cursor:pointer;
        font-size:12px; font-weight:500; font-family:'DM Sans',sans-serif;
        transition:all .15s; text-align:center;
      }
      .filter-btn.active { background:var(--bg2); color:var(--text); border-color:var(--teal); }
      .filter-btn:hover:not(.active) { color:var(--text); }

      /* - Room status center - */
      .room-status-center {
        display:flex; align-items:stretch; margin-top:8px;
        background:var(--bg3); border-radius:10px; overflow:hidden;
      }
      .rsc-cell {
        flex:1; display:flex; flex-direction:column; align-items:center;
        justify-content:center; padding:7px 4px; gap:2px;
        border-bottom:3px solid transparent;
      }
      .rsc-div { width:1px; background:var(--div); margin:6px 0; flex-shrink:0; }
      .rsc-ico { font-size:15px; line-height:1; }
      .rsc-val { font-size:10px; font-weight:700; text-align:center; line-height:1.2; }
      .rsc-lbl { font-size:7px; color:var(--sub); text-transform:uppercase; letter-spacing:.5px; }

      /* - Mold status grid - */
      .mold-status-grid {
        display:flex; align-items:stretch;
        background:var(--bg3); border-radius:12px; overflow:hidden;
      }
      .msg-cell {
        flex:1; display:flex; flex-direction:column; align-items:center;
        justify-content:center; padding:12px 6px; gap:3px;
        border-bottom:3px solid transparent;
      }
      .msg-div { width:1px; background:var(--div); margin:8px 0; flex-shrink:0; }
      .msg-icon { font-size:22px; line-height:1; }
      .msg-val  { font-size:13px; font-weight:700; text-align:center; }
      .msg-lbl  { font-size:9px; color:var(--sub); text-transform:uppercase; letter-spacing:.6px; }

      /* - Loading / error - */
      .loading-wrap {
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        min-height: 300px; gap: 16px;
      }
      .loading-icon { font-size: 48px; animation: float 3s ease-in-out infinite; }
      @keyframes float {
        0%,100% { transform: translateY(0); }
        50%      { transform: translateY(-10px); }
      }
      .loading-text { color: var(--sub); font-size: 14px; }

      /* - Skeleton loader - */
      .skel {
        background: linear-gradient(90deg,
          var(--bg2) 25%, var(--bg3) 50%, var(--bg2) 75%);
        background-size: 200% 100%;
        animation: skel-shimmer 1.4s infinite;
        border-radius: 8px;
      }
      @keyframes skel-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .skel-h1   { height: 120px; margin-bottom: 20px; }
      .skel-row  { height: 80px; margin-bottom: 12px; }
      .skel-row2 { height: 60px; margin-bottom: 12px; }
      .skel-grid { display: grid; grid-template-columns: repeat(4,1fr); gap:10px; margin-bottom:20px; }
      .skel-grid-item { height: 80px; }
      .skel-stale { opacity: 0.6; pointer-events: none; }

      .error-box {
        background: rgba(239,68,68,0.1);
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: 14px;
        padding: 16px; text-align: center;
        color: #fca5a5; font-size: 13px;
      }
    `;
  }

  // ---- Render sections --------------------------------------------------------------------------------------------------------------

  _renderOverview(d) {
    const status   = d.status || "good";
    const severity = d.severity || 0;
    const color    = this._statusColor(status);
    const averages = d.averages || {};
    const trends   = d.trends   || {};
    const vent     = d.ventilation || {};
    const vStatus  = vent.status || "no";
    const vColor   = this._ventColor(vStatus);
    const circ     = d.air_circulation || "poor";
    const cColor   = this._circColor(circ);
    const winCount = d.open_windows_count || 0;
    const winColor = winCount > 0 ? "#0ea5e9" : "#10b981";

    // SVG ring
    const r     = 46;
    const circ2 = 2 * Math.PI * r;
    const dashV = (severity / 100) * circ2;
    const dashO = circ2 - dashV;

    // Vent reasons med rum
    const reasons = Array.isArray(vent.reason) ? vent.reason : (vent.reason ? [vent.reason] : []);
    const vrooms  = Array.isArray(vent.rooms)  ? vent.rooms  : (vent.rooms  ? [vent.rooms]  : []);
    const reasonChips = reasons.map((r2, i) => vrooms[i] ? `${r2} - ${vrooms[i]}` : r2);

    // Udend-rs vejr kompakt
    const outdoorLine = vent.outdoor_temp != null
      ? `\uD83D\uDCCA- ${this._fmt(vent.outdoor_temp, "\u00b0C", 1)} \u00B7 \uD83D\uDCCA- ${this._fmt(vent.outdoor_humidity, "%", 0)} udenfor`
      : vent.weather_configured ? "- Vejrdata ikke tilg\u00e6ngeligt endnu" : null;

    return `
      <!-- Score + status i -n boks -->
      <div class="section-box">
        <div class="section-box-header">
          <div class="section-box-title">Husstandens indeklima</div>
          <div class="section-box-badge" style="background:${color}22;color:${color};">${this._statusLabel(status)}</div>
        </div>
        <div class="section-box-body">
          <div class="score-section" style="background:none;border:none;padding:0;margin:0;overflow:visible;">
            <div class="score-ring-wrap">
              <svg class="score-ring-svg" viewBox="0 0 120 120">
                <circle class="score-ring-bg"   cx="60" cy="60" r="${r}" />
                <circle class="score-ring-fill" cx="60" cy="60" r="${r}"
                  stroke="${color}" stroke-dasharray="${dashV} ${dashO}" stroke-dashoffset="0" />
              </svg>
              <div class="score-ring-center">
                <div class="score-value" style="color:${color}">${Math.round(severity)}</div>
                <div class="score-unit">/ 100</div>
              </div>
            </div>
            <div class="score-info">
              <div class="score-title">${this._statusLabel(status)}</div>
              <div class="score-sub">${d.room_count || 0} rum overv\u00e5ges</div>
              ${outdoorLine ? `<div style="font-size:11px;color:var(--sub);margin-top:6px;">${outdoorLine}</div>` : ""}
            </div>
          </div>

          <!-- Status-panel: udluftning / cirkulation / vinduer -->
          <div class="ov-status-grid">
            <div class="ov-cell" id="ov-vent-cell" style="border-bottom-color:${vColor};cursor:pointer;">
              <div class="ov-icon">${this._ventIcon(vStatus)}</div>
              <div class="ov-val" style="color:${vColor}">${this._ventLabel(vStatus)}</div>
              <div class="ov-lbl">Udluftning ${reasons.length > 0 ? `<span class="ov-expand-ico">${this._ventExpanded ? "-" : "-"}</span>` : ""}</div>
            </div>
            <div class="ov-div"></div>
            <div class="ov-cell" style="border-bottom-color:${cColor}">
              <div class="ov-icon">${this._circIcon(circ)}</div>
              <div class="ov-val" style="color:${cColor}">${circ === "good" ? "God" : circ === "moderate" ? "Moderat" : "D\u00e5rlig"}</div>
              <div class="ov-lbl">Cirkulation</div>
            </div>
            <div class="ov-div"></div>
            <div class="ov-cell" style="border-bottom-color:${winColor}">
              <div class="ov-icon">\uD83D\uDCCA-</div>
              <div class="ov-val" style="color:${winColor}">${winCount}</div>
              <div class="ov-lbl">${winCount === 1 ? "Vindue \u00e5bent" : "Vinduer \u00e5bne"}</div>
            </div>
          </div>

          <!-- Udluftnings-detalje: folder ud ved klik -->
          ${this._ventExpanded && reasons.length > 0 ? `
          <div class="ov-vent-detail">
            ${vrooms.length > 0 ? `<div style="font-size:11px;color:var(--sub);margin-bottom:6px;">Ber\u00f8rte rum: ${vrooms.join(", ")}</div>` : ""}
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${reasonChips.map(r2 => `<div class="vent-reason-chip">- ${r2}</div>`).join("")}
            </div>
            ${(d.open_internal_doors||[]).length > 0 ? `
            <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
              ${(d.open_internal_doors||[]).map(r2 => `<span class="circ-door-chip">\uD83D\uDCCA- ${r2}</span>`).join("")}
            </div>` : ""}
          </div>` : ""}
        </div>
      </div>

      <!-- Gennemsnitlige m\u00e5linger -->
      <div class="section-box">
        <div class="section-box-header">
          <div class="section-box-title">Gennemsnitlige m\u00e5linger</div>
        </div>
        <div class="section-box-body" style="padding:12px 14px;">
          <div class="quick-stats" style="margin-bottom:0;">
            ${this._qs("\uD83C\uDF21\uFE0F", this._fmt(averages.temperature, "\u00b0C", 1), "Temp", "stable", false)}
            ${this._qs("\uD83D\uDCA7", this._fmt(averages.humidity, "%", 0), "Fugtighed", trends.humidity, true)}
            ${this._qs("\uD83E\uDEA7", this._fmt(averages.co2, "ppm", 0), "CO\u2082", trends.co2, true)}
            ${this._qs("\uD83E\uDDED", this._fmt(averages.pressure, "hPa", 0), "Lufttryk", "stable", false)}
          </div>
        </div>
      </div>

      <!-- Tendenser -->
      <div class="section-box">
        <div class="section-box-header">
          <div class="section-box-title">Tendenser (30 min)</div>
        </div>
        <div class="section-box-body" style="padding:12px 14px;">
          ${(trends.humidity === "stable" && trends.co2 === "stable" && trends.severity === "stable")
            ? `<div class="all-stable-row"><span class="all-stable-dot"></span>Alle m\u00e5linger er stabile</div>`
            : `<div class="trends-row" style="margin-bottom:0;">
                ${this._trendCard("\uD83D\uDCA7", "Fugtighed", trends.humidity)}
                ${this._trendCard("\uD83E\uDEA7", "CO\u2082", trends.co2)}
                ${this._trendCard("\uD83D\uDCCA", "Alvorlighed", trends.severity)}
               </div>`}
        </div>
      </div>

      <!-- -bne vinduer/d\u00f8re (kun vis hvis der er nogen) -->
      ${winCount > 0 || (d.open_windows && d.open_windows.length > 0) ? `
      <div class="section-box">
        <div class="section-box-header">
          <div class="section-box-title">-bne vinduer / d\u00f8re</div>
          <div class="section-box-badge" style="background:rgba(14,165,233,0.15);color:var(--teal);">${(d.open_windows||[]).length + (d.open_internal_doors||[]).length} \u00e5ben</div>
        </div>
        <div class="section-box-body">
          <div class="windows-list" style="margin-bottom:0;">
            ${(d.open_windows||[]).map(r2 => `<div class="window-chip"><span class="window-chip-icon">\uD83D\uDCCA-</span>${r2}</div>`).join("")}
            ${(d.open_internal_doors||[]).map(r2 => `<div class="window-chip" style="border-left-color:#f59e0b"><span class="window-chip-icon">\uD83D\uDCCA-</span>${r2}</div>`).join("")}
          </div>
        </div>
      </div>` : ""}
    `;
  }


  _qs(icon, value, label, trend, showTrend) {
    const tc = showTrend ? this._trendColor(trend) : "transparent";
    const ti = showTrend ? this._trendIcon(trend)  : "";
    return `
      <div class="qs-card">
        <div class="qs-icon">${icon}</div>
        <div class="qs-value">
          ${value}
          ${showTrend ? `<span class="qs-trend" style="color:${tc}">${ti}</span>` : ""}
        </div>
        <div class="qs-label">${label}</div>
      </div>`;
  }

  _trendCard(icon, label, trend) {
    const color = this._trendColor(trend);
    const arrow = this._trendIcon(trend);
    const labels = { rising: "Stigende", falling: "Faldende", stable: "Stabil" };
    return `
      <div class="trend-card">
        <div class="trend-icon">${icon}</div>
        <div class="trend-val" style="color:${color}">${arrow} ${labels[trend] || "Stabil"}</div>
        <div class="trend-lbl">${label}</div>
      </div>`;
  }

  _renderRooms(d) {
    const allRooms = d.rooms || [];
    const problemRooms = allRooms.filter(r => r.status !== "good");
    const rooms = this._roomFilter === "problems" ? problemRooms : allRooms;
    const filterBar = `
      <div class="filter-bar">
        <button class="filter-btn${this._roomFilter === "all" ? " active" : ""}" data-filter="all">Alle rum (${allRooms.length})</button>
        <button class="filter-btn${this._roomFilter === "problems" ? " active" : ""}" data-filter="problems">&#9888;&#65039; Problemer${problemRooms.length > 0 ? ` (${problemRooms.length})` : ""}</button>
      </div>`;

    const roomsHTML = rooms.map(r => {
      const color = this._statusColor(r.status);
      const bg    = this._statusGradient(r.status);
      const severityPct = Math.min(100, r.severity || 0);

      return `
        <div class="room-card status-${r.status}"
          style="border-left-color:${color}; background:${bg}, var(--bg2);"
          data-room="${r.name}">
          <div class="room-card-header">
            <div class="room-name">${r.name}</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:10px;color:${color};font-family:'DM Mono',monospace;font-weight:700;">${Math.round(severityPct)}</span>
              <div class="room-status-pill" style="background:${color}22; color:${color};">
                ${this._statusLabel(r.status)}
              </div>
            </div>
          </div>

          <div class="room-metrics">
            ${r.temperature_sensors_count > 0 ? this._roomMetric("\uD83D\uDCCA-", this._fmt(r.temperature, "\u00b0C", 1), "Temp") : ""}
            ${r.humidity_sensors_count > 0    ? this._roomMetric("\uD83D\uDCCA-", this._fmt(r.humidity, "%", 0), "Fugt") : ""}
            ${r.co2_sensors_count > 0         ? this._roomMetric("\uD83D\uDCCA-", this._fmt(r.co2, "ppm", 0), "CO-") : ""}
          </div>

          <div class="room-severity-bar">
            <div class="room-severity-fill"
              style="width:${severityPct}%;background:${color}">
            </div>
          </div>

          <div class="room-status-center">
            <div class="rsc-cell" style="border-bottom-color:${this._moldColor(r.mold_risk||'low')}">
              <div class="rsc-ico">${this._moldIcon(r.mold_risk)}</div>
              <div class="rsc-val" style="color:${this._moldColor(r.mold_risk||'low')}">${r.mold_risk==="low"?"Lav":r.mold_risk==="moderate"?"Moderat":r.mold_risk==="high"?"H\u00f8j":"Kritisk"}</div>
              <div class="rsc-lbl">Skimmel</div>
            </div>
            <div class="rsc-div"></div>
            <div class="rsc-cell" style="border-bottom-color:${this._ventColor(r.ventilation_status||'no')}">
              <div class="rsc-ico">${this._ventIcon(r.ventilation_status||'no')}</div>
              <div class="rsc-val" style="color:${this._ventColor(r.ventilation_status||'no')}">${r.ventilation_status==="yes"?"Luft ud":r.ventilation_status==="optional"?"Overv\u00e6j":"OK"}</div>
              <div class="rsc-lbl">Udluftning</div>
            </div>
            ${r.has_dehumidifier && this._dehumIcon(r.dehumidifier_recommendation) ? `
            <div class="rsc-div"></div>
            <div class="rsc-cell" style="border-bottom-color:${this._dehumColor(r.dehumidifier_recommendation)}">
              <div class="rsc-ico">${this._dehumIcon(r.dehumidifier_recommendation)}</div>
              <div class="rsc-val" style="color:${this._dehumColor(r.dehumidifier_recommendation)}">${r.dehumidifier_recommendation==="yes"?"T\u00e6nd":"Overv\u00e6j"}</div>
              <div class="rsc-lbl">Affugter</div>
            </div>` : ""}
          </div>
          ${this._sparkline(r.name, "severity")}
          ${r.outdoor_windows_open > 0 || r.internal_doors_open > 0 ? `
          <div class="room-windows">
            ${r.outdoor_windows_open > 0 ? `<span class="room-window-chip open">\uD83D\uDCCA- ${r.outdoor_windows_open} vindue${r.outdoor_windows_open > 1 ? "r" : ""} \u00e5ben</span>` : ""}
            ${r.internal_doors_open > 0 ? `<span class="room-window-chip open">\uD83D\uDCCA- ${r.internal_doors_open} d\u00f8r${r.internal_doors_open > 1 ? "e" : ""} \u00e5ben</span>` : ""}
          </div>` : ""}
        </div>`;
    }).join("");

    const detailHTML = this._selectedRoom
      ? this._renderRoomDetail(rooms.find(r => r.name === this._selectedRoom))
      : "";

    return `
      <div class="section-box">
        <div class="section-box-header">
          <div class="section-box-title">Rum</div>
          <div class="section-box-badge" style="background:var(--bg3);color:var(--sub);">${allRooms.length} rum</div>
        </div>
        <div class="section-box-body" style="padding:12px 14px;">
          ${filterBar}
          ${rooms.length === 0
            ? `<div style="text-align:center;padding:20px;color:var(--sub);font-size:13px;">- Alle rum er i orden</div>`
            : `<div class="rooms-grid">${roomsHTML}</div>`}
        </div>
      </div>
      ${detailHTML}
    `;
  }

  _roomMetric(icon, value, label) {
    return `
      <div class="room-metric">
        <div class="room-metric-icon">${icon}</div>
        <div class="room-metric-val">${value}</div>
        <div class="room-metric-lbl">${label}</div>
      </div>`;
  }

  _renderRoomDetail(r) {
    if (!r) return "";
    const color = this._statusColor(r.status);

    return `
      <div class="room-detail" id="room-detail">
        <div class="room-detail-header" style="border-left: 4px solid ${color};">
          <div class="room-detail-name">${r.name}</div>
          <button class="room-detail-close" id="close-detail">-</button>
        </div>
        <div class="room-detail-body">
          <div class="room-detail-metrics">
            ${r.temperature_sensors_count > 0 ? this._rdmCard("\uD83D\uDCCA-", this._fmt(r.temperature, "\u00b0C", 1), "Temperatur", r.temperature_sensors_count) : ""}
            ${r.humidity_sensors_count > 0    ? this._rdmCard("\uD83D\uDCCA-", this._fmt(r.humidity, "%", 0), "Fugtighed", r.humidity_sensors_count) : ""}
            ${r.co2_sensors_count > 0         ? this._rdmCard("\uD83D\uDCCA-", this._fmt(r.co2, "ppm", 0), "CO-", r.co2_sensors_count) : ""}
            ${r.pressure_sensors_count > 0    ? this._rdmCard("\uD83D\uDCCA-", this._fmt(r.pressure, "hPa", 0), "Lufttryk", r.pressure_sensors_count) : ""}
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--sub);">
            <span>Alvorlighed:</span>
            <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;">
              <div style="width:${Math.min(100, r.severity || 0)}%;height:100%;background:${color};border-radius:3px;transition:width .6s;"></div>
            </div>
            <strong style="color:${color};">${Math.round(r.severity || 0)}/100</strong>
          </div>

          <div style="display:flex;align-items:flex-start;gap:10px;margin-top:10px;background:var(--bg3);border-radius:10px;padding:12px;border-left:3px solid ${this._moldColor(r.mold_risk || 'low')};">
            <span style="font-size:22px;flex-shrink:0;">${this._moldIcon(r.mold_risk || 'low')}</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:${this._moldColor(r.mold_risk || 'low')};margin-bottom:3px;">${this._moldLabel(r.mold_risk || 'low')}</div>
              <div style="font-size:11px;color:var(--sub);line-height:1.5;">${this._moldDesc(r.mold_risk || 'low')}</div>
              ${r.mold_humidity != null ? `<div style="font-size:10px;color:var(--sub);margin-top:4px;opacity:.7;">Fugtsensor: ${r.mold_humidity.toFixed(1)}\u00a0%</div>` : ""}
            </div>
          </div>

          ${r.dehumidifier_recommendation && r.dehumidifier_recommendation !== "no"
            ? `<div style="display:flex;align-items:center;gap:10px;margin-top:10px;background:var(--bg3);border-radius:10px;padding:12px;border-left:3px solid ${this._dehumColor(r.dehumidifier_recommendation)};">
                <span style="font-size:22px;flex-shrink:0;">${this._dehumIcon(r.dehumidifier_recommendation)}</span>
                <div>
                  <div style="font-size:13px;font-weight:700;color:${this._dehumColor(r.dehumidifier_recommendation)};margin-bottom:3px;">${this._dehumLabel(r.dehumidifier_recommendation)}</div>
                  <div style="font-size:11px;color:var(--sub);line-height:1.5;">${r.dehumidifier_recommendation === "yes" ? "Fugt- eller skimmelrisiko er forh\u00f8jet \u2014 affugter anbefales aktiveret." : "Fugtniveauet er let forh\u00f8jet \u2014 overvej at t\u00e6nde affugteren."}</div>
                </div>
              </div>`
            : ""}
        </div>
      </div>`;
  }

  _rdmCard(icon, value, label, count) {
    return `
      <div class="rdm-card">
        <div class="rdm-icon">${icon}</div>
        <div class="rdm-val">${value}</div>
        <div class="rdm-lbl">${label}</div>
        ${count > 1 ? `<div class="rdm-sensors">${count} sensorer (gns.)</div>` : ""}
      </div>`;
  }

  _sparkline(roomName, key) {
    const hist = this._history[roomName];
    if (!hist || hist.length < 5) return "";
    const vals = hist.map(p => p[key]).filter(v => v != null);
    if (vals.length < 5) return "";
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const rng = mx - mn || 1;
    const W = 200, H = 28, pd = 2;
    const pts = vals.map((v, i) => {
      const x = pd + (i / (vals.length - 1)) * (W - pd * 2);
      const y = H - pd - ((v - mn) / rng) * (H - pd * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const last = vals[vals.length - 1];
    const col = key === "severity" ? (last >= 60 ? "#ef4444" : last >= 30 ? "#f59e0b" : "#10b981") : "#0ea5e9";
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:28px;display:block;margin-top:6px;opacity:0.7;"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ---- Main render ----------------------------------------------------------------------------------------------------------------------


  _render() {
    const d = this._data;

    let content;
    if (!d) {
      // First-ever load - show skeleton UI instead of blank spinner
      content = `
        <div>
          <div class="skel skel-h1"></div>
          <div class="skel-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px;">
            <div class="skel skel-grid-item"></div>
            <div class="skel skel-grid-item"></div>
            <div class="skel skel-grid-item"></div>
            <div class="skel skel-grid-item"></div>
          </div>
          <div class="skel skel-row"></div>
          <div class="skel skel-row"></div>
          <div class="skel skel-row2"></div>
        </div>`;
    } else {
      let tabContent;
      if      (this._tab === "overview")     tabContent = this._renderOverview(d);
      else if (this._tab === "rooms")        tabContent = this._renderRooms(d);


      content = tabContent;
    }

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>

      <div class="panel-topbar">
        <div class="header">
          <div class="header-icon"><img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAQABAADASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAECAwgEBgcFCf/EAGMQAAIBAgMFAwYFDAkRCQABBQABAgMRBAUhBgcSMUFRYXEIEyKBkaEUMmKx0RUXGCNCUlaTlLLB0hYzNFRygpKz4QkkJSc1NkNERVNVY3N0hKLwJkZkZXWDo8LxKKQ3OMOV/8QAGwEBAAIDAQEAAAAAAAAAAAAAAAEFAwQGAgf/xAA4EQEAAQMBBQUGBQUBAQEBAQAAAQIDBBEFEiExURMUFUFhBhYiMnGhI1KBsdEzNEKR8CTBckPh/9oADAMBAAIRAxEAPwDTIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==" alt="Indeklima"></div>
          <div class="header-text">
            <h1>Indeklima</h1>
            <div class="version">v${d?.version || "2.5.2"} \u00B7 Gold Tier${this._lastLoad ? " \u00B7 " + this._lastLoad.toLocaleTimeString("da-DK",{hour:"2-digit",minute:"2-digit"}) : ""}</div>
          </div>
          ${this._stale ? '<span style="font-size:11px;color:var(--sub);padding:6px 10px;background:var(--bg2);border-radius:8px;border:1px solid var(--div)">- Opdaterer-</span>' : ''}
          <button class="header-refresh" id="refresh-btn">- Opdater</button>
        </div>
        ${d ? `<div class="tabs">
          ${[
            { id: "overview",    label: "\uD83D\uDCCA- Overblik" },
            { id: "rooms",       label: "\uD83D\uDCCA- Rum" },
          ].map(t => `
            <button class="tab${this._tab === t.id ? " active" : ""}" data-tab="${t.id}">
              ${t.label}
            </button>`).join("")}
        </div>` : ""}
      </div>

      <div class="panel-scroll${this._stale ? " skel-stale" : ""}">
        ${content}
      </div>
    `;

        this._bindEvents();
    // Reapply height after every render (DOM may have changed)
    if (this._applyHeight) requestAnimationFrame(this._applyHeight);
  }

  _bindEvents() {
    // Tab switching
    this.shadowRoot.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => {
        this._tab = btn.dataset.tab;
        this._selectedRoom = null;
        this._ventExpanded = false;
        this._render();
      });
    });

    // Refresh
    const refreshBtn = this.shadowRoot.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this._load());
    }

    // Ov-vent-cell klik: fold udluftnings-detalje ud/ind
    const ventCell = this.shadowRoot.getElementById("ov-vent-cell");
    if (ventCell) {
      ventCell.addEventListener("click", () => {
        this._ventExpanded = !this._ventExpanded;
        this._render();
      });
    }

    // Room filter buttons
    this.shadowRoot.querySelectorAll(".filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this._roomFilter = btn.dataset.filter;
        this._selectedRoom = null;
        this._render();
      });
    });

    // Room card clicks (rooms tab)
    this.shadowRoot.querySelectorAll(".room-card").forEach(card => {
      card.addEventListener("click", () => {
        const name = card.dataset.room;
        this._selectedRoom = this._selectedRoom === name ? null : name;
        this._render();
        if (this._selectedRoom) {
          setTimeout(() => {
            this.shadowRoot.getElementById("room-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 50);
        }
      });
    });

    // Close room detail
    const closeBtn = this.shadowRoot.getElementById("close-detail");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._selectedRoom = null;
        this._render();
      });
    }
  }
}

if (!customElements.get("indeklima-panel")) {
  customElements.define("indeklima-panel", IndeklimaPanel);
}