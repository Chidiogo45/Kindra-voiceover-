import React, { useState, useEffect, useRef } from 'react';
import {
  Key,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  Download,
  Trash2,
  RotateCcw,
  Sliders,
  Volume2,
  VolumeX,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Headphones,
  Check,
  Copy,
  ChevronDown,
  Info,
  Clock,
  AudioWaveform,
} from 'lucide-react';

interface Voice {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  labels: Record<string, string>;
  preview_url: string | null;
  settings: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  } | null;
  high_quality_base_model_ids?: string[];
}

interface Model {
  model_id: string;
  name: string;
  description: string;
  max_characters_request_free_user?: number;
  max_characters_request_subscribed_user?: number;
  languages?: Array<{ language_id: string; name: string }>;
}

interface AccountInfo {
  tier: string;
  characterCount: number;
  characterLimit: number;
  status: string;
  charactersRemaining: number;
}

interface GenerationHistoryItem {
  id: string;
  timestamp: string;
  text: string;
  voiceName: string;
  voiceId: string;
  modelId: string;
  blobUrl: string;
  blobSize: number;
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
}

const SAMPLE_SCRIPTS = [
  {
    title: 'Short Sentence',
    text: 'Hello! This is a real-time text-to-speech test using the ElevenLabs API.',
  },
  {
    title: 'Product Narrative',
    text: 'Welcome to the future of voice technology. With hyper-realistic synthesis, every nuance, pause, and emotion comes to life effortlessly.',
  },
  {
    title: 'Technical Readout',
    text: 'System diagnostics complete. Audio fidelity is verified at forty-four point one kilohertz. Latency metrics remain optimal across all nodes.',
  },
  {
    title: 'Storytelling',
    text: 'Deep within the whispering pines, the old observatory stood silently, gazing at stars that had burned for a billion years.',
  },
];

