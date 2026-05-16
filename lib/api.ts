// Single source of truth for talking to the gen-studio NestJS backend.
// All endpoints documented in the corresponding controllers.

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  // Some endpoints (notably /generation/jobs/:id when ComfyUI hasn't recorded
  // the prompt yet) return 200 with an empty body. Treat that as null.
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

export interface DashboardResponse {
  project: { id: string; slug: string; name: string };
  profiles: ProfileSummary[];
}

export interface ProfileSummary {
  profileId:     string;
  characterId:   string;
  characterCode: string;
  displayName:   string | null;
  profileCode:   string;
  ageLabel:      string | null;
  targetImages:  number | null;
  triggerToken:  string | null;
  datasetCount:  number;
  loraReady:     boolean;
  loraPath:      string | null;
  loraSizeMB:    number | null;
  phase:         'idle' | 'queued' | 'generating' | 'has_dataset' | 'training' | 'ready';
  lastDatasetJob: {
    id: string; status: string;
    dependsOnProfileId: string | null;
    referenceProfileId: string | null;
    error: string | null;
    queuedAt: string;
  } | null;
  lastTrainingJob: {
    id: string; status: string; error: string | null;
    startedAt: string | null; completedAt: string | null;
  } | null;
}

export interface DatasetImage { filename: string; size: number; mtime: number; }

export interface LoraVariant {
  filename:  string;
  fullPath:  string;
  /** epoch index parsed from `<name>-NNNNNN.safetensors`; null = final. */
  epoch:     number | null;
  sizeBytes: number;
  mtime:     string;
  /** Human-readable label: "final" or "epoch 3". */
  label:     string;
}

export interface ProfileFull {
  id:             string;
  profileCode:    string;
  ageLabel:       string | null;
  targetImages:   number | null;
  promptBase:     string;
  negative:       string | null;
  promptAngles:   string | null;
  promptVariety:  string | null;
  datasetPath:    string | null;
  loraPath:       string | null;
  /** All LoRA checkpoints (final + intermediate) saved by the last training run. */
  loraVariants:   LoraVariant[] | null;
  triggerToken:   string | null;
  characterId:    string;
  character?: {
    id:          string;
    code:        string;
    displayName: string | null;
    project?:    { id: string; slug: string; name: string };
  };
}

export interface UpdateProfileBody {
  ageLabel?:      string;
  targetImages?:  number;
  promptBase?:    string;
  negative?:      string;
  promptAngles?:  string;
  promptVariety?: string;
  triggerToken?:  string;
}

export interface ShotParticipant {
  id:          string;
  label:       string;
  characterId: string | null;
  profileId:   string | null;
  character?:  {
    id: string;
    code: string;
    displayName: string | null;
    profiles?: Array<{ id: string; profileCode: string; loraPath: string | null; ageLabel: string | null }>;
  } | null;
  profile?:    { id: string; profileCode: string; loraPath: string | null; ageLabel: string | null } | null;
}

/** promptFields is freeform JSON, but these are the conventional keys. */
export interface ShotPromptFields {
  narrativeBeat?:          string;
  storyFunction?:          string;
  frameDescription?:       string;
  location?:               { label?: string; interiorExterior?: string };
  lightingMood?:           string;
  positive?:               string;
  negative?:               string;
  positiveCharacterLocks?: string;
  positiveEnvironment?:    string;
  camera?:                 { framing?: string; movement?: string };
  production?:             { notes?: string; promptStatus?: string; assetRefs?: string[] };
  workflowParams?:         { seedPolicy?: string; faceswapRef?: string };
  captionGenerator?:       string;
  [key: string]: unknown;
}

export interface RenderedImage {
  filename:    string;
  promptId?:   string;
  seed?:       number;
  strategyId?: string;
  createdAt?:  string;
}

export interface ShotFull {
  id:                  string;
  projectId:           string;
  sceneId:             string;
  shotCode:            string;
  promptFields:        ShotPromptFields | null;
  workflowRouteKey:    string | null;
  referenceProfileId:  string | null;
  referenceImagePool:  unknown;
  renderedImages:      RenderedImage[] | null;
  chosenRender:        string | null;
  chosenVideoId:       string | null;
  participants:        ShotParticipant[];
  scene?: {
    id:              string;
    sceneKey:        string;
    title:           string | null;
    sortOrder:       number;
    /** Scene-level voiceover text (the slice of script.md this scene covers). */
    narrationText:   string | null;
    /** Inclusive line range in the project's script.md. */
    scriptStartLine: number | null;
    scriptEndLine:   number | null;
  };
  project?: { id: string; slug: string; name: string };
}

