import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Reads the width synchronously on first render. It used to start as
// `undefined` (so `false`) and only learn the real width in an effect, which
// meant any decision taken on the first render - a redirect, say - was taken
// as if every phone were a desktop.
function narrow() {
  return typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(narrow)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(narrow())
    }
    mql.addEventListener("change", onChange)
    setIsMobile(narrow())
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
