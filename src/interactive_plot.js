(function (root) {
  "use strict";

  const api = root.MapReconstructionWeb = root.MapReconstructionWeb || {};

  class TracePlotController {
    constructor(canvas, options) {
      this.canvas = canvas;
      this.options = options || {};
      this.timeS = null;
      this.series = [];
      this.config = {};
      this.view = null;
      this.drag = null;
      this.regionDrawMode = false;
      this.temporaryRegion = null;
      this._bind();
    }

    _bind() {
      this.canvas.addEventListener("wheel", event => this._wheel(event), { passive: false });
      this.canvas.addEventListener("pointerdown", event => this._pointerDown(event));
      this.canvas.addEventListener("pointermove", event => this._pointerMove(event));
      this.canvas.addEventListener("pointerup", event => this._pointerUp(event));
      this.canvas.addEventListener("pointercancel", event => this._pointerUp(event));
      this.canvas.addEventListener("dblclick", event => {
        event.preventDefault();
        this.autoscale();
      });
    }

    setData(timeS, series, config) {
      this.timeS = timeS || null;
      this.series = series || [];
      this.config = config || {};
      this.draw();
    }

    setRegionDrawMode(enabled) {
      this.regionDrawMode = Boolean(enabled);
      this.temporaryRegion = null;
      this.canvas.classList.toggle("region-draw-mode", this.regionDrawMode);
      this.draw();
    }

    autoscale() {
      this.view = null;
      this.draw();
      this._notifyView();
    }

    fullX() {
      const viewport = this._viewport();
      if (!viewport) return;
      this.view = Object.assign({}, this.view || {}, {
        xMin: viewport.data.xMin,
        xMax: viewport.data.xMax,
      });
      this.draw();
      this._notifyView();
    }

    setView(view) {
      if (!view) {
        this.autoscale();
        return;
      }
      const next = {};
      for (const key of ["xMin","xMax","yMin","yMax"]) {
        if (Number.isFinite(Number(view[key]))) next[key] = Number(view[key]);
      }
      if (
        ("xMin" in next || "xMax" in next) &&
        !(Number.isFinite(next.xMin) && Number.isFinite(next.xMax) && next.xMin < next.xMax)
      ) throw new Error("X axis minimum must be less than maximum.");
      if (
        ("yMin" in next || "yMax" in next) &&
        !(Number.isFinite(next.yMin) && Number.isFinite(next.yMax) && next.yMin < next.yMax)
      ) throw new Error("Y axis minimum must be less than maximum.");
      this.view = Object.freeze(next);
      this.draw();
      this._notifyView();
    }

    resolvedView() {
      const viewport = this._viewport();
      return viewport ? Object.freeze({
        xMin: viewport.xMin, xMax: viewport.xMax,
        yMin: viewport.yMin, yMax: viewport.yMax,
      }) : null;
    }

    draw() {
      if (!this.timeS || !this.timeS.length || !this.series.length) {
        api.plotting.clearCanvas(this.canvas);
        return null;
      }
      const regions = Array.from(this.config.regions || []);
      if (this.temporaryRegion) regions.push(this.temporaryRegion);
      return api.plotting.drawTraces(this.canvas, this.timeS, this.series, {
        yLabel: this.config.yLabel,
        view: this.view,
        markers: this.config.markers || [],
        regions,
      });
    }

    _viewport() {
      if (!this.timeS || !this.timeS.length || !this.series.length) return null;
      return api.plotting.traceViewport(
        this.canvas.clientWidth,
        this.canvas.clientHeight,
        this.timeS,
        this.series,
        this.view,
      );
    }

    _position(event) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    _inside(position, viewport) {
      return position.x >= viewport.left && position.x <= viewport.right &&
        position.y >= viewport.top && position.y <= viewport.bottom;
    }

    _nearestMarker(position, viewport) {
      let best = null;
      for (const marker of this.config.markers || []) {
        const value = Number(marker.value);
        if (!Number.isFinite(value)) continue;
        const px = api.plotting.xToPixel(value, viewport);
        const distance = Math.abs(px - position.x);
        if (distance <= 10 && (!best || distance < best.distance)) best = { marker, distance };
      }
      return best && best.marker;
    }

    _wheel(event) {
      const viewport = this._viewport();
      if (!viewport) return;
      const position = this._position(event);
      if (!this._inside(position, viewport)) return;
      event.preventDefault();
      const factor = Math.exp(Math.max(-2, Math.min(2, event.deltaY * 0.0015)));
      const current = this.resolvedView();
      if (event.shiftKey) {
        const anchor = api.plotting.pixelToY(position.y, viewport);
        this.view = Object.freeze(Object.assign({}, current, {
          yMin: anchor + (current.yMin - anchor) * factor,
          yMax: anchor + (current.yMax - anchor) * factor,
        }));
      } else {
        const anchor = api.plotting.pixelToX(position.x, viewport);
        this.view = Object.freeze(Object.assign({}, current, {
          xMin: anchor + (current.xMin - anchor) * factor,
          xMax: anchor + (current.xMax - anchor) * factor,
        }));
      }
      this.draw();
      this._notifyView();
    }

    _pointerDown(event) {
      const viewport = this._viewport();
      if (!viewport) return;
      const position = this._position(event);
      if (!this._inside(position, viewport)) return;

      const marker = this._nearestMarker(position, viewport);
      if (marker) {
        this.drag = { type: "marker", markerId: marker.id };
        this.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      if (this.regionDrawMode) {
        const start = api.plotting.pixelToX(position.x, viewport);
        this.drag = { type: "region", start };
        this.temporaryRegion = { start_s: start, end_s: start, color: "rgba(245,158,11,.22)" };
        this.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      this.drag = {
        type: "pan",
        startPosition: position,
        startView: this.resolvedView(),
      };
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    _pointerMove(event) {
      const viewport = this._viewport();
      if (!viewport) return;
      const position = this._position(event);

      if (!this.drag) {
        this.canvas.style.cursor = this._nearestMarker(position, viewport) ? "ew-resize" : (this.regionDrawMode ? "crosshair" : "grab");
        return;
      }

      if (this.drag.type === "marker") {
        const value = Math.max(viewport.data.xMin, Math.min(viewport.data.xMax, api.plotting.pixelToX(position.x, viewport)));
        if (typeof this.options.onMarkerMove === "function") this.options.onMarkerMove(this.drag.markerId, value, false);
        return;
      }

      if (this.drag.type === "region") {
        const value = Math.max(viewport.data.xMin, Math.min(viewport.data.xMax, api.plotting.pixelToX(position.x, viewport)));
        this.temporaryRegion = {
          start_s: Math.min(this.drag.start, value),
          end_s: Math.max(this.drag.start, value),
          color: "rgba(245,158,11,.22)",
        };
        this.draw();
        return;
      }

      const start = this.drag.startView;
      const dx = position.x - this.drag.startPosition.x;
      const dy = position.y - this.drag.startPosition.y;
      const xShift = -dx / viewport.plotWidth * (start.xMax - start.xMin);
      const yShift = dy / viewport.plotHeight * (start.yMax - start.yMin);
      this.view = Object.freeze({
        xMin: start.xMin + xShift, xMax: start.xMax + xShift,
        yMin: start.yMin + yShift, yMax: start.yMax + yShift,
      });
      this.draw();
      this._notifyView();
    }

    _pointerUp(event) {
      if (!this.drag) return;
      const finished = this.drag;
      this.drag = null;
      try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) {}

      if (finished.type === "marker") {
        const viewport = this._viewport();
        const position = this._position(event);
        if (viewport && typeof this.options.onMarkerMove === "function") {
          const value = Math.max(viewport.data.xMin, Math.min(viewport.data.xMax, api.plotting.pixelToX(position.x, viewport)));
          this.options.onMarkerMove(finished.markerId, value, true);
        }
      } else if (finished.type === "region") {
        const region = this.temporaryRegion;
        this.temporaryRegion = null;
        this.setRegionDrawMode(false);
        if (region && region.end_s - region.start_s > 0 && typeof this.options.onRegionCreate === "function") {
          this.options.onRegionCreate(region.start_s, region.end_s);
        }
      }
      this.canvas.style.cursor = this.regionDrawMode ? "crosshair" : "grab";
    }

    _notifyView() {
      if (typeof this.options.onViewChange === "function") this.options.onViewChange(this.resolvedView());
    }
  }

  api.interactivePlot = Object.freeze({ TracePlotController });
})(typeof window !== "undefined" ? window : globalThis);
