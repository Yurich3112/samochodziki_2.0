// Mouse interaction for the track editor: draw, eraser, hover preview.

export class TrackEditor {
  constructor(canvas, track, opts = {}) {
    this.canvas = canvas;
    this.track = track;
    this.tool = 'draw';
    this.enabled = true;
    this.brushSize = opts.brushSize ?? 90;
    this.minSampleDist = 4;

    this.drawing = false;
    this.erasing = false;
    this.activePointerId = null;
    this.currentPoints = [];
    this.cursor = null;          // last known cursor position (for hover preview)
    this.hoveredStroke = null;   // stroke under cursor while in eraser mode

    // After drawing one stroke the user must simulate or clear before drawing another.
    this.strokeCommitted = false;

    this._onChange = opts.onChange ?? (() => {});

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup',   e => this._up(e));
    canvas.addEventListener('pointercancel', e => this._up(e));
    canvas.addEventListener('pointerleave', e => this._leave(e));
  }

  setTool(tool) {
    this.tool = tool;
    this.canvas.parentElement?.classList.toggle('eraser', tool === 'eraser');
    this._onChange();
  }

  setBrushSize(px) { this.brushSize = px; this._onChange(); }

  /** Call when the track is cleared or reset so the user can draw again. */
  resetCommit() {
    this.strokeCommitted = false;
    this._onChange();
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.activePointerId = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this._pos(e);

    // Right-click is always an eraser shortcut, regardless of selected tool.
    if (e.button === 2 || this.tool === 'eraser') {
      this.erasing = true;
      const removed = this.track.removeStrokeAt(p.x, p.y);
      if (removed) {
        // After erasing, allow drawing again since the track changed.
        this.strokeCommitted = this.track.strokes.length > 0;
        this._onChange();
      }
      return;
    }

    // Block drawing if a stroke was already committed.
    if (this.strokeCommitted) return;

    this.drawing = true;
    this.currentPoints = [p];
    this._onChange();
  }

  _move(e) {
    if (!this.enabled) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    e.preventDefault();
    const p = this._pos(e);
    this.cursor = p;

    if (this.drawing) {
      const last = this.currentPoints[this.currentPoints.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= this.minSampleDist) {
        this.currentPoints.push(p);
        this._onChange();
      }
      return;
    }

    if (this.erasing) {
      const removed = this.track.removeStrokeAt(p.x, p.y);
      if (removed) {
        this.strokeCommitted = this.track.strokes.length > 0;
        this._onChange();
      }
      return;
    }

    if (this.tool === 'eraser') {
      const s = this.track.pickStrokeAt(p.x, p.y);
      if (s !== this.hoveredStroke) {
        this.hoveredStroke = s;
        this._onChange();
      } else {
        this._onChange(); // still update for cursor halo movement
      }
    } else {
      this._onChange();
    }
  }

  _up() {
    if (!this.enabled) return;
    this.activePointerId = null;
    this.erasing = false;
    if (!this.drawing) return;
    this.drawing = false;
    if (this.currentPoints.length >= 2) {
      this.track.addStroke(this.currentPoints, this.brushSize);
      this.strokeCommitted = true;   // lock drawing until clear/simulate
    }
    this.currentPoints = [];
    this._onChange();
  }

  _leave() {
    if (!this.enabled) return;
    this._up();
    this.cursor = null;
    this.hoveredStroke = null;
    this._onChange();
  }
}
