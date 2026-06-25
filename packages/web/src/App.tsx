import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import RoomSettingsPage from './pages/RoomSettingsPage'
import SettingsPage from './pages/SettingsPage'
import DmPage from './pages/DmPage'
import AgentSettingsPage from './pages/AgentSettingsPage'
import WorkgroupEntryPage from './pages/WorkgroupEntryPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token)
  const redirect = `${window.location.pathname}${window.location.search}`
  return token ? <>{children}</> : <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <HomePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/room/:roomId"
          element={
            <PrivateRoute>
              <RoomPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/room/:roomId/settings"
          element={
            <PrivateRoute>
              <RoomSettingsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/dm/:conversationId"
          element={
            <PrivateRoute>
              <DmPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/agents/new"
          element={
            <PrivateRoute>
              <AgentSettingsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/agents/:agentId/settings"
          element={
            <PrivateRoute>
              <AgentSettingsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/workgroup-entry/:token"
          element={
            <PrivateRoute>
              <WorkgroupEntryPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <SettingsPage />
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