export interface UpdateShotBody {
  shotCode?:           string;
  sceneId?:            string;
  promptFields?:       ShotPromptFields;
  workflowRouteKey?:   string;
  referenceProfileId?: string;
  participants?:       Array<{ label: string; characterId?: string | null; profileId?: string | null }>;
}

export interface CreateShotBody {
  shotCode:           string;
  sceneId:            string;
  promptFields?:      ShotPromptFields;
  workflowRouteKey?:  string;
  referenceProfileId?: string;
}

export interface ProjectListItem {
  id:        string;
  slug:      string;
  name:      string;
  settings?: unknown;
}

export interface SceneShotParticipant {
  id:                   string;
  label:                string;
  characterId:          string | null;
  characterCode:        string | null;
  characterDisplayName: string | null;
  profileId:            string | null;
  profileCode:          string | null;
  profileAgeLabel:      string | null;
  loraReady:            boolean;
  chosenExplicitly:     boolean;
}

export interface SceneShot {
  id:                   string;
  shotCode:             string;
  beat:                 string | null;
  location:             string | null;
  cameraFraming:        string | null;
  participants:         SceneShotParticipant[];
  rendersCount:         number;
  chosenRender:         string | null;
  activeRenderPromptId: string | null;
  /** Most recent pending|running pipeline render job for this shot, or null. */
  pipelineRender:       { id: string; status: string; queuedAt: string } | null;

  // ── Video state (mirrors chosenRender for the animation pass) ──────────────
  /** How many VideoRender rows exist for the shot (any status). */
  videosCount:    number;
  /** VideoRender.id approved as the canonical motion clip, or null. */
  chosenVideoId:  string | null;
  /** Summary of the chosen video (status info needed to render the right button). */
  chosenVideo:    {
    id:               string;
    outputFilename:   string | null;
    upscaleStatus:    'pending' | 'running' | 'completed' | 'failed' | null;
    upscaledFilename: string | null;
  } | null;
  /** Oldest pending|running video render — used to badge "⚙ video" in the row. */
  pipelineVideo:   { id: string; status: string; queuedAt: string } | null;
  /** Pending|running upscale on the chosen video, if any. */
  pipelineUpscale: { id: string; status: string } | null;
}

export interface SceneSummary {
  id:              string;
  sceneKey:        string;
  title:           string | null;
  sortOrder:       number;
  /** Scene-level voiceover script — used by the TTS narration modal. */
  narrationText:   string | null;
  /** Which lines in <slug>_script.md this scene covers (inclusive). */
  scriptStartLine: number | null;
  scriptEndLine:   number | null;
  shots:           SceneShot[];
}

export type QueueJobType = 'training' | 'dataset' | 'scene' | 'video' | 'video_upscale';

export interface QueueRow {
  type:          QueueJobType;
  id:            string;
  status:        string;
  profileCode:   string;
  characterCode: string;
  projectSlug:   string;
  triggerToken:  string | null;
  queuedAt:      string;
  startedAt:     string | null;
  completedAt:   string | null;
  errorMessage:  string | null;
}

export interface QueueSnapshot {
  active:  QueueRow[];
  pending: QueueRow[];
  recent:  QueueRow[];
}

export interface ScenesResponse {
  project: { id: string; slug: string; name: string };
  scenes:  SceneSummary[];
}

