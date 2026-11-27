import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";

interface CustomScrollbarProps {
  targetRef: RefObject<HTMLElement | null>;
  label: string;
}

interface ScrollbarGeometry {
  visible: boolean;
  thumbHeight: number;
  thumbTop: number;
  travel: number;
  maxScroll: number;
  percent: number;
}

const EMPTY_GEOMETRY: ScrollbarGeometry = {
  visible: false,
  thumbHeight: 0,
  thumbTop: 0,
  travel: 0,
  maxScroll: 0,
  percent: 0,
};

export function CustomScrollbar({ targetRef, label }: CustomScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<() => void>(() => {});
  const dragRef = useRef<{ startY: number; startScroll: number } | null>(null);
  const [geometry, setGeometry] = useState<ScrollbarGeometry>(EMPTY_GEOMETRY);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const measure = () => {
      const trackHeight = Math.max(0, target.clientHeight - 8);
      const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
      const ratio =
        target.scrollHeight > 0 ? target.clientHeight / target.scrollHeight : 1;
      const thumbHeight = Math.min(trackHeight, Math.max(28, trackHeight * ratio));
      const travel = Math.max(0, trackHeight - thumbHeight);
      const thumbTop =
        maxScroll > 0 && travel > 0 ? (target.scrollTop / maxScroll) * travel : 0;

      setGeometry({
        visible: maxScroll > 1 && trackHeight > 0,
        thumbHeight,
        thumbTop,
        travel,
        maxScroll,
        percent: maxScroll > 0 ? Math.round((target.scrollTop / maxScroll) * 100) : 0,
      });
    };

    measureRef.current = measure;
    measure();
    target.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const settle = window.requestAnimationFrame(measure);

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(target);
    const observed = new Set<Element>();
    const observeTree = () => {
      for (const node of Array.from(target.querySelectorAll("*"))) {
        if (observed.has(node)) continue;
        observed.add(node);
        resizeObserver.observe(node);
      }
    };
    observeTree();

    const mutationObserver = new MutationObserver(() => {
      observeTree();
      measure();
    });
    mutationObserver.observe(target, { childList: true, subtree: true });

    void document.fonts?.ready.then(measure);

    return () => {
      window.cancelAnimationFrame(settle);
      target.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [targetRef]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = targetRef.current;
    const track = trackRef.current;
    if (!target || !track || !geometry.visible || event.button !== 0) return;

    event.preventDefault();
    const trackRect = track.getBoundingClientRect();
    const isThumb = (event.target as HTMLElement).closest(".custom-scrollbar-thumb");

    if (isThumb && geometry.travel > 0) {
      dragRef.current = { startY: event.clientY, startScroll: target.scrollTop };
      setDragging(true);
      track.setPointerCapture(event.pointerId);
      return;
    }

    if (geometry.travel > 0) {
      const offset = Math.min(
        geometry.travel,
        Math.max(0, event.clientY - trackRect.top - geometry.thumbHeight / 2),
      );
      target.scrollTop = (offset / geometry.travel) * geometry.maxScroll;
      measureRef.current();
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = targetRef.current;
    const drag = dragRef.current;
    if (!target || !drag || geometry.travel <= 0) return;
    const delta = event.clientY - drag.startY;
    target.scrollTop = drag.startScroll + (delta / geometry.travel) * geometry.maxScroll;
    measureRef.current();
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const target = targetRef.current;
    if (!target) return;
    target.scrollTop += event.deltaY;
    measureRef.current();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = targetRef.current;
    if (!target) return;
    const page = target.clientHeight * 0.9;

    switch (event.key) {
      case "ArrowDown":
        target.scrollTop += 40;
        break;
      case "ArrowUp":
        target.scrollTop -= 40;
        break;
      case "PageDown":
        target.scrollTop += page;
        break;
      case "PageUp":
        target.scrollTop -= page;
        break;
      case "Home":
        target.scrollTop = 0;
        break;
      case "End":
        target.scrollTop = target.scrollHeight;
        break;
      default:
        return;
    }
    measureRef.current();
    event.preventDefault();
  };

  return (
    <div
      ref={trackRef}
      className={`custom-scrollbar${geometry.visible ? " is-visible" : ""}${
        dragging ? " is-dragging" : ""
      }`}
      role="scrollbar"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={geometry.percent}
      tabIndex={geometry.visible ? 0 : -1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <span
        className="custom-scrollbar-thumb"
        style={
          {
            height: geometry.thumbHeight,
            "--thumb-top": `${geometry.thumbTop}px`,
          } as CSSProperties
        }
      />
    </div>
  );
}
