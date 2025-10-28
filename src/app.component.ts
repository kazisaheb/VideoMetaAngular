import { Component, ChangeDetectionStrategy, signal, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from './services/gemini.service';
import { VideoMetadata } from './models/video-metadata.model';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule],
  providers: [GeminiService],
})
export class AppComponent {
  private geminiService = inject(GeminiService);

  videos = signal<VideoMetadata[]>([]);
  isProcessing = signal(false);
  isPaused = signal(false);
  currentIndex = signal(0);
  
  apiKeyMissing = signal(!this.geminiService.isConfigured());
  copiedState = signal<{ [key: string]: boolean }>({});

  canPause = computed(() => this.isProcessing() && !this.isPaused());
  canResume = computed(() => this.isProcessing() && this.isPaused());
  canStop = computed(() => this.isProcessing());
  canClear = computed(() => this.videos().length > 0 && !this.isProcessing());
  canRetry = computed(() => this.videos().some(v => v.status === 'failed') && !this.isProcessing());
  canDownload = computed(() => this.videos().some(v => v.status === 'completed') && !this.isProcessing());
  
  progress = computed(() => {
    const total = this.videos().length;
    if (total === 0) return 0;
    const current = this.currentIndex();
    return Math.round((current / total) * 100);
  });

  private processQueueRunning = false;

  constructor() {
    effect(() => {
      if (this.isProcessing() && !this.isPaused() && !this.processQueueRunning) {
        this.processQueue();
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    const newVideos: VideoMetadata[] = Array.from(input.files)
      .filter(file => file.type.startsWith('video/'))
      .map(file => ({
        id: crypto.randomUUID(),
        file,
        thumbnail: null,
        status: 'pending',
        title: '',
        keywords: [],
        errorMessage: null,
      }));

    this.videos.update(current => [...current, ...newVideos]);
    input.value = ''; // Reset file input
    
    newVideos.forEach(video => this.generateThumbnail(video));

    if (!this.isProcessing()) {
      this.startProcessing();
    }
  }

  startProcessing(): void {
    if (this.apiKeyMissing()) {
        alert('API Key is missing. Cannot start processing.');
        return;
    }
    this.isProcessing.set(true);
    this.isPaused.set(false);
  }

  async processQueue(): Promise<void> {
    this.processQueueRunning = true;
    
    while(this.currentIndex() < this.videos().length && this.isProcessing() && !this.isPaused()) {
        const video = this.videos()[this.currentIndex()];

        if (video.status === 'pending' || video.status === 'failed') {
            try {
                this.updateVideoStatus(video.id, 'processing');
                const frames = await this.extractFrames(video.file, 8);
                const metadata = await this.geminiService.generateMetadataFromFrames(frames);
                this.updateVideoResult(video.id, 'completed', metadata.title, metadata.keywords);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'An unknown error occurred';
                this.updateVideoResult(video.id, 'failed', '', [], message);
            }
        }
        this.currentIndex.update(i => i + 1);
    }

    if (this.currentIndex() >= this.videos().length) {
      this.isProcessing.set(false);
    }
    this.processQueueRunning = false;
  }

  private updateVideoStatus(id: string, status: VideoMetadata['status']): void {
    this.videos.update(videos =>
      videos.map(v => (v.id === id ? { ...v, status, errorMessage: null } : v))
    );
  }

  private updateVideoResult(id: string, status: VideoMetadata['status'], title: string, keywords: string[], error: string | null = null): void {
    this.videos.update(videos =>
      videos.map(v => (v.id === id ? { ...v, status, title, keywords, errorMessage: error } : v))
    );
  }
  
  private async extractSingleFrame(file: File, timeInSeconds: number = 1): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('Canvas context not available'));

      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      video.onloadedmetadata = () => {
        video.currentTime = Math.min(timeInSeconds, video.duration);
      };
      
      video.onseeked = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        const frame = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(objectUrl);
        resolve(frame);
      };

      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load video file for thumbnail.'));
      };
    });
  }

  private async generateThumbnail(video: VideoMetadata): Promise<void> {
    try {
      const frame = await this.extractSingleFrame(video.file, 1); // Extract frame at 1s
      this.videos.update(videos =>
        videos.map(v => (v.id === video.id ? { ...v, thumbnail: frame } : v))
      );
    } catch (error) {
      console.error(`Failed to generate thumbnail for ${video.file.name}:`, error);
    }
  }

  private async extractFrames(file: File, frameCount: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return reject(new Error('Canvas context not available'));

      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
      const frames: string[] = [];

      video.onloadedmetadata = async () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const duration = video.duration;
        const interval = duration / (frameCount + 1);

        for (let i = 1; i <= frameCount; i++) {
          video.currentTime = interval * i;
          await new Promise<void>(r => video.onseeked = () => r());
          context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
          frames.push(canvas.toDataURL('image/jpeg', 0.8));
        }

        URL.revokeObjectURL(objectUrl);
        resolve(frames);
      };

      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load video file.'));
      };
    });
  }

  pauseProcessing(): void {
    this.isPaused.set(true);
  }

  resumeProcessing(): void {
    this.isPaused.set(false);
  }

  stopProcessing(): void {
    this.isProcessing.set(false);
    this.isPaused.set(false);
    this.currentIndex.set(this.videos().length); // effectively stops the loop
  }

  retryFailed(): void {
    this.currentIndex.set(0);
    this.startProcessing();
  }

  clearAll(): void {
    this.videos.set([]);
    this.currentIndex.set(0);
    this.isProcessing.set(false);
    this.isPaused.set(false);
  }

  copyToClipboard(text: string | string[], type: string, id: string): void {
    const content = Array.isArray(text) ? text.join(', ') : text;
    navigator.clipboard.writeText(content).then(() => {
      const key = `${id}-${type}`;
      this.copiedState.update(s => ({...s, [key]: true}));
      setTimeout(() => {
        this.copiedState.update(s => ({...s, [key]: false}));
      }, 2000);
    });
  }

  downloadCSV(): void {
    const completed = this.videos().filter(v => v.status === 'completed');
    if (completed.length === 0) return;

    const header = 'Filename,Title,Keywords\n';
    const rows = completed.map(v => {
      const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
      return [escape(v.file.name), escape(v.title), escape(v.keywords.join(', '))].join(',');
    }).join('\n');

    const csvContent = header + rows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'video_metadata.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
