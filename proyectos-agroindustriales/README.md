# Proyectos agroindustriales — material de trabajo

Material para el curso **Formulación y Evaluación de Proyectos**
(Ingeniería Agroindustrial — UPSJB, Ica).

## Archivos

| Archivo | Qué es |
|---|---|
| `01_Estructura_Proyecto_Inversion.docx` | Esqueleto completo del informe, capítulo por capítulo. Cada sección trae una nota en gris que explica qué va ahí. Reemplázala por tu contenido y bórrala. |
| `02_Modelo_Financiero.xlsx` | Modelo financiero con fórmulas vivas: inversiones, depreciación, deuda, estados, flujo de caja, VAN, TIR, B/C, PRI, punto de equilibrio y sensibilidad. |

## Cómo empezar

1. Abre el Excel en la hoja **Instrucciones** y lee el código de colores.
   - Azul sobre amarillo = celda que llenas tú.
   - Negro y verde = fórmulas, no las toques.
2. Ve a la hoja **Supuestos**: ahí está el 90 % de lo que debes cambiar.
3. Carga tus cotizaciones reales en la hoja **Inversiones**.
4. Todo lo demás se recalcula solo. Los resultados finales están en **Evaluacion**.
5. Copia esas tablas al Word, en el Capítulo VIII.

## Ejemplo cargado

El Excel viene con un caso completo de ejemplo (planta de pulpa de mango congelada,
720 t/año de capacidad, Ica) para que veas cómo se conectan las hojas.

**Las cifras del ejemplo son referenciales y no son datos oficiales de ningún mercado.**
Antes de entregar, reemplaza cada dato por uno con fuente citable (INEI, MIDAGRI,
SUNAT, SBS, cotizaciones reales) y cita la fuente al pie de cada tabla del informe.

## Convención de tasas de descuento

Por defecto el flujo económico se descuenta al **WACC** y el financiero al **COK**.
Si tu docente usa otra convención, cámbiala en la hoja `Evaluacion`, en las celdas
"Tasa de descuento del flujo ECONÓMICO / FINANCIERO". Declara la convención elegida
en el informe.

## Verificación del modelo

- 891 fórmulas, 0 errores tras recálculo.
- VAN, TIR, B/C y PRI contrastados contra un cálculo independiente en Python: coinciden exactamente.
- El análisis de sensibilidad se validó recalculando el modelo completo con el precio
  a −10 %: la estimación coincide con el resultado real (diferencia 0.00).

## Pendiente

Estructura del curso **Proyecto de Investigación II** — falta definir tema, tipo de
estudio y diseño experimental.
