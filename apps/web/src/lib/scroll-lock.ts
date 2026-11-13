/**
 * Stops the page behind a window (side panel, file viewer, bank tracker) from scrolling while it is open.
 *
 * Counted, not saved-and-restored: two windows can be open at once (a panel over a panel) and close in any
 * order. Each remembering "what the page's overflow was when I opened" left the page locked when the first
 * to open was the first to close: the second then "restored" the lock. The page scrolls again when the last
 * one closes.
 */
let open = 0;
let before = "";

/** Lock the page's scroll; call the returned function once when the window closes. */
export function lockScroll(): () => void {
  if (open === 0) {
    before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  open += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open -= 1;
    if (open === 0) document.body.style.overflow = before;
  };
}
