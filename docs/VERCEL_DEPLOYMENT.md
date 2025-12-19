# Guía de Despliegue en Vercel

Este repositorio está preparado para funcionar en Vercel (serverless) manteniendo compatibilidad con Express para desarrollo local.

## Arquitectura

### Desarrollo Local
- **Servidor**: Express tradicional (`npm run dev`)
- **Autenticación**: Sesiones Express con Passport
- **Base de datos**: PostgreSQL con connection pooling estándar

### Producción Vercel (Serverless)
- **Servidor**: Funciones serverless de Vercel (`api/[...path].ts`)
- **Autenticación**: JWT tokens (compatible con sesiones Express)
- **Base de datos**: PostgreSQL con connection pooling optimizado para serverless

## Configuración

### 1. Variables de Entorno

Configura las siguientes variables de entorno en el dashboard de Vercel:

```
DATABASE_URL=postgresql://postgres:[PASSWORD]@aws-0-us-west-2.pooler.supabase.com:5432/postgres
SESSION_SECRET=your-session-secret-here
JWT_SECRET=your-jwt-secret-here (puede ser el mismo que SESSION_SECRET)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
NODE_ENV=production
```

**Importante**: 
- Usa el **Session pooler** connection string de Supabase (no la conexión directa)
- `JWT_SECRET` puede ser el mismo que `SESSION_SECRET` si quieres
- Asegúrate de que todas las variables estén configuradas en Vercel

### 2. Build Configuration

El proyecto ya está configurado con `vercel.json`. No necesitas cambios adicionales.

### 3. Supabase Redirect URLs

1. Ve a Supabase Dashboard → **Authentication** → **URL Configuration**
2. Agrega tu URL de Vercel a **Redirect URLs**:
   ```
   https://your-app.vercel.app/callback.html
   ```
3. Mantén tu URL local también:
   ```
   http://localhost:5000/callback.html
   ```

## Despliegue

### Opción 1: Desde GitHub (Recomendado)

1. Conecta tu repositorio a Vercel
2. Vercel detectará automáticamente la configuración
3. Agrega las variables de entorno en el dashboard
4. Deploy automático en cada push

### Opción 2: Desde CLI

```bash
npm install -g vercel
vercel login
vercel
```

## Estructura de Archivos

```
├── api/
│   └── [...path].ts          # Handler serverless para todas las rutas API
├── server/
│   ├── jwtAuth.ts            # Autenticación JWT para serverless
│   ├── supabaseAuth.ts       # Autenticación Express + JWT
│   ├── routes.ts             # Rutas API (compatible con ambos modos)
│   └── db.ts                 # Conexión DB optimizada para serverless
├── vercel.json               # Configuración de Vercel
└── .vercelignore             # Archivos a ignorar en deploy
```

## Autenticación

### Cómo Funciona

1. **Login**: El usuario se autentica con Supabase OAuth o email/password
2. **Token JWT**: Se genera un token JWT además de la sesión Express
3. **Cookies**: El token se almacena en una cookie `jwt` para serverless
4. **Validación**: 
   - En Express: Se usa la sesión Passport
   - En Serverless: Se valida el token JWT desde la cookie o header Authorization

### Headers de Autenticación

Para llamadas API directas, puedes usar:

```
Authorization: Bearer <jwt-token>
```

O el token se enviará automáticamente en la cookie `jwt`.

## Rutas API Disponibles

Todas las rutas API funcionan tanto en Express como en serverless:

- `GET /api/auth/user` - Obtener usuario actual
- `GET /api/auth/setup-required` - Verificar si se necesita setup inicial
- `GET /api/invite/:token` - Validar token de invitación
- `GET /api/users` - Listar usuarios
- `GET /api/users/:id` - Obtener usuario específico
- `GET /api/invites` - Listar invitaciones
- `POST /api/invites` - Crear invitación
- `GET /api/promotions` - Listar solicitudes de promoción
- `GET /api/promotions/:id` - Obtener solicitud específica
- `GET /api/stats` - Estadísticas del sistema

**Nota**: Algunas rutas que requieren sesiones complejas (como `complete-registration`) pueden necesitar ajustes adicionales para funcionar completamente en serverless.

## Desarrollo Local

Para desarrollo local, simplemente usa:

```bash
npm run dev
```

Esto iniciará el servidor Express tradicional con todas las funcionalidades, incluyendo sesiones completas.

## Limitaciones de Serverless

1. **Sesiones**: Las sesiones Express no persisten entre invocaciones serverless. Se usa JWT en su lugar.
2. **Estado**: No se puede mantener estado entre requests (cada función es stateless)
3. **Cold Starts**: La primera invocación puede ser más lenta (~1-2 segundos)
4. **Timeouts**: Las funciones tienen un timeout máximo (10s en plan gratuito, 60s en Pro)

## Troubleshooting

### Error: "Database connection failed"

- Verifica que `DATABASE_URL` use el **Session pooler** (no conexión directa)
- Asegúrate de que la URL tenga el formato correcto
- Verifica que Supabase permita conexiones desde Vercel

### Error: "Unauthorized" en serverless

- Verifica que el token JWT se esté enviando (cookie o header)
- Revisa que `JWT_SECRET` esté configurado correctamente
- Asegúrate de que el token no haya expirado (7 días por defecto)

### Error: "Route not found"

- Verifica que la ruta esté implementada en `api/[...path].ts`
- Revisa los logs de Vercel para ver qué path se está recibiendo
- Asegúrate de que `vercel.json` tenga la configuración correcta

### Cold Starts Lentos

- Considera usar Vercel Pro para funciones más rápidas
- Optimiza las importaciones en `api/[...path].ts`
- Usa connection pooling eficiente (ya configurado)

## Migración desde Express

Si ya tienes la app corriendo en Express (Railway, Render, etc.):

1. **Mantén ambos funcionando**: El código es compatible con ambos
2. **Prueba en Vercel**: Despliega y prueba las funcionalidades
3. **Migra gradualmente**: Puedes tener ambos activos durante la transición
4. **Actualiza URLs**: Cambia las URLs de Supabase redirect cuando estés listo

## Costos

**Vercel**:
- Plan Hobby (gratis): 100GB bandwidth, funciones serverless ilimitadas
- Plan Pro ($20/mes): Más recursos, funciones más rápidas, mejor soporte

**Supabase**:
- Plan gratuito: 500MB database, 50k MAU
- Plan Pro ($25/mes): Más recursos

**Total estimado**: $0-45/mes dependiendo del plan

## Recursos

- [Documentación de Vercel](https://vercel.com/docs)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- [Supabase Connection Pooling](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler)

