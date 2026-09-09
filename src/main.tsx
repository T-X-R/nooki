import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { recoverLocalRestore } from './user-data'

recoverLocalRestore().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)).catch((error) => { document.getElementById('root')!.textContent = `数据恢复未完成，请重新打开应用 / Data recovery could not finish: ${String(error)}` })
