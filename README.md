# Simulador Industrial Omron E5CC

Este simulador de alta fidelidad recrea el comportamiento técnico y visual del controlador de temperatura **Omron E5CC (48x48mm)**.

## Características Técnicas
- **Algoritmo de Control:** Implementación de 2-PID (2 grados de libertad) y ON/OFF con histéresis.
- **Autotuning (AT-2):** Simulación de sintonización automática mediante el método de oscilación de relé.
- **Modelo Físico:** Motor térmico integrado con ganancia de calefacción, pérdida por convección y ruido térmico.
- **Navegación Realista:** Implementación exacta de los niveles de operación, ajuste, configuración inicial y protección.

## Guía de Uso Rápido

### Niveles de Menú
1. **Nivel de Operación (Por defecto):** 
   - Visualiza PV (Proceso) y SV (Consigna).
   - Ajusta la consigna con las teclas ▲ y ▼.
2. **Nivel de Ajuste (Pulsación corta <1s tecla O):**
   - Parámetros: `At` (Autotuning), `P`, `I`, `d`, `HyS`.
3. **Nivel de Configuración Inicial (Mantener O por 3s):**
   - **Nota:** El control se detiene por seguridad.
   - Parámetros: `in-t` (Tipo de entrada), `CntL` (Método de control), `ALt1`.
4. **Nivel de Protección (Mantener O + M por 3s):**
   - Parámetros: `oAPt`. Si se activa (ej: 3), bloquea el cambio de otros niveles.

### Indicadores LED
- **OUT1:** Se ilumina cuando la salida de control está activa.
- **TUNE:** Parpadea durante el proceso de Autotuning.
- **STOP:** Activo cuando el control está detenido (ej: en nivel inicial).
- **Icono Llave:** Indica que hay una protección activa.

## Instalación y Ejecución
1. Asegúrese de tener [Node.js](https://nodejs.org/) instalado.
2. Ejecute `npm install` para las dependencias (Vite).
3. Inicie el simulador con `npm run dev`.
4. Abra su navegador en `http://localhost:5173`.

---
*Desarrollado como una herramienta de formación para ingenieros de instrumentación.*
