import { useEffect, useRef } from "react";

const BAR_COUNT = 14;

interface AudioVisualizerProps {
  getAnalyser: () => AnalyserNode | null;
}

export function AudioVisualizer({ getAnalyser }: AudioVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const analyser = getAnalyser();
    if (!container || !analyser) return;

    const bars = Array.from(container.children) as HTMLElement[];
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const levels = new Float32Array(BAR_COUNT);
    const usable = Math.floor(bins.length * 0.62);
    const edges = Array.from({ length: BAR_COUNT + 1 }, (_, index) =>
      Math.floor(Math.pow(index / BAR_COUNT, 1.9) * usable),
    );
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let gain = 1;
    let frame = 0;

    const render = () => {
      analyser.getByteFrequencyData(bins);
      let loudest = 0;
      for (let index = 0; index < BAR_COUNT; index += 1) {
        const from = edges[index];
        const to = Math.max(from + 1, edges[index + 1]);
        let sum = 0;
        for (let bin = from; bin < to; bin += 1) sum += bins[bin];
        const tilt = 0.78 + (index / BAR_COUNT) * 0.85;
        levels[index] = Math.min(1, Math.pow(sum / (to - from) / 255, 1.45) * tilt);
        loudest = Math.max(loudest, levels[index]);
      }

      if (loudest > 0.035) {
        gain += (Math.min(5, 0.82 / loudest) - gain) * 0.06;
      } else {
        gain += (1 - gain) * 0.02;
      }

      for (let index = 0; index < BAR_COUNT; index += 1) {
        bars[index].style.setProperty("--level", Math.min(1, levels[index] * gain).toFixed(3));
      }
      if (!reduceMotion) frame = window.requestAnimationFrame(render);
    };

    render();
    return () => window.cancelAnimationFrame(frame);
  }, [getAnalyser]);

  return (
    <div className="audio-visualizer" aria-hidden="true" ref={containerRef}>
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
