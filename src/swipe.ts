type Direction = "prev" | "next";

export function trackVerticalSwipe(
  target: Document | HTMLElement,
  onPrev: () => void,
  onNext: () => void,
  canTurn: (direction: Direction) => boolean = () => true,
  allowTurn: () => boolean = () => true,
): () => void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const start = (event: Event) => {
    if (touchCount(event) > 1) {
      tracking = false;
      return;
    }
    const touch = touchFrom(event, "changedTouches");
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  };

  const move = (event: Event) => {
    if (touchCount(event) > 1) {
      tracking = false;
      return;
    }
    if (!tracking) return;
    const touch = touchFrom(event, "touches");
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const direction: Direction = horizontal ? (dx < 0 ? "next" : "prev") : dy < 0 ? "next" : "prev";
    if (!allowTurn()) return;
    const turning = horizontal || canTurn(direction);
    if (turning && (horizontal ? Math.abs(dx) : Math.abs(dy)) > 18) event.preventDefault();
  };

  const end = (event: Event) => {
    if (!tracking) return;
    tracking = false;
    const touch = touchFrom(event, "changedTouches");
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const distance = horizontal ? Math.abs(dx) : Math.abs(dy);
    if (!allowTurn() || distance < 56) return;
    const direction: Direction = horizontal ? (dx < 0 ? "next" : "prev") : dy < 0 ? "next" : "prev";
    if (!horizontal && !canTurn(direction)) return;
    if (direction === "next") onNext();
    else onPrev();
  };

  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: false });
  target.addEventListener("touchend", end);

  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
  };
}

export function trackpadSwipe(
  target: HTMLElement,
  onPrev: () => void,
  onNext: () => void,
): () => void {
  let accum = 0;
  let consumed = false;
  let quietTimer = 0;

  const onWheel = (event: Event) => {
    const wheel = event as WheelEvent;
    if (wheel.ctrlKey) return;
    const scale = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? window.innerWidth : 1;
    const dx = wheel.deltaX * scale;
    const dy = wheel.deltaY * scale;
    if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 2) return;
    event.preventDefault();
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(() => {
      accum = 0;
      consumed = false;
    }, 280);
    if (consumed) return;
    accum += dx;
    if (Math.abs(accum) < 40) return;
    consumed = true;
    if (accum > 0) onNext();
    else onPrev();
    accum = 0;
  };

  target.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    window.clearTimeout(quietTimer);
    target.removeEventListener("wheel", onWheel);
  };
}

export type ImageView = { scale: number; x: number; y: number };

export function trackZoomPan(
  target: HTMLElement,
  getView: () => ImageView,
  setView: (view: ImageView) => void,
  metrics: () => { width: number; height: number; viewWidth: number; viewHeight: number },
  allow: () => boolean = () => true,
): () => void {
  let mode: "none" | "pending" | "pan" | "pinch" = "none";
  let startX = 0;
  let startY = 0;
  let origin: ImageView = { scale: 1, x: 0, y: 0 };
  let startDist = 0;

  const clamp = (next: ImageView): ImageView => {
    const { width, height, viewWidth, viewHeight } = metrics();
    const scale = Math.min(4, Math.max(1, next.scale));
    const minX = Math.min(0, viewWidth - width * scale);
    const minY = Math.min(0, viewHeight - height * scale);
    return {
      scale,
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    };
  };

  const start = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (!touches || !allow()) {
      mode = "none";
      return;
    }
    origin = getView();
    if (touches.length === 2) {
      startDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      startX = (touches[0].clientX + touches[1].clientX) / 2;
      startY = (touches[0].clientY + touches[1].clientY) / 2;
      mode = startDist > 8 ? "pinch" : "none";
      return;
    }
    if (touches.length === 1) {
      startX = touches[0].clientX;
      startY = touches[0].clientY;
      mode = "pending";
    }
  };

  const move = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (!touches || mode === "none") return;
    const bounds = target.getBoundingClientRect();
    if (mode === "pinch" && touches.length >= 2) {
      event.preventDefault();
      const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      const midX = (touches[0].clientX + touches[1].clientX) / 2 - bounds.left;
      const midY = (touches[0].clientY + touches[1].clientY) / 2 - bounds.top;
      const startMidX = startX - bounds.left;
      const startMidY = startY - bounds.top;
      const scale = Math.min(4, Math.max(1, origin.scale * (dist / startDist)));
      const factor = scale / origin.scale;
      setView(clamp({
        scale,
        x: midX - (startMidX - origin.x) * factor,
        y: midY - (startMidY - origin.y) * factor,
      }));
      return;
    }
    if (mode === "pending" && touches.length === 1) {
      const dx = touches[0].clientX - startX;
      const dy = touches[0].clientY - startY;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const size = metrics();
      const overflows = origin.scale > 1.02 || size.height * origin.scale > size.viewHeight + 4;
      if (overflows && (origin.scale > 1.02 || Math.abs(dy) >= Math.abs(dx))) mode = "pan";
      else mode = "none";
    }
    if (mode === "pan" && touches.length === 1) {
      event.preventDefault();
      setView(clamp({
        scale: origin.scale,
        x: origin.x + touches[0].clientX - startX,
        y: origin.y + touches[0].clientY - startY,
      }));
    }
  };

  const end = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (touches && touches.length > 0) return;
    mode = "none";
  };

  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: false });
  target.addEventListener("touchend", end);
  target.addEventListener("touchcancel", end);
  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", end);
  };
}

export function applyImageView(element: HTMLElement, view: ImageView): void {
  element.style.transformOrigin = "0 0";
  element.style.transform = view.scale === 1 && view.x === 0 && view.y === 0
    ? ""
    : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

export function trackPinch(
  target: HTMLElement,
  onRatio: (ratio: number, done: boolean) => void,
  allow: () => boolean = () => true,
): () => void {
  let startDist = 0;
  let lastRatio = 1;
  let pinching = false;

  const distance = (touches: TouchList) => {
    const a = touches[0];
    const b = touches[1];
    if (!a || !b) return 0;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const start = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (!touches || touches.length !== 2 || !allow()) {
      pinching = false;
      return;
    }
    startDist = distance(touches);
    lastRatio = 1;
    pinching = startDist > 8;
  };

  const move = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (!pinching || !touches || touches.length < 2) return;
    event.preventDefault();
    lastRatio = distance(touches) / startDist;
    onRatio(lastRatio, false);
  };

  const end = (event: Event) => {
    if (!pinching) return;
    const touches = (event as TouchEvent).touches;
    if (touches && touches.length >= 2) return;
    pinching = false;
    onRatio(lastRatio, true);
    lastRatio = 1;
  };

  target.addEventListener("touchstart", start, { passive: true });
  target.addEventListener("touchmove", move, { passive: false });
  target.addEventListener("touchend", end);
  target.addEventListener("touchcancel", end);
  return () => {
    target.removeEventListener("touchstart", start);
    target.removeEventListener("touchmove", move);
    target.removeEventListener("touchend", end);
    target.removeEventListener("touchcancel", end);
  };
}

function touchCount(event: Event): number {
  return (event as TouchEvent).touches?.length ?? 0;
}

function touchFrom(event: Event, list: "touches" | "changedTouches"): Touch | null {
  const touches = (event as TouchEvent)[list];
  return touches?.[0] ?? null;
}
