# Messaging Brief — Limbo v2: Telegram Bot (Argentina Launch)

**Author:** Pepper Potts, CMO
**Date:** 2026-03-11
**Task:** [LIM-39](/LIM/issues/LIM-39)
**For:** Vision (landing page redesign)
**Status:** Final — unblocks Vision immediately

---

## Context: El Pivot

Limbo ya no es una app. Es un **bot de Telegram**. Esto no es un cambio menor — es un cambio de paradigma que afecta todo: el hook, la forma de explicarlo, la propuesta de valor, y la fricción de entrada.

**Antes:** "Instalás Docker, corrés el container, tenés una IA local."
**Ahora:** "Abrís Telegram, escribís, Limbo recuerda."

La barrera de entrada se eliminó. La privacidad se complica (Telegram = nube). Hay que reencuadrar todo.

---

## 1. Target Audience — Fase 1 Argentina

### Primario: El Fundador Saturado (Persona 2 del biz plan)
**Quién es:** Fundador de startup, director, freelancer senior. 30-48 años. Tiene Telegram instalado desde siempre — lo usa más que WhatsApp para trabajo.

**Pain point argentino específico:**
- Tiene 4 grupos de WhatsApp, 3 de Telegram, y una cabeza que explota
- Anota cosas en notas del celu que nunca vuelve a leer
- Se olvidó el nombre del contacto del banco, la fecha del vencimiento, lo que le prometió a alguien en un café
- "Lo tengo en algún lado" es su frase favorita y la odia

**Por qué Telegram como interfaz resuena:**
- Ya tiene Telegram. No hay que instalar nada nuevo.
- Ya le escribe a gente por Telegram. Limbo es "una persona más en el chat."
- La curva de aprendizaje es cero.

**Por qué le importa la privacidad:**
- No es que sea fanático — es que ya le robaron datos o le molesta que sus notas las indexe Google
- "Que corra en mi servidor" para él significa "nadie más tiene mis cosas"
- No necesita entender Docker para confiar en "tu vault vive en tu máquina, no en nuestros servidores"

### Secundario: El Constructor Solo (Persona 3)
- Indie hacker, consultor, dev freelance
- Usa Claude/ChatGPT diario pero le molesta empezar de cero cada vez
- Telegram es su app de trabajo
- Adopta herramientas rápido, las abandona igual de rápido — hay que darle valor en el día 1

### Segmento a ignorar en el landing (Fase 1):
- Obsidian power users (siguen siendo válidos para canal HN/GitHub, pero no para este landing)
- Privacy activists puros (demasiado técnicos para el tono rioplatense casual)
- Académicos (monetización más lenta, canal diferente)

---

## 2. Nueva Propuesta de Valor — Telegram-Based Limbo

### El Hook Central

> **"Tu memoria personal. En Telegram."**

Simple. Dice todo. No requiere explicación de qué es un "segundo cerebro" o un "vault".

### Por Qué Funciona Este Hook

- "Tu memoria personal" → soluciona el dolor real (te olvidás cosas)
- "En Telegram" → inmediato, sin fricción, ya lo tenés instalado
- La combinación es nueva. No hay otro producto que diga esto y lo cumpla.

### El Ángulo de Privacidad — Cómo Comunicarlo

**El problema real:** Telegram sí pasa mensajes por sus servidores. No podemos decir "data never leaves your machine" si el input viene de Telegram — sería deshonesto.

**La respuesta honesta y marketeable:**
- Los mensajes pasan por Telegram (como cualquier mensaje que mandás hoy)
- **Lo que importa: tu vault, tus notas, tu memoria — viven en tu servidor, no en el nuestro**
- Limbo no es un servicio de almacenamiento en la nube — es un procesador local
- Analogía: Telegram es la interfaz (como el teclado). El contenido se guarda en tu máquina.

**Copy para la sección de privacidad:**
> "Limbo procesa y guarda todo en tu propio servidor. Nosotros no vemos tus notas, no las indexamos, no las vendemos. Tu memoria es tuya."

**Framing de la objeción "pero Telegram es nube":**
> "Telegram es solo la interfaz — como el teclado. Tu vault vive en tu servidor. Cuando cierran Telegram, tus datos siguen ahí."

---

## 3. Key Messaging Pillars (5)

### Pillar 1: Sin fricción — entrás en 30 segundos
> "Nada que instalar. Abrís Telegram, escribís, Limbo recuerda."

Preempta el mayor objection de cualquier herramienta nueva: "no tengo ganas de configurar nada más."

### Pillar 2: Tu memoria, no la nuestra
> "Lo que le contás a Limbo queda en tu servidor. No en el nuestro."

Diferenciador real frente a ChatGPT memory, Notion AI, Mem.ai. No necesitamos decir "privacidad" — lo mostramos.

### Pillar 3: Escribí como escribís
> "Sin categorías, sin carpetas, sin tags. Escribí como si le hablaras a alguien — Limbo entiende."

Anti-fricción de setup. El "segundo cerebro" clásico requiere un sistema. Limbo no.

### Pillar 4: Recordá sin buscar
> "Preguntale a Limbo lo que necesitás. Te responde en segundos — aunque lo hayas guardado hace meses."

El momento del "aha". La propuesta de valor no es guardar cosas — es recuperarlas cuando importa.

### Pillar 5: Tu servidor o el nuestro — vos elegís
> "Correlo en tu propia máquina, o usá nuestra nube. Misma app. Datos siempre tuyos."

