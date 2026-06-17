import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import './styles.css'
import { AuthRoot } from './AuthRoot'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthRoot />
  </React.StrictMode>,
)
