import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api.js';
import Login from './pages/Login.js';
import AuthCallback from './pages/AuthCallback.js';
import Leads from './pages/Leads.js';
import LeadDetail from './pages/LeadDetail.js';
import Tareas from './pages/Tareas.js';
import Formularios from './pages/Formularios.js';
import FormularioEditor from './pages/FormularioEditor.js';
import Ajustes from './pages/Ajustes.js';

interface Me {
  user: { id: string; name: string; role: string; organizationId: string };
  organization: { id: string; name: string } | null;
}

export default function App() {
  const location = useLocation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    retry: false,
  });

  if (location.pathname === '/auth/callback') return <AuthCallback />;
  if (isLoading) return <div className="vacio">Cargando…</div>;
  if (isError || !data) return <Login />;

  const puedeGestionar = data.user.role === 'admin_lucuma' || data.user.role === 'gerente';

  return (
    <div className="app">
      <header className="topbar">
        <span className="marca">Lucuma CRM</span>
        <h1>{data.organization?.name ?? ''}</h1>
        <span className="meta">{data.user.name}</span>
      </header>

      <main className="contenido">
        <Routes>
          <Route path="/" element={<Navigate to="/leads" replace />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:id" element={<LeadDetail rol={data.user.role} />} />
          <Route path="/tareas" element={<Tareas />} />
          {puedeGestionar && <Route path="/formularios" element={<Formularios />} />}
          {puedeGestionar && <Route path="/formularios/:id" element={<FormularioEditor />} />}
          {puedeGestionar && <Route path="/ajustes" element={<Ajustes />} />}
          <Route path="*" element={<div className="vacio">Página no encontrada</div>} />
        </Routes>
      </main>

      <nav className="nav">
        <NavLink to="/leads" className={({ isActive }) => (isActive ? 'activo' : '')}>
          <span className="icono">👥</span>Leads
        </NavLink>
        <NavLink to="/tareas" className={({ isActive }) => (isActive ? 'activo' : '')}>
          <span className="icono">✓</span>Tareas
        </NavLink>
        {puedeGestionar && (
          <NavLink to="/formularios" className={({ isActive }) => (isActive ? 'activo' : '')}>
            <span className="icono">📋</span>Formularios
          </NavLink>
        )}
        {puedeGestionar && (
          <NavLink to="/ajustes" className={({ isActive }) => (isActive ? 'activo' : '')}>
            <span className="icono">⚙</span>Ajustes
          </NavLink>
        )}
      </nav>
    </div>
  );
}
