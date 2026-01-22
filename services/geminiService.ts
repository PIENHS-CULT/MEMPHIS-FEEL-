
import { GoogleGenAI, Type, Modality } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

/**
 * Advanced Prompt Engineering with Thinking Mode
 */
export async function generateDeepMusicPrompt(userDescription: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Act as a world-class prompt architect. Develop an extremely detailed technical music specification for AI generation. 
    User Idea: "${userDescription}"
    Analyze genre trends, instrument synthesis, and structural dynamics.
    Respond in JSON: { "style": "...", "structure": "...", "technicalNotes": "..." }`,
    config: {
      thinkingConfig: { thinkingBudget: 32768 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          style: { type: Type.STRING },
          structure: { type: Type.STRING },
          technicalNotes: { type: Type.STRING }
        },
        required: ["style", "structure", "technicalNotes"]
      }
    }
  });
  return JSON.parse(response.text);
}

/**
 * Generates a short, calming producer tip for ambient mode.
 */
export async function generateAmbientTip() {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: "Give me one short, poetic, and calming piece of advice for a music producer struggling with creative block. Max 15 words."
  });
  return response.text;
}

/**
 * Image Generation with Aspect Ratio Control
 */
export async function generateCoverArt(prompt: string, aspectRatio: string = "1:1") {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: { parts: [{ text: `High-quality phonk style album cover: ${prompt}. Aesthetic: Gritty, dark, explosive, neon accents.` }] },
    config: {
      imageConfig: { aspectRatio: aspectRatio as any, imageSize: "1K" }
    },
  });
  
  const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
  return imagePart?.inlineData?.data ? `data:image/png;base64,${imagePart.inlineData.data}` : null;
}

/**
 * Video Generation (Veo 3.1)
 */
export async function generateVisuals(prompt: string, isPortrait: boolean = false) {
  const ai = getAI();
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: `Abstract visual loop for a phonk music track: ${prompt}. Dark atmosphere, glitch effects, intense movement.`,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: isPortrait ? '9:16' : '16:9'
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  const res = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Animate Image to Video (Veo)
 */
export async function animateImage(base64Image: string, prompt: string) {
  const ai = getAI();
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    image: { imageBytes: base64Image, mimeType: 'image/png' },
    config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  const res = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Image Understanding / Analysis
 */
export async function analyzeCoverInspiration(base64Image: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: 'image/png' } },
        { text: "Analyze this image's aesthetic and musical vibe. Suggest a phonk or industrial prompt based on its visual energy." }
      ]
    }
  });
  return response.text;
}

/**
 * Market Research with Search Grounding
 */
export async function musicMarketResearch(query: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze current trending sub-genres and market demand for: ${query}. Focus on streaming trends (Spotify/TikTok).`,
    config: { tools: [{ googleSearch: {} }] },
  });
  
  const text = response.text;
  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return { text, sources };
}

/**
 * Text-to-Speech (TTS)
 */
export async function speakFeedback(text: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Read this technical analysis clearly: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) return null;

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const buffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

/**
 * Fast Chat (Low Latency)
 */
export async function fastAssistantChat(prompt: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt
  });
  return response.text;
}

// Existing Utils
export function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Original core functions
export async function generateMusicPrompt(userDescription: string) {
  return generateDeepMusicPrompt(userDescription);
}

export async function transcribeAudio(base64Audio: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: 'audio/pcm;rate=16000', data: base64Audio } },
        { text: "Transcribe exactly." }
      ]
    }
  });
  return response.text;
}

export async function detectChords(base64Audio: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: 'audio/pcm;rate=16000', data: base64Audio } },
        { text: "Return JSON array of chords." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
    }
  });
  return JSON.parse(response.text);
}

export async function analyzeTrackForMastering(trackTitle: string, genre: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Analyze mastering for ${trackTitle} in ${genre}.`,
  });
  return response.text;
}

export async function connectLiveCoProducer(callbacks: any) {
  const ai = getAI();
  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      systemInstruction: 'You are a phonk music producer. Be brief, cool, and technical.',
    },
  });
}

export function encodePCM(data: Float32Array): string {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodePCM(base64: string): Uint8Array { return decode(base64); }
