export type ImageRef = {
  imageId: string;
  filename: string;
  width?: number | null;
  height?: number | null;
  exists: boolean;
  thumbnailUrl: string | null;
  originalUrl: string | null;
  missingReason?: string | null;
};

export type ClusterRef = {
  clusterId: string;
  title: string;
  imageIds: string[];
  images: ImageRef[];
  color?: string;
  count?: number;
  suggestedName?: string;
};

export type JobManifest = {
  job_id: string;
  output_root: string;
  input_roots: string[];
  created_at: string;
  version: string;
  layout_version: string;
};
