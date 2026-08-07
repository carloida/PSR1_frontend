export type WindowRecord = {
  window_start: string;
  window_end: string;
  process_step: string;
  sensor_name: string;
  window_n: number;
  window_mean: number;
  window_std: number;
  window_min: number;
  window_max: number;
  window_slope: number;
  baseline_mean: number;
  baseline_std: number;
  z_score: number;
  lower_3sigma: number;
  upper_3sigma: number;
  iqr_lower_bound: number;
  iqr_upper_bound: number;
  is_3sigma_outlier: number;
  is_iqr_outlier: number;
  ewma_flag: number;
  cusum_flag: number;
  target_anomaly: number;
  weak_fault_category?: string;
  weak_fault_confidence?: number;
  rationale?: string;
};

export type Overview = {
  total_windows: number;
  normal_windows: number;
  anomaly_windows: number;
  anomaly_rate: number;
  sensor_count: number;
  process_step_count: number;
  top_weak_fault_category: string;
  top_anomalous_sensor: string;
  random_forest: ModelRow;
  isolation_forest: ModelRow;
  anomaly_by_step: Array<{ process_step: string; anomaly_windows: number }>;
  anomaly_by_sensor: Array<{ sensor_name: string; anomaly_windows: number }>;
};

export type FaultSummaryRow = {
  weak_fault_category?: string;
  weak_fault_type?: string;
  fault_category?: string;
  window_count?: number;
  count?: number;
  anomaly_windows?: number;
};

export type ModelRow = {
  model?: string;
  method?: string;
  type?: string;
  description?: string;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  roc_auc?: number;
};

export type FeatureImportanceRow = {
  feature: string;
  importance: number;
};

export type DataFile = {
  name: string;
  exists: boolean;
  size_bytes?: number | null;
  last_modified?: number | null;
};

export type PlotFile = {
  id: string;
  group: string;
  name: string;
  title: string;
  url: string;
  size_bytes?: number | null;
  last_modified?: number | null;
};

export type SensorPoint = {
  index: number;
  timestamp: string;
  value: number;
};

export type SensorStream = {
  mode: "csv_replay" | "live_stream";
  source: string;
  time_column: string;
  step_column?: string | null;
  sensor: string;
  sensors: string[];
  step: string;
  steps: string[];
  points: SensorPoint[];
  summary: {
    count: number;
    mean: number;
    std: number;
    min: number;
    max: number;
    lower_3sigma: number;
    upper_3sigma: number;
  };
};

export type DashboardData = {
  overview: Overview;
  windows: WindowRecord[];
  fault_summary: FaultSummaryRow[];
  model_comparison: ModelRow[];
  feature_importance: FeatureImportanceRow[];
  metrics: Record<string, unknown>;
  files: DataFile[];
  plot_files: PlotFile[];
};
