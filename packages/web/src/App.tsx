import React, { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'

const LoginPage = React.lazy(() => import('./pages/LoginPage'))
const HomePage = React.lazy(() => import('./pages/HomePage'))
const RoomPage = React.lazy(() => import('./pages/RoomPage'))
const RoomSettingsPage = React.lazy(() => import('./pages/RoomSettingsPage'))
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'))
const DmPage = React.lazy(() => import('./pages/DmPage'))
const AgentSettingsPage = React.lazy(() => import('./pages/AgentSettingsPage'))
const WorkgroupEntryPage = React.lazy(() => import('./pages/WorkgroupEntryPage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token)
  const redirect = `${window.location.pathname}${window.location.search}`
  return token ? <>{children}</> : <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
}

function PageFallback() {
  return <div className="fc-app-viewport bg-gray-50 flex items-center justify-center text-sm text-gray-500">加载中...</div>
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
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
      </Suspense>
    </BrowserRouter>
  )
}
