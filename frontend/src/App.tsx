import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth.js";
import { RequireAuth } from "./components/RequireAuth.js";
import { Register } from "./pages/Register.js";
import { Login } from "./pages/Login.js";
import { ProjectsPlaceholder } from "./pages/ProjectsPlaceholder.js";

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
              <ProjectsPlaceholder />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
