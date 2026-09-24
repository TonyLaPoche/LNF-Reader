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
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) event.preventDefault();
  };

  const end = (event: Event) => {
    if (!tracking) return;
    tracking = false;
    const touch = touchFrom(event, "changedTouches");
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dy) < 56 || Math.abs(dy) < Math.abs(dx)) return;
    const direction: Direction = dy < 0 ? "next" : "prev";
    if (!canTurn(direction)) return;
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

function touchFrom(event: Event, list: "touches" | "changedTouches"): Touch | null {
  if (!(event instanceof TouchEvent)) return null;
  return event[list][0] ?? null;
}
