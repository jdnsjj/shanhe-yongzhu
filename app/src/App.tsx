/**
 * 应用根组件 —— 开始界面 / 游戏主界面的切换。
 */

import { useEffect } from 'react'
import { MapView } from './components/MapView.tsx'
import { BottomBar, InfoPanel, RightMenu, StartScreen, ToastLayer, TopBar } from './components/Hud.tsx'
import { DialogHost } from './components/Dialogs.tsx'
import { useGame } from './store.ts'

export function App() {
  const screen = useGame((s) => s.screen)
  const boot = useGame((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  return (
    <div className="app">
      {screen === 'start' ? (
        <StartScreen />
      ) : (
        <>
          <MapView />
          <TopBar />
          <RightMenu />
          <InfoPanel />
          <BottomBar />
          <DialogHost />
        </>
      )}
      <ToastLayer />
    </div>
  )
}
