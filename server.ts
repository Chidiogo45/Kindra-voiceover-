import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

// Helper to extract clean error message from ElevenLabs responses
function parseElevenLabsError(status: number, data: any): string {
  if (data && typeof data === 'object') {
    if (data.detail) {
      if (typeof data.detail === 'string') {
        return data.detail;
      }
      if (typeof data.detail === 'object') {
        if (data.detail.message) {
          return data.detail.message;
        }
        if (data.detail.status) {
          return `${data.detail.status}: ${data.detail.message || 'ElevenLabs API error'}`;
        }
      }
    }
    if (data.message) {
      return data.message;
    }
  }

  switch (status) {
    case 401:
      return 'Invalid API key. Please check your ElevenLabs API key and try again.';
    case 402:
      return 'Insufficient credits or quota. Your ElevenLabs account does not have enough characters to complete this request.';
    case 403:
      return 'Access forbidden. The API key does not have permissions for this resource or model.';
    case 404:
      return 'Resource not found. The specified Voice ID or Model ID does not exist.';
    case 422:
      return 'Unprocessable request parameters. Please verify your script length and voice settings.';
    case 429:
      return 'ElevenLabs API rate limit reached. Please wait a moment before trying again.';
    default:
      return `ElevenLabs API request failed with status code ${status}.`;
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // JSON body parser with 10mb limit for script payloads
  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'kindra-voiceover' });
  });

  // 1. Test API Connection & Account Validation
  app.post('/api/elevenlabs/test-connection', async (req: Request, res: Response): Promise<void> => {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'API key is required. Please provide a valid ElevenLabs API key.',
      });
      return;
    }

    const cleanKey = apiKey.trim();

    try {
      // Validate key against /v1/user
      const userResponse = await fetch(`${ELEVENLABS_BASE_URL}/v1/user`, {
        method: 'GET',
        headers: {
          'xi-api-key': cleanKey,
          'Accept': 'application/json',
        },
      });

      if (!userResponse.ok) {
        let errData: any = null;
        try {
          errData = await userResponse.json();
        } catch {
          // ignore
        }
        const errorMsg = parseElevenLabsError(userResponse.status, errData);
        res.status(userResponse.status).json({
          success: false,
          error: errorMsg,
          statusCode: userResponse.status,
        });
        return;
      }

      const userData: any = await userResponse.json();

      // Also fetch subscription if available for character quota breakdown
      let subscriptionInfo: any = null;
      try {
        const subResponse = await fetch(`${ELEVENLABS_BASE_URL}/v1/user/subscription`, {
          method: 'GET',
          headers: {
            'xi-api-key': cleanKey,
            'Accept': 'application/json',
          },
        });
        if (subResponse.ok) {
          subscriptionInfo = await subResponse.json();
        }
      } catch {
        // non-blocking
      }

      const tier = subscriptionInfo?.tier || userData?.subscription?.tier || 'free';
      const characterCount = subscriptionInfo?.character_count ?? userData?.subscription?.character_count ?? 0;
      const characterLimit = subscriptionInfo?.character_limit ?? userData?.subscription?.character_limit ?? 10000;
      const status = subscriptionInfo?.status || userData?.subscription?.status || 'active';

      res.json({
        success: true,
        message: 'Successfully authenticated with ElevenLabs API.',
        account: {
          tier,
          characterCount,
          characterLimit,
          status,
          charactersRemaining: Math.max(0, characterLimit - characterCount),
        },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Network connection failed while connecting to ElevenLabs API.',
      });
    }
  });

  // 2. Retrieve Voices Dynamically
  app.post('/api/elevenlabs/voices', async (req: Request, res: Response): Promise<void> => {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'API key is required to fetch available voices.',
      });
      return;
    }

    try {
      const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices`, {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey.trim(),
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        let errData: any = null;
        try {
          errData = await response.json();
        } catch {
          // ignore
        }
        const errorMsg = parseElevenLabsError(response.status, errData);
        res.status(response.status).json({
          success: false,
          error: errorMsg,
          statusCode: response.status,
        });
        return;
      }

      const data: any = await response.json();
      const rawVoices = Array.isArray(data.voices) ? data.voices : [];

      // Format voices cleanly for client
      const voices = rawVoices.map((v: any) => ({
        voice_id: v.voice_id,
        name: v.name || 'Unnamed Voice',
        category: v.category || 'premade',
        description: v.description || '',
        labels: v.labels || {},
        preview_url: v.preview_url || null,
        settings: v.settings || null,
        high_quality_base_model_ids: v.high_quality_base_model_ids || [],
      }));

      res.json({
        success: true,
        count: voices.length,
        voices,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to retrieve voices from ElevenLabs API.',
      });
    }
  });

  // 3. Retrieve Models Dynamically
  app.post('/api/elevenlabs/models', async (req: Request, res: Response): Promise<void> => {
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'API key is required to fetch available models.',
      });
      return;
    }

    try {
      const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/models`, {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey.trim(),
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        let errData: any = null;
        try {
          errData = await response.json();
        } catch {
          // ignore
        }
        const errorMsg = parseElevenLabsError(response.status, errData);
        res.status(response.status).json({
          success: false,
          error: errorMsg,
        });
        return;
      }

      const modelsData: any = await response.json();
      const list = Array.isArray(modelsData) ? modelsData : [];
      // Filter for TTS capable models
      const ttsModels = list
        .filter((m: any) => m.can_do_text_to_speech !== false)
        .map((m: any) => ({
          model_id: m.model_id,
          name: m.name,
          description: m.description,
          max_characters_request_free_user: m.max_characters_request_free_user,
          max_characters_request_subscribed_user: m.max_characters_request_subscribed_user,
          languages: m.languages || [],
          can_be_finetuned: m.can_be_finetuned,
        }));

      res.json({
        success: true,
        models: ttsModels,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message || 'Failed to retrieve models from ElevenLabs API.',
      });
    }
  });

  // 4. Text-To-Speech Generation
  app.post('/api/elevenlabs/generate', async (req: Request, res: Response): Promise<void> => {
    const { apiKey, voiceId, text, modelId, voiceSettings } = req.body;

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      res.status(400).json({
        error: 'API key is missing. Please provide your ElevenLabs API key.',
      });
      return;
    }

    if (!voiceId || typeof voiceId !== 'string' || voiceId.trim().length === 0) {
      res.status(400).json({
        error: 'Voice ID is missing. Please select a valid voice from the list.',
      });
      return;
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({
        error: 'Script text is empty. Please enter text to convert to speech.',
      });
      return;
    }

    const trimmedText = text.trim();
    const cleanVoiceId = voiceId.trim();
    const cleanKey = apiKey.trim();
    const selectedModel = (modelId && typeof modelId === 'string' && modelId.trim()) 
      ? modelId.trim() 
      : 'eleven_multilingual_v2';

    // Prepare voice_settings payload if specified
    const settingsPayload: Record<string, any> = {};
    if (voiceSettings && typeof voiceSettings === 'object') {
      if (typeof voiceSettings.stability === 'number') {
        settingsPayload.stability = Math.max(0, Math.min(1, voiceSettings.stability));
      }
      if (typeof voiceSettings.similarity_boost === 'number') {
        settingsPayload.similarity_boost = Math.max(0, Math.min(1, voiceSettings.similarity_boost));
      }
      if (typeof voiceSettings.style === 'number') {
        settingsPayload.style = Math.max(0, Math.min(1, voiceSettings.style));
      }
      if (typeof voiceSettings.use_speaker_boost === 'boolean') {
        settingsPayload.use_speaker_boost = voiceSettings.use_speaker_boost;
      }
    }

    const requestBody: Record<string, any> = {
      text: trimmedText,
      model_id: selectedModel,
    };

    if (Object.keys(settingsPayload).length > 0) {
      requestBody.voice_settings = settingsPayload;
    }

    try {
      const elevenResponse = await fetch(
        `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(cleanVoiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': cleanKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!elevenResponse.ok) {
        let errorData: any = null;
        try {
          const contentType = elevenResponse.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            errorData = await elevenResponse.json();
          } else {
            const rawText = await elevenResponse.text();
            try {
              errorData = JSON.parse(rawText);
            } catch {
              errorData = { detail: rawText };
            }
          }
        } catch {
          // ignore
        }

        const formattedError = parseElevenLabsError(elevenResponse.status, errorData);
        res.status(elevenResponse.status).json({
          error: formattedError,
          statusCode: elevenResponse.status,
          detail: errorData,
        });
        return;
      }

      // Read audio binary
      const arrayBuffer = await elevenResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'attachment; filename="elevenlabs_voiceover.mp3"');
      res.setHeader('Content-Length', buffer.length.toString());
      res.setHeader('Cache-Control', 'no-cache');
      res.end(buffer);
    } catch (err: any) {
      res.status(500).json({
        error: err.message || 'Network failure while communicating with ElevenLabs Text-to-Speech API.',
      });
    }
  });

  // Client-side routing / Vite integration
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kindra Voiceover running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
