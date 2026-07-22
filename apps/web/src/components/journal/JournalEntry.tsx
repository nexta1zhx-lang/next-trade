'use client'

import {useState, useEffect} from 'react'
import {Save} from 'lucide-react'
import type {SymbolJournal} from '@nexttrade/shared'

interface JournalEntryProps {
  symbol: string
  date: string
  editingJournal: SymbolJournal | null
  onSaved: (journal: SymbolJournal) => void
}

export default function JournalEntry({
  symbol,
  date,
  editingJournal,
  onSaved
}: JournalEntryProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editingJournal) {
      setTitle(editingJournal.title || '')
      setContent(editingJournal.content || '')
    } else {
      setTitle('')
      setContent('')
    }
  }, [editingJournal])

  const handleSave = async () => {
    if (!content.trim()) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/symbols/${encodeURIComponent(symbol)}/journals`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({date, title: title.trim(), content: content.trim()})
        }
      )
      const data = await res.json()
      if (data.success) {
        onSaved(data.data)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="标题（可选）"
        className="w-full text-sm bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-gray-200
                   focus:outline-none focus:border-gray-500 mb-2"
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={`记录 ${date} 的交易想法...`}
        rows={3}
        className="w-full text-sm bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200
                   focus:outline-none focus:border-gray-500 resize-none"
      />
      <div className="flex justify-end mt-2">
        <button
          onClick={handleSave}
          disabled={saving || !content.trim()}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-primary text-white
                     hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Save className="w-3 h-3" />
          {saving ? '保存中...' : editingJournal ? '更新' : '保存'}
        </button>
      </div>
    </div>
  )
}