Introduce el modelo Ghost (open source + managed hosting) sin jerga técnica.

---

## 4. Landing Page Copy Direction

### Hero Headline
**Mantener:** "Para todo lo que queda en el **limbo**" ← no cambiar. Es brillante y sigue siendo 100% relevante para el concepto de Telegram bot.

### Hero Subtitle (CAMBIAR)

❌ v1 recomendada: "Tu cerebro no tiene que recordar todo. **Limbo sí.**"
— era bueno para un concepto de app. Para Telegram bot es demasiado abstracto.

✅ **Nuevo (recomendado):**
> "Contaselo por Telegram. Cuando lo necesitás, preguntale."

✅ Alternativa A (más emocional):
> "Todo lo que querés recordar, en una conversación de Telegram."

✅ Alternativa B (más directa):
> "Tu memoria personal. En Telegram. En tu servidor."

**Pick:** La recomendada — dos acciones simples, cuenta el loop completo (guardar → recuperar), sin tecnicismos.

### CTA Principal
❌ "Quiero probarlo" (implica disponibilidad inmediata)
✅ **"Reservar acceso anticipado"**

### CTA Secundario
✅ "Cómo funciona" (keep)

---

### "Así funciona" — Reescribir para Telegram

| Paso | Copy nuevo |
|------|-----------|
| 1 — Input | "Le escribís a Limbo por Telegram, como si le mandaras un mensaje a alguien." |
| 2 — Procesa | "Entiende qué guardaste, qué importa, y qué contexto tiene. Solo." |
| 3 — Guarda | "Lo almacena en tu servidor — ordenado, listo, tuyo." |
| 4 — Recordá | "Preguntale lo que necesitás, cuando lo necesitás. En dos segundos." |

**Eliminar:** El paso de "se organiza en carpetas automáticamente" — suena técnico y no es el hook para este público.

### Problem Section — MANTENER TODO
Los ejemplos (póliza, número de trámite, link del drive, etc.) son perfectos para Argentina y siguen siendo 100% relevantes. No cambiar nada.

---

### Nueva sección recomendada: "¿Y mis datos?" (AGREGAR antes de waitlist)

> **¿Y mis datos?**
>
> "Limbo corre en tu servidor — en casa, en un VPS, donde quieras. Nosotros nunca vemos lo que guardás. Si no querés configurar nada, lo hacemos nosotros por $9/mes."

Un párrafo, fondo diferenciado (card pequeña), ícono de servidor o candado.

---

### Waitlist Section

| Elemento | Copy |
|----------|------|
| H2 | "Sé de los primeros en usarlo." |
| Subtitle | "Los primeros 200 tienen acceso anticipado y precio de early adopter." |
| Button | "Reservar mi lugar" |
| Post-submit note | "🎉 Lugar reservado. Te escribimos antes que nadie." |
| Success message | "✅ ¡Listo! Sos parte del acceso anticipado." |

---

### Roadmap Section — Leve Actualización

**H2:** "Hoy texto. Mañana, todo."
**Subtitle:** "Empezamos con texto por Telegram. Después sumamos todo lo demás."
**Items próximamente:** Imágenes, PDFs, mensajes de voz (via Telegram voice notes).

---

## 5. Objeciones a Preemptar

| Objeción | Respuesta en copy |
|----------|------------------|
| "Telegram no es privado" | "Telegram es solo la interfaz. Tu vault vive en tu servidor." |
| "¿Tengo que saber de Docker?" | "No. Lo instalamos nosotros por $9/mes. O seguí las instrucciones si querés hacerlo vos." |
| "¿Y si cierran Limbo?" | "Open source. El código es tuyo. Los datos son Markdown plano." |
| "¿Otro bot de Telegram más?" | "No es un chatbot. Es tu memoria — guarda, conecta, y recuerda lo que vos le contás." |
| "¿Qué pasa con lo que le mando a Telegram?" | "Telegram ve tus mensajes como ve cualquier mensaje. Lo que importa: tu vault vive en tu máquina." |

---

## 6. Tono y Registro

- **Idioma:** español rioplatense auténtico — vos, conjugaciones rioplatenses, lunfardo cuando pega natural, nunca forzado
- **Tono:** directo, amigable, como alguien que te recomienda algo bueno. No corporativo. No hype.
- **Lo que NO funciona:** "segundo cerebro", "knowledge management", "semantic search", cualquier tecnicismo
- **Longitud:** frases cortas. El ritmo de la landing actual es correcto — mantenerlo.

---

## Notas para Vision (Diseño)

1. **H1 es intocable.** "Para todo lo que queda en el limbo" — construí el diseño alrededor de esto.
2. **Demo card = conversación de Telegram.** Chat bubbles realistas (izquierda: usuario, derecha: Limbo). Mostrar el loop: guardar → preguntar → recibir respuesta. Los ejemplos actuales (DeLorean, Mike Ehrmantraut, Raúl el electricista) son excelentes — mantenerlos.
3. **Sección "¿Y mis datos?"** puede ser una card discreta entre "Así funciona" y el waitlist.
4. **CTAs:** el primario lleva al waitlist siempre. Coming soon = capturar emails.
5. **Roadmap items:** sumar "Mensajes de voz" a la lista de próximamente — especialmente relevante para el público argentino que graba audios de 3 minutos en lugar de escribir.

---

*El copy de landing-page-copy-v1.md sigue siendo válido para Problem Section y tono general. Las secciones de Hero, "Así funciona", y Waitlist necesitan actualizarse para reflejar el modelo Telegram.*
