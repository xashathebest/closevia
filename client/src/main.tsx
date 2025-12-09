import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import '@fontsource/prata/400.css'
import './index.css'

// Load and apply font size immediately before React renders
// This ensures the font size is applied on page load without flashing
try {
  const saved = localStorage.getItem('user_settings')
  if (saved) {
    const parsed = JSON.parse(saved)
    if (parsed.fontSize) {
      const fontSize = parsed.fontSize
      const root = document.documentElement
      switch (fontSize) {
        case 'small':
          root.style.fontSize = '14px'
          break
        case 'large':
          root.style.fontSize = '18px'
          break
        case 'extra-large':
          root.style.fontSize = '20px'
          break
        default:
          root.style.fontSize = '16px' // medium
      }
    }
  }
} catch (e) {
  // ignore if localStorage is not available
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)