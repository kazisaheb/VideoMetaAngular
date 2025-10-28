import { Injectable } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private readonly apiKey?: string = process.env.API_KEY;

  constructor() {
    if (this.apiKey) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async generateMetadataFromFrames(frames: string[]): Promise<{ title: string; keywords: string[] }> {
    if (!this.ai) {
      throw new Error('Gemini API key is not configured.');
    }

    const imageParts = frames.map(frame => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: frame.split(',')[1], // Remove the "data:image/jpeg;base64," prefix
      },
    }));

    const textPart = {
      text: 'Analyze these video frames to understand the content, context, and potential audience. Generate a searchable and SEO-friendly title between 15 and 20 words long. Also, generate a list of 40 to 45 highly relevant and diverse keywords/tags that cover the main subjects, objects, themes, actions, and artistic style of the video.',
    };

    try {
      const response: GenerateContentResponse = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [textPart, ...imageParts] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'A searchable and SEO-friendly title, between 15 and 20 words long.',
              },
              keywords: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                },
                description: 'A list of 40 to 45 relevant keywords.',
              },
            },
            required: ['title', 'keywords'],
          },
        },
      });
      
      const jsonString = response.text.trim();
      const result = JSON.parse(jsonString);
      return result;

    } catch (error) {
      console.error('Error generating metadata:', error);
      throw new Error('Failed to generate metadata from Gemini API.');
    }
  }
}
