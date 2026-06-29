import type { ReactNode } from 'react';
import type { ClusterData } from './types';

interface OrganizeBoardLayoutProps {
  clusters: ClusterData[];
  renderClusterCard: (cluster: ClusterData) => ReactNode;
}

const BOARD_GAP = 16;

/**
 * Board Layout layer: arranges cluster cards only.
 * Cluster width is owned by ClusterCard, not inferred from the board container.
 */
export default function OrganizeBoardLayout({
  clusters,
  renderClusterCard,
}: OrganizeBoardLayoutProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        alignContent: 'flex-start',
        gap: BOARD_GAP,
        width: '100%',
      }}
    >
      {clusters.map((cluster) => (
        <div
          key={cluster.id}
          id={`cluster-${cluster.id}`}
          style={{ flex: '0 0 auto' }}
        >
          {renderClusterCard(cluster)}
        </div>
      ))}
    </div>
  );
}
