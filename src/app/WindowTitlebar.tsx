import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function WindowTitlebar() {
  const { t } = useTranslation()
  if (!window.__TAURI_INTERNALS__) return null

  const appWindow = getCurrentWindow()

  return (
    <header
      className="window-titlebar"
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        void appWindow.toggleMaximize()
      }}
    >
      <div className="window-controls" role="group" aria-label={t('windowControls')}>
        <button type="button" className="window-control window-control-close" aria-label={t('closeWindow')} onClick={() => void appWindow.close()} />
        <button type="button" className="window-control window-control-minimize" aria-label={t('minimizeWindow')} onClick={() => void appWindow.minimize()} />
        <button type="button" className="window-control window-control-maximize" aria-label={t('maximizeWindow')} onClick={() => void appWindow.toggleMaximize()} />
      </div>
    </header>
  )
}
