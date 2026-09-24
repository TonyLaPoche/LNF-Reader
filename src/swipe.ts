type Direction = "prev" | "next";

export function trackVerticalSwipe(
  target: Document | HTMLElement,
  onPrev: () => void,
  onNext: () => void,
  canTurn: (direction: Direction) => boolean = () => true,
): () => void {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  const start = (event: Event) => {
    const touch = touchFrom(event, "changedTouches");
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  };

  const move = (event: Event) => {
    if (!tracking) return;
    const touch = touchFrom(event, "touches");
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const direction: Direction = horizontal ? (dx < 0 ? "next" : "prev") : dy < 0 ? "next" : "prev";
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
    if (distance < 56) return;
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

function touchFrom(event: Event, list: "touches" | "changedTouches"): Touch | null {
  const touches = (event as TouchEvent)[list];
  return touches?.[0] ?? null;
}
