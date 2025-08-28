
# Tickets Full App

Frontend + Backend + Panel Administrativo (Node + Express, sin base de datos externa).

## Requisitos
- Node.js 18+

## Instalación y ejecución
```bash
cd backend
npm install
npm start
```
- Frontend: http://localhost:4000
- Panel admin: http://localhost:4000/admin
- Subidas (comprobantes): carpeta `backend/uploads/`
- Variables: `.env` (incluye `ADMIN_SECRET=pruebaadmin`, `PORT=4000`).

## Flujo
1. El usuario selecciona tickets, llena el formulario y sube un *comprobante* (imagen o PDF).
2. El backend guarda la compra en `db.json` como **pending** y marca esos tickets como **reserved**.
3. En el panel admin:
   - **Aceptar** → pasa a **approved** y los tickets quedan vendidos.
   - **Rechazar** → vuelve los tickets a **free**.
   - **Participantes aprobados** → Ver, Modificar (nombre/email), Eliminar (libera tickets).
4. **Configuración** → Cambiar cantidad total de tickets.
   - Validación: no se permite bajar por debajo del mayor ticket en uso (reservado o aprobado).
   - Si no es válido, devuelve error 400, el servidor **no** se cae.

## Notas
- Los archivos subidos se sirven en `/uploads/...` para que el admin pueda verlos.
- Persistencia simple en `db.json`. No requiere SQLite.
