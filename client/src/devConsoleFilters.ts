if (import.meta.env.DEV) {
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error

  const shouldHideConsoleMessage = (args: unknown[]) => {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : ''))
      .join(' ')

    return (
      message.includes('Download the React DevTools for a better development experience') ||
      message.includes('Cross-Origin-Opener-Policy policy would block the window.closed call') ||
      message.includes('Cross-Origin-Opener-Policy policy would block the window.close call')
    )
  }

  console.info = (...args: unknown[]) => {
    if (shouldHideConsoleMessage(args)) {
      return
    }

    originalInfo(...args)
  }

  console.warn = (...args: unknown[]) => {
    if (shouldHideConsoleMessage(args)) {
      return
    }

    originalWarn(...args)
  }

  console.error = (...args: unknown[]) => {
    if (shouldHideConsoleMessage(args)) {
      return
    }

    originalError(...args)
  }
}
