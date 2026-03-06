/**
 * Hass Records – Lovelace Cards
 *
 * Cards:
 *   hass-records-action-card      – Record a custom event via a form
 *   hass-records-history-card     – History chart with event annotation markers
 *   hass-records-statistics-card  – Statistics chart with event annotation markers
 */
(function () {
  "use strict";

  const DOMAIN = "hass_records";
  const COLORS = [
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
  ];

  /* ─────────────────────────────────────────────────
   * Shared helpers
   * ───────────────────────────────────────────────── */

  async function fetchEvents(hass, startTime, endTime, entityId) {
    try {
      const msg = {
        type: `${DOMAIN}/events`,
        start_time: startTime,
        end_time: endTime,
      };
      if (entityId) msg.entity_id = entityId;
      const result = await hass.connection.sendMessagePromise(msg);
      return result.events || [];
    } catch (err) {
      console.warn("[hass-records] fetchEvents failed:", err);
      return [];
    }
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ─────────────────────────────────────────────────
   * SVG Chart Renderer
   *
   * All drawing is done on a <canvas> element.
   * ───────────────────────────────────────────────── */

  class ChartRenderer {
    constructor(canvas, cssWidth, cssHeight) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.cssW = cssWidth;
      this.cssH = cssHeight;
      this.pad = { top: 24, right: 20, bottom: 36, left: 56 };
    }

    get cw() {
      return this.cssW - this.pad.left - this.pad.right;
    }
    get ch() {
      return this.cssH - this.pad.top - this.pad.bottom;
    }

    xOf(t, t0, t1) {
      return this.pad.left + ((t - t0) / (t1 - t0)) * this.cw;
    }

    yOf(v, vMin, vMax) {
      return this.pad.top + this.ch - ((v - vMin) / (vMax - vMin)) * this.ch;
    }

    _isDark() {
      // Detect if HA is in dark mode via the canvas background color
      const bg = getComputedStyle(this.canvas).backgroundColor;
      if (!bg) return false;
      const m = bg.match(/\d+/g);
      if (!m) return false;
      const lum = 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
      return lum < 128;
    }

    drawGrid(t0, t1, vMin, vMax, yTicks = 5) {
      const { ctx, pad } = this;
      const gridColor = "rgba(128,128,128,0.15)";
      const labelColor = "rgba(128,128,128,0.85)";

      ctx.font = "10px sans-serif";

      // Horizontal lines + y-labels
      for (let i = 0; i <= yTicks; i++) {
        const v = vMin + (i / yTicks) * (vMax - vMin);
        const y = this.yOf(v, vMin, vMax);

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + this.cw, y);
        ctx.stroke();

        ctx.fillStyle = labelColor;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const label =
          Math.abs(v) >= 1000
            ? (v / 1000).toFixed(1) + "k"
            : v.toFixed(v % 1 !== 0 ? 1 : 0);
        ctx.fillText(label, pad.left - 6, y);
      }

      // X-axis ticks + time labels
      const tickCount = Math.max(2, Math.min(6, Math.floor(this.cw / 80)));
      for (let i = 0; i <= tickCount; i++) {
        const t = t0 + (i / tickCount) * (t1 - t0);
        const x = this.xOf(t, t0, t1);

        ctx.strokeStyle = "rgba(128,128,128,0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + this.ch);
        ctx.stroke();

        ctx.fillStyle = labelColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(fmtTime(new Date(t).toISOString()), x, pad.top + this.ch + 6);
      }

      // Axes
      ctx.strokeStyle = "rgba(128,128,128,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, pad.top + this.ch);
      ctx.lineTo(pad.left + this.cw, pad.top + this.ch);
      ctx.stroke();
    }

    drawLine(points, color, t0, t1, vMin, vMax) {
      if (!points.length) return;
      const { ctx, pad } = this;

      ctx.save();
      ctx.beginPath();
      let first = true;
      for (const [t, v] of points) {
        const x = this.xOf(t, t0, t1);
        const y = this.yOf(v, vMin, vMax);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Filled area gradient
      const lastX = this.xOf(points[points.length - 1][0], t0, t1);
      const firstX = this.xOf(points[0][0], t0, t1);
      const baseY = pad.top + this.ch;

      // Clone path for fill before stroking
      ctx.stroke(); // draw line first so we can reopen path for fill

      ctx.beginPath();
      first = true;
      for (const [t, v] of points) {
        const x = this.xOf(t, t0, t1);
        const y = this.yOf(v, vMin, vMax);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.lineTo(lastX, baseY);
      ctx.lineTo(firstX, baseY);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + this.ch);
      grad.addColorStop(0, hexToRgba(color, 0.25));
      grad.addColorStop(1, hexToRgba(color, 0.02));
      ctx.fillStyle = grad;
      ctx.fill();

      // Re-draw the line on top cleanly
      ctx.beginPath();
      first = true;
      for (const [t, v] of points) {
        const x = this.xOf(t, t0, t1);
        const y = this.yOf(v, vMin, vMax);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.restore();
    }

    /**
     * Draw vertical annotation lines with diamond markers at the top.
     * Returns an array of { event, x } for hit-testing.
     */
    drawAnnotations(events, t0, t1) {
      const { ctx, pad } = this;
      const hits = [];

      for (const event of events) {
        const t = new Date(event.timestamp).getTime();
        if (t < t0 || t > t1) continue;

        const x = this.xOf(t, t0, t1);
        const color = event.color || "#03a9f4";
        hits.push({ event, x });

        // Dashed vertical line
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(x, pad.top + 8);
        ctx.lineTo(x, pad.top + this.ch);
        ctx.stroke();
        ctx.restore();

        // Diamond marker
        const d = 5;
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, pad.top - d);
        ctx.lineTo(x + d, pad.top);
        ctx.lineTo(x, pad.top + d);
        ctx.lineTo(x - d, pad.top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      return hits;
    }
  }

  /* ─────────────────────────────────────────────────
   * Shared chart card base behaviour
   * ───────────────────────────────────────────────── */

  const CHART_STYLE = `
    :host { display: block; }
    ha-card { padding: 0; overflow: hidden; }
    .card-header {
      padding: 16px 16px 0;
      font-size: 1.1em;
      font-weight: 500;
      color: var(--primary-text-color);
    }
    .chart-wrap {
      position: relative;
      padding: 8px 12px 12px;
      box-sizing: border-box;
    }
    canvas { display: block; }
    .loading {
      text-align: center;
      padding: 40px 16px;
      color: var(--secondary-text-color);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      padding: 0 12px 12px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.78em;
      color: var(--secondary-text-color);
    }
    .legend-line { width: 14px; height: 3px; border-radius: 2px; }
    /* Tooltip */
    .tooltip {
      position: absolute;
      background: var(--card-background-color, #fff);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 0.8em;
      line-height: 1.4;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      pointer-events: none;
      display: none;
      max-width: 220px;
      z-index: 10;
      color: var(--primary-text-color);
    }
    .tt-dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      margin-right: 4px;
      flex-shrink: 0;
    }
    .tt-time { color: var(--secondary-text-color); margin-bottom: 3px; }
    .tt-message { font-weight: 500; }
    .tt-annotation { color: var(--secondary-text-color); margin-top: 4px; white-space: pre-wrap; }
  `;

  function buildChartCardShell(title) {
    return `
      <style>${CHART_STYLE}</style>
      <ha-card>
        ${title ? `<div class="card-header">${title}</div>` : ""}
        <div class="chart-wrap">
          <div class="loading" id="loading">Loading…</div>
          <canvas id="chart" style="display:none"></canvas>
          <div class="tooltip" id="tooltip">
            <div class="tt-time" id="tt-time"></div>
            <div style="display:flex;align-items:flex-start;gap:4px">
              <span class="tt-dot" id="tt-dot"></span>
              <span class="tt-message" id="tt-message"></span>
            </div>
            <div class="tt-annotation" id="tt-annotation" style="display:none"></div>
          </div>
        </div>
        <div class="legend" id="legend"></div>
      </ha-card>`;
  }

  function setupCanvas(canvas, container, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth || 360;
    const h = cssHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.getContext("2d").scale(dpr, dpr);
    return { w, h };
  }

  function attachTooltipBehaviour(card, canvas, renderer, events, t0, t1) {
    const tooltip = card.shadowRoot.getElementById("tooltip");
    const ttTime = card.shadowRoot.getElementById("tt-time");
    const ttDot = card.shadowRoot.getElementById("tt-dot");
    const ttMsg = card.shadowRoot.getElementById("tt-message");
    const ttAnn = card.shadowRoot.getElementById("tt-annotation");
    const wrap = card.shadowRoot.querySelector(".chart-wrap");

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Find nearest event within 14px
      const msPerPx = (t1 - t0) / renderer.cw;
      const threshold = 14 * msPerPx;
      const tAtX = t0 + ((x - renderer.pad.left) / renderer.cw) * (t1 - t0);

      let best = null;
      let bestDist = Infinity;
      for (const ev of events) {
        const t = new Date(ev.timestamp).getTime();
        if (t < t0 || t > t1) continue;
        const d = Math.abs(t - tAtX);
        if (d < threshold && d < bestDist) {
          bestDist = d;
          best = ev;
        }
      }

      if (best) {
        ttTime.textContent = fmtDateTime(best.timestamp);
        ttDot.style.background = best.color || "#03a9f4";
        ttMsg.textContent = best.message;
        const ann = best.annotation !== best.message ? best.annotation : "";
        ttAnn.textContent = ann || "";
        ttAnn.style.display = ann ? "block" : "none";

        tooltip.style.display = "block";
        const wrapRect = wrap.getBoundingClientRect();
        let left = e.clientX - wrapRect.left + 12;
        let top = e.clientY - wrapRect.top - 16;
        // Keep inside container
        if (left + 230 > wrap.clientWidth) left = wrap.clientWidth - 234;
        if (top < 0) top = 0;
        tooltip.style.left = left + "px";
        tooltip.style.top = top + "px";
        canvas.style.cursor = "crosshair";
      } else {
        tooltip.style.display = "none";
        canvas.style.cursor = "default";
      }
    });

    canvas.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  }

  /* ─────────────────────────────────────────────────
   * hass-records-action-card
   * ───────────────────────────────────────────────── */

  class HassRecordsActionCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._rendered = false;
    }

    setConfig(config) {
      this._config = config || {};
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._rendered) {
        this._render();
        this._loadRecent();
      }
    }

    _render() {
      this._rendered = true;
      const cfg = this._config;
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; }
          ha-card { padding: 16px; }
          .card-header {
            font-size: 1.1em;
            font-weight: 500;
            margin-bottom: 16px;
            color: var(--primary-text-color);
          }
          .form-group { margin-bottom: 12px; }
          label {
            display: block;
            font-size: 0.8em;
            color: var(--secondary-text-color);
            margin-bottom: 3px;
          }
          input[type=text], textarea {
            width: 100%;
            box-sizing: border-box;
            padding: 8px 10px;
            border: 1px solid var(--divider-color, #ccc);
            border-radius: 6px;
            background: var(--secondary-background-color, transparent);
            color: var(--primary-text-color);
            font-size: 0.95em;
            font-family: inherit;
          }
          input[type=text]:focus, textarea:focus {
            outline: none;
            border-color: var(--primary-color);
          }
          textarea { resize: vertical; min-height: 56px; }
          .row { display: flex; gap: 10px; }
          .row .form-group { flex: 1; }
          input[type=color] {
            width: 100%;
            height: 36px;
            padding: 2px;
            border: 1px solid var(--divider-color, #ccc);
            border-radius: 6px;
            cursor: pointer;
            background: none;
          }
          .btn {
            width: 100%;
            margin-top: 6px;
            padding: 10px;
            background: var(--primary-color);
            color: var(--text-primary-color);
            border: none;
            border-radius: 6px;
            font-size: 0.95em;
            font-family: inherit;
            cursor: pointer;
            font-weight: 500;
            letter-spacing: 0.02em;
          }
          .btn:hover { opacity: 0.88; }
          .btn:disabled { opacity: 0.45; cursor: not-allowed; }
          .feedback {
            font-size: 0.82em;
            margin-top: 8px;
            padding: 6px 10px;
            border-radius: 6px;
            display: none;
          }
          .feedback.ok { background: rgba(76,175,80,0.12); color: var(--success-color, #4caf50); }
          .feedback.err { background: rgba(244,67,54,0.12); color: var(--error-color, #f44336); }
          .recent {
            margin-top: 16px;
            border-top: 1px solid var(--divider-color, #eee);
            padding-top: 12px;
          }
          .recent-title {
            font-size: 0.78em;
            font-weight: 500;
            color: var(--secondary-text-color);
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 8px;
          }
          .ev {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            font-size: 0.83em;
            border-bottom: 1px solid var(--divider-color, #eee);
          }
          .ev:last-child { border: none; }
          .ev-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
          .ev-time { color: var(--secondary-text-color); white-space: nowrap; }
          .ev-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        </style>
        <ha-card>
          <div class="card-header">${cfg.title || "Record Event"}</div>
          <div class="form-group">
            <label>Message *</label>
            <input id="msg" type="text" placeholder="What happened?" />
          </div>
          <div class="form-group">
            <label>Annotation (tooltip text)</label>
            <textarea id="ann" placeholder="Detailed note shown on chart hover…"></textarea>
          </div>
          <div class="row">
            <div class="form-group">
              <label>Icon (MDI)</label>
              <input id="icon" type="text" placeholder="mdi:bookmark" />
            </div>
            <div class="form-group">
              <label>Color</label>
              <input id="color" type="color" value="#03a9f4" />
            </div>
          </div>
          ${
            cfg.entity
              ? ""
              : `<div class="form-group">
                   <label>Entity (optional)</label>
                   <input id="ent" type="text" placeholder="sensor.my_sensor" />
                 </div>`
          }
          <button class="btn" id="btn">Record Event</button>
          <div class="feedback" id="feedback"></div>
          <div class="recent" id="recent" style="display:none">
            <div class="recent-title">Recent events</div>
            <div id="ev-list"></div>
          </div>
        </ha-card>`;

      this.shadowRoot.getElementById("btn").addEventListener("click", () =>
        this._record()
      );
    }

    async _record() {
      const msgEl = this.shadowRoot.getElementById("msg");
      const message = msgEl.value.trim();
      if (!message) {
        msgEl.focus();
        return;
      }

      const btn = this.shadowRoot.getElementById("btn");
      btn.disabled = true;

      const data = { message };
      const ann = this.shadowRoot.getElementById("ann")?.value.trim();
      if (ann) data.annotation = ann;
      const icon = this.shadowRoot.getElementById("icon")?.value.trim();
      if (icon) data.icon = icon;
      data.color = this.shadowRoot.getElementById("color")?.value || "#03a9f4";

      const entEl = this.shadowRoot.getElementById("ent");
      const eid = entEl?.value.trim() || this._config?.entity;
      if (eid) data.entity_id = eid;

      const fb = this.shadowRoot.getElementById("feedback");
      try {
        await this._hass.callService(DOMAIN, "record", data);
        msgEl.value = "";
        if (this.shadowRoot.getElementById("ann"))
          this.shadowRoot.getElementById("ann").value = "";
        fb.className = "feedback ok";
        fb.textContent = "Event recorded!";
        fb.style.display = "block";
        setTimeout(() => (fb.style.display = "none"), 3000);
        this._loadRecent();
      } catch (e) {
        fb.className = "feedback err";
        fb.textContent = `Error: ${e.message || "unknown error"}`;
        fb.style.display = "block";
        console.error("[hass-records action-card]", e);
      }

      btn.disabled = false;
    }

    async _loadRecent() {
      const now = new Date();
      const start = new Date(now - 7 * 86400 * 1000).toISOString();
      const events = await fetchEvents(this._hass, start, now.toISOString());
      if (!events.length) {
        this.shadowRoot.getElementById("recent").style.display = "none";
        return;
      }
      this.shadowRoot.getElementById("recent").style.display = "block";
      const recent = [...events].reverse().slice(0, 6);
      this.shadowRoot.getElementById("ev-list").innerHTML = recent
        .map(
          (e) => `
          <div class="ev">
            <span class="ev-dot" style="background:${e.color}"></span>
            <span class="ev-time">${fmtDateTime(e.timestamp)}</span>
            <span class="ev-msg" title="${e.message}">${e.message}</span>
          </div>`
        )
        .join("");
    }

    static getStubConfig() {
      return { title: "Record Event" };
    }
  }

  /* ─────────────────────────────────────────────────
   * hass-records-history-card
   * ───────────────────────────────────────────────── */

  class HassRecordsHistoryCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._rendered = false;
    }

    setConfig(config) {
      if (!config.entity && !config.entities) {
        throw new Error("hass-records-history-card: define `entity` or `entities`");
      }
      this._config = { hours_to_show: 24, ...config };
    }

    get _entityIds() {
      if (this._config.entities) {
        return this._config.entities.map((e) =>
          typeof e === "string" ? e : e.entity
        );
      }
      return [this._config.entity];
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._rendered) {
        this._rendered = true;
        this.shadowRoot.innerHTML = buildChartCardShell(this._config.title);
        this._load();
      }
    }

    async _load() {
      const now = new Date();
      const start = new Date(now - this._config.hours_to_show * 3600 * 1000);
      const t0 = start.getTime();
      const t1 = now.getTime();

      try {
        const [histResult, events] = await Promise.all([
          this._hass.connection.sendMessagePromise({
            type: "history/history_during_period",
            start_time: start.toISOString(),
            end_time: now.toISOString(),
            entity_ids: this._entityIds,
            include_start_time_state: true,
            significant_changes_only: false,
            no_attributes: true,
          }),
          fetchEvents(this._hass, start.toISOString(), now.toISOString()),
        ]);

        this._drawChart(histResult || {}, events, t0, t1);
      } catch (err) {
        this.shadowRoot.getElementById("loading").textContent =
          "Failed to load data.";
        console.error("[hass-records history-card]", err);
      }
    }

    _drawChart(histResult, events, t0, t1) {
      const canvas = this.shadowRoot.getElementById("chart");
      const wrap = this.shadowRoot.querySelector(".chart-wrap");
      const { w, h } = setupCanvas(canvas, wrap, 220);
      const renderer = new ChartRenderer(canvas, w, h);
      renderer.clear();

      // Build series
      const series = [];
      let allVals = [];

      Object.entries(histResult).forEach(([entityId, stateList], i) => {
        const pts = [];
        for (const s of stateList) {
          const v = parseFloat(s.s);
          if (!isNaN(v)) {
            // lu = last_updated as unix seconds (float)
            pts.push([Math.round(s.lu * 1000), v]);
            allVals.push(v);
          }
        }
        if (pts.length) {
          series.push({ entityId, pts, color: COLORS[i % COLORS.length] });
        }
      });

      if (!allVals.length) {
        this.shadowRoot.getElementById("loading").textContent =
          "No numeric data in the selected time range.";
        return;
      }

      this.shadowRoot.getElementById("loading").style.display = "none";
      canvas.style.display = "block";

      const vMin = Math.min(...allVals);
      const vMax = Math.max(...allVals);
      const vPad = (vMax - vMin) * 0.1 || 1;

      renderer.drawGrid(t0, t1, vMin - vPad, vMax + vPad);
      for (const s of series) {
        renderer.drawLine(s.pts, s.color, t0, t1, vMin - vPad, vMax + vPad);
      }
      renderer.drawAnnotations(events, t0, t1);

      // Legend
      const legendEl = this.shadowRoot.getElementById("legend");
      legendEl.innerHTML =
        series
          .map(
            (s) => `
          <div class="legend-item">
            <div class="legend-line" style="background:${s.color}"></div>
            ${s.entityId}
          </div>`
          )
          .join("") +
        (events.length
          ? `<div class="legend-item">
               <svg width="10" height="10" viewBox="-5 -5 10 10" style="flex-shrink:0">
                 <polygon points="0,-4 4,0 0,4 -4,0" fill="#03a9f4"/>
               </svg>
               ${events.length} event${events.length !== 1 ? "s" : ""}
             </div>`
          : "");

      attachTooltipBehaviour(this, canvas, renderer, events, t0, t1);
    }

    static getStubConfig() {
      return { title: "History with Events", entity: "sensor.example", hours_to_show: 24 };
    }
  }

  /* ─────────────────────────────────────────────────
   * hass-records-statistics-card
   * ───────────────────────────────────────────────── */

  class HassRecordsStatisticsCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._rendered = false;
    }

    setConfig(config) {
      if (!config.entity && !config.entities) {
        throw new Error(
          "hass-records-statistics-card: define `entity` or `entities`"
        );
      }
      this._config = {
        hours_to_show: 24,
        period: "hour",
        stat_types: ["mean"],
        ...config,
      };
    }

    get _statIds() {
      if (this._config.entities) {
        return this._config.entities.map((e) =>
          typeof e === "string" ? e : e.entity || e.statistics_id
        );
      }
      return [this._config.entity];
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._rendered) {
        this._rendered = true;
        this.shadowRoot.innerHTML = buildChartCardShell(this._config.title);
        this._load();
      }
    }

    async _load() {
      const now = new Date();
      const start = new Date(now - this._config.hours_to_show * 3600 * 1000);
      const t0 = start.getTime();
      const t1 = now.getTime();

      try {
        const [statsResult, events] = await Promise.all([
          this._hass.connection.sendMessagePromise({
            type: "recorder/statistics_during_period",
            start_time: start.toISOString(),
            end_time: now.toISOString(),
            statistic_ids: this._statIds,
            period: this._config.period,
            types: this._config.stat_types,
            units: {},
          }),
          fetchEvents(this._hass, start.toISOString(), now.toISOString()),
        ]);

        this._drawChart(statsResult || {}, events, t0, t1);
      } catch (err) {
        this.shadowRoot.getElementById("loading").textContent =
          "Failed to load statistics.";
        console.error("[hass-records statistics-card]", err);
      }
    }

    _drawChart(statsResult, events, t0, t1) {
      const canvas = this.shadowRoot.getElementById("chart");
      const wrap = this.shadowRoot.querySelector(".chart-wrap");
      const { w, h } = setupCanvas(canvas, wrap, 220);
      const renderer = new ChartRenderer(canvas, w, h);
      renderer.clear();

      const series = [];
      let allVals = [];
      let colorIdx = 0;

      for (const [statId, entries] of Object.entries(statsResult)) {
        for (const statType of this._config.stat_types) {
          const pts = [];
          for (const entry of entries) {
            const v = entry[statType];
            if (v === null || v === undefined) continue;
            // start can be a unix timestamp (seconds) or ISO string
            const tRaw = entry.start;
            const t =
              typeof tRaw === "number"
                ? tRaw * 1000
                : new Date(tRaw).getTime();
            pts.push([t, v]);
            allVals.push(v);
          }
          if (pts.length) {
            series.push({
              label: `${statId} (${statType})`,
              pts,
              color: COLORS[colorIdx % COLORS.length],
            });
            colorIdx++;
          }
        }
      }

      if (!allVals.length) {
        this.shadowRoot.getElementById("loading").textContent =
          "No statistics available in the selected time range.";
        return;
      }

      this.shadowRoot.getElementById("loading").style.display = "none";
      canvas.style.display = "block";

      const vMin = Math.min(...allVals);
      const vMax = Math.max(...allVals);
      const vPad = (vMax - vMin) * 0.1 || 1;

      renderer.drawGrid(t0, t1, vMin - vPad, vMax + vPad);
      for (const s of series) {
        renderer.drawLine(s.pts, s.color, t0, t1, vMin - vPad, vMax + vPad);
      }
      renderer.drawAnnotations(events, t0, t1);

      // Legend
      const legendEl = this.shadowRoot.getElementById("legend");
      legendEl.innerHTML =
        series
          .map(
            (s) => `
          <div class="legend-item">
            <div class="legend-line" style="background:${s.color}"></div>
            ${s.label}
          </div>`
          )
          .join("") +
        (events.length
          ? `<div class="legend-item">
               <svg width="10" height="10" viewBox="-5 -5 10 10" style="flex-shrink:0">
                 <polygon points="0,-4 4,0 0,4 -4,0" fill="#03a9f4"/>
               </svg>
               ${events.length} event${events.length !== 1 ? "s" : ""}
             </div>`
          : "");

      attachTooltipBehaviour(this, canvas, renderer, events, t0, t1);
    }

    static getStubConfig() {
      return {
        title: "Statistics with Events",
        entity: "sensor.example",
        hours_to_show: 168,
        period: "hour",
        stat_types: ["mean"],
      };
    }
  }

  /* ─────────────────────────────────────────────────
   * Register custom elements
   * ───────────────────────────────────────────────── */

  customElements.define("hass-records-action-card", HassRecordsActionCard);
  customElements.define("hass-records-history-card", HassRecordsHistoryCard);
  customElements.define(
    "hass-records-statistics-card",
    HassRecordsStatisticsCard
  );

  window.customCards = window.customCards || [];
  window.customCards.push(
    {
      type: "hass-records-action-card",
      name: "Hass Records – Action Card",
      description: "Form card to record a custom event with a message and tooltip annotation.",
      preview: false,
    },
    {
      type: "hass-records-history-card",
      name: "Hass Records – History Card",
      description: "History line chart with coloured annotation markers for recorded events.",
      preview: false,
    },
    {
      type: "hass-records-statistics-card",
      name: "Hass Records – Statistics Card",
      description: "Statistics line chart with coloured annotation markers for recorded events.",
      preview: false,
    }
  );

  console.info(
    "%c HASS-RECORDS %c v0.1.0 loaded ",
    "color:#fff;background:#03a9f4;font-weight:bold;padding:2px 6px;border-radius:3px 0 0 3px",
    "color:#03a9f4;background:#fff;font-weight:bold;padding:2px 6px;border:1px solid #03a9f4;border-radius:0 3px 3px 0"
  );
})();
