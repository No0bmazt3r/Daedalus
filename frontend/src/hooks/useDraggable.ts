import { useState, useEffect, useRef } from 'react'

export function useDraggable() {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  
  const handleRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y,
        })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragOffset])

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (windowRef.current) {
      const rect = windowRef.current.getBoundingClientRect()
      // If we haven't set an initial position, default to current rect
      if (position.x === 0 && position.y === 0) {
        setPosition({ x: rect.left, y: rect.top })
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      } else {
        setDragOffset({
          x: e.clientX - position.x,
          y: e.clientY - position.y,
        })
      }
      setIsDragging(true)
    }
  }

  return { position, onMouseDown, handleRef, windowRef }
}
