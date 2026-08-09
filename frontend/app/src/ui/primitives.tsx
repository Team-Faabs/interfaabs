import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react'

import './primitives.css'

type Tone = 'default' | 'accent' | 'danger' | 'warn' | 'ghost'

export function Button({
  tone = 'default',
  size = 'md',
  className = '',
  ...rest
}: ComponentProps<'button'> & {
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
}) {
  return <button className={`ui-btn ui-btn--${tone} ui-btn--${size} ${className}`} {...rest} />
}

export function IconButton({ className = '', ...rest }: ComponentProps<'button'>) {
  return <button className={`ui-iconbtn ${className}`} {...rest} />
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
  disabled?: boolean
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className={`ui-seg ui-seg--${size}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          title={option.title}
          disabled={option.disabled}
          className={option.value === value ? 'on' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  hint?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label className={`ui-toggle ${disabled ? 'is-disabled' : ''}`} htmlFor={id} title={hint}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="ui-toggle-track" aria-hidden="true">
        <span className="ui-toggle-knob" />
      </span>
      <span className="ui-toggle-label">{label}</span>
    </label>
  )
}

export function Field({
  label,
  children,
  hint,
  wide,
}: {
  label: ReactNode
  children: ReactNode
  hint?: string
  wide?: boolean
}) {
  return (
    <label className={`ui-field ${wide ? 'ui-field--wide' : ''}`} title={hint}>
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  )
}

export function TextInput({ className = '', ...rest }: ComponentProps<'input'>) {
  return <input className={`ui-input ${className}`} {...rest} />
}

export function Select({
  className = '',
  children,
  ...rest
}: ComponentProps<'select'>) {
  return (
    <select className={`ui-select ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function StatusDot({
  tone,
  title,
}: {
  tone: 'ok' | 'warn' | 'error' | 'idle'
  title?: string
}) {
  return <span className={`ui-dot ui-dot--${tone}`} title={title} />
}

export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="ui-empty">
      <b>{title}</b>
      {hint && <span>{hint}</span>}
    </div>
  )
}

export function SectionTitle({
  children,
  aside,
}: {
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="ui-section-title">
      <span>{children}</span>
      {aside && <i>{aside}</i>}
    </div>
  )
}

export function Disclosure({
  title,
  aside,
  defaultOpen = true,
  children,
}: {
  title: ReactNode
  aside?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`ui-disclosure ${open ? 'is-open' : ''}`}>
      <button className="ui-disclosure-head" onClick={() => setOpen((value) => !value)}>
        <span className="ui-caret">{open ? '▾' : '▸'}</span>
        <span className="ui-disclosure-title">{title}</span>
        {aside && <i>{aside}</i>}
      </button>
      {open && <div className="ui-disclosure-body">{children}</div>}
    </div>
  )
}

export function useOutsideClick<T extends HTMLElement>(
  active: boolean,
  onOutside: () => void,
) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!active) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOutside()
    }
    // `capture` so a click inside another popover still closes this one.
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('keydown', key)
    }
  }, [active, onOutside])
  return ref
}

export function Popover({
  open,
  onClose,
  anchor,
  align = 'start',
  children,
  width,
}: {
  open: boolean
  onClose: () => void
  anchor: HTMLElement | null
  align?: 'start' | 'end'
  children: ReactNode
  width?: number
}) {
  const ref = useOutsideClick<HTMLDivElement>(open, onClose)
  const [style, setStyle] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const rect = anchor.getBoundingClientRect()
    const panelWidth = width ?? 280
    const left =
      align === 'end'
        ? Math.max(8, rect.right - panelWidth)
        : Math.min(window.innerWidth - panelWidth - 8, rect.left)
    setStyle({
      top: Math.min(window.innerHeight - 40, rect.bottom + 6),
      left,
      width: panelWidth,
      maxHeight: window.innerHeight - rect.bottom - 24,
    })
  }, [open, anchor, align, width])

  if (!open) return null
  return (
    <div className="ui-popover" style={style} ref={ref} role="dialog">
      {children}
    </div>
  )
}

export interface MenuItem {
  id: string
  label: ReactNode
  hint?: string
  disabled?: boolean
  danger?: boolean
  onSelect?: () => void
  separatorBefore?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useOutsideClick<HTMLDivElement>(true, onClose)
  const [style, setStyle] = useState<CSSProperties>({ top: y, left: x, visibility: 'hidden' })

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setStyle({
      top: Math.min(y, window.innerHeight - rect.height - 8),
      left: Math.min(x, window.innerWidth - rect.width - 8),
      visibility: 'visible',
    })
  }, [x, y, ref])

  return (
    <div className="ui-menu" style={style} ref={ref} role="menu">
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="ui-menu-sep" />}
          <button
            role="menuitem"
            className={`ui-menu-item ${item.danger ? 'is-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.()
              onClose()
            }}
          >
            <span>{item.label}</span>
            {item.hint && <i>{item.hint}</i>}
          </button>
        </div>
      ))}
    </div>
  )
}

/** Copies text and reports success for a moment, for the debug token. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => setCopied(false))
  }, [])
  return [copied, copy]
}
