/** Normalized image data used throughout the V2 UI. */
export interface ImageData {
  id: string;
  image_id?: string;
  filename: string;
  image_path: string;
  clusterId: string;
  thumbUrl: string;
  /** Aspect ratio (width/height). 1.0 if unknown. */
  aspectRatio?: number;
}

export interface ClusterData {
  id: string;
  name: string;
  count: number;
  color: string;
  images: ImageData[];
  suggestedName: string;
}

export interface PendingMoves {
  [filename: string]: string;
}

export interface PendingRenames {
  [clusterId: string]: string;
}

/** Cluster layout positions (from cluster_layout.json). */
export interface ClusterLayout {
  [clusterId: string]: { x: number; y: number };
}

/** Manual image order per cluster (from manual_order.json). */
export interface ManualOrder {
  [clusterId: string]: string[]; // ordered filenames
}

/** View state for the organize board. */
export type ViewMode = 'cluster' | 'global' | 'manual';

/** Stable contact-sheet tile size presets for Organize. */
export type TileSize = 'small' | 'medium' | 'large' | 'xlarge';

/** Image fitting inside a fixed tile frame. */
export type FitMode = 'cover' | 'contain';

/** User-controlled cluster contact-sheet column mode. */
export type ClusterColumnsMode = 'auto' | '2' | '3' | '4';
