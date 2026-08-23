#!/bin/sh
# Ejecuta el worker de la cola desde la tarea programada de Plesk.
#
# Existe porque el shell de las tareas programadas no hereda el PATH de Node de la
# suscripción: un `node ...` a secas falla con "command not found", y en una tarea
# programada eso ocurre en silencio, cada minuto, sin que nadie se entere.
#
# Uso en Plesk (Tareas programadas, cada minuto):
#     /ruta/al/dominio/bin/worker.sh
#
# Para forzar un intérprete concreto:  NODE_BIN=/opt/plesk/node/20/bin/node worker.sh
set -e

RAIZ=$(cd "$(dirname "$0")/.." && pwd)

buscar_node() {
  if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then echo "$NODE_BIN"; return; fi
  # Versiones LTS pares primero. Se evita a propósito la 21, que es impar y ya no
  # recibe parches de seguridad (pendiente G de DECISIONES.md).
  for v in 22 20 24; do
    if [ -x "/opt/plesk/node/$v/bin/node" ]; then echo "/opt/plesk/node/$v/bin/node"; return; fi
  done
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  ls -d /opt/plesk/node/*/bin/node 2>/dev/null | sort -V | tail -1
}

NODE=$(buscar_node)

if [ -z "$NODE" ]; then
  echo "worker.sh: no se encontró un intérprete de Node." >&2
  exit 1
fi

# cd a la raíz: el worker resuelve el .env por ruta propia, pero la CLI de Prisma y
# algunas rutas relativas siguen dependiendo del directorio actual.
cd "$RAIZ"
exec "$NODE" "$RAIZ/packages/api/dist/worker.js"
