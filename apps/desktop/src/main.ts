import { initTauriBridge } from './bridge'

// Initialize native bridge when running in Tauri
document.addEventListener('DOMContentLoaded', () => {
  initTauriBridge()
})
