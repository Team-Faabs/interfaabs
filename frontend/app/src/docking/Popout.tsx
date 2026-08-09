// Panel pop-outs.
//
// A popped panel stays part of the same React tree and is portalled into a
// child window, rather than being re-rooted there. That keeps one store, one
// config and one theme: a pop-out is a second viewport onto the same
// application, not a second application.

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PopoutWindow({
  title,
  themeKey,
  onClose,
  children,
}: {
  title: string
  /** Changing this re-copies the host document's theme variables. */
  themeKey: string
  onClose: () => void
  children: ReactNode
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [popup, setPopup] = useState<Window | null>(null)

  useEffect(() => {
    const child = window.open('', '', 'width=760,height=580')
    if (!child) {
      // Blocked by the popup blocker; fall back to the docked panel rather
      // than leaving the operator with a tab that renders nothing.
      onClose()
      return
    }

    child.document.title = title
    const mount = child.document.createElement('div')
    mount.className = 'popout-root'
    child.document.body.appendChild(mount)
    child.document.body.style.margin = '0'

    const beforeUnload = () => onClose()
    child.addEventListener('beforeunload', beforeUnload)
    // The opener closing must not leave an orphaned window behind.
    const closeOnExit = () => child.close()
    window.addEventListener('beforeunload', closeOnExit)

    setPopup(child)
    setContainer(mount)

    return () => {
      child.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('beforeunload', closeOnExit)
      child.close()
      setContainer(null)
      setPopup(null)
    }
    // Deliberately keyed only on identity: re-running this would flicker the
    // window closed and open again on every title or theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stylesheets and the theme's custom properties live on the host document,
  // so they are copied across and refreshed whenever the theme changes.
  useEffect(() => {
    if (!popup) return
    popup.document.head.replaceChildren()
    for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      popup.document.head.appendChild(node.cloneNode(true))
    }
    const source = document.documentElement
    popup.document.documentElement.setAttribute(
      'style',
      source.getAttribute('style') ?? '',
    )
    popup.document.documentElement.dataset.theme = source.dataset.theme ?? ''
    popup.document.documentElement.dataset.shell = source.dataset.shell ?? ''
    popup.document.body.style.background = 'var(--app-bg)'
    popup.document.body.style.color = 'var(--text)'
  }, [popup, themeKey])

  useEffect(() => {
    if (popup) popup.document.title = title
  }, [popup, title])

  return container ? createPortal(children, container) : null
}
