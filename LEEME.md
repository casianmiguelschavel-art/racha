# 🔥 Racha: guía de instalación

Página web para controlar la comida y el peso entre dos personas. Todo es gratis: GitHub Pages para la web, el plan gratuito de Firebase para guardar los datos y un escáner que funciona en el propio móvil.

Se tarda unos 15 minutos. Hazlo desde el ordenador.

---

## Paso 1: Crear el proyecto en Firebase (gratis)

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google.
2. **Crear un proyecto** → ponle un nombre (por ejemplo `racha`) → **desactiva Google Analytics** → Crear.
3. Te quedas en el plan **Spark (gratuito)**. No metas ninguna tarjeta.

## Paso 2: Crear vuestros dos usuarios

1. Menú izquierdo → **Compilación → Authentication** → **Comenzar**.
2. Pestaña **Método de inicio de sesión** → **Correo electrónico/contraseña** → Habilitar → Guardar.
3. Pestaña **Usuarios** → **Agregar usuario** → tu email y una contraseña. Repite con el email de tu pareja.
4. (Recomendado) Pestaña **Configuración → Acciones del usuario** → desmarca **Habilitar la creación (registro)**. Así nadie puede crearse una cuenta.

## Paso 3: Crear la base de datos

1. Menú izquierdo → **Compilación → Firestore Database** → **Crear base de datos**.
2. Ubicación: una de Europa (por ejemplo `europe-southwest1`, Madrid) → **Modo de producción** → Crear.
3. Pestaña **Reglas**: borra lo que haya y pega el contenido de `firestore.rules`.
4. **Muy importante:** cambia los dos emails de ejemplo por los vuestros, en minúsculas → **Publicar**.

> Estas reglas son el candado. Aunque alguien encuentre la web, no puede ver ni tocar nada si su email no está en esa lista.

## Paso 4: Conectar la web con Firebase

1. En Firebase, arriba a la izquierda: ⚙️ → **Configuración del proyecto**.
2. Abajo, en **Tus apps**, pulsa el icono **`</>`** (Web) → ponle un nombre → **Registrar app** (no marques Hosting).
3. Te enseña un bloque `const firebaseConfig = { ... }`. Copia esos valores en el archivo **`firebase-config.js`**, sustituyendo los de ejemplo.

> Esos datos (`apiKey`, etc.) no son contraseñas. Es normal que estén en la web pública. Lo que protege vuestra información son las reglas del paso 3.

## Paso 5: Subirla a GitHub Pages

1. En <https://github.com> → **New repository** → nombre, por ejemplo `racha` → **Public** → Create.
   (GitHub Pages gratis solo funciona con repositorios públicos. Se verá el código, pero **no vuestros datos**.)
2. **Add file → Upload files** → arrastra **todos** los archivos de esta carpeta → Commit.
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` y carpeta `/ (root)` → Save.
4. En 1 o 2 minutos tendrás la web en `https://TU-USUARIO.github.io/racha/`.
5. De vuelta en Firebase: **Authentication → Configuración → Dominios autorizados** → **Agregar dominio** → `TU-USUARIO.github.io`.

## Paso 6: Ponerla en el iPhone

1. Abre la web en **Safari**.
2. Botón **Compartir ⬆︎** → **Añadir a pantalla de inicio**.
3. Entra con tu email y contraseña. La primera vez te pide nombre, sexo, altura y peso.
4. Consejo: ve a **Ajustes → Descargar escáner ahora** con WiFi. Son unos 150 MB y solo se descargan una vez.

---

## Cómo funciona

- **Objetivo**: al entrar la primera vez eliges entre **perder peso**, **ganar músculo** o **mantenerte y tonificar**, y cuánto te mueves. La app calcula tus **calorías, proteínas, carbohidratos y grasas** diarios. Se recalculan solos cada vez que añades un peso. En **Perfil** puedes cambiar el objetivo o poner tus propios números.
- **Racha**: si un día registras la **comida** y la **cena**, ese día cuenta. Si te falta alguna, la racha vuelve a 0. Cada uno tiene la suya.
  - **Protectores**: cada 7 días seguidos ganas uno (máximo 2). Si un día se te olvida, el protector salva tu racha automáticamente.
- **Añadir comida** (botón **+** del centro):
  - **Foto del plato**: un modelo de reconocimiento de imágenes de código abierto (CLIP) se ejecuta **dentro de tu móvil**. No hay ningún servidor de pago ni se envía la foto a nadie. Te propone los 3 platos más probables. Pones los **gramos** que has comido (o eliges ½ ración, 1 ración, doble…) y las calorías, proteínas, carbohidratos y grasas se recalculan solos y puedes corregir los números. Es una **estimación**: ninguna app calcula las calorías exactas con una foto, tampoco las de pago.
  - **Código de barras**: para productos envasados. Es exacto e incluye macros (datos de Open Food Facts, gratis).
  - **Buscar** en la lista de platos, añadir **a mano** o repetir algo de **Recientes** con un toque.
- **Quitar o corregir**: toca cualquier comida para editarla, o pulsa la papelera para quitarla. Si te equivocas, aparece un botón **Deshacer**.
- **Agua**: toca los vasos (250 ml cada uno) para apuntar lo que bebes.
- **Progreso**: peso actual, gráfica, peso objetivo con la **fecha estimada** en la que lo conseguirás, calorías de los últimos 7 días e historial.
- **Pareja**: podéis ver la racha, las calorías, las proteínas y el peso del otro, pero cada uno solo puede modificar lo suyo.
- **Colores**: en **Perfil → Apariencia** cada uno elige modo claro u oscuro, uno de los 8 temas o **cualquier color**: principal, degradado, fondo, tarjetas, texto y los colores de cada macro. Se guarda en vuestro perfil.
- **Qué se guarda**: de cada comida, solo el nombre, las calorías y los macros (las fotos no se guardan). **Las comidas y el agua de hace más de 30 días se borran solas.** El **peso se guarda para siempre**.

## Añadir platos al escáner

Edita `foods.js` y añade una línea como esta (calorías y macros de una ración):

```js
{ n: 'Nombre en español', en: 'english description of the dish', k: 450, m: [30, 40, 15], u: '1 plato', q: 350 },
```

`m` son los gramos de `[proteínas, carbohidratos, grasas]` de esa ración y `q` lo que pesa la ración en gramos (por ejemplo `q: 350`). Con eso la app calcula las calorías y macros de cualquier cantidad.

La descripción en inglés es la que usa el escáner para reconocer la foto: cuanto más descriptiva, mejor. Después sube el número de `FOODS_VERSION` (por ejemplo de `'1'` a `'2'`) y vuelve a subir los archivos a GitHub.

## Límites gratuitos de Firebase

El plan Spark permite 50.000 lecturas y 20.000 escrituras al día, y 1 GB de datos. Vosotros dos usaréis menos del 1 %. Si algún día se superara, Firebase simplemente deja de funcionar hasta el día siguiente: **nunca cobra** sin una tarjeta añadida.
