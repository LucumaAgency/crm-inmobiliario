import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api.js';
import Login from './pages/Login.js';
import AuthCallback from './pages/AuthCallback.js';
import Leads from './pages/Leads.js';
import LeadDetail from './pages/LeadDetail.js';
import Tareas from './pages/Tareas.js';
import Proyectos from './pages/Proyectos.js';
import ProyectoDetail from './pages/ProyectoDetail.js';
import Formularios from './pages/Formularios.js';
import FormularioEditor from './pages/FormularioEditor.js';
import Ajustes from './pages/Ajustes.js';

interface Me {
  user: { id: string; name: string; role: string; organizationId: string };
  organization: { id: string; name: string } | null;
}

const ROLES: Record<string, string> = {
  admin_lucuma: 'Admin',
  gerente: 'Gerente',
  asesor: 'Asesor',
  solo_lectura: 'Solo lectura',
};

export default function App() {
  const location = useLocation();
  const [menuAbierto, setMenuAbierto] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    retry: false,
  });

  // En móvil el lateral es un cajón: navegar debe cerrarlo, o tapa el contenido
  // que la persona acaba de pedir.
  useEffect(() => setMenuAbierto(false), [location.pathname]);

  if (location.pathname === '/auth/callback') return <AuthCallback />;
  if (isLoading) return <div className="vacio">Cargando…</div>;
  if (isError || !data) return <Login />;

  const puedeGestionar = data.user.role === 'admin_lucuma' || data.user.role === 'gerente';
  const enlace = ({ isActive }: { isActive: boolean }) => (isActive ? 'activo' : '');

  return (
    <div className="app">
      <aside className={`lateral${menuAbierto ? ' abierto' : ''}`}>
        <div className="lateral-marca">Lucuma CRM</div>

        <nav className="lateral-nav">
          <NavLink to="/leads" className={enlace}>
            <span className="icono">👥</span>Leads
          </NavLink>
          <NavLink to="/tareas" className={enlace}>
            <span className="icono">✓</span>Tareas
          </NavLink>
          <NavLink to="/proyectos" className={enlace}>
            <span className="icono">🏢</span>Proyectos
          </NavLink>
          {puedeGestionar && (
            <NavLink to="/formularios" className={enlace}>
              <span className="icono">📋</span>Formularios
            </NavLink>
          )}
          {puedeGestionar && (
            <NavLink to="/ajustes" className={enlace}>
              <span className="icono">⚙</span>Ajustes
            </NavLink>
          )}
        </nav>

        <div className="lateral-pie">
          <div className="nombre">{data.user.name}</div>
          <div className="meta">{ROLES[data.user.role] ?? data.user.role}</div>
        </div>
      </aside>

      {menuAbierto && <div className="velo" onClick={() => setMenuAbierto(false)} />}

      <div className="principal">
        <header className="topbar">
          <button
            type="button"
            className="hamburguesa"
            aria-label="Abrir menú"
            aria-expanded={menuAbierto}
            onClick={() => setMenuAbierto((v) => !v)}
          >
            ☰
          </button>
          <h1>{data.organization?.name ?? ''}</h1>
          <span className="meta">{data.user.name}</span>
        </header>

        <main className="contenido">
          <Routes>
            <Route path="/" element={<Navigate to="/leads" replace />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/leads/:id" element={<LeadDetail rol={data.user.role} />} />
            <Route path="/tareas" element={<Tareas />} />
            <Route path="/proyectos" element={<Proyectos />} />
            <Route path="/proyectos/:id" element={<ProyectoDetail />} />
            {puedeGestionar && <Route path="/formularios" element={<Formularios />} />}
            {puedeGestionar && <Route path="/formularios/:id" element={<FormularioEditor />} />}
            {puedeGestionar && <Route path="/ajustes" element={<Ajustes rol={data.user.role} />} />}
            <Route path="*" element={<div className="vacio">Página no encontrada</div>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
