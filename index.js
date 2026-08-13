/**
 * JARVIS - Backend Principal
 * Servidor Express que corre en Vercel (24/7)
 * 
 * Este código es el "cerebro" de Jarvis.
 * Recibe órdenes del iPhone, entiende qué hacer, y ejecuta acciones.
 */

// ============================================
// 1. IMPORTAR LIBRERÍAS (dependencias)
// ============================================

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

// ============================================
// 2. CONFIGURAR VARIABLES DE AMBIENTE
// ============================================
// Estas vienen de Vercel (las configuraremos después)

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY, // Tu API Key de Claude
});

const supabase = createClient(
  process.env.SUPABASE_URL, // URL de tu base de datos Supabase
  process.env.SUPABASE_KEY  // Llave de acceso a Supabase
);

// ============================================
// 3. CREAR LA APLICACIÓN EXPRESS
// ============================================

const app = express();

// Middlewares (configuraciones de Express)
app.use(cors()); // Permite que tu iPhone se conecte al servidor
app.use(express.json()); // Permite recibir datos en formato JSON

// ============================================
// 4. RUTAS PRINCIPALES
// ============================================

/**
 * RUTA 1: Verificar que el servidor está vivo
 * GET /api/health
 * 
 * Cuando abras la app en tu iPhone, primero verifica que Jarvis está despierto
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Jarvis está despierto ✅', 
    timestamp: new Date().toISOString() 
  });
});

/**
 * RUTA 2: Procesar órdenes de Jarvis
 * POST /api/process-order
 * 
 * Aquí es donde ocurre la magia:
 * 1. Tu iPhone envía una orden (ej: "Manda WhatsApp a Celia")
 * 2. Claude IA entiende qué hacer
 * 3. Jarvis ejecuta la acción
 * 4. Envía el resultado de vuelta a tu iPhone
 */
