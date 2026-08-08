import { useEffect, type RefObject } from 'react'

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus(open: boolean, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      const first = containerRef.current?.querySelector<HTMLElement>('[data-autofocus], button:not([disabled]), input:not([disabled])')
      first?.focus()
    })

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !containerRef.current) return
      const controls = [...containerRef.current.querySelectorAll<HTMLElement>(focusableSelector)].filter((item) => item.offsetParent !== null)
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInside)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', keepFocusInside)
      previous?.focus()
    }
  }, [containerRef, open])
}
