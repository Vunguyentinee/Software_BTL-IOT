import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { LoginPage } from './components/auth/LoginPage'
import { authService, Session } from './services/api/authService'
import './index.css'

/** Chưa đăng nhập -> chỉ hiện trang đăng nhập; không tải dữ liệu, không mở WebSocket. */
const Root: React.FC = () => {
  const [session, setSession] = useState<Session | null>(() => authService.getSession())
  const [expired] = useState(() => authService.consumeLogoutReason() === 'expired')

  useEffect(
    () =>
      authService.subscribe((s) => {
        if (s === null) {
          // Đăng xuất / hết phiên: tải lại trang để xóa sạch dữ liệu và kết nối của phiên cũ
          window.location.reload()
          return
        }
        setSession(s)
      }),
    []
  )

  // Tự đăng xuất đúng lúc token hết hạn
  useEffect(() => {
    if (!session) return
    const t = setTimeout(() => authService.logout('expired'), Math.max(0, session.expiresAt - Date.now()))
    return () => clearTimeout(t)
  }, [session])

  return session ? <App session={session} /> : <LoginPage expired={expired} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