app.post('/api/process-order', async (req, res) => {
  try {
    const { order, userId } = req.body; // order = tu orden, userId = tu identificador

    console.log(`📥 Orden recibida: ${order}`);

    // ============================================
    // PASO 1: Obtener el historial de órdenes del usuario (contexto)
    // ============================================
    const { data: userOrders } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    // ============================================
    // PASO 2: Crear el PROMPT para Claude (instrucciones)
    // ============================================
    const systemPrompt = `Eres JARVIS, el asistente personal de Pepe (un comerciante de acero en México).

Tu trabajo es:
1. Entender qué quiere hacer Pepe
2. Crear un PLAN de acciones específicas
3. Ejecutar esas acciones

Pepe usa:
- WhatsApp para mensajes
- Spotify para música
- Google Maps / Waze para rutas
- Quantfury para inversión (trading)
- Airbnb para reservas
- Gmail / Outlook para email
- Apple Calendar para citas
- LinkedIn para networking
- CapCut para videos

REGLA CRÍTICA: 
- Para Quantfury, NUNCA hagas trading automático sin confirmación explícita de Pepe
- SIEMPRE pregunta antes de enviar mensajes sensibles
- Sé proactivo pero prudente

Responde SIEMPRE en JSON con esta estructura:
{
  "entendimiento": "qué entendiste",
  "plan": ["paso 1", "paso 2", ...],
  "accion_principal": "la acción que vas a ejecutar",
  "requiere_confirmacion": true/false,
  "mensaje_para_pepe": "qué le dices a Pepe"
}`;

    // ============================================
    // PASO 3: Llamar a Claude para que entienda la orden
    // ============================================
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Orden de Pepe: "${order}"\n\nHistorial reciente de órdenes: ${JSON.stringify(userOrders || [])}`,
        },
      ],
    });

    // ============================================
    // PASO 4: Procesar la respuesta de Claude
    // ============================================
    const claudeResponse = response.content[0].text;
    let jarvisAction;

    try {
      jarvisAction = JSON.parse(claudeResponse);
    } catch (e) {
      // Si Claude no devuelve JSON perfecto, intentamos extraerlo
      jarvisAction = {
        entendimiento: "No pude procesar bien la orden",
        plan: [],
        accion_principal: "reintento",
        requiere_confirmacion: true,
        mensaje_para_pepe: "No entendí bien. ¿Puedes repetir de otra forma?",
      };
    }

    // ============================================
    // PASO 5: Guardar la orden en Supabase (para historial)
    // ============================================
    await supabase.from('orders').insert({
      user_id: userId,
      order_text: order,
      claude_response: jarvisAction,
      status: jarvisAction.requiere_confirmacion ? 'pendiente_confirmacion' : 'ejecutada',
      created_at: new Date().toISOString(),
    });

    // ============================================
    // PASO 6: Ejecutar la acción
    // ============================================
    let executionResult = null;

    if (jarvisAction.accion_principal === 'whatsapp') {
      // Aquí conectaríamos con WhatsApp API
      executionResult = await executeWhatsApp(jarvisAction);
    } else if (jarvisAction.accion_principal === 'spotify') {
      // Aquí conectaríamos con Spotify API
      executionResult = await executeSpotify(jarvisAction);
    } else if (jarvisAction.accion_principal === 'google_maps') {
      // Aquí conectaríamos con Google Maps API
      executionResult = await executeGoogleMaps(jarvisAction);
    } else if (jarvisAction.accion_principal === 'quantfury') {
      // Aquí conectaríamos con Quantfury API (pero con CONFIRMACIÓN primero)
      executionResult = { status: 'pendiente', message: 'Requiere tu confirmación' };
    }
    // ... más integraciones

    // ============================================
    // PASO 7: Responder al iPhone
    // ============================================
    res.json({
      success: true,
      jarvis_understanding: jarvisAction.entendimiento,
      jarvis_plan: jarvisAction.plan,
      jarvis_message: jarvisAction.mensaje_para_pepe,
      requires_confirmation: jarvisAction.requiere_confirmacion,
      execution_result: executionResult,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Error procesando orden:', error);
    res.status(500).json({
      success: false,
      error: 'Hubo un problema procesando tu orden',
      details: error.message,
    });
  }
});

/**
 * RUTA 3: Sugerencias Proactivas
 * GET /api/suggestions/:userId
 * 
 * Jarvis se comunica con tu iPhone cada X horas para sugerir cosas:
 * - "Tienes reunión en 30 minutos, ¿necesitas la ruta?"
 * - "Tu balance en Quantfury bajó 5%, ¿quieres rebalancear?"
 * - "Tienes $500 disponibles, ¿quieres invertir?"
 */
app.get('/api/suggestions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Obtener datos del usuario (calendar, portafolio, etc.)
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Generar sugerencias basadas en contexto
    const suggestion = await generateProactiveSuggestion(userProfile);

    res.json({
      success: true,
      suggestion: suggestion,
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 5. FUNCIONES DE INTEGRACIONES
// ============================================

/**
 * Ejecutar orden de WhatsApp
 * (En producción, aquí conectarías con WhatsApp Business API)
 */
async function executeWhatsApp(action) {
  try {
    // TODO: Integrar WhatsApp Business API
    // Por ahora, simulamos la ejecución
    return {
      status: 'enviado',
      message: `Mensaje enviado a ${action.destinatario || 'contacto'}`,
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

/**
 * Ejecutar orden de Spotify
 * (En producción, aquí conectarías con Spotify API)
 */
async function executeSpotify(action) {
  try {
    // TODO: Integrar Spotify API
    return {
      status: 'reproduciendo',
      message: `Reproduciendo ${action.playlist || 'playlist'}`,
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

/**
 * Ejecutar orden de Google Maps
 * (En producción, aquí conectarías con Google Maps API)
 */
async function executeGoogleMaps(action) {
  try {
    // TODO: Integrar Google Maps API
    return {
      status: 'ruta_calculada',
      message: `Ruta encontrada: ${action.distancia || 'distancia'} km`,
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

/**
 * Generar sugerencias proactivas basadas en contexto
 */
async function generateProactiveSuggestion(userProfile) {
  try {
    // Aquí Claude analizaría el contexto del usuario y generaría sugerencias inteligentes
    const suggestions = [
      "¿Quieres que te reserve un hotel en Cuernavaca para el fin de semana?",
      "Notei que Quantfury subió 3% hoy. ¿Quieres revisarlo?",
      "Tu próxima reunión es en 30 minutos. ¿Necesitas la ruta?",
    ];

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  } catch (error) {
    return "¿Hay algo en lo que pueda ayudarte?";
  }
}

// ============================================
// 6. INICIAR EL SERVIDOR
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🤖 JARVIS activado en puerto ${PORT}`);
  console.log(`✅ Listo para recibir órdenes de Pepe`);
});

// Exportar para Vercel
module.exports = app;
