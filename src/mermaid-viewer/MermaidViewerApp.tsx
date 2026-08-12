import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { useI18n } from '../shared/i18n'

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const SCALE_STEP = 0.25

type DiagramSize = {
  width: number
  height: number
}

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100))
}

export default function MermaidViewerApp() {
  const { t } = useI18n()
  const [diagram, setDiagram] = useState<MdvMermaidViewerPayload | null>(null)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [diagramSize, setDiagramSize] = useState<DiagramSize | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const diagramRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)

  useEffect(() => window.mdvDesktop?.onMermaidViewerDiagram((payload) => {
    setDiagram(payload)
    setScale(1)
    setDiagramSize(null)
    const viewport = viewportRef.current
    if (viewport) {
      viewport.scrollLeft = 0
      viewport.scrollTop = 0
    }
  }), [])

  useEffect(() => {
    if (!diagram) {
      return
    }

    let active = true
    mermaid.initialize({ startOnLoad: false, theme: diagram.theme === 'dark' ? 'dark' : 'neutral' })
    mermaid.render(`mermaid-viewer-${crypto.randomUUID()}`, diagram.code)
      .then((result) => {
        if (active) {
          setSvg(result.svg)
          setError(null)
        }
      })
      .catch((renderError: unknown) => {
        if (active) {
          setSvg('')
          setError(renderError instanceof Error ? renderError.message : 'Render failed')
        }
      })

    return () => {
      active = false
    }
  }, [diagram])

  useLayoutEffect(() => {
    const renderedSvg = diagramRef.current?.querySelector('svg')
    if (!renderedSvg) {
      setDiagramSize(null)
      return
    }

    const viewBox = renderedSvg.viewBox.baseVal
    const bounds = renderedSvg.getBoundingClientRect()
    const width = viewBox.width > 0 ? viewBox.width : bounds.width
    const height = viewBox.height > 0 ? viewBox.height : bounds.height
    setDiagramSize({
      width: Math.max(1, width),
      height: Math.max(1, height),
    })
  }, [svg])

  function adjustScale(delta: number) {
    setScale((current) => clampScale(current + delta))
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      return
    }
    event.preventDefault()
    adjustScale(event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current
    if (!viewport || event.button !== 0) {
      return
    }
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    }
    viewport.setPointerCapture(event.pointerId)
    viewport.dataset.dragging = 'true'
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current
    const drag = dragRef.current
    if (!viewport || !drag || drag.pointerId !== event.pointerId) {
      return
    }
    viewport.scrollLeft = drag.left - (event.clientX - drag.x)
    viewport.scrollTop = drag.top - (event.clientY - drag.y)
  }

  function stopDragging(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current
    if (dragRef.current?.pointerId !== event.pointerId) {
      return
    }
    dragRef.current = null
    if (viewport) {
      delete viewport.dataset.dragging
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId)
      }
    }
  }

  return (
    <main className="mermaid-viewer-shell">
      <header className="mermaid-viewer-toolbar">
        <strong>{t.mermaidViewer.title}</strong>
        <div className="mermaid-viewer-controls" role="group" aria-label={t.mermaidViewer.zoom}>
          <button type="button" onClick={() => adjustScale(-SCALE_STEP)} disabled={scale <= MIN_SCALE} aria-label={t.mermaidViewer.zoomOut}>−</button>
          <button type="button" onClick={() => setScale(1)} aria-label={t.mermaidViewer.resetZoom}>{Math.round(scale * 100)}%</button>
          <button type="button" onClick={() => adjustScale(SCALE_STEP)} disabled={scale >= MAX_SCALE} aria-label={t.mermaidViewer.zoomIn}>＋</button>
        </div>
      </header>
      <div
        ref={viewportRef}
        className="mermaid-viewer-viewport"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {error ? <pre className="mermaid-viewer-error">{error}</pre> : null}
        {!diagram ? <p className="mermaid-viewer-empty">{t.mermaidViewer.waiting}</p> : null}
        {svg ? (
          <div
            className="mermaid-viewer-canvas"
            style={diagramSize ? {
              width: `${diagramSize.width * scale}px`,
              height: `${diagramSize.height * scale}px`,
            } : undefined}
          >
            <div
              ref={diagramRef}
              className="mermaid-viewer-diagram"
              style={diagramSize ? {
                width: `${diagramSize.width}px`,
                height: `${diagramSize.height}px`,
                transform: `scale(${scale})`,
              } : undefined}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        ) : null}
      </div>
    </main>
  )
}
