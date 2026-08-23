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

# Busca un intérprete de Node.
#
# Contempla los dos entornos en que corre esta tarea:
#  - Sin jaula: los Node de Plesk viven en /opt/plesk/node/<version>/bin/node.
#  - Con shell enjaulado (chroot): /opt/plesk no está montado, pero la cuenta suele
#    tener su propio Node gestionado por nodenv en ~/.nodenv, que dentro de la jaula
#    queda colgando de la raíz.
buscar_node() {
  if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then echo "$NODE_BIN"; return; fi

  # Versiones LTS pares primero. Se evita a propósito la 21, que es impar y ya no
  # recibe parches de seguridad (pendiente G de DECISIONES.md).
  for v in 22 20 24; do
    if [ -x "/opt/plesk/node/$v/bin/node" ]; then echo "/opt/plesk/node/$v/bin/node"; return; fi
  done

  # nodenv: primero la versión fijada en .node-version, si la hay.
  for base in "$HOME/.nodenv" /.nodenv "$HOME"; do
    [ -d "$base/versions" ] || continue
    fijada=""
    for vf in "$base/../.node-version" "$HOME/.node-version" /.node-version; do
      [ -f "$vf" ] && { fijada=$(tr -d ' \r\n' < "$vf"); break; }
    done
    if [ -n "$fijada" ] && [ -x "$base/versions/$fijada/bin/node" ]; then
      echo "$base/versions/$fijada/bin/node"; return
    fi
    candidato=$(ls -d "$base"/versions/*/bin/node 2>/dev/null | sort -V | tail -1)
    [ -n "$candidato" ] && { echo "$candidato"; return; }
  done

  if command -v node >/dev/null 2>&1; then command -v node; return; fi

  # `|| true`: con `set -e`, un `ls` sin coincidencias abortaría el script aquí
  # mismo y en silencio, sin llegar al mensaje de error de abajo. En una tarea
  # programada eso es un fallo mudo cada minuto.
  ls -d /opt/plesk/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true
}

NODE=$(buscar_node)

if [ -z "$NODE" ]; then
  # Por stderr: la tarea programada de Plesk avisa mirando la salida de error.
  echo "worker.sh: no se encontró un intérprete de Node." >&2
  echo "  Probado: /opt/plesk/node/{22,20,24}, nodenv y el PATH." >&2
  echo "  Indica uno con NODE_BIN=/ruta/a/node antes del comando." >&2
  exit 1
fi

[ -n "$WORKER_VERBOSE" ] && echo "worker.sh: usando $NODE ($("$NODE" -v 2>/dev/null))"

if [ ! -f "$RAIZ/packages/api/dist/worker.js" ]; then
  echo "worker.sh: falta $RAIZ/packages/api/dist/worker.js — ¿se desplegó el build?" >&2
  exit 1
fi

# cd a la raíz: el worker resuelve el .env por ruta propia, pero la CLI de Prisma y
# algunas rutas relativas siguen dependiendo del directorio actual.
cd "$RAIZ"
exec "$NODE" "$RAIZ/packages/api/dist/worker.js"