export const api = {
  listProjects: () =>
    http<ProjectListItem[]>(`/projects`),

  dashboard: (slug: string) =>
    http<DashboardResponse>(`/projects/${slug}/dashboard`),

  listScenes: (slug: string) =>
    http<ScenesResponse>(`/projects/${slug}/scenes`),

  listImages: (profileId: string) =>
    http<{ profileCode: string; count: number; images: DatasetImage[] }>(
      `/datasets/profiles/${profileId}/images`,
    ),

  deleteImage: (profileId: string, filename: string) =>
    http<{ deleted: string }>(
      `/datasets/profiles/${profileId}/images/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    ),

  imageUrl: (profileId: string, filename: string) =>
    `${API_BASE}/datasets/profiles/${profileId}/images/${encodeURIComponent(filename)}/raw`,

  // Reference image (used as ComfyUI LoadImage source for dataset gen)
  referenceInfo: (profileId: string) =>
    http<
      | { exists: false; profileCode: string }
      | { exists: true;  profileCode: string; filename: string; size: number; mtime: number }
    >(`/datasets/profiles/${profileId}/reference`),

  referenceUrl: (profileId: string, cacheBust?: number) =>
    `${API_BASE}/datasets/profiles/${profileId}/reference/raw${cacheBust ? `?t=${cacheBust}` : ''}`,

  uploadReference: async (profileId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/datasets/profiles/${profileId}/reference`, {
      method: 'POST',
      body:   fd,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<{ uploaded: true; path: string; size: number; mime: string }>;
  },

  deleteReference: (profileId: string) =>
    http<{ deleted: string }>(`/datasets/profiles/${profileId}/reference`, { method: 'DELETE' }),

  enqueueDataset: (
    profileId: string,
    body: {
      dependsOnProfileId?:     string;
      referenceProfileId?:     string;
      referenceImageFilename?: string;
    } = {},
  ) =>
    http<{ id: string; status: string }>(
      `/dataset-queue/profiles/${profileId}/enqueue`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  cancelDatasetJob: (jobId: string) =>
    http(`/dataset-queue/jobs/${jobId}`, { method: 'DELETE' }),

  // Profile read/edit
  getProfile: (profileId: string) =>
    http<ProfileFull>(`/profiles/${profileId}`),

  updateProfile: (profileId: string, body: UpdateProfileBody) =>
    http<ProfileFull>(`/profiles/${profileId}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  // ── LoRA library (manage all checkpoints saved by training) ─────────────
  // Backend endpoints (added in profiles.controller.ts) — require Nest restart
  // to take effect. Until then these calls return 404 and the UI surfaces it.

  /** Rescan disk for new/missing files and return the up-to-date variants list. */
  listLoraVariants: (profileId: string) =>
    http<{ active: string | null; variants: LoraVariant[] }>(
      `/profiles/${profileId}/loras`,
    ),

  /** Mark one variant as active (sets profile.loraPath). */
  setActiveLora: (profileId: string, filename: string) =>
    http<ProfileFull>(`/profiles/${profileId}/loras/active`, {
      method: 'POST',
      body:   JSON.stringify({ filename }),
    }),

  /** Delete a variant from disk and from the variants list. */
  deleteLoraVariant: (profileId: string, filename: string) =>
    http<{ deleted: string; variants: LoraVariant[] }>(
      `/profiles/${profileId}/loras/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    ),

  // Create character (with optional first profile)
  createCharacter: (
    projectIdOrSlug: string,
    body: {
      code: string;
      displayName?: string;
      profile?: {
        profileCode:    string;
        promptBase:     string;
        negative?:      string;
        ageLabel?:      string;
        targetImages?:  number;
        promptAngles?:  string;
        promptVariety?: string;
        triggerToken?:  string;
      };
    },
  ) =>
    http<{ id: string; code: string; displayName: string | null; profiles: ProfileFull[] }>(
      `/projects/${projectIdOrSlug}/characters`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Project characters list (used by shot editor for participant dropdown)
  listCharacters: (projectIdOrSlug: string) =>
    http<Array<{
      id:          string;
      code:        string;
      displayName: string | null;
      profiles:    Array<{ id: string; profileCode: string; loraPath: string | null; ageLabel: string | null }>;
    }>>(`/projects/${projectIdOrSlug}/characters`),

  characterUsage: (projectIdOrSlug: string, characterId: string) =>
    http<{
      character:        { id: string; code: string; displayName: string | null };
      profileCount:     number;
      participantCount: number;
      shotCount:        number;
      sceneCount:       number;
      shots:            Array<{ id: string; shotCode: string; sceneId: string }>;
    }>(`/projects/${projectIdOrSlug}/characters/${characterId}/usage`),

  deleteCharacter: (projectIdOrSlug: string, characterId: string) =>
    http<{ deleted: { characterId: string; code: string; profileCodes: string[] }; filesRemoved: number; paths: string[] }>(
      `/projects/${projectIdOrSlug}/characters/${characterId}`,
      { method: 'DELETE' },
    ),

  // Shot rendering — queues a ComfyUI job, returns prompt_id
  renderShot: (shotId: string, body: { dryRun?: boolean; scenePrompt?: string; seed?: number; loraStrength?: number; batchSize?: number } = {}) =>
    http<{
      shotId:        string;
      shotCode:      string;
      strategyId:    string;
      participants:  Array<{ profileCode: string; displayName: string; loraPath: string }>;
      job?:          { promptId: string; number: number };
      workflow?:     unknown;
    }>(`/generation/shots/${shotId}/render${body.dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  // Enqueue scene render via the pipeline (preferred — coordinates with training/dataset queues)
  enqueueShotRender: (shotId: string, body: { scenePrompt?: string; seed?: number; loraStrength?: number; batchSize?: number } = {}) =>
    http<{ id: string; shotId: string; status: string; queuedAt: string }>(
      `/generation/shots/${shotId}/enqueue`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ComfyUI live queue — list of running + pending prompt_ids
  comfyQueue: () =>
    http<{ running: string[]; pending: string[] }>(`/generation/comfy-queue`),

  // ComfyUI history — proxied through gen-studio (CORS-safe)
  comfyHistory: (promptId: string) =>
    http<{
      status?:  { status_str: string; completed: boolean };
      outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
    } | null>(`/generation/jobs/${promptId}`),

  // ComfyUI /view proxied through gen-studio (CORS-safe + works in img tags).
  // Prefer shotImageUrl() for shot renders — it reads from the project tree and
  // does not depend on ComfyUI being alive.
  comfyViewUrl: (filename: string, subfolder = '', type = 'output') =>
    `${API_BASE}/generation/comfy-image?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`,

  /**
   * Stream a rendered shot image directly from disk
   * (data/<slug>/shots/<shotCode>/<filename>, falls back to COMFY_OUTPUT).
   * Doesn't depend on ComfyUI running — survives engine restarts.
   */
  shotImageUrl: (shotId: string, filename: string) =>
    `${API_BASE}/shots/${shotId}/renders/${encodeURIComponent(filename)}/raw`,

  // Shots
  getShot: (shotId: string) =>
    http<ShotFull>(`/shots/${shotId}`),

  updateShot: (shotId: string, body: UpdateShotBody) =>
    http<ShotFull>(`/shots/${shotId}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  deleteShot: (shotId: string) =>
    http(`/shots/${shotId}`, { method: 'DELETE' }),

  addShotRender: (shotId: string, body: { filename: string; promptId?: string; seed?: number; strategyId?: string }) =>
    http<ShotFull>(`/shots/${shotId}/renders`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  removeShotRender: (shotId: string, filename: string) =>
    http<ShotFull>(`/shots/${shotId}/renders/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),

  setChosenRender: (shotId: string, filename: string | null) =>
    http<ShotFull>(`/shots/${shotId}/chosen-render`, {
      method: 'PATCH',
      body:   JSON.stringify({ filename }),
    }),

  setChosenVideo: (shotId: string, videoId: string | null) =>
    http<ShotFull>(`/shots/${shotId}/chosen-video`, {
      method: 'PATCH',
      body:   JSON.stringify({ videoId }),
    }),

  createShot: (projectIdOrSlug: string, body: CreateShotBody) =>
    http<ShotFull>(`/projects/${projectIdOrSlug}/shots`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  // Create scene
  createScene: (
    projectIdOrSlug: string,
    body: {
      sceneKey:                     string;
      title?:                       string;
      sortOrder?:                   number;
      defaultReferenceProfileCode?: string;
    },
  ) =>
    http<{ id: string; sceneKey: string; title: string | null; sortOrder: number }>(
      `/projects/${projectIdOrSlug}/scenes`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  trainingProgress: (jobId: string) =>
    http<{
      phase:      string;
      step:       number | null;
      totalSteps: number | null;
      percent:    number | null;
      avgLoss:    number | null;
      eta:        string | null;
      elapsed?:   string;
      elapsedMs:  number | null;
      lastLine:   string | null;
    }>(`/training/jobs/${jobId}/progress`),

  /** Full step series parsed from train.log — every kohya step line decimated. */
  trainingHistory: (jobId: string, maxPoints = 500) =>
    http<{
      phase:      string;
      totalSteps: number | null;
      samples:    Array<{
        step:       number;
        totalSteps: number;
        percent:    number;
        avgLoss:    number;
        elapsedSec: number;
        etaSec:     number | null;
        secPerIt:   number;
      }>;
    }>(`/training/jobs/${jobId}/history?maxPoints=${maxPoints}`),

  listTrainingJobs: (profileId: string) =>
    http<Array<{
      id:           string;
      profileId:    string;
      status:       string;
      logPath:      string | null;
      outputLoraPath: string | null;
      errorMessage: string | null;
      startedAt:    string | null;
      completedAt:  string | null;
      createdAt:    string;
    }>>(`/training/jobs?profileId=${profileId}`),

  cancelTraining: (jobId: string) =>
    http(`/training/jobs/${jobId}`, { method: 'DELETE' }),

  startTraining: (profileId: string, body: Record<string, unknown> = {}) =>
    http<{ id: string; status: string }>(
      `/training/profiles/${profileId}/start`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ── Pipeline queue (unified across training + dataset) ──────────────────
  pipelineQueue: () =>
    http<QueueSnapshot>(`/pipeline/queue`),

  pipelineMove: (type: QueueJobType, id: string, direction: 'up' | 'down') =>
    http<{ moved: boolean; swappedWith?: { type: QueueJobType; id: string }; reason?: string }>(
      `/pipeline/queue/${type}/${id}/move`,
      { method: 'POST', body: JSON.stringify({ direction }) },
    ),

  pipelineCancel: (type: QueueJobType, id: string) =>
    http(`/pipeline/queue/${type}/${id}/cancel`, { method: 'POST' }),

  // ── Video renders (Wan2.2 i2v from the shot's chosen render) ──────────────
  startVideoRender: (
    shotId: string,
    body: { motionPrompt?: string; seed?: number; width?: number; height?: number; length?: number; fps?: number; count?: number } = {},
  ) =>
    http<VideoRender[]>(`/generation/shots/${shotId}/videos`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  listVideosForShot: (shotId: string) =>
    http<VideoRender[]>(`/generation/shots/${shotId}/videos`),

  getVideo: (videoId: string) =>
    http<VideoRender>(`/generation/videos/${videoId}`),

  // For <video src> — backend streams the mp4 with proper content-type.
  videoFileUrl: (videoId: string) =>
    `${API_BASE}/generation/videos/${videoId}/file`,

  videoFhdFileUrl: (videoId: string) =>
    `${API_BASE}/generation/videos/${videoId}/file-fhd`,

  upscaleVideo: (videoId: string) =>
    http<VideoRender>(`/generation/videos/${videoId}/upscale`, { method: 'POST' }),

  deleteVideo: (videoId: string) =>
    http<{ deleted: true; id: string }>(`/generation/videos/${videoId}`, { method: 'DELETE' }),

  // ── TTS (Silero V5 ru) ────────────────────────────────────────────────────
  startTTS: (
    sceneId: string,
    body: { text?: string; voice?: TTSVoice; sampleRate?: TTSSampleRate } = {},
  ) =>
    http<TTSJob>(`/tts/scenes/${sceneId}`, {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  listTTSJobs: (sceneId: string) =>
    http<TTSJob[]>(`/tts/scenes/${sceneId}/jobs`),

  setSceneNarrationText: (sceneId: string, text: string) =>
    http<{ id: string; narrationText: string | null }>(`/tts/scenes/${sceneId}/narration`, {
      method: 'PATCH',
      body:   JSON.stringify({ text }),
    }),

  getTTSJob: (jobId: string) =>
    http<TTSJob>(`/tts/jobs/${jobId}`),

  ttsFileUrl: (jobId: string) =>
    `${API_BASE}/tts/jobs/${jobId}/file`,

  /**
   * Read the project's full narration script (Markdown), if one is configured.
   * Used by the TTS modal to show the user the full story they're voicing —
   * they then copy/paste relevant chunks per scene.
   */
  getProjectScript: (idOrSlug: string) =>
    http<{ text: string | null; path: string | null }>(`/projects/${idOrSlug}/script`),
};

export type TTSVoice      = 'aidar' | 'baya' | 'kseniya' | 'xenia' | 'eugene' | 'random';
export type TTSSampleRate = 8000 | 24000 | 48000;

export interface TTSJob {
  id:             string;
  sceneId:        string;
  text:           string;
  voice:          TTSVoice;
  sampleRate:     TTSSampleRate;
  status:         'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  outputFilename: string | null;
  errorMessage:   string | null;
  queuedAt:       string;
  startedAt:      string | null;
  completedAt:    string | null;
}

export interface VideoRender {
  id:                  string;
  shotId:              string;
  sourceImageFilename: string;
  motionPrompt:        string;
  status:              'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  comfyPromptId:       string | null;
  params:              { seed?: number; width?: number; height?: number; length?: number; fps?: number } | null;
  outputFilename:      string | null;
  workflowFilename:    string;
  errorMessage:        string | null;
  queuedAt:            string;
  startedAt:           string | null;
  completedAt:         string | null;
  // Upscale-on-demand (4x-UltraSharp → 1920×1080). Populated after the user clicks "upscale".
  upscaleStatus:        'pending' | 'running' | 'completed' | 'failed' | null;
  upscaledFilename:     string | null;
  upscalePromptId:      string | null;
  upscaleStartedAt:     string | null;
  upscaleCompletedAt:   string | null;
  upscaleErrorMessage:  string | null;
}
