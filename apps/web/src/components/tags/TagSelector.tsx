'use client'

import {useState, useEffect} from 'react'
import {Plus, X} from 'lucide-react'
import type {SymbolTag} from '@nexttrade/shared'

const PRESET_TAGS = [
  {tag: '突破', color: '#22c55e'},
  {tag: '回调', color: '#f59e0b'},
  {tag: '支撑', color: '#3b82f6'},
  {tag: '压力', color: '#ef4444'},
  {tag: '看涨', color: '#10b981'},
  {tag: '看跌', color: '#f43f5e'},
  {tag: '放量', color: '#a855f7'},
  {tag: '十字星', color: '#94a3b8'},
  {tag: '反转', color: '#ec4899'},
  {tag: '关注', color: '#eab308'}
]

interface TagSelectorProps {
  symbol: string
}

export default function TagSelector({symbol}: TagSelectorProps) {
  const [tags, setTags] = useState<SymbolTag[]>([])
  const [customTag, setCustomTag] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!symbol) return
    fetch(`/api/symbols/${encodeURIComponent(symbol)}/tags`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setTags(d.data)
      })
      .catch(() => {})
  }, [symbol])

  const addTag = async (tag: string, color: string) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/symbols/${encodeURIComponent(symbol)}/tags`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({tag, color})
        }
      )
      const data = await res.json()
      if (data.success) {
        setTags(prev => [...prev, data.data])
      }
    } finally {
      setLoading(false)
    }
  }

  const removeTag = async (id: number) => {
    setTags(prev => prev.filter(t => t.id !== id))
    await fetch(
      `/api/symbols/${encodeURIComponent(symbol)}/tags/${id}`,
      {method: 'DELETE'}
    ).catch(() => {})
  }

  const handleAddCustom = () => {
    const trimmed = customTag.trim()
    if (!trimmed) return
    if (tags.some(t => t.tag === trimmed)) {
      setCustomTag('')
      return
    }
    addTag(trimmed, '#6b7280')
    setCustomTag('')
  }

  // 分离已有标签和预设标签
  const existingTags = new Set(tags.map(t => t.tag))
  const unselectedPresets = PRESET_TAGS.filter(p => !existingTags.has(p.tag))

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {/* 已有标签 */}
        {tags.map(t => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
            style={{backgroundColor: t.color + '20', color: t.color, border: `1px solid ${t.color}40`}}
          >
            {t.tag}
            <button
              onClick={() => removeTag(t.id)}
              className="hover:opacity-70"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {/* 预设标签（未选中） */}
        {!loading && unselectedPresets.map(p => (
          <button
            key={p.tag}
            onClick={() => addTag(p.tag, p.color)}
            className="px-2 py-0.5 rounded text-[11px] border border-dashed border-gray-600 text-gray-500 hover:text-gray-300 hover:border-gray-400 transition-colors"
          >
            +{p.tag}
          </button>
        ))}
      </div>

      {/* 自定义标签输入 */}
      <div className="flex items-center gap-1 mt-2">
        <input
          value={customTag}
          onChange={e => setCustomTag(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
          placeholder="自定义标签..."
          className="flex-1 text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200
                     focus:outline-none focus:border-gray-500"
        />
        <button
          onClick={handleAddCustom}
          disabled={!customTag.trim()}
          className="p-1 rounded bg-gray-800 text-gray-400 hover:text-gray-200 disabled:opacity-30"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
