export declare class CalibrationError extends Error {}

export interface CalibrationDocumentReport {
  readonly id: string;
  readonly planted: number;
  readonly found: number;
  readonly missed: readonly string[];
  readonly falseGaps: number;
}

export interface CalibrationReport {
  readonly documents: readonly CalibrationDocumentReport[];
  readonly planted: number;
  readonly found: number;
  readonly missed: number;
  readonly falseGaps: number;
  readonly recall: number;
}

export declare function validateCorpus(corpus: unknown): readonly string[];

export declare function scoreCalibration(
  corpus: unknown,
  observed: unknown,
): CalibrationReport;

export declare function renderCalibration(report: CalibrationReport): string;
