import type {ReactNode} from 'react'

/** About 页面使用独立布局，不显示导航栏 */
export default function AboutLayout({children}: {children: ReactNode}) {
  return <>{children}</>
}
