import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'

type LensCursorProps = {
  targetRef: RefObject<HTMLElement>
  contentRef?: RefObject<HTMLElement>
  magnifyContent?: ReactNode
  size?: number
  zoom?: number
  enabled?: boolean
}

export function LensCursor({
  targetRef,
  contentRef,
  magnifyContent,
  size = 160,
  zoom = 2,
  enabled = true,
}: LensCursorProps) {
  const lensRef = useRef<HTMLDivElement>(null)
  const magRef = useRef<HTMLDivElement>(null)
  const [mediaReady, setMediaReady] = useState(false)

  useEffect(() => {
    const queries = [
      window.matchMedia('(prefers-reduced-motion: reduce)'),
      window.matchMedia('(hover: none), (pointer: coarse)'),
      window.matchMedia('(max-width: 899px)'),
    ]
    const evaluate = () => setMediaReady(queries.every((query) => !query.matches))
    evaluate()
    queries.forEach((query) => query.addEventListener('change', evaluate))
    return () => {
      queries.forEach((query) => query.removeEventListener('change', evaluate))
    }
  }, [])

  useEffect(() => {
    const target = targetRef.current
    const lens = lensRef.current
    if (!target || !lens || !enabled || !mediaReady) return

    const radius = size / 2
    const goal = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }
    const contentBox = { ox: 0, oy: 0, width: 0 }
    const state = { visible: false, pressed: false }
    let scale = 0.85
    let rafId = 0
    let looping = false

    const measure = () => {
      const targetRect = target.getBoundingClientRect()
      const contentRect = (contentRef?.current ?? target).getBoundingClientRect()
      contentBox.ox = contentRect.left - targetRect.left
      contentBox.oy = contentRect.top - targetRect.top
      contentBox.width = contentRect.width
      if (magRef.current) {
        magRef.current.style.width = `${contentRect.width}px`
      }
    }

    const render = () => {
      current.x += (goal.x - current.x) * 0.22
      current.y += (goal.y - current.y) * 0.22
      const targetScale = !state.visible ? 0.85 : state.pressed ? 0.92 : 1
      scale += (targetScale - scale) * 0.2
      lens.style.transform = `translate3d(${current.x - radius}px, ${
        current.y - radius
      }px, 0) scale(${scale.toFixed(4)})`

      const mag = magRef.current
      if (mag && magnifyContent) {
        const tx = radius - zoom * (current.x - contentBox.ox)
        const ty = radius - zoom * (current.y - contentBox.oy)
        mag.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${zoom})`
      }

      if (looping) rafId = requestAnimationFrame(render)
    }

    const start = () => {
      if (looping) return
      looping = true
      rafId = requestAnimationFrame(render)
    }

    const stop = () => {
      looping = false
      cancelAnimationFrame(rafId)
      rafId = 0
    }

    const onMove = (event: MouseEvent) => {
      const rect = target.getBoundingClientRect()
      goal.x = event.clientX - rect.left
      goal.y = event.clientY - rect.top
    }

    const onEnter = (event: MouseEvent) => {
      measure()
      const rect = target.getBoundingClientRect()
      current.x = event.clientX - rect.left
      current.y = event.clientY - rect.top
      goal.x = current.x
      goal.y = current.y
      state.visible = true
      state.pressed = false
      scale = 0.85
      lens.classList.add('is-visible')
      target.classList.add('is-lens-active')
      start()
    }

    const onLeave = () => {
      state.visible = false
      state.pressed = false
      lens.classList.remove('is-visible')
      target.classList.remove('is-lens-active')
      stop()
      scale = 0.85
      lens.style.transform = `translate3d(${current.x - radius}px, ${
        current.y - radius
      }px, 0) scale(0.85)`
    }

    const onDown = () => {
      state.pressed = true
    }
    const onUp = () => {
      state.pressed = false
    }
    const onScroll = () => {
      if (state.visible) measure()
    }

    target.addEventListener('mouseenter', onEnter)
    target.addEventListener('mousemove', onMove)
    target.addEventListener('mouseleave', onLeave)
    target.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', onScroll, true)

    return () => {
      target.removeEventListener('mouseenter', onEnter)
      target.removeEventListener('mousemove', onMove)
      target.removeEventListener('mouseleave', onLeave)
      target.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', onScroll, true)
      stop()
      lens.classList.remove('is-visible')
      target.classList.remove('is-lens-active')
    }
  }, [targetRef, contentRef, enabled, size, zoom, magnifyContent, mediaReady])

  return (
    <div ref={lensRef} className="auth-lens" style={{ width: size, height: size }} aria-hidden="true">
      {magnifyContent ? (
        <div className="auth-lens__mag" ref={magRef}>
          {magnifyContent}
        </div>
      ) : null}
      <span className="auth-lens__dot" />
    </div>
  )
}
