import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth.js";
import { RequireAuth } from "./components/RequireAuth.js";
import { Register } from "./pages/Register.js";
import { Login } from "./pages/Login.js";
import { Projects } from "./pages/Projects.js";
import { ProjectNew } from "./pages/ProjectNew.js";
import { ProjectOverview } from "./pages/ProjectOverview.js";
import { ProjectSettings } from "./pages/ProjectSettings.js";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/projects"
          element={
            <RequireAuth>
              <Projects />
            </RequireAuth>
          }
        />
        <Route
          path="/projects/new"
          element={
            <RequireAuth>
              <ProjectNew />
            </RequireAuth>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <RequireAuth>
              <ProjectOverview />
            </RequireAuth>
          }
        />
        <Route
          path="/projects/:id/settings"
          element={
            <RequireAuth>
              <ProjectSettings />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
