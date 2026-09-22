import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, matchPath, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api.js';
import Icono from './components/Icono.js';
import Login from './pages/Login.js';
import AuthCallback from './pages/AuthCallback.js';
import Resumen from './pages/Resumen.js';
import Reportes from './pages/Reportes.js';
import Leads from './pages/Leads.js';
import LeadDetail from './pages/LeadDetail.js';
import Tareas from './pages/Tareas.js';
import Proyectos from './pages/Proyectos.js';
import ProyectoDetail from './pages/ProyectoDetail.js';
import Formularios from './pages/Formularios.js';
import FormularioEditor from './pages/FormularioEditor.js';
import Ajustes from './pages/Ajustes.js';
import Cuenta from './pages/Cuenta.js';

interface Me {
  user: { id: string; name: string; email: string; role: string; organizationId: string };
  organization: { id: string; name: string } | null;
  tienePassword: boolean;
}

const ROLES: Record<string, string> = {
  admin_lucuma: 'Admin',
  gerente: 'Gerente',
  asesor: 'Asesor',
  solo_lectura: 'Solo lectura',
};

/** Título de la barra superior según la ruta. El primero que coincide gana. */
const TITULOS: [string, string][] = [
  ['/resumen', 'Resumen'],
  ['/reportes', 'Reportes'],
  ['/leads/:id', 'Ficha del lead'],
  ['/leads', 'Leads'],
  ['/tareas', 'Tareas'],
  ['/proyectos/:id', 'Proyecto'],
  ['/proyectos', 'Proyectos'],
  ['/formularios/:id', 'Editar formulario'],
  ['/formularios', 'Formularios'],
  ['/ajustes', 'Ajustes'],
  ['/cuenta', 'Mi cuenta'],
];

function iniciales(nombre: string) {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export default function App() {
  const location = useLocation();
  const qc = useQueryClient();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [menuUsuario, setMenuUsuario] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    retry: false,
  });
  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/projects'),
    enabled: !!data,
  });

  // En móvil el lateral es un cajón: navegar debe cerrarlo, o tapa el contenido
  // que la persona acaba de pedir.
  useEffect(() => {
    setMenuAbierto(false);
    setMenuUsuario(false);
  }, [location.pathname]);

  if (location.pathname === '/auth/callback') return <AuthCallback />;
  if (isLoading) return <div className="vacio">Cargando…</div>;
  if (isError || !data) return <Login />;

  const puedeGestionar = data.user.role === 'admin_lucuma' || data.user.role === 'gerente';
  const enlace = ({ isActive }: { isActive: boolean }) => (isActive ? 'activo' : '');
  const titulo =
    TITULOS.find(([patron]) => matchPath(patron, location.pathname))?.[1] ?? 'Lucuma CRM';

  async function salir() {
    await api.post('/auth/logout');
    qc.clear();
    window.location.assign('/');
  }

  return (
    <div className="app">
      <aside className={`lateral${menuAbierto ? ' abierto' : ''}`}>
        <div className="lateral-marca">
          <span className="wordmark">Lucuma Agency</span>
          <span className="producto">CRM</span>
        </div>

        <nav className="lateral-nav">
          <div className="nav-seccion">Menú</div>
          <NavLink to="/resumen" className={enlace}>
            <Icono nombre="resumen" />Resumen
          </NavLink>
          <NavLink to="/leads" className={enlace}>
            <Icono nombre="leads" />Leads
          </NavLink>
          <NavLink to="/tareas" className={enlace}>
            <Icono nombre="tareas" />Tareas
          </NavLink>
          <NavLink to="/reportes" className={enlace}>
            <Icono nombre="reportes" />Reportes
          </NavLink>

          <div className="nav-seccion">
            Proyectos
            {puedeGestionar && (
              <NavLink to="/proyectos" aria-label="Gestionar proyectos" title="Gestionar proyectos">
                <Icono nombre="mas" tam={15} />
              </NavLink>
            )}
          </div>
          {proyectos.data?.map((p) => (
            <NavLink
              key={p.id}
              to={`/proyectos/${p.id}`}
              className={({ isActive }) => `proyecto-nav${isActive ? ' activo' : ''}`}
            >
              <Icono nombre="carpeta" />
              <span>{p.name}</span>
            </NavLink>
          ))}
          {proyectos.data?.length === 0 && (
            <NavLink to="/proyectos" className={enlace}>
              <Icono nombre="proyectos" />Ver proyectos
            </NavLink>
          )}

          {puedeGestionar && (
            <>
              <div className="nav-seccion">Configuración</div>
              <NavLink to="/formularios" className={enlace}>
                <Icono nombre="formularios" />Formularios
              </NavLink>
              <NavLink to="/ajustes" className={enlace}>
                <Icono nombre="ajustes" />Ajustes
              </NavLink>
            </>
          )}
        </nav>

        <div className="lateral-pie">
          {menuUsuario && (
            <div className="usuario-menu" role="menu">
              <NavLink to="/cuenta" role="menuitem">
                <Icono nombre="cuenta" tam={16} />Mi cuenta
              </NavLink>
              <button type="button" role="menuitem" onClick={salir}>
                <Icono nombre="salir" tam={16} />Cerrar sesión
              </button>
            </div>
          )}
          <button
            type="button"
            className="usuario"
            aria-expanded={menuUsuario}
            onClick={() => setMenuUsuario((v) => !v)}
          >
            <span className="avatar">{iniciales(data.user.name)}</span>
            <span className="datos">
              <div className="nombre">{data.user.name}</div>
              <div className="meta">
                {ROLES[data.user.role] ?? data.user.role}
                {!data.tienePassword && <span className="aviso-pass"> · sin contraseña</span>}
              </div>
            </span>
            <Icono nombre="selector" tam={16} />
          </button>
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
            <Icono nombre="menu" tam={20} />
          </button>
          <h1>{titulo}</h1>
          {data.organization && <span className="org">{data.organization.name}</span>}
        </header>

        <main className="contenido">
          <Routes>
            <Route path="/" element={<Navigate to="/resumen" replace />} />
            <Route path="/resumen" element={<Resumen />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/leads/:id" element={<LeadDetail rol={data.user.role} />} />
            <Route path="/tareas" element={<Tareas />} />
            <Route path="/proyectos" element={<Proyectos />} />
            <Route path="/proyectos/:id" element={<ProyectoDetail />} />
            {puedeGestionar && <Route path="/formularios" element={<Formularios />} />}
            {puedeGestionar && <Route path="/formularios/:id" element={<FormularioEditor />} />}
            {puedeGestionar && <Route path="/ajustes" element={<Ajustes rol={data.user.role} />} />}
            <Route path="/cuenta" element={<Cuenta tienePassword={data.tienePassword} />} />
            <Route path="*" element={<div className="vacio">Página no encontrada</div>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
