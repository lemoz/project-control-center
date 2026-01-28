"use client";

type LaneNode = { id: string };

export type TechTreeLaneLayout = {
  id: string;
  name: string;
  color: string | null;
  nodes: LaneNode[];
  isUnassigned: boolean;
  top: number;
  height: number;
  isCollapsed: boolean;
};

type TechTreeSwimlanesProps = {
  lanes: TechTreeLaneLayout[];
  svgWidth: number;
  isTrackVisible: (trackId: string) => boolean;
  onToggleLane?: (laneId: string) => void;
  showHeaders?: boolean;
  showBackgrounds?: boolean;
};

const DEFAULT_LANE_COLOR = "#334155";
const LANE_HEADER_HEIGHT = 32;

export function TechTreeSwimlanes({
  lanes,
  svgWidth,
  isTrackVisible,
  onToggleLane,
  showHeaders = true,
  showBackgrounds = true,
}: TechTreeSwimlanesProps) {
  const visibleLanes = lanes.filter((lane) => isTrackVisible(lane.id));

  return (
    <>
      {showBackgrounds &&
        visibleLanes.map((lane) => {
          const laneColor = lane.color ?? DEFAULT_LANE_COLOR;
          return (
            <rect
              key={`lane-bg-${lane.id}`}
              x={0}
              y={lane.top}
              width={svgWidth}
              height={lane.height}
              fill={laneColor}
              opacity={0.08}
            />
          );
        })}

      {showHeaders &&
        visibleLanes.map((lane) => {
          const laneColor = lane.color ?? DEFAULT_LANE_COLOR;
          const nodeCount = lane.nodes.length;
          const indicator = lane.isCollapsed ? ">" : "v";
          const handleClick = onToggleLane ? () => onToggleLane(lane.id) : undefined;
          return (
            <g
              key={`lane-header-${lane.id}`}
              onClick={handleClick}
              style={{ cursor: onToggleLane ? "pointer" : "default" }}
            >
              <rect
                x={0}
                y={lane.top}
                width={svgWidth}
                height={LANE_HEADER_HEIGHT}
                fill="#111827"
                opacity={0.9}
              />
              <rect x={16} y={lane.top + 9} width={10} height={10} rx={2} fill={laneColor} />
              <text x={32} y={lane.top + 20} fill="#e5e7eb" fontSize={12} fontWeight={600}>
                {lane.name} - {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
              </text>
              <text
                x={svgWidth - 16}
                y={lane.top + 20}
                textAnchor="end"
                fill="#9ca3af"
                fontSize={12}
              >
                {indicator}
              </text>
            </g>
          );
        })}
    </>
  );
}
