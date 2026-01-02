import type {
  BuilderResult,
  ProviderSettings,
  ReviewVerdict,
  WorkOrderInput,
} from "./types.js";

export interface Provider {
  name: ProviderSettings["provider"];
  runBuilder(workOrder: WorkOrderInput, settings: ProviderSettings): Promise<BuilderResult>;
  runReviewer(workOrder: WorkOrderInput, builder: BuilderResult, settings: ProviderSettings): Promise<ReviewVerdict>;
}

