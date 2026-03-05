import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, SyntheticEvent } from "react";

type UseCvIframePreviewOptions = {
  containerRef: RefObject<HTMLDivElement>;
  sourceUrl?: string | null;
  paddingPx?: number;
  enabled?: boolean;
  defaultHeight?: string;
};

type UseCvIframePreviewResult = {
  scale: number;
  iframeHeight: string;
  iframeReady: boolean;
  handleIframeLoad: (e: SyntheticEvent<HTMLIFrameElement>) => void;
};

const CV_WIDTH_PX = 794;

function getMeasuredHeight(iframe: HTMLIFrameElement): number {
  const doc = iframe.contentWindow?.document;
  if (!doc) return 0;

  const body = doc.body;
  const html = doc.documentElement;
  if (!body || !html) return 0;

  return Math.max(
    body.scrollHeight,
    body.offsetHeight,
    html.clientHeight,
    html.scrollHeight,
    html.offsetHeight
  );
}

function applyPreviewStyles(iframe: HTMLIFrameElement) {
  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  const styleId = "__cv_preview_iframe_styles";
  if (doc.getElementById(styleId)) return;

  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `
    html, body {
      margin: 0 !important;
      overflow-x: hidden !important;
    }
  `;
  doc.head?.appendChild(style);
}

export function useCvIframePreview({
  containerRef,
  sourceUrl = null,
  paddingPx = 0,
  enabled = true,
  defaultHeight = "297mm",
}: UseCvIframePreviewOptions): UseCvIframePreviewResult {
  const [scale, setScale] = useState(1);
  const [iframeHeight, setIframeHeight] = useState(defaultHeight);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeWatchCleanupRef = useRef<(() => void) | null>(null);
  const measuredHeightRef = useRef(0);

  const scaleDepsKey = useMemo(
    () => `${enabled ? 1 : 0}:${paddingPx}:${sourceUrl || ""}`,
    [enabled, paddingPx, sourceUrl]
  );

  useEffect(() => {
    if (!enabled) return;

    const updateScale = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.offsetWidth;
      const availableWidth = Math.max(0, containerWidth - paddingPx);
      setScale(availableWidth < CV_WIDTH_PX ? availableWidth / CV_WIDTH_PX : 1);
    };

    updateScale();
    const raf = window.requestAnimationFrame(updateScale);
    const timer = window.setTimeout(updateScale, 120);

    window.addEventListener("resize", updateScale);

    let observer: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => updateScale());
      observer.observe(containerRef.current);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateScale);
      observer?.disconnect();
    };
  }, [containerRef, scaleDepsKey, paddingPx, enabled]);

  useEffect(() => {
    if (!enabled) return;
    setIframeReady(false);
    setIframeHeight(defaultHeight);
    measuredHeightRef.current = 0;
    iframeWatchCleanupRef.current?.();
    iframeWatchCleanupRef.current = null;
  }, [enabled, sourceUrl, defaultHeight]);

  useEffect(() => {
    return () => {
      iframeWatchCleanupRef.current?.();
      iframeWatchCleanupRef.current = null;
    };
  }, []);

  const handleIframeLoad = useCallback((e: SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = e.currentTarget;

    try {
      applyPreviewStyles(iframe);

      const measureAndCommit = () => {
        const height = getMeasuredHeight(iframe);
        if (height > 0) {
          const nextHeight = Math.ceil(height);
          if (nextHeight > measuredHeightRef.current) {
            measuredHeightRef.current = nextHeight;
            setIframeHeight(`${nextHeight}px`);
          }
        }
        setIframeReady(true);
      };

      iframeWatchCleanupRef.current?.();
      iframeWatchCleanupRef.current = null;

      const iframeWindow = iframe.contentWindow;
      const doc = iframeWindow?.document;
      if (iframeWindow && doc && typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          window.requestAnimationFrame(measureAndCommit);
        });
        observer.observe(doc.documentElement);
        if (doc.body) observer.observe(doc.body);

        const onIframeResize = () => window.requestAnimationFrame(measureAndCommit);
        iframeWindow.addEventListener("resize", onIframeResize);

        iframeWatchCleanupRef.current = () => {
          observer.disconnect();
          iframeWindow.removeEventListener("resize", onIframeResize);
        };
      }

      window.requestAnimationFrame(measureAndCommit);
      window.setTimeout(measureAndCommit, 120);
      window.setTimeout(measureAndCommit, 420);

      const fonts = iframe.contentWindow?.document?.fonts;
      if (fonts?.ready) {
        fonts.ready
          .then(() => {
            window.requestAnimationFrame(measureAndCommit);
          })
          .catch(() => {
            setIframeReady(true);
          });
      }
    } catch (err) {
      console.error("Could not access iframe content for preview sizing:", err);
      setIframeHeight(defaultHeight);
      setIframeReady(true);
    }
  }, [defaultHeight]);

  return { scale, iframeHeight, iframeReady, handleIframeLoad };
}
