export interface VideoMetadata {
  id: string;
  file: File;
  thumbnail: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  title: string;
  keywords: string[];
  errorMessage: string | null;
}
