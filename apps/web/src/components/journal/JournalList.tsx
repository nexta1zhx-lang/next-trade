'use client'

import {Trash2, Edit3, ChevronDown, ChevronUp} from 'lucide-react'
import {useState} from 'react'
import type {SymbolJournal} from '@nexttrade/shared'

interface JournalListProps {
  journals: SymbolJournal[]
  onEdit: (journal: SymbolJournal) => void
  onDelete: (id: number) => void
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('zh-CN', {month: 'short', day: 'numeric', weekday: 'short'})
}

export default function JournalList({journals, onEdit, onDelete}: JournalListProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  if (journals.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-2">暂无日记</p>
    )
  }

  return (
    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
      {journals.map(j => (
        <div
          key={j.id}
          className={`rounded border border-gray-700/50 overflow-hidden transition-colors ${
            expandedId === j.id ? 'bg-gray-800/80' : 'bg-gray-800/30 hover:bg-gray-800/50'
          }`}
        >
          <div
            onClick={() => setExpandedId(expandedId === j.id ? null : j.id)}
            className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
          >
            <span className="text-[11px] text-gray-400 shrink-0">{fmtDate(j.date)}</span>
            <span className="text-xs text-gray-300 truncate flex-1">
              {j.title || j.content.slice(0, 40)}
            </span>
            <button
              onClick={e => {
                e.stopPropagation()
                onEdit(j)
              }}
              className="text-gray-500 hover:text-gray-300 shrink-0"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              onClick={e => {
                e.stopPropagation()
                onDelete(j.id)
              }}
              className="text-gray-500 hover:text-red-400 shrink-0"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            {expandedId === j.id
              ? <ChevronUp className="w-3 h-3 text-gray-500 shrink-0" />
              : <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
            }
          </div>
          {expandedId === j.id && (
            <div className="px-3 pb-2 text-xs text-gray-400 whitespace-pre-wrap border-t border-gray-700/30 pt-1.5">
              {j.content}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
