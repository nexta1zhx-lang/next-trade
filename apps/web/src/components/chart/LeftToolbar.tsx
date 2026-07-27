'use client'

import {
  MousePointer2,
  Minus,
  TrendingUp,
  SeparatorVertical,
  Ruler,
  Eraser,
  Trash2,
  Edit3
} from 'lucide-react'

export type DrawTool =
  | 'cursor'
  | 'horizontal'
  | 'trendline'
  | 'vertical'
  | 'ruler'

interface LeftToolbarProps {
  activeTool: DrawTool
  onSelectTool: (tool: DrawTool) => void
  onClearAll: () => void
  hasDrawings: boolean
  editMode?: boolean
  onEditModeChange?: (mode: boolean) => void
  deleteMode?: boolean
  onDeleteModeChange?: (mode: boolean) => void
}

const TOOLS: Array<{id: DrawTool; icon: typeof MousePointer2; label: string}> =
  [
    {id: 'cursor', icon: MousePointer2, label: '光标'},
    {id: 'horizontal', icon: Minus, label: '水平线'},
    {id: 'vertical', icon: SeparatorVertical, label: '垂直线'},
    {id: 'trendline', icon: TrendingUp, label: '趋势线'},
    {id: 'ruler', icon: Ruler, label: '尺子'}
  ]

export default function LeftToolbar({
  activeTool,
  onSelectTool,
  onClearAll,
  hasDrawings,
  editMode = false,
  onEditModeChange,
  deleteMode = false,
  onDeleteModeChange
}: LeftToolbarProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 px-1 bg-[#18181b] border border-gray-700/50 rounded-lg">
      {TOOLS.map(t => {
        const Icon = t.icon
        const isActive = activeTool === t.id
        return (
          <button
            key={t.id}
            onClick={() =>
              onSelectTool(isActive && t.id !== 'cursor' ? 'cursor' : t.id)
            }
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors relative group ${
              isActive
                ? 'bg-primary/20 text-primary'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
            title={t.label}
          >
            <Icon className="w-4 h-4" />
            <span
              className="absolute left-full ml-2 px-2 py-0.5 bg-gray-900 text-gray-200 text-[10px] rounded
                         whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
            >
              {t.label}
            </span>
          </button>
        )
      })}
      <div className="w-6 border-t border-gray-700/50 my-1" />

      {/* 垃圾桶 — 只在移动端显示 (md:hidden) */}
      <button
        onClick={() => onDeleteModeChange?.(!deleteMode)}
        className={`md:hidden w-8 h-8 flex items-center justify-center rounded transition-colors relative group ${
          deleteMode
            ? 'bg-red-500/20 text-red-400'
            : 'text-gray-500 hover:text-red-400 hover:bg-gray-800/50'
        }`}
        title={deleteMode ? '退出删除模式' : '点击辅助线删除'}
      >
        <Trash2 className="w-4 h-4" />
        <span
          className="absolute left-full ml-2 px-2 py-0.5 bg-gray-900 text-gray-200 text-[10px] rounded
                     whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
        >
          {deleteMode ? '退出删除' : '点击删除'}
        </span>
      </button>

      {hasDrawings && (
        <button
          onClick={onClearAll}
          className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-red-400 hover:bg-gray-800/50 transition-colors relative group"
          title="清除所有"
        >
          <Eraser className="w-4 h-4" />
          <span
            className="absolute left-full ml-2 px-2 py-0.5 bg-gray-900 text-gray-200 text-[10px] rounded
                       whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
          >
            清除所有
          </span>
        </button>
      )}

      <div className="w-6 border-t border-gray-700/50 my-1" />

      {/* 编辑模式开关 — 只在移动端显示 (md:hidden)，放在底部 */}
      <button
        onClick={() => onEditModeChange?.(!editMode)}
        className={`md:hidden w-8 h-8 flex items-center justify-center rounded transition-colors relative group ${
          editMode
            ? 'bg-primary/20 text-primary'
            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
        }`}
        title={editMode ? '退出编辑模式' : '编辑辅助线'}
      >
        <Edit3 className="w-4 h-4" />
        <span
          className="absolute left-full ml-2 px-2 py-0.5 bg-gray-900 text-gray-200 text-[10px] rounded
                     whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
        >
          {editMode ? '退出编辑' : '编辑'}
        </span>
      </button>
    </div>
  )
}
