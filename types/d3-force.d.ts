declare module "d3-force" {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
  }

  export interface SimulationLinkDatum<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum> {
    source: NodeDatum | string | number;
    target: NodeDatum | string | number;
    index?: number;
  }

  export interface Force<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  > {}

  export interface Simulation<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  > {
    alpha(): number;
    alpha(value: number): this;
    alphaTarget(value: number): this;
    alphaDecay(value: number): this;
    velocityDecay(value: number): this;
    nodes(nodes: NodeDatum[]): this;
    force(name: string): Force<NodeDatum, LinkDatum> | null;
    force(name: string, force: Force<NodeDatum, LinkDatum> | null): this;
    restart(): this;
    stop(): this;
  }

  export interface ForceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  > extends Force<NodeDatum, LinkDatum> {
    id(id: (node: NodeDatum) => string | number): this;
    distance(distance: number | ((link: LinkDatum) => number)): this;
    strength(strength: number | ((link: LinkDatum) => number)): this;
    links(links: LinkDatum[]): this;
  }

  export interface ForceManyBody<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum, SimulationLinkDatum<NodeDatum>> {
    strength(strength: number | ((node: NodeDatum) => number)): this;
  }

  export interface ForceCollide<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum, SimulationLinkDatum<NodeDatum>> {
    radius(radius: number | ((node: NodeDatum) => number)): this;
  }

  export interface ForceCenter<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum, SimulationLinkDatum<NodeDatum>> {
    x(x: number): this;
    y(y: number): this;
  }

  export function forceSimulation<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum> = SimulationLinkDatum<NodeDatum>,
  >(nodes?: NodeDatum[]): Simulation<NodeDatum, LinkDatum>;

  export function forceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum> = SimulationLinkDatum<NodeDatum>,
  >(links?: LinkDatum[]): ForceLink<NodeDatum, LinkDatum>;

  export function forceManyBody<NodeDatum extends SimulationNodeDatum>(): ForceManyBody<NodeDatum>;

  export function forceCenter<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum>(
    x?: number,
    y?: number
  ): ForceCenter<NodeDatum>;

  export function forceCollide<NodeDatum extends SimulationNodeDatum>(): ForceCollide<NodeDatum>;
}
