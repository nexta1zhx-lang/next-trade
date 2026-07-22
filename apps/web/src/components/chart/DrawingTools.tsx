'use client'

import {Minus, TrendingUp, X} from 'lucide-react'

interface DrawingToolsProps {
  activeTool: 'horizontal' | 'trendline' | null
  onSelectTool: (tool: 'horizontal' | 'trendline' | null) => void
  onClearAll: () => void
  hasDrawings: boolean
}

export default function DrawingTools({
  activeTool,
  onSelectTool,
  onClearAll,
  hasDrawings
}: DrawingToolsProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onSelectTool(activeTool === 'trendline' ? null : 'trendline')}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
          activeTool === 'trendline'
            ? 'bg-yellow-500/20 text-yellow-400'
            : 'bg-gray-800 text-gray-400 hover:text-gray-200'
        }`}
        title="趋势线"
      >
        <TrendingUp className="w-3.5 h-3.5" />
        趋势线
      </button>
      <button
        onClick={() => onSelectTool(activeTool === 'horizontal' ? null : 'horizontal')}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
          activeTool === 'horizontal'
            ? 'bg-blue-500/20 text-blue-400'
            : 'bg-gray-800 text-gray-400 hover:text-gray-200'
        }`}
        title="水平线"
      >
        <Minus className="w-3.5 h-3.5" />
        水平线
      </button>
      {hasDrawings && (
        <button
          onClick={onClearAll}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-800 text-red-400 hover:text-red-300 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          清除
        </button>
      )}
    </div>
  )
}
