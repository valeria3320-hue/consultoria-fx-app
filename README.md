# Consultoría FX — Mesa de Derivados · Dashboard

Dashboard operativo para arrancar una práctica de **consultoría financiera / introducing broker**:
prospección, segmentación de clientes, seguimiento, generación de notas diarias de mercado y
catálogo de productos (FX, derivados cambiarios, commodities, inversiones, transferencias) apoyado
en proveedores institucionales (**Marex, StoneX, ADM, Bursamétrica**).

> ⚠️ **Privacidad:** este repositorio contiene **solo el código de la app**. Los datos de tus clientes
> **nunca** se suben a GitHub: viven únicamente en el `localStorage` de tu navegador. Respáldalos con el
> botón **Respaldar (JSON)** dentro de la app.

## Cómo usarlo

### Opción A — Local (recomendada, 100% offline)
1. Descarga/clona este repositorio.
2. Doble clic en **`index.html`**. Abre en tu navegador. Listo.

### Opción B — En línea (GitHub Pages)
Disponible si el repositorio es **público** (o cuenta GitHub Pro para repos privados):
`Settings → Pages → Branch: main → /(root)`. La URL queda en `https://USUARIO.github.io/consultoria-fx`.

## Funcionalidad
- **Resumen** — KPIs: pipeline abierto y ponderado, ganado del mes, embudo, acciones pendientes.
- **Pipeline** — tablero Kanban; arrastra prospectos entre etapas (Identificado → … → Ganado/Perdido).
- **Clientes** — base completa con segmentación por industria y filtros; export CSV.
- **Seguimiento** — agenda de próximas acciones (vencidas/hoy/semana) + cadencia recomendada.
- **Notas diarias** — generador de nota de mercado (USD/MXN, niveles, commodities, eventos) en formato
  WhatsApp o correo, con historial y copiar al portapapeles.
- **Productos & Guiones** — catálogo de soluciones con perfil ideal + scripts de venta y plantillas.
- **Playbook** — metodología completa de prospección, segmentos objetivo y disciplina diaria.

## Datos
- Persistencia: `localStorage` (clave `cfx_state_v1`).
- Respaldo/Restauración: JSON desde la barra lateral.
- Export de clientes: CSV (compatible con Excel).
- El primer arranque carga **datos de ejemplo** que puedes borrar con **Reiniciar datos**.

## Estructura
```
index.html        · estructura y vistas
assets/styles.css · tema visual
assets/app.js     · toda la lógica (sin dependencias externas)
seed.example.json · ejemplo de respaldo importable
```

## Aviso
Herramienta de **gestión comercial**, no de asesoría de inversión regulada. La intermediación y
operación de derivados debe realizarse a través de las entidades autorizadas y bajo los contratos
y avisos correspondientes.