export default function App() {
  // Authentication & API state (never persisted to localStorage)
  const [apiKey, setApiKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'error'
  >('disconnected');
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);

  // Dynamic Voices & Models
  const [voices, setVoices] = useState<Voice[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('eleven_multilingual_v2');
  const [isLoadingVoices, setIsLoadingVoices] = useState<boolean>(false);
  const [voiceSearch, setVoiceSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Script & Generation
  const [scriptText, setScriptText] = useState<string>(
    'Welcome to Kindra Voiceover. Type any text here to test real speech synthesis with the ElevenLabs API.'
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Voice Settings (Sensible defaults)
  const [stability, setStability] = useState<number>(0.5);
  const [similarityBoost, setSimilarityBoost] = useState<number>(0.75);
  const [style, setStyle] = useState<number>(0.0);
  const [useSpeakerBoost, setUseSpeakerBoost] = useState<boolean>(true);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);

  // Audio Playback & Output
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [currentAudioBlob, setCurrentAudioBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [audioVolume, setAudioVolume] = useState<number>(1);
  const [copiedVoiceId, setCopiedVoiceId] = useState<boolean>(false);

  // Voice Preview (from ElevenLabs premade previews)
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);

  // Session History
  const [history, setHistory] = useState<GenerationHistoryItem[]>([]);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }
      history.forEach((h) => URL.revokeObjectURL(h.blobUrl));
    };
  }, []);

  // Update audio element listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setAudioCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setAudioDuration(audio.duration || 0);
    const handleEnded = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [currentAudioUrl]);

  // Sync volume with audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : audioVolume;
    }
  }, [audioVolume, isMuted]);

  // 1. Test Connection & Retrieve dynamic voices + models
  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setAuthError('Please enter an ElevenLabs API key to connect.');
      setConnectionStatus('error');
      return;
    }

    setConnectionStatus('connecting');
    setAuthError(null);
    setGeneralError(null);
    setIsLoadingVoices(true);

    try {
      // Step A: Test auth and get user subscription details
      const testRes = await fetch('/api/elevenlabs/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const testData = await testRes.json();

      if (!testRes.ok || !testData.success) {
        const message = testData.error || 'Authentication failed. Please verify your ElevenLabs API key.';
        setAuthError(message);
        setConnectionStatus('error');
        setIsLoadingVoices(false);
        return;
      }

      setAccountInfo(testData.account);
      setConnectionStatus('connected');

      // Step B: Retrieve available voices dynamically
      const voicesRes = await fetch('/api/elevenlabs/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const voicesData = await voicesRes.json();

      if (voicesRes.ok && voicesData.success && Array.isArray(voicesData.voices)) {
        setVoices(voicesData.voices);
        if (voicesData.voices.length > 0 && !selectedVoiceId) {
          // Default to first voice or Rachel if found
          const rachel = voicesData.voices.find(
            (v: Voice) => v.name.toLowerCase() === 'rachel'
          );
          setSelectedVoiceId(rachel ? rachel.voice_id : voicesData.voices[0].voice_id);
        }
      } else {
        setGeneralError(voicesData.error || 'Could not fetch voices for this account.');
      }

      // Step C: Retrieve available models dynamically
      try {
        const modelsRes = await fetch('/api/elevenlabs/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
        const modelsData = await modelsRes.json();
        if (modelsRes.ok && modelsData.success && Array.isArray(modelsData.models)) {
          setModels(modelsData.models);
        }
      } catch {
        // Non-fatal, fallback models will remain
      }
    } catch (err: any) {
      setAuthError(err.message || 'Network failure while attempting to reach backend.');
      setConnectionStatus('error');
    } finally {
      setIsLoadingVoices(false);
    }
  };

  // Disconnect / Reset session
  const handleDisconnect = () => {
    setApiKey('');
    setConnectionStatus('disconnected');
    setAccountInfo(null);
    setVoices([]);
    setModels([]);
    setSelectedVoiceId('');
    setAuthError(null);
    setGeneralError(null);
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      setCurrentAudioUrl(null);
      setCurrentAudioBlob(null);
    }
  };

  // Preview voice sample from ElevenLabs
  const handleTogglePreview = (previewUrl: string | null, voiceId: string) => {
    if (!previewUrl) return;

    if (previewingVoiceId === voiceId) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      setPreviewingVoiceId(null);
    } else {
      if (previewAudioRef.current) {
        previewAudioRef.current.src = previewUrl;
        previewAudioRef.current.play();
        setPreviewingVoiceId(voiceId);
      }
    }
  };

  // Generate Speech using ElevenLabs Text-to-Speech API
  const handleGenerateVoiceover = async () => {
    setGeneralError(null);

    // Validation checks
    if (!apiKey.trim()) {
      setGeneralError('Please connect your ElevenLabs API key first.');
      return;
    }

    if (!selectedVoiceId) {
      setGeneralError('Please select a voice from the dropdown.');
      return;
    }

    if (!scriptText.trim()) {
      setGeneralError('Please enter text in the script area before generating.');
      return;
    }

    // Check character count sanity
    const charCount = scriptText.trim().length;
    if (charCount > 5000) {
      setGeneralError(`Script exceeds maximum single request limit (5,000 chars). Current: ${charCount} chars.`);
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch('/api/elevenlabs/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          voiceId: selectedVoiceId,
          text: scriptText.trim(),
          modelId: selectedModelId,
          voiceSettings: {
            stability,
            similarity_boost: similarityBoost,
            style,
            use_speaker_boost: useSpeakerBoost,
          },
        }),
      });

      if (!response.ok) {
        let errData: any = null;
        try {
          errData = await response.json();
        } catch {
          // not json
        }
        const errorMsg =
          errData?.error ||
          `Generation failed with status code ${response.status}. Please check your quota or voice permissions.`;
        setGeneralError(errorMsg);
        return;
      }

      // Successful audio received as audio/mpeg binary
      const blob = await response.blob();
      const newAudioUrl = URL.createObjectURL(blob);

      // Clean up previous main URL if needed
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }

      setCurrentAudioUrl(newAudioUrl);
      setCurrentAudioBlob(blob);
      setAudioCurrentTime(0);

      // Add to session history
      const selectedVoice = voices.find((v) => v.voice_id === selectedVoiceId);
      const historyItem: GenerationHistoryItem = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        text: scriptText.trim(),
        voiceName: selectedVoice?.name || 'Selected Voice',
        voiceId: selectedVoiceId,
        modelId: selectedModelId,
        blobUrl: newAudioUrl,
        blobSize: blob.size,
        settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: useSpeakerBoost,
        },
      };

      setHistory((prev) => [historyItem, ...prev.slice(0, 9)]);

      // Update remaining characters locally if available
      if (accountInfo) {
        setAccountInfo({
          ...accountInfo,
          characterCount: accountInfo.characterCount + charCount,
          charactersRemaining: Math.max(0, accountInfo.charactersRemaining - charCount),
        });
      }

      // Auto play generated speech
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {
            // Browser autoplay policy might block silent audio; user can hit play button
          });
        }
      }, 100);
    } catch (err: any) {
      setGeneralError(err.message || 'Network failure while requesting voiceover synthesis.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Download MP3
  const handleDownloadMp3 = () => {
    if (!currentAudioBlob && !currentAudioUrl) return;

    const selectedVoice = voices.find((v) => v.voice_id === selectedVoiceId);
    const voiceNameClean = (selectedVoice?.name || 'voice')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');
    const filename = `elevenlabs_${voiceNameClean}_${Date.now()}.mp3`;

    const downloadLink = document.createElement('a');
    if (currentAudioBlob) {
      const url = URL.createObjectURL(currentAudioBlob);
      downloadLink.href = url;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (currentAudioUrl) {
      downloadLink.href = currentAudioUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    }
  };

  // Toggle playback
  const handlePlayPause = () => {
    if (!audioRef.current || !currentAudioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  // Scrub bar
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setAudioCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  // Clear script
  const handleClearScript = () => {
    setScriptText('');
    setGeneralError(null);
  };

  // Reset voice settings to defaults
  const handleResetSettings = () => {
    setStability(0.5);
    setSimilarityBoost(0.75);
    setStyle(0.0);
    setUseSpeakerBoost(true);
  };

  // Filter voices
  const filteredVoices = voices.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(voiceSearch.toLowerCase()) ||
      v.voice_id.toLowerCase().includes(voiceSearch.toLowerCase()) ||
      Object.values(v.labels || {}).some((lbl) =>
        lbl.toLowerCase().includes(voiceSearch.toLowerCase())
      );
    const matchesCategory =
      selectedCategory === 'all' || v.category.toLowerCase() === selectedCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(
    new Set(voices.map((v) => v.category.toLowerCase()).filter(Boolean))
  );

  const selectedVoice = voices.find((v) => v.voice_id === selectedVoiceId);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const copyVoiceId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedVoiceId(true);
    setTimeout(() => setCopiedVoiceId(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Hidden audio element for voice preview samples */}
      <audio
        ref={previewAudioRef}
        onEnded={() => setPreviewingVoiceId(null)}
        onError={() => setPreviewingVoiceId(null)}
        className="hidden"
      />

      {/* Primary Top Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Brand Zone */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20">
              <AudioWaveform className="w-5 h-5" />
            </div>
            <div>
              <span className="text-base font-semibold tracking-tight text-white whitespace-nowrap">
                Kindra Voiceover
              </span>
            </div>
          </div>

          {/* Middle Nav / Context */}
          <div className="hidden md:flex items-center gap-6 text-xs text-slate-400 font-medium">
            <span>Direct ElevenLabs Text-to-Speech API</span>
            <span aria-hidden="true">·</span>
            <span>xi-api-key Authentication</span>
            <span aria-hidden="true">·</span>
            <span>Real Dynamic Voices</span>
          </div>

          {/* Action Zone: Status indicator */}
          <div className="flex items-center gap-3 shrink-0">
            {connectionStatus === 'connected' ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-medium whitespace-nowrap">Connected</span>
                {accountInfo && (
                  <span className="text-emerald-400/80 font-mono text-[11px] tabular-nums">
                    ({accountInfo.tier.toUpperCase()} · {accountInfo.charactersRemaining.toLocaleString()} chars left)
                  </span>
                )}
              </div>
            ) : connectionStatus === 'connecting' ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span className="font-medium">Connecting...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-slate-400 text-xs">
                <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                <span className="font-medium">Not Connected</span>
              </div>
            )}

            {connectionStatus === 'connected' && (
              <button
                onClick={handleDisconnect}
                title="Disconnect API Key"
                className="p-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: API Authentication & Voice Selection (5 cols) */}
          <section className="lg:col-span-5 space-y-6">
            
            {/* 1. API Authentication Card */}
            <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white tracking-wide uppercase">
                    1. API Authentication
                  </h2>
                </div>
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                >
                  Get API Key
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="space-y-2">
                <label htmlFor="apiKeyInput" className="block text-xs font-medium text-slate-300">
                  ElevenLabs API Key (<code className="text-slate-400 font-mono text-[11px]">xi-api-key</code>)
                </label>
                <div className="relative">
                  <input
                    id="apiKeyInput"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="e.g. sk_398a72b..."
                    disabled={connectionStatus === 'connecting'}
                    className="w-full px-3.5 py-2.5 pr-20 text-xs font-mono bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors disabled:opacity-50"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="p-1.5 text-slate-400 hover:text-slate-200 rounded transition-colors"
                      title={showKey ? 'Hide key' : 'Show key'}
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Keys are forwarded securely in-memory via our backend proxy to ElevenLabs. Never saved to localStorage.
                </p>
              </div>

              {/* Connect / Test Button */}
              <div className="pt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={connectionStatus === 'connecting' || !apiKey.trim()}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-xs shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {connectionStatus === 'connecting' ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Testing API Connection...</span>
                    </>
                  ) : connectionStatus === 'connected' ? (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>Re-test / Refresh Voices</span>
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      <span>Connect / Test API</span>
                    </>
                  )}
                </button>
              </div>

              {/* Authentication Error Feedback */}
              {authError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/80 text-rose-200 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-rose-300">Connection Failed</p>
                    <p className="text-rose-200/90 leading-relaxed">{authError}</p>
                  </div>
                </div>
              )}

              {/* Successful Account Quota Details */}
              {accountInfo && (
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-2">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Account Tier</span>
                    <span className="font-semibold text-slate-200 uppercase">{accountInfo.tier}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Character Usage</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {accountInfo.characterCount.toLocaleString()} / {accountInfo.characterLimit.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          (accountInfo.characterCount / Math.max(1, accountInfo.characterLimit)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. Voice & Model Selection Card */}
            <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Headphones className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white tracking-wide uppercase">
                    2. Voice & Model
                  </h2>
                </div>
                <span className="text-xs text-slate-400 font-mono tabular-nums">
                  {voices.length} voices
                </span>
              </div>

              {connectionStatus !== 'connected' && voices.length === 0 ? (
                <div className="py-8 text-center text-slate-500 space-y-2 border border-dashed border-slate-800 rounded-lg">
                  <Headphones className="w-8 h-8 mx-auto text-slate-600 opacity-60" />
                  <p className="text-xs">Connect your API key above to load account voices dynamically.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Category Filter Tabs */}
                  {categories.length > 1 && (
                    <div className="flex flex-wrap gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => setSelectedCategory('all')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          selectedCategory === 'all'
                            ? 'bg-slate-800 text-white shadow-xs'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        All ({voices.length})
                      </button>
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                            selectedCategory === cat
                              ? 'bg-slate-800 text-white shadow-xs'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {cat} ({voices.filter((v) => v.category.toLowerCase() === cat).length})
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Voice Search input */}
                  {voices.length > 5 && (
                    <input
                      type="text"
                      placeholder="Search voices by name, accent, or ID..."
                      value={voiceSearch}
                      onChange={(e) => setVoiceSearch(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                  )}

                  {/* Dynamic Voice Select Dropdown */}
                  <div className="space-y-1.5">
                    <label htmlFor="voiceSelect" className="block text-xs font-medium text-slate-300">
                      Select Voice ({filteredVoices.length} available)
                    </label>
                    <div className="relative">
                      <select
                        id="voiceSelect"
                        value={selectedVoiceId}
                        onChange={(e) => setSelectedVoiceId(e.target.value)}
                        className="w-full px-3.5 py-2.5 pr-10 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors appearance-none"
                      >
                        {filteredVoices.map((voice) => (
                          <option key={voice.voice_id} value={voice.voice_id}>
                            {voice.name} — {voice.category} ({voice.voice_id.slice(0, 8)}...)
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Selected Voice Details Card */}
                  {selectedVoice && (
                    <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/90 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-slate-200 text-sm">{selectedVoice.name}</div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <span className="capitalize">{selectedVoice.category}</span>
                            {Object.entries(selectedVoice.labels || {}).slice(0, 3).map(([k, val]) => (
                              <React.Fragment key={k}>
                                <span aria-hidden="true">·</span>
                                <span className="capitalize">{val}</span>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>

                        {/* ElevenLabs native voice sample preview button */}
                        {selectedVoice.preview_url && (
                          <button
                            type="button"
                            onClick={() => handleTogglePreview(selectedVoice.preview_url, selectedVoice.voice_id)}
                            className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                              previewingVoiceId === selectedVoice.voice_id
                                ? 'bg-amber-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                            title="Play official sample preview"
                          >
                            {previewingVoiceId === selectedVoice.voice_id ? (
                              <>
                                <Pause className="w-3.5 h-3.5" />
                                <span>Playing</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                <span>Sample</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Voice ID display with copy */}
                      <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60">
                        <span className="font-mono text-slate-500">ID: {selectedVoice.voice_id}</span>
                        <button
                          type="button"
                          onClick={() => copyVoiceId(selectedVoice.voice_id)}
                          className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          {copiedVoiceId ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy ID</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ElevenLabs Model Selector */}
                  <div className="space-y-1.5">
                    <label htmlFor="modelSelect" className="block text-xs font-medium text-slate-300">
                      ElevenLabs Model
                    </label>
                    <div className="relative">
                      <select
                        id="modelSelect"
                        value={selectedModelId}
                        onChange={(e) => setSelectedModelId(e.target.value)}
                        className="w-full px-3.5 py-2.5 pr-10 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors appearance-none"
                      >
                        {models.length > 0 ? (
                          models.map((m) => (
                            <option key={m.model_id} value={m.model_id}>
                              {m.name || m.model_id}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="eleven_multilingual_v2">Eleven Multilingual v2 (29 Languages, High Quality)</option>
                            <option value="eleven_flash_v2_5">Eleven Flash v2.5 (Fastest, Multilingual)</option>
                            <option value="eleven_turbo_v2_5">Eleven Turbo v2.5 (Low Latency, High Quality)</option>
                            <option value="eleven_monolingual_v1">Eleven English v1 (Standard Monolingual)</option>
                          </>
                        )}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Voice Settings (Stability, Similarity Boost, Style, Speaker Boost) */}
            <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="flex items-center gap-2 text-sm font-semibold text-white tracking-wide uppercase hover:text-indigo-400 transition-colors"
                >
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span>3. Voice Settings</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      showAdvancedSettings ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={handleResetSettings}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Reset Defaults
                </button>
              </div>

              {showAdvancedSettings && (
                <div className="space-y-4 pt-2 border-t border-slate-800/80">
                  {/* Stability Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">Stability</span>
                      <span className="font-mono text-indigo-400 tabular-nums">
                        {(stability * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={stability}
                      onChange={(e) => setStability(parseFloat(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>More Variable (Expressive)</span>
                      <span>More Stable (Consistent)</span>
                    </div>
                  </div>

                  {/* Similarity Boost Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">Similarity Boost</span>
                      <span className="font-mono text-indigo-400 tabular-nums">
                        {(similarityBoost * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={similarityBoost}
                      onChange={(e) => setSimilarityBoost(parseFloat(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>Low</span>
                      <span>High Fidelity</span>
                    </div>
                  </div>

                  {/* Style Slider */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">Style Exaggeration</span>
                      <span className="font-mono text-indigo-400 tabular-nums">
                        {(style * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={style}
                      onChange={(e) => setStyle(parseFloat(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    />
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>Subtle (0%)</span>
                      <span>Pronounced (100%)</span>
                    </div>
                  </div>

                  {/* Speaker Boost Toggle */}
                  <div className="pt-1 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-medium text-slate-300 block">Speaker Boost</span>
                      <span className="text-[11px] text-slate-500">Boosts voice clarity and similarity</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useSpeakerBoost}
                        onChange={(e) => setUseSpeakerBoost(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                    </label>
                  </div>
                </div>
              )}
            </div>

          </section>

          {/* Right Column: Script Input, Generation & Audio Output (7 cols) */}
          <section className="lg:col-span-7 space-y-6">
            
            {/* 4. Script Text Area Card */}
            <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white tracking-wide uppercase">
                    4. Script & Voiceover
                  </h2>
                </div>
                {/* Character Counter */}
                <div className="text-xs font-mono tabular-nums text-slate-400">
                  <span className={scriptText.length > 5000 ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                    {scriptText.length.toLocaleString()}
                  </span>
                  <span className="text-slate-500"> / 5,000 chars</span>
                </div>
              </div>

              {/* Sample script presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 font-medium mr-1">Presets:</span>
                {SAMPLE_SCRIPTS.map((sample) => (
                  <button
                    key={sample.title}
                    type="button"
                    onClick={() => setScriptText(sample.text)}
                    className="px-2.5 py-1 text-xs rounded-md bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors"
                  >
                    {sample.title}
                  </button>
                ))}
              </div>

              {/* Textarea */}
              <div className="space-y-1">
                <textarea
                  rows={6}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder="Enter the voiceover script here. Type or paste your text to test ElevenLabs speech generation..."
                  className="w-full p-3.5 text-sm leading-relaxed bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-y min-h-[140px]"
                />
              </div>

              {/* Action Buttons: Generate, Clear */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleClearScript}
                  disabled={!scriptText}
                  className="py-2.5 px-3.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>

                <button
                  type="button"
                  onClick={handleGenerateVoiceover}
                  disabled={isGenerating || !scriptText.trim()}
                  className="flex-1 max-w-xs py-2.5 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-xs shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Synthesizing Voiceover...</span>
                    </>
                  ) : (
                    <>
                      <Headphones className="w-4 h-4" />
                      <span>Generate Voiceover</span>
                    </>
                  )}
                </button>
              </div>

              {/* General or Generation Error Alert */}
              {generalError && (
                <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/80 text-rose-200 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-rose-300">API Error</p>
                    <p className="text-rose-200/95 leading-relaxed">{generalError}</p>
                  </div>
                </div>
              )}
            </div>

            {/* 5. Audio Player & Output Card */}
            <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-white tracking-wide uppercase">
                    5. Generated Audio
                  </h2>
                </div>
                {currentAudioBlob && (
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    {(currentAudioBlob.size / 1024).toFixed(1)} KB · MP3
                  </span>
                )}
              </div>

              {/* Hidden native HTML audio element for master playback */}
              <audio ref={audioRef} src={currentAudioUrl || undefined} preload="metadata" />

              {currentAudioUrl ? (
                <div className="space-y-4 p-4 rounded-lg bg-slate-950 border border-slate-800">
                  {/* Custom Player Controls */}
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={handlePlayPause}
                      className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white flex items-center justify-center shadow-md transition-colors shrink-0"
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>

                    <div className="flex-1 space-y-1">
                      {/* Scrub bar */}
                      <input
                        type="range"
                        min="0"
                        max={audioDuration || 1}
                        step="0.01"
                        value={audioCurrentTime}
                        onChange={handleSeek}
                        className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
                      />
                      <div className="flex justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                        <span>{formatTime(audioCurrentTime)}</span>
                        <span>{formatTime(audioDuration)}</span>
                      </div>
                    </div>

                    {/* Volume toggle */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsMuted(!isMuted)}
                        className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted || audioVolume === 0 ? (
                          <VolumeX className="w-4 h-4 text-rose-400" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={isMuted ? 0 : audioVolume}
                        onChange={(e) => {
                          setAudioVolume(parseFloat(e.target.value));
                          setIsMuted(false);
                        }}
                        className="w-16 accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg hidden sm:block"
                      />
                    </div>
                  </div>

                  {/* Standard Native Audio Control fallback */}
                  <div className="pt-2 border-t border-slate-900">
                    <audio
                      controls
                      src={currentAudioUrl}
                      className="w-full h-8 opacity-75 hover:opacity-100 transition-opacity"
                    />
                  </div>

                  {/* Download MP3 Button */}
                  <div className="pt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-400">
                      <span>Ready for playback and export</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadMp3}
                      className="py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-medium text-xs shadow-sm transition-colors flex items-center gap-2 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download MP3</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center text-slate-500 space-y-2 border border-dashed border-slate-800 rounded-lg">
                  <Headphones className="w-8 h-8 mx-auto text-slate-600 opacity-60" />
                  <p className="text-xs">No audio generated yet.</p>
                  <p className="text-[11px] text-slate-600">
                    Click &ldquo;Generate Voiceover&rdquo; to test actual ElevenLabs speech synthesis.
                  </p>
                </div>
              )}
            </div>

            {/* 6. Recent Session Generations History */}
            {history.length > 0 && (
              <div className="p-6 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-semibold text-white tracking-wide uppercase">
                      Session Tests ({history.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500">In-memory history</span>
                </div>

                <div className="space-y-2">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">{item.voiceName}</span>
                          <span className="text-slate-500 font-mono text-[11px]">{item.timestamp}</span>
                          <span className="text-slate-500 font-mono text-[11px] tabular-nums">
                            {(item.blobSize / 1024).toFixed(1)} KB
                          </span>
                        </div>
                        <p className="text-slate-400 truncate text-[11px] mt-0.5">
                          &ldquo;{item.text}&rdquo;
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (currentAudioUrl) {
                              URL.revokeObjectURL(currentAudioUrl);
                            }
                            setCurrentAudioUrl(item.blobUrl);
                            if (audioRef.current) {
                              audioRef.current.currentTime = 0;
                              audioRef.current.play().catch(() => {});
                            }
                          }}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                          title="Load and play this test"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <a
                          href={item.blobUrl}
                          download={`elevenlabs_${item.voiceName.toLowerCase()}_${item.id}.mp3`}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                          title="Download MP3"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Testing Workflow Guide */}
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-xs text-slate-400 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Info className="w-3.5 h-3.5 text-indigo-400" />
                <span>Standard Testing Workflow</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 leading-relaxed">
                <li>Paste your ElevenLabs API key and click <strong className="text-slate-300 font-medium">Connect / Test API</strong>.</li>
                <li>Verify your account connection status and remaining character quota.</li>
                <li>Select a dynamically retrieved voice from your account and choose your preferred model.</li>
                <li>Enter or customize your script in the text area (or select a preset).</li>
                <li>Click <strong className="text-slate-300 font-medium">Generate Voiceover</strong> to synthesize real speech.</li>
                <li>Audition using the audio player, adjust voice settings as desired, and download the MP3 file.</li>
              </ol>
            </div>

          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Kindra Voiceover</span>
          <div className="flex items-center gap-3 text-[11px]">
            <span>Official ElevenLabs API v1</span>
            <span aria-hidden="true">·</span>
            <span>xi-api-key Authentication</span>
            <span aria-hidden="true">·</span>
            <span>Text-to-Speech Engine</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
